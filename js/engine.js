(function () {
  const D = window.RetireData;
  const C = window.RetireCalc;

  // ─────────────────────────────────────────────
  // DOM HELPERS (read sidebar inputs)
  // ─────────────────────────────────────────────
  function gv(id)  { return D.parseCurrency(document.getElementById(id)?.value || ''); }
  function gvi(id) { return parseInt(String(D.parseCurrency(document.getElementById(id)?.value || '')), 10) || 0; }
  function gvs(id) { return document.getElementById(id)?.value || ''; }

  function getOrder(prefix, slots) {
    const o = [];
    for (let i = 1; i <= slots; i++) o.push(gvs(prefix + 'Order' + i));
    return o;
  }

  // ─────────────────────────────────────────────
  // MAIN PROJECTION
  // ─────────────────────────────────────────────
  function runProjection(interestAccounts) {
    const startYear = gvi('startYear');
    const endYear   = gvi('endYear');
    if (!startYear || !endYear || endYear <= startYear) {
      alert('Please enter valid start and end years.'); return null;
    }

    const woodyDOB        = gvi('woodyDOB');
    const heidiDOB        = gvi('heidiDOB');
    const spending        = gv('spending');
    const stepDownPct     = gvi('stepDownPct');
    const heidiSalary     = gv('heidiSalary');
    const heidiSalaryStop = gvi('heidiSalaryStopAge');
    const woodySPAge      = gvi('woodySPAge');
    const woodySPAmt      = gv('woodySP');
    const heidiSPAge      = gvi('heidiSPAge');
    const heidiSPAmt      = gv('heidiSP');
    const growth          = gv('growth') / 100;
    const inflation       = gv('inflation') / 100;
    const thresholdMode   = document.querySelector('input[name="thresholdMode"]:checked')?.value || 'frozen';
    const thresholdFromYear = parseInt(document.getElementById('thresholdFromYearVal')?.value) || 2028;
    const bniEnabled      = document.getElementById('bniEnabled')?.checked || false;
    const bniWoodyGIA     = bniEnabled ? gv('bniWoodyGIA') : 0;
    const bniHeidiGIA     = bniEnabled ? gv('bniHeidiGIA') : 0;
    const ISA_ALLOWANCE   = D.ISA_ALLOWANCE;

    // Interest-bearing accounts — deep copy so we don't mutate state
    const intAccts = (interestAccounts || []).map(a => ({ ...a }));

    const woodyBal = { Cash: gv('woodyCash'), GIA: gv('woodyGIA'), SIPP: gv('woodySIPP'), ISA: gv('woodyISA') };
    const heidiBal = { Cash: gv('heidiCash'), GIA: gv('heidiGIA'), SIPP: gv('heidiSIPP'), ISA: gv('heidiISA') };

    const woodyOrder = getOrder('woody', 4);
    const heidiOrder = getOrder('heidi', 4);

    // p1name used to match interest account ownership
    const p1name = document.getElementById('sp-p1name')?.value?.trim() || 'Woody';

    let woodyGIACost = woodyBal.GIA;
    let heidiGIACost = heidiBal.GIA;

    const startBal = {
      'Woody Cash': woodyBal.Cash, 'Woody GIA': woodyBal.GIA,
      'Woody SIPP': woodyBal.SIPP, 'Woody ISA': woodyBal.ISA,
      'Heidi Cash': heidiBal.Cash, 'Heidi GIA': heidiBal.GIA,
      'Heidi SIPP': heidiBal.SIPP, 'Heidi ISA': heidiBal.ISA,
    };
    intAccts.forEach(a => { startBal[a.name + ' (' + a.owner + ')'] = a.balance || a.value || 0; });

    const depletions = {};
    let cumInfl = 1;
    const rows = [];

    for (let year = startYear; year <= endYear; year++) {
      const woodyAge = year - woodyDOB;
      const heidiAge = year - heidiDOB;
      cumInfl *= (1 + inflation);
      const realDeflator = 1 / cumInfl;

      const woodySP     = woodyAge >= woodySPAge ? woodySPAmt * cumInfl : 0;
      const heidiSP     = heidiAge >= heidiSPAge ? heidiSPAmt * cumInfl : 0;
      const heidiSalInc = (heidiSalaryStop && heidiAge < heidiSalaryStop) ? heidiSalary * cumInfl : 0;
      const target      = (spending * cumInfl) * (stepDownPct > 0 && woodyAge >= 75 ? (1 - stepDownPct / 100) : 1);

      // Tax threshold uprating
      let uprateFactor = 1;
      if (thresholdMode === 'always') {
        uprateFactor = cumInfl;
      } else if (thresholdMode === 'fromYear' && year >= thresholdFromYear) {
        uprateFactor = cumInfl / Math.pow(1 + inflation, thresholdFromYear - startYear);
      }
      const baseRules      = C.getTaxRulesForYear(year);
      const effThresholds  = C.upratedTaxRules(baseRules, uprateFactor);
      const effCGTExempt   = effThresholds.cgtExempt;

      // Bed-and-ISA
      let bniCGTBill = 0, bniCGTUnpaid = 0;
      if (bniEnabled) {
        let woodyBniCGT = 0, heidiBniCGT = 0;
        if (bniWoodyGIA > 0 && woodyBal.GIA > 0) {
          const transfer    = Math.min(bniWoodyGIA, woodyBal.GIA, ISA_ALLOWANCE);
          const giaGain     = Math.max(0, woodyBal.GIA - woodyGIACost);
          const taxableGain = Math.max(0, transfer * (woodyBal.GIA > 0 ? giaGain / woodyBal.GIA : 0) - effCGTExempt);
          woodyBniCGT       = taxableGain > 0 ? C.calcCGT(0, taxableGain, effThresholds) : 0;
          bniCGTBill       += woodyBniCGT;
          const costFrac    = woodyBal.GIA > 0 ? transfer / woodyBal.GIA : 1;
          woodyBal.GIA     -= transfer;
          woodyBal.ISA     += transfer;
          woodyGIACost      = Math.max(0, woodyGIACost * (1 - costFrac));
        }
        if (bniHeidiGIA > 0 && heidiBal.GIA > 0) {
          const transfer    = Math.min(bniHeidiGIA, heidiBal.GIA, ISA_ALLOWANCE);
          const giaGain     = Math.max(0, heidiBal.GIA - heidiGIACost);
          const taxableGain = Math.max(0, transfer * (heidiBal.GIA > 0 ? giaGain / heidiBal.GIA : 0) - effCGTExempt);
          heidiBniCGT       = taxableGain > 0 ? C.calcCGT(0, taxableGain, effThresholds) : 0;
          bniCGTBill       += heidiBniCGT;
          const costFrac    = heidiBal.GIA > 0 ? transfer / heidiBal.GIA : 1;
          heidiBal.GIA     -= transfer;
          heidiBal.ISA     += transfer;
          heidiGIACost      = Math.max(0, heidiGIACost * (1 - costFrac));
        }
        if (woodyBniCGT > 0) {
          const fromCash = Math.min(woodyBniCGT, woodyBal.Cash || 0);
          woodyBal.Cash -= fromCash;
          bniCGTUnpaid  += woodyBniCGT - fromCash;
        }
        if (heidiBniCGT > 0) {
          const fromCash = Math.min(heidiBniCGT, heidiBal.Cash || 0);
          heidiBal.Cash -= fromCash;
          bniCGTUnpaid  += heidiBniCGT - fromCash;
        }
      }

      // Priority 1: interest-bearing accounts
      let intDrawTotal = 0, woodyIntDraw = 0, heidiIntDraw = 0;
      let woodyIntTaxable = 0, heidiIntTaxable = 0;
      intAccts.forEach(a => {
        if ((a.balance || 0) <= 0) return;
        const effectiveRate  = C.interestEffective(a.rate);
        const interestEarned = (a.balance || 0) * effectiveRate;
        const annualTarget   = (a.monthlyDraw || 0) * 12;
        const isP1           = a.owner === p1name;
        if (annualTarget <= 0) {
          a.balance += interestEarned;
          if (a.wrapper === 'GIA') { if (isP1) woodyIntTaxable += interestEarned; else heidiIntTaxable += interestEarned; }
          return;
        }
        const drawActual    = Math.min(annualTarget, a.balance + interestEarned);
        const interestDrawn = Math.min(drawActual, interestEarned);
        a.balance          -= Math.max(0, drawActual - interestDrawn);
        a.balance          += interestEarned - interestDrawn;
        intDrawTotal += drawActual;
        if (isP1) woodyIntDraw += drawActual; else heidiIntDraw += drawActual;
        if (a.wrapper === 'GIA') { if (isP1) woodyIntTaxable += interestEarned; else heidiIntTaxable += interestEarned; }
        const key = a.name + ' (' + a.owner + ')';
        if (!depletions[key] && (startBal[key] || 0) > 0 && a.balance <= 0)
          depletions[key] = { year, age: year - (isP1 ? woodyDOB : heidiDOB) };
      });

      // Priority 2: cash
      const guaranteed = woodySP + heidiSP + heidiSalInc + intDrawTotal;
      let shortfall    = Math.max(0, target - guaranteed + bniCGTUnpaid);
      let woodyCashDrawn = 0, heidiCashDrawn = 0;
      if (shortfall > 0) {
        const totalCash = (woodyBal.Cash || 0) + (heidiBal.Cash || 0);
        const cashDrawn = Math.min(shortfall, totalCash);
        const fromWoody = Math.min(cashDrawn, woodyBal.Cash || 0);
        const fromHeidi = Math.max(0, cashDrawn - fromWoody);
        woodyBal.Cash  -= fromWoody;
        heidiBal.Cash   = Math.max(0, (heidiBal.Cash || 0) - fromHeidi);
        woodyCashDrawn  = fromWoody;
        heidiCashDrawn  = fromHeidi;
        shortfall      -= cashDrawn;
      }

      // Priority 3: wrapper order (50/50 split)
      const woodyWrapperOrder = woodyOrder.filter(w => w !== 'Cash');
      const heidiWrapperOrder = heidiOrder.filter(w => w !== 'Cash');
      const woodyHalf  = shortfall / 2;
      const woodyDrawn = C.withdraw(woodyBal, woodyWrapperOrder, woodyHalf);
      const woodyUnmet = Math.max(0, woodyHalf - woodyDrawn.GIA - woodyDrawn.SIPP - woodyDrawn.ISA);
      const heidiDrawn = C.withdraw(heidiBal, heidiWrapperOrder, shortfall / 2 + woodyUnmet);
      const heidiUnmet = Math.max(0, (shortfall / 2 + woodyUnmet) - heidiDrawn.GIA - heidiDrawn.SIPP - heidiDrawn.ISA);
      if (heidiUnmet > 0) C.withdraw(woodyBal, woodyWrapperOrder, heidiUnmet);
      woodyDrawn.Cash += woodyCashDrawn;
      heidiDrawn.Cash += heidiCashDrawn;

      // Growth & CGT
      const woodyGIABalBefore = woodyBal.GIA || 0;
      const heidiGIABalBefore = heidiBal.GIA || 0;
      C.growBalances(woodyBal, growth);
      C.growBalances(heidiBal, growth);
      woodyGIACost += woodyGIABalBefore * growth;
      heidiGIACost += heidiGIABalBefore * growth;
      const woodyGIAGainFrac = woodyBal.GIA > 0 ? Math.max(0, woodyBal.GIA - woodyGIACost) / woodyBal.GIA : 0;
      const heidiGIAGainFrac = heidiBal.GIA > 0 ? Math.max(0, heidiBal.GIA - heidiGIACost) / heidiBal.GIA : 0;
      const woodyGIARealised = woodyDrawn.GIA * woodyGIAGainFrac;
      const heidiGIARealised = heidiDrawn.GIA * heidiGIAGainFrac;
      if (woodyGIABalBefore > 0 && woodyDrawn.GIA > 0)
        woodyGIACost = Math.max(0, woodyGIACost * (1 - Math.min(1, woodyDrawn.GIA / woodyGIABalBefore)));
      if (heidiGIABalBefore > 0 && heidiDrawn.GIA > 0)
        heidiGIACost = Math.max(0, heidiGIACost * (1 - Math.min(1, heidiDrawn.GIA / heidiGIABalBefore)));

      // Tax
      const woodyNonSavings = woodySP + woodyDrawn.sippTaxable;
      const heidiNonSavings = heidiSP + heidiSalInc + heidiDrawn.sippTaxable;
      const woodyIncome     = C.calcIncomeTaxDetailed(woodyNonSavings, woodyIntTaxable, 0, effThresholds);
      const heidiIncome     = C.calcIncomeTaxDetailed(heidiNonSavings, heidiIntTaxable, 0, effThresholds);
      const woodyCGT        = C.calcCGT(woodyIncome.taxableIncomeAfterPA, Math.max(0, woodyGIARealised - effCGTExempt), effThresholds);
      const heidiCGT        = C.calcCGT(heidiIncome.taxableIncomeAfterPA, Math.max(0, heidiGIARealised - effCGTExempt), effThresholds);
      const woodyNI         = C.calcEmployeeNI(0, effThresholds, woodyAge >= woodySPAge);
      const heidiNI         = C.calcEmployeeNI(heidiSalInc, effThresholds, heidiAge >= heidiSPAge);

      // Depletion tracking
      const checkMap = {
        'Woody Cash': woodyBal.Cash, 'Woody GIA': woodyBal.GIA,
        'Woody SIPP': woodyBal.SIPP, 'Woody ISA': woodyBal.ISA,
        'Heidi Cash': heidiBal.Cash, 'Heidi GIA': heidiBal.GIA,
        'Heidi SIPP': heidiBal.SIPP, 'Heidi ISA': heidiBal.ISA,
      };
      Object.entries(checkMap).forEach(([key, bal]) => {
        if (!depletions[key] && (startBal[key] || 0) > 0 && bal <= 0)
          depletions[key] = { year, age: year - (key.startsWith('Woody') ? woodyDOB : heidiDOB) };
      });

      const intBalWoody = intAccts.filter(a => a.owner === p1name).reduce((s, a) => s + (a.balance || 0), 0);
      const intBalHeidi = intAccts.filter(a => a.owner !== p1name).reduce((s, a) => s + (a.balance || 0), 0);

      rows.push({
        year, woodyAge, heidiAge,
        woodySP, heidiSP, heidiSalInc,
        intDrawTotal, woodyIntDraw, heidiIntDraw,
        woodyIntTaxable, heidiIntTaxable,
        woodyDrawn, heidiDrawn,
        woodyIncomeTax: woodyIncome.tax, heidiIncomeTax: heidiIncome.tax,
        woodyCGT, heidiCGT, woodyNI, heidiNI,
        woodyTax: woodyIncome.tax + woodyCGT + woodyNI,
        heidiTax: heidiIncome.tax + heidiCGT + heidiNI,
        woodyTaxInc: woodyNonSavings + woodyIntTaxable,
        heidiTaxInc: heidiNonSavings + heidiIntTaxable,
        bniCGTBill: bniCGTBill || 0,
        totalPortfolio: C.totalBal(woodyBal) + C.totalBal(heidiBal) + intBalWoody + intBalHeidi,
        realDeflator, cumInfl,
        snap: {
          woodyCash: woodyBal.Cash, woodyIntBal: intBalWoody,
          woodyGIA:  woodyBal.GIA,  woodySIPP:   woodyBal.SIPP, woodyISA: woodyBal.ISA,
          heidiCash: heidiBal.Cash, heidiIntBal: intBalHeidi,
          heidiGIA:  heidiBal.GIA,  heidiSIPP:   heidiBal.SIPP, heidiISA: heidiBal.ISA,
        },
      });
    }

    return { rows, depletions };
  }

  window.RetireEngine = { runProjection };
})();
