(function () {
  const D = window.RetireData;
  const C = window.RetireCalc;
  const T = window.RetireTax;
  const L = window.RetireLedger;

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
      bniEnabled, bniP1GIA, bniP1Years, bniP2GIA, bniP2Years,
      dividendYield,
      dividendMode,
      strategy,
    } = inputs;

    // Fallback wrapper order used by applyFallback inside withdrawalStrategy.
    // Cash is excluded here; SIPP lock is applied per-year below.
    // app.js no longer supplies p1Order/p2Order — order is fixed as GIA→SIPP→ISA.
    const BASE_WRAPPER_ORDER = ['GIA', 'SIPP', 'ISA'];

    // Deep-copy balances so the engine never mutates the caller's object
    const p1Bal = { ...inputs.p1Bal };
    const p2Bal = { ...inputs.p2Bal };

    // Merge GIAeq + GIAcash → GIA (the engine's internal key).
    // app.js splits GIA into equity and cashlike portions for the MC worker;
    // the engine uses a single .GIA key. GIAcash accounts that have a rate/draw
    // are handled via intAccts and their balance is subtracted from p1Bal.GIA
    // below, so including GIAcash here is safe — the intAccts loop corrects it.
    p1Bal.GIA = (inputs.p1Bal.GIAeq || 0) + (inputs.p1Bal.GIAcash || 0);
    p2Bal.GIA = (inputs.p2Bal.GIAeq || 0) + (inputs.p2Bal.GIAcash || 0);

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

    // FIX: GIA-wrapper interest accounts (e.g. QMMF) are taxed on their yield
    // separately via p1IntTaxable. Remove their balances from p1Bal.GIA / p2Bal.GIA
    // so they do not also generate phantom dividend income — preventing double-counting.
    intAccts.forEach(a => {
      if (a.wrapper === 'GIA') {
        if (a.owner === 'p1') p1Bal.GIA = Math.max(0, (p1Bal.GIA || 0) - a.balance);
        else                  p2Bal.GIA = Math.max(0, (p2Bal.GIA || 0) - a.balance);
      }
    });

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
    const annotations = [];
    let cumInfl = 1;
    const rows = [];

    // Bed-and-ISA: track how many active transfer years have elapsed per person
    let bniP1YearsUsed = 0;
    let bniP2YearsUsed = 0;

    for (let year = startYear; year <= endYear; year++) {
      const p1Age = year - p1DOB;
      const p2Age = year - p2DOB;
      const realDeflator = 1 / cumInfl;

      const p1SP     = p1Age >= p1SPAge ? p1SPAmt * cumInfl : 0;
      const p2SP     = p2Age >= p2SPAge ? p2SPAmt * cumInfl : 0;
      const p2SalInc = (p2SalaryStop && p2Age <= p2SalaryStop) ? p2Salary * cumInfl : 0;
      const p1SalInc = (p1SalaryStop && p1Age <= p1SalaryStop) ? p1Salary * cumInfl : 0;

      // Annotations: one-off lifecycle events
      if (p1Age === p1SPAge && p1SPAmt > 0)
        annotations.push({ year, person: 'p1', event: 'sp_starts',
          message: `${p1name}'s State Pension begins (£${Math.round(p1SPAmt).toLocaleString('en-GB')}/yr)` });
      if (p2Age === p2SPAge && p2SPAmt > 0)
        annotations.push({ year, person: 'p2', event: 'sp_starts',
          message: `${p2name}'s State Pension begins (£${Math.round(p2SPAmt).toLocaleString('en-GB')}/yr)` });
      if (p1SalaryStop && p1Age === p1SalaryStop + 1 && p1Salary > 0)
        annotations.push({ year, person: 'p1', event: 'salary_stop',
          message: `${p1name}'s salary stops` });
      if (p2SalaryStop && p2Age === p2SalaryStop + 1 && p2Salary > 0)
        annotations.push({ year, person: 'p2', event: 'salary_stop',
          message: `${p2name}'s salary stops` });

      // Minimum pension access age: 55 before 2028, 57 from 2028 onwards.
      const minPensionAge = year >= 2028 ? 57 : 55;
      const p1SIPPLocked  = p1Age < minPensionAge;
      const p2SIPPLocked  = p2Age < minPensionAge;

      if (p1Age === minPensionAge && (p1Bal.SIPP || 0) > 0)
        annotations.push({ year, person: 'p1', event: 'sipp_unlocked',
          message: `${p1name}'s pension accessible from age ${minPensionAge}` });
      if (p2Age === minPensionAge && (p2Bal.SIPP || 0) > 0)
        annotations.push({ year, person: 'p2', event: 'sipp_unlocked',
          message: `${p2name}'s pension accessible from age ${minPensionAge}` });

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

      // GIA dividends — always taxable on arising basis (HMRC), regardless of reinvest/payout.
      // p1Divs     = earned/taxable (always computed)
      // p1DivsUsed = cashflow only (= p1Divs in payout, 0 in reinvest)
      const p1GIAOpen  = p1Bal.GIA || 0;
      const p2GIAOpen  = p2Bal.GIA || 0;
      const p1Divs = p1GIAOpen * dividendYield;
      const p2Divs = p2GIAOpen * dividendYield;
      let p1DivsUsed, p2DivsUsed;

      if (dividendMode === 'reinvest') {
        p1DivsUsed = 0; p2DivsUsed = 0;
        // GIA balance not reduced — dividends compound inside wrapper
      } else {
        p1DivsUsed = p1Divs;
        p2DivsUsed = p2Divs;
        // Deduct dividends from GIA before growth so growth applies to ex-dividend balance
        p1Bal.GIA  = Math.max(0, (p1Bal.GIA || 0) - p1Divs);
        p2Bal.GIA  = Math.max(0, (p2Bal.GIA || 0) - p2Divs);
      }

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
        if (bniP1GIA > 0 && p1Bal.GIA > 0 && bniP1YearsUsed < bniP1Years) {
          const transfer  = Math.min(bniP1GIA, p1Bal.GIA, ISA_ALLOWANCE);
          p1AnnualGains  += transfer * p1GainRatio;
          const costFrac  = p1GIABalBefore > 0 ? transfer / p1GIABalBefore : 1;
          p1Bal.GIA      -= transfer;
          p1Bal.ISA      += transfer;
          p1GIACost       = Math.max(0, p1GIACost * (1 - costFrac));
          bniP1YearsUsed++;
        }
        if (bniP2GIA > 0 && p2Bal.GIA > 0 && bniP2YearsUsed < bniP2Years) {
          const transfer  = Math.min(bniP2GIA, p2Bal.GIA, ISA_ALLOWANCE);
          p2AnnualGains  += transfer * p2GainRatio;
          const costFrac  = p2GIABalBefore > 0 ? transfer / p2GIABalBefore : 1;
          p2Bal.GIA      -= transfer;
          p2Bal.ISA      += transfer;
          p2GIACost       = Math.max(0, p2GIACost * (1 - costFrac));
          bniP2YearsUsed++;
        }
      }

      // Priority 1: interest-bearing accounts — capped to spending gap only
      let intDrawTotal = 0, p1IntDraw = 0, p2IntDraw = 0;
      let p1IntTaxable = 0, p2IntTaxable = 0;

      // How much of the target is already covered before interest draws
      const preIntGuaranteed = p1SP + p2SP + p1SalInc + p2SalInc + p1DivsUsed + p2DivsUsed;
      // Surplus salary/SP above target goes to p1 cash buffer
      const preIntSurplus    = Math.max(0, preIntGuaranteed - target);
      if (preIntSurplus > 0) {
        p1Bal.Cash = (p1Bal.Cash || 0) + preIntSurplus;
        annotations.push({ year, person: 'p1', event: 'cash_surplus',
          message: `Household surplus income (£${Math.round(preIntSurplus).toLocaleString('en-GB')}) above target parked in ${p1name}'s Cash` });
      }
      let intBudget = Math.max(0, target - preIntGuaranteed);

      intAccts.forEach(a => {
        if ((a.balance || 0) <= 0) return;

        const effectiveRate  = C.interestEffective(a.rate);
        const interestEarned = (a.balance || 0) * effectiveRate;
        const annualTarget   = (a.monthlyDraw || 0) * 12;
        const isP1           = a.owner === 'p1';

        if (annualTarget <= 0) {
          a.balance += interestEarned;
          if (a.wrapper !== 'ISA') {
            if (isP1) p1IntTaxable += interestEarned;
            else p2IntTaxable += interestEarned;
          }
          return;
        }

        // Cap draw to remaining spending budget
        const drawActual    = Math.min(annualTarget, intBudget, a.balance + interestEarned);
        const interestDrawn = Math.min(drawActual, interestEarned);

        a.balance -= Math.max(0, drawActual - interestDrawn);
        a.balance += interestEarned - interestDrawn;

        intDrawTotal += drawActual;
        intBudget    -= drawActual;
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
      const guaranteed = p1SP + p2SP + p2SalInc + p1SalInc + intDrawTotal + p1DivsUsed + p2DivsUsed;
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

      // Priority 3: wrapper draws — delegated to withdrawal strategy layer.
      // Ledgers track remaining allowances per person at this point in the year.
      // Already consumed upstream: SP + salary (non-savings), interest (savings), dividends.
      const p1Ledger = L.initialiseLedger(effThresholds);
      const p2Ledger = L.initialiseLedger(effThresholds);

      // Consume guaranteed non-savings income (SP + salary)
      L.consumeNonSavings(p1Ledger, p1SP + p1SalInc);
      L.consumeNonSavings(p2Ledger, p2SP + p2SalInc);

      // Consume taxable savings interest
      L.consumeSavings(p1Ledger, p1IntTaxable);
      L.consumeSavings(p2Ledger, p2IntTaxable);

      // Consume GIA dividends (taxed on arising basis regardless of draw)
      L.consumeDividends(p1Ledger, p1Divs);
      L.consumeDividends(p2Ledger, p2Divs);

      // Consume B&I gains accumulated so far this year
      L.consumeGains(p1Ledger, p1AnnualGains);
      L.consumeGains(p2Ledger, p2AnnualGains);

      const p1WrapperOrder = BASE_WRAPPER_ORDER.filter(w => !(w === 'SIPP' && p1SIPPLocked));
      const p2WrapperOrder = BASE_WRAPPER_ORDER.filter(w => !(w === 'SIPP' && p2SIPPLocked));

      const { p1Drawn, p2Drawn } = window.RetireWithdrawalStrategy.withdrawalStrategy({
        strategy,
        shortfall,
        p1Bal,          p2Bal,
        p1WrapperOrder, p2WrapperOrder,
        p1SIPPLocked,   p2SIPPLocked,
        p1Ledger,       p2Ledger,
        p1GainRatio:    p1GainRatio,
        p2GainRatio:    p2GainRatio,
      });

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

      // Tax — all three components (income tax, CGT, NI) via single façade call per person.
      // tax.js owns the CGT exemption, band-stacking, and NI SPA logic.
      // Engine assembles the raw inputs; tax layer applies all rules.
      const p1NonSavings = p1SP + p1SalInc + p1Drawn.sippTaxable;
      const p2NonSavings = p2SP + p2SalInc + p2Drawn.sippTaxable;

      const p1Income = T.calculateTax({
        nonSavings:       p1NonSavings,
        employmentIncome: p1SalInc,
        interest:         p1IntTaxable,
        dividends:        p1Divs,
        annualGains:      p1AnnualGains,
        atOrAboveSPA:     p1Age >= p1SPAge,
      }, effThresholds, 'england');

      const p2Income = T.calculateTax({
        nonSavings:       p2NonSavings,
        employmentIncome: p2SalInc,
        interest:         p2IntTaxable,
        dividends:        p2Divs,
        annualGains:      p2AnnualGains,
        atOrAboveSPA:     p2Age >= p2SPAge,
      }, effThresholds, 'england');

      const p1CGT = p1Income.cgt;
      const p2CGT = p2Income.cgt;
      const p1NI  = p1Income.ni;
      const p2NI  = p2Income.ni;

      // Pay CGT from cash where possible
      if (p1CGT > 0) {
        const f = Math.min(p1CGT, p1Bal.Cash || 0);
        p1Bal.Cash -= f;
      }
      if (p2CGT > 0) {
        const f = Math.min(p2CGT, p2Bal.Cash || 0);
        p2Bal.Cash -= f;
      }

      // Depletion tracking — keys kept as "${name} Wrapper" (unchanged; rename deferred)
      const checkMap = {
        [`${p1name} Cash`]: p1Bal.Cash, [`${p1name} GIA`]: p1Bal.GIA,
        [`${p1name} SIPP`]: p1Bal.SIPP, [`${p1name} ISA`]: p1Bal.ISA,
        [`${p2name} Cash`]: p2Bal.Cash, [`${p2name} GIA`]: p2Bal.GIA,
        [`${p2name} SIPP`]: p2Bal.SIPP, [`${p2name} ISA`]: p2Bal.ISA,
      };
      Object.entries(checkMap).forEach(([key, bal]) => {
        if (!depletions[key] && (startBal[key] || 0) > 0 && bal <= 0) {
          const age = year - (key.startsWith(p1name) ? p1DOB : p2DOB);
          depletions[key] = { year, age };
          annotations.push({ year, person: key.startsWith(p1name) ? 'p1' : 'p2',
            event: 'depletion', message: `${key.replace(/^(.+) (\w+)$/, "$1's $2")} depleted` });
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
        p1DivsUsed +
        (p1Drawn.Cash || 0) +
        (p1Drawn.GIA || 0) +
        (p1Drawn.SIPP || 0) +
        (p1Drawn.ISA || 0);

      const p2GrossIncome =
        p2SP +
        p2SalInc +
        p2IntDraw +
        p2DivsUsed +
        (p2Drawn.Cash || 0) +
        (p2Drawn.GIA || 0) +
        (p2Drawn.SIPP || 0) +
        (p2Drawn.ISA || 0);

      const p1TaxTotal = p1Income.totalTax;
      const p2TaxTotal = p2Income.totalTax;

      const householdGrossIncome = p1GrossIncome + p2GrossIncome;
      const householdTax         = p1TaxTotal + p2TaxTotal;
      const householdNetCashflow = householdGrossIncome - householdTax;

      const cashflowShortfall = Math.max(0, target - householdNetCashflow);
      const cashflowSurplus   = Math.max(0, householdNetCashflow - target);



      const p1NaturalIncome = p1SP + p1SalInc + p1IntDraw + p1Divs;    
      const p2NaturalIncome =  p2SP + p2SalInc + p2IntDraw + p2Divs;
    
      const householdNaturalIncome = p1NaturalIncome + p2NaturalIncome;
    
      const p1NaturalNet = p1NaturalIncome - p1Income.tax - p1NI;
      const p2NaturalNet = p2NaturalIncome - p2Income.tax - p2NI;
      const householdNaturalNet = p1NaturalNet + p2NaturalNet;

      const p1NetCashflow = p1GrossIncome - p1TaxTotal;
      const p2NetCashflow = p2GrossIncome - p2TaxTotal;

        rows.push({
        year, p1Age, p2Age,

        target,

        p1SP, p2SP, p1SalInc, p2SalInc,
        intDrawTotal, p1IntDraw, p2IntDraw,
        p1IntTaxable, p2IntTaxable,
        p1Divs, p2Divs,
        p1DivsUsed, p2DivsUsed,
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
        householdNetCashflow,
        p1NetCashflow,
        p2NetCashflow,
        cashflowShortfall,
        cashflowSurplus,

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

    return { rows, depletions, annotations };
  }

  window.RetireEngine = { runProjection };
})();