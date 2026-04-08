(function () {
  const D = window.RetireData;
  const C = window.RetireCalc;

  // inputs  — plain object built by gatherInputs() in app.js
  // accounts — interest-bearing accounts array (may be empty)
  function runProjection(inputs, accounts) {
    const {
      startYear, endYear,
      p1DOB, p2DOB,
      p1name, p2name,
      spending, stepDownPct,
      p1Salary, p1SalaryStop,
      p2Salary, p2SalaryStop,
      p1SPAge, p1SPAmt,
      p2SPAge, p2SPAmt,
      growth, inflation,
      thresholdMode, thresholdFromYear,
      bniEnabled, bniP1GIA, bniP2GIA,
      dividendYield,
      withdrawalMode,
      p1Order, p2Order,
    } = inputs;

    // Deep-copy balances so the engine never mutates the caller's object
    const p1Bal = { ...inputs.p1Bal };
    const p2Bal = { ...inputs.p2Bal };

    if (!startYear || !endYear || endYear <= startYear) {
      alert('Please enter valid start and end years.');
      return null;
    }

    const ISA_ALLOWANCE = D.ISA_ALLOWANCE;

    const intAccts = (accounts || [])
      .filter(a => a.rate != null || a.monthlyDraw != null)
      .map(a => ({
        name:        a.name,
        owner:       a.owner,
        wrapper:     a.wrapper,
        balance:     a.value || 0,
        rate:        a.rate || 0,
        monthlyDraw: a.monthlyDraw || 0,
      }));

    let p1GIACost = p1Bal.GIA;
    let p2GIACost = p2Bal.GIA;

    const startBal = {
      [`${p1name} Cash`]: p1Bal.Cash, [`${p1name} GIA`]: p1Bal.GIA,
      [`${p1name} SIPP`]: p1Bal.SIPP, [`${p1name} ISA`]: p1Bal.ISA,
      [`${p2name} Cash`]: p2Bal.Cash, [`${p2name} GIA`]: p2Bal.GIA,
      [`${p2name} SIPP`]: p2Bal.SIPP, [`${p2name} ISA`]: p2Bal.ISA,
    };
    intAccts.forEach(a => {
      startBal[a.name + ' (' + a.owner + ')'] = a.balance || a.value || 0;
    });

    const depletions = {};
    let cumInfl = 1;
    const rows = [];

    for (let year = startYear; year <= endYear; year++) {
      const p1Age = year - p1DOB;
      const p2Age = year - p2DOB;
      const realDeflator = 1 / cumInfl;

      const p1SP     = p1Age >= p1SPAge ? p1SPAmt * cumInfl : 0;
      const p2SP     = p2Age >= p2SPAge ? p2SPAmt * cumInfl : 0;
      const p2SalInc = (p2SalaryStop && p2Age <= p2SalaryStop) ? p2Salary * cumInfl : 0;
      const p1SalInc = (p1SalaryStop && p1Age <= p1SalaryStop) ? p1Salary * cumInfl : 0;
      const target   = (spending * cumInfl) * (
        stepDownPct > 0 && p1Age >= 75 ? (1 - stepDownPct / 100) : 1
      );

      // Tax threshold uprating
      let uprateFactor = 1;
      if (thresholdMode === 'always') {
        uprateFactor = cumInfl;
      } else if (thresholdMode === 'fromYear' && year >= thresholdFromYear) {
        uprateFactor = cumInfl / Math.pow(1 + inflation, thresholdFromYear - startYear);
      }
      const baseRules     = C.getTaxRulesForYear(year);
      const effThresholds = C.upratedTaxRules(baseRules, uprateFactor);
      const effCGTExempt  = effThresholds.cgtExempt;

      // FIX 2: GIA dividends — opening balance × yield, treated as cashflow (not reinvested)
      const p1GIAOpen = p1Bal.GIA || 0;
      const p2GIAOpen = p2Bal.GIA || 0;
      const p1Divs    = p1GIAOpen * dividendYield;
      const p2Divs    = p2GIAOpen * dividendYield;

      // FIX 1: annual CGT gain accumulators — reset each year, exemption applied once at year-end
      let p1AnnualGains = 0;
      let p2AnnualGains = 0;

      // Capture opening GIA balances and compute gain ratios ONCE (pre-growth, pre-B&I)
      const p1GIABalBefore = p1Bal.GIA || 0;
      const p2GIABalBefore = p2Bal.GIA || 0;
      const p1GainRatio = p1GIABalBefore > 0
        ? Math.max(0, p1GIABalBefore - p1GIACost) / p1GIABalBefore
        : 0;
      const p2GainRatio = p2GIABalBefore > 0
        ? Math.max(0, p2GIABalBefore - p2GIACost) / p2GIABalBefore
        : 0;

      // Bed-and-ISA: accumulate gains only, no exemption applied here
      if (bniEnabled) {
        if (bniP1GIA > 0 && p1Bal.GIA > 0) {
          const transfer  = Math.min(bniP1GIA, p1Bal.GIA, ISA_ALLOWANCE);
          p1AnnualGains  += transfer * p1GainRatio;
          const costFrac  = p1GIABalBefore > 0 ? transfer / p1GIABalBefore : 1;
          p1Bal.GIA      -= transfer;
          p1Bal.ISA      += transfer;
          p1GIACost       = Math.max(0, p1GIACost * (1 - costFrac));
        }
        if (bniP2GIA > 0 && p2Bal.GIA > 0) {
          const transfer  = Math.min(bniP2GIA, p2Bal.GIA, ISA_ALLOWANCE);
          p2AnnualGains  += transfer * p2GainRatio;
          const costFrac  = p2GIABalBefore > 0 ? transfer / p2GIABalBefore : 1;
          p2Bal.GIA      -= transfer;
          p2Bal.ISA      += transfer;
          p2GIACost       = Math.max(0, p2GIACost * (1 - costFrac));
        }
      }

      // Priority 1: interest-bearing accounts
      let intDrawTotal = 0, p1IntDraw = 0, p2IntDraw = 0;
      let p1IntTaxable = 0, p2IntTaxable = 0;
      intAccts.forEach(a => {
        if ((a.balance || 0) <= 0) return;

        const effectiveRate  = C.interestEffective(a.rate);
        const interestEarned = (a.balance || 0) * effectiveRate;
        const annualTarget   = (a.monthlyDraw || 0) * 12;
        const isP1           = a.owner === 'p1'; // FIX: compare token, not display name

        if (annualTarget <= 0) {
          a.balance += interestEarned;
          if (a.wrapper !== 'ISA') {
            if (isP1) p1IntTaxable += interestEarned;
            else p2IntTaxable += interestEarned;
          }
          return;
        }

        const drawActual    = Math.min(annualTarget, a.balance + interestEarned);
        const interestDrawn = Math.min(drawActual, interestEarned);

        a.balance -= Math.max(0, drawActual - interestDrawn);
        a.balance += interestEarned - interestDrawn;

        intDrawTotal += drawActual;
        if (isP1) p1IntDraw += drawActual;
        else p2IntDraw += drawActual;

        if (a.wrapper !== 'ISA') {
          if (isP1) p1IntTaxable += interestEarned;
          else p2IntTaxable += interestEarned;
        }

        const key = a.name + ' (' + a.owner + ')';
        if (!depletions[key] && (startBal[key] || 0) > 0 && a.balance <= 0) {
          depletions[key] = { year, age: year - (isP1 ? p1DOB : p2DOB) };
        }
      });

      // Priority 2: cash (dividends now count as guaranteed income)
      const guaranteed = p1SP + p2SP + p2SalInc + p1SalInc + intDrawTotal + p1Divs + p2Divs;
      let shortfall    = Math.max(0, target - guaranteed);

      let p1CashDrawn = 0;
      let p2CashDrawn = 0;

      if (shortfall > 0) {
        const totalCash = (p1Bal.Cash || 0) + (p2Bal.Cash || 0);
        const cashDrawn = Math.min(shortfall, totalCash);
        const fromP1    = Math.min(cashDrawn, p1Bal.Cash || 0);
        const fromP2    = Math.max(0, cashDrawn - fromP1);

        p1Bal.Cash -= fromP1;
        p2Bal.Cash = Math.max(0, (p2Bal.Cash || 0) - fromP2);

        p1CashDrawn = fromP1;
        p2CashDrawn = fromP2;
        shortfall  -= cashDrawn;
      }

      // Priority 3: wrapper draws
      const p1WrapperOrder = p1Order.filter(w => w !== 'Cash');
      const p2WrapperOrder = p2Order.filter(w => w !== 'Cash');
      let p1Drawn, p2Drawn;

      if (withdrawalMode === '50/50') {
        // Purely mechanical equal split — no tax logic applied
        const p1Half  = shortfall / 2;
        p1Drawn       = C.withdraw(p1Bal, p1WrapperOrder, p1Half);
        const p1Unmet = Math.max(0, p1Half - p1Drawn.GIA - p1Drawn.SIPP - p1Drawn.ISA);

        p2Drawn       = C.withdraw(p2Bal, p2WrapperOrder, shortfall / 2 + p1Unmet);
        const p2Unmet = Math.max(
          0,
          (shortfall / 2 + p1Unmet) - p2Drawn.GIA - p2Drawn.SIPP - p2Drawn.ISA
        );

        if (p2Unmet > 0) {
          const extra = C.withdraw(p1Bal, p1WrapperOrder, p2Unmet);
          p1Drawn.GIA += extra.GIA;
          p1Drawn.SIPP += extra.SIPP;
          p1Drawn.ISA += extra.ISA;
          p1Drawn.sippTaxable += extra.sippTaxable;
        }
      } else {
        // FIX 3: tax-aware mode — SIPP to fill PA, then proportional split by remaining headroom

        // Step 1: PA headroom — deduct all known income that consumes PA
        const p1GuaranteedNS = p1SP + p1SalInc + p1IntTaxable + p1Divs;
        const p2GuaranteedNS = p2SP + p2SalInc + p2IntTaxable + p2Divs;
        const p1PAHeadroom   = Math.max(0, effThresholds.PA - p1GuaranteedNS);
        const p2PAHeadroom   = Math.max(0, effThresholds.PA - p2GuaranteedNS);

        // Step 2: draw SIPP to fill PA (gross = headroom / 0.75 because 75% of SIPP is taxable)
        const p1SippTarget = p1PAHeadroom > 0
          ? Math.min(p1PAHeadroom / 0.75, p1Bal.SIPP || 0)
          : 0;
        const p2SippTarget = p2PAHeadroom > 0
          ? Math.min(p2PAHeadroom / 0.75, p2Bal.SIPP || 0)
          : 0;

        p1Drawn = C.withdraw(p1Bal, ['SIPP'], p1SippTarget);
        p2Drawn = C.withdraw(p2Bal, ['SIPP'], p2SippTarget);

        // Step 3: remaining shortfall split proportionally by remaining PA headroom
        const p1SippTaxable = p1Drawn.sippTaxable;
        const p2SippTaxable = p2Drawn.sippTaxable;
        const p1RemHeadroom = Math.max(0, p1PAHeadroom - p1SippTaxable);
        const p2RemHeadroom = Math.max(0, p2PAHeadroom - p2SippTaxable);
        const sippDrawTotal = p1Drawn.SIPP + p2Drawn.SIPP;
        const remShortfall  = Math.max(0, shortfall - sippDrawTotal);

        const totalHeadroom = p1RemHeadroom + p2RemHeadroom;
        const p1Weight      = totalHeadroom > 0 ? p1RemHeadroom / totalHeadroom : 0.5;
        const p2Weight      = 1 - p1Weight;

        const p1NonSippOrder = p1WrapperOrder.filter(w => w !== 'SIPP' && w !== 'Cash');
        const p2NonSippOrder = p2WrapperOrder.filter(w => w !== 'SIPP' && w !== 'Cash');

        const p1RemDrawn = C.withdraw(p1Bal, p1NonSippOrder, remShortfall * p1Weight);
        const p2RemDrawn = C.withdraw(p2Bal, p2NonSippOrder, remShortfall * p2Weight);

        // Merge draws
        p1Drawn.GIA += p1RemDrawn.GIA;
        p1Drawn.ISA += p1RemDrawn.ISA;
        p2Drawn.GIA += p2RemDrawn.GIA;
        p2Drawn.ISA += p2RemDrawn.ISA;

        // Fallback: unmet demand goes to the other person, including SIPP as last resort
        const p1Unmet = Math.max(
          0,
          remShortfall * p1Weight - p1RemDrawn.GIA - p1RemDrawn.ISA - p1RemDrawn.SIPP
        );
        const p2Unmet = Math.max(
          0,
          remShortfall * p2Weight - p2RemDrawn.GIA - p2RemDrawn.ISA - p2RemDrawn.SIPP
        );

        if (p1Unmet > 0) {
          const extra = C.withdraw(p2Bal, p2WrapperOrder, p1Unmet);
          p2Drawn.GIA += extra.GIA;
          p2Drawn.ISA += extra.ISA;
          p2Drawn.SIPP += extra.SIPP;
          p2Drawn.sippTaxable += extra.sippTaxable;
        }
        if (p2Unmet > 0) {
          const extra = C.withdraw(p1Bal, p1WrapperOrder, p2Unmet);
          p1Drawn.GIA += extra.GIA;
          p1Drawn.ISA += extra.ISA;
          p1Drawn.SIPP += extra.SIPP;
          p1Drawn.sippTaxable += extra.sippTaxable;
        }

        // Final catch-all: if shortfall still unmet after all above
        // (e.g. PA-capped SIPP draw + empty ISA/GIA), draw more SIPP regardless of PA limit
        const totalDrawn = p1Drawn.GIA + p1Drawn.SIPP + p1Drawn.ISA
                         + p2Drawn.GIA + p2Drawn.SIPP + p2Drawn.ISA;
        const stillUnmet = Math.max(0, shortfall - totalDrawn);
        if (stillUnmet > 0) {
          const p1Extra = C.withdraw(p1Bal, ['SIPP'], stillUnmet / 2);
          const p2Extra = C.withdraw(p2Bal, ['SIPP'], stillUnmet / 2 + Math.max(0, stillUnmet / 2 - p1Extra.SIPP));
          p1Drawn.SIPP += p1Extra.SIPP;
          p1Drawn.sippTaxable += p1Extra.sippTaxable;
          p2Drawn.SIPP += p2Extra.SIPP;
          p2Drawn.sippTaxable += p2Extra.sippTaxable;
          // If p2 couldn't cover its share, try p1 again for the remainder
          const p2StillUnmet = Math.max(0, stillUnmet / 2 - p2Extra.SIPP);
          if (p2StillUnmet > 0) {
            const p1Last = C.withdraw(p1Bal, ['SIPP'], p2StillUnmet);
            p1Drawn.SIPP += p1Last.SIPP;
            p1Drawn.sippTaxable += p1Last.sippTaxable;
          }
        }
      }

      p1Drawn.Cash += p1CashDrawn;
      p2Drawn.Cash += p2CashDrawn;

      // Growth (cost basis NOT grown — gains accumulate naturally)
      C.growBalances(p1Bal, growth);
      C.growBalances(p2Bal, growth);

      // Accumulate withdrawal GIA gains using pre-computed gainRatio (no exemption yet)
      p1AnnualGains += p1Drawn.GIA * p1GainRatio;
      p2AnnualGains += p2Drawn.GIA * p2GainRatio;

      if (p1GIABalBefore > 0 && p1Drawn.GIA > 0) {
        p1GIACost = Math.max(
          0,
          p1GIACost * (1 - Math.min(1, p1Drawn.GIA / p1GIABalBefore))
        );
      }
      if (p2GIABalBefore > 0 && p2Drawn.GIA > 0) {
        p2GIACost = Math.max(
          0,
          p2GIACost * (1 - Math.min(1, p2Drawn.GIA / p2GIABalBefore))
        );
      }

      // Income tax first (required for CGT band stacking)
      const p1NonSavings = p1SP + p1SalInc + p1Drawn.sippTaxable;
      const p2NonSavings = p2SP + p2SalInc + p2Drawn.sippTaxable;
      const p1Income     = C.calcIncomeTaxDetailed(p1NonSavings, p1IntTaxable, p1Divs, effThresholds);
      const p2Income     = C.calcIncomeTaxDetailed(p2NonSavings, p2IntTaxable, p2Divs, effThresholds);

      // FIX 1: single CGT per person — one exemption applied to full annual gains
      const p1TaxableGain = Math.max(0, p1AnnualGains - effCGTExempt);
      const p2TaxableGain = Math.max(0, p2AnnualGains - effCGTExempt);
      const p1CGT         = C.calcCGT(p1Income.taxableIncomeAfterPA, p1TaxableGain, effThresholds);
      const p2CGT         = C.calcCGT(p2Income.taxableIncomeAfterPA, p2TaxableGain, effThresholds);

      // Pay CGT from cash where possible
      if (p1CGT > 0) {
        const f = Math.min(p1CGT, p1Bal.Cash || 0);
        p1Bal.Cash -= f;
      }
      if (p2CGT > 0) {
        const f = Math.min(p2CGT, p2Bal.Cash || 0);
        p2Bal.Cash -= f;
      }

      const p1NI = C.calcEmployeeNI(p1SalInc, effThresholds, p1Age >= p1SPAge);
      const p2NI = C.calcEmployeeNI(p2SalInc, effThresholds, p2Age >= p2SPAge);

      // Depletion tracking — keys kept as "${name} Wrapper" (unchanged; rename deferred)
      const checkMap = {
        [`${p1name} Cash`]: p1Bal.Cash, [`${p1name} GIA`]: p1Bal.GIA,
        [`${p1name} SIPP`]: p1Bal.SIPP, [`${p1name} ISA`]: p1Bal.ISA,
        [`${p2name} Cash`]: p2Bal.Cash, [`${p2name} GIA`]: p2Bal.GIA,
        [`${p2name} SIPP`]: p2Bal.SIPP, [`${p2name} ISA`]: p2Bal.ISA,
      };
      Object.entries(checkMap).forEach(([key, bal]) => {
        if (!depletions[key] && (startBal[key] || 0) > 0 && bal <= 0) {
          depletions[key] = {
            year,
            age: year - (key.startsWith(p1name) ? p1DOB : p2DOB),
          };
        }
      });

      // FIX: filter by 'p1'/'p2' token, not display name
      const intBalP1 = intAccts
        .filter(a => a.owner === 'p1')
        .reduce((s, a) => s + (a.balance || 0), 0);
      const intBalP2 = intAccts
        .filter(a => a.owner !== 'p1')
        .reduce((s, a) => s + (a.balance || 0), 0);

      const p1GrossIncome =
        p1SP +
        p1SalInc +
        p1IntDraw +
        p1Divs +
        (p1Drawn.Cash || 0) +
        (p1Drawn.GIA || 0) +
        (p1Drawn.SIPP || 0) +
        (p1Drawn.ISA || 0);

      const p2GrossIncome =
        p2SP +
        p2SalInc +
        p2IntDraw +
        p2Divs +
        (p2Drawn.Cash || 0) +
        (p2Drawn.GIA || 0) +
        (p2Drawn.SIPP || 0) +
        (p2Drawn.ISA || 0);

      const p1TaxTotal = p1Income.tax + p1CGT + p1NI;
      const p2TaxTotal = p2Income.tax + p2CGT + p2NI;

      const householdGrossIncome = p1GrossIncome + p2GrossIncome;
      const householdTax         = p1TaxTotal + p2TaxTotal;
      const householdNetIncome   = householdGrossIncome - householdTax;

      const spendingShortfall = Math.max(0, target - householdNetIncome);
      const spendingSurplus   = Math.max(0, householdNetIncome - target);

      const p1NaturalIncome = p1SP + p1SalInc + p1IntDraw + p1Divs;    
      const p2NaturalIncome =  p2SP + p2SalInc + p2IntDraw + p2Divs;
    
      const householdNaturalIncome = p1NaturalIncome + p2NaturalIncome;
    
      const p1NaturalNet = p1NaturalIncome - p1Income.tax - p1NI;
      const p2NaturalNet = p2NaturalIncome - p2Income.tax - p2NI;
      const householdNaturalNet = p1NaturalNet + p2NaturalNet;

      const p1NetIncome = p1GrossIncome - p1TaxTotal;
      const p2NetIncome = p2GrossIncome - p2TaxTotal;

        rows.push({
        year, p1Age, p2Age,

        target,

        p1SP, p2SP, p1SalInc, p2SalInc,
        intDrawTotal, p1IntDraw, p2IntDraw,
        p1IntTaxable, p2IntTaxable,
        p1Divs, p2Divs,
        p1Drawn, p2Drawn,

        p1IncomeTax: p1Income.tax,
        p2IncomeTax: p2Income.tax,
        p1CGT,
        p2CGT,
        p1NI,
        p2NI,

        p1Tax: p1TaxTotal,
        p2Tax: p2TaxTotal,

        p1GrossIncome,
        p2GrossIncome,
        householdGrossIncome,
        householdTax,
        householdNetIncome,
        p1NetIncome,
        p2NetIncome,
        spendingShortfall,
        spendingSurplus,

        p1NaturalNet,
        p2NaturalNet,
        householdNaturalNet,

        p1TaxInc: p1NonSavings + p1IntTaxable + p1Divs,
        p2TaxInc: p2NonSavings + p2IntTaxable + p2Divs,
        p1AnnualGains,
        p2AnnualGains,
        bniCGTBill: p1CGT + p2CGT,

        totalPortfolio: C.totalBal(p1Bal) + C.totalBal(p2Bal) + intBalP1 + intBalP2,
        realDeflator,
        cumInfl,

        snap: {
          p1Cash: p1Bal.Cash, p1IntBal: intBalP1,
          p1GIA:  p1Bal.GIA,  p1SIPP:   p1Bal.SIPP, p1ISA: p1Bal.ISA,
          p2Cash: p2Bal.Cash, p2IntBal: intBalP2,
          p2GIA:  p2Bal.GIA,  p2SIPP:   p2Bal.SIPP, p2ISA: p2Bal.ISA,
        },
      });

      cumInfl *= (1 + inflation); // advance AFTER this year's figures are recorded
    }

    return { rows, depletions };
  }

  window.RetireEngine = { runProjection };
})();