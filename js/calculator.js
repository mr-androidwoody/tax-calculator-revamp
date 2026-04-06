(function () {
  const D = window.RetireData;

  // ─────────────────────────────────────────────
  // PORTFOLIO SUMMARY (RESTORED)
  // ─────────────────────────────────────────────
  function summarisePortfolio(accounts) {
    const wrapperTotals = { ISA: 0, SIPP: 0, GIA: 0, Cash: 0 };

    let total = 0;

    const overallAllocation = {
      equities: 0,
      bonds: 0,
      cashlike: 0,
      cash: 0,
    };

    accounts.forEach((acc) => {
      const val = acc.value || 0;

      total += val;
      wrapperTotals[acc.wrapper] += val;

      Object.keys(overallAllocation).forEach((cls) => {
        overallAllocation[cls] += val * ((acc.alloc?.[cls] || 0) / 100);
      });
    });

    if (total > 0) {
      Object.keys(overallAllocation).forEach((cls) => {
        overallAllocation[cls] = (overallAllocation[cls] / total) * 100;
      });
    }

    return {
      total,
      wrapperTotals,
      overallAllocation,
      overallPct: Object.values(overallAllocation).reduce((a, b) => a + b, 0),
    };
  }

  // ─────────────────────────────────────────────
  // ACCOUNT MANAGEMENT (RESTORED)
  // ─────────────────────────────────────────────
  function addAccount(accounts, nextId, data = {}) {
    const account = {
      id: nextId,
      name: data.name || '',
      wrapper: data.wrapper || 'GIA',
      owner: data.owner || 'p1',
      value: data.value || 0,
      alloc: data.alloc || {
        equities: 0,
        bonds: 0,
        cashlike: 0,
        cash: 0,
      },
      rate: data.rate ?? null,
      monthlyDraw: data.monthlyDraw ?? null,
    };

    return {
      account,
      accounts: [...accounts, account],
      nextId: nextId + 1,
    };
  }

  function removeAccount(accounts, id) {
    return accounts.filter((a) => a.id !== id);
  }

  // ─────────────────────────────────────────────
  // ORIGINAL TAX + ENGINE LOGIC (UNCHANGED)
  // ─────────────────────────────────────────────
  function calcCGT(taxableIncomeAfterPA, taxableGain, TAX) {
    if (taxableGain <= 0) return 0;

    const basicBand = Math.max(0, TAX.basicLimit - TAX.PA);
    const basicUsed = Math.min(Math.max(0, taxableIncomeAfterPA), basicBand);
    const basicRemaining = Math.max(0, basicBand - basicUsed);

    const atBasic = Math.min(taxableGain, basicRemaining);
    const atHigher = Math.max(0, taxableGain - atBasic);

    return atBasic * TAX.cgtRates.basic + atHigher * TAX.cgtRates.higher;
  }

  function calcEmployeeNI(employmentIncome, TAX, atOrAboveStatePensionAge) {
    if (atOrAboveStatePensionAge || employmentIncome <= 0) return 0;

    const pt = TAX.ni.primaryThreshold;
    const uel = TAX.ni.upperEarningsLimit;

    const mainBand = Math.max(0, Math.min(employmentIncome, uel) - pt);
    const upperBand = Math.max(0, employmentIncome - uel);

    return mainBand * TAX.ni.mainRate + upperBand * TAX.ni.upperRate;
  }

  function calcIncomeTaxDetailed(nonSavings, savings, dividends, TAX) {
    nonSavings = nonSavings || 0;
    savings = savings || 0;
    dividends = dividends || 0;

    const totalIncome = nonSavings + savings + dividends;

    if (totalIncome <= 0) {
      return {
        tax: 0,
        taxableIncomeAfterPA: 0,
        paUsed: 0,
        nsNet: 0,
        savNet: 0,
        divNet: 0,
        savTaxable: 0,
        divTaxable: 0,
      };
    }

    const pa =
      totalIncome > TAX.taperStart
        ? Math.max(0, TAX.PA - Math.floor((totalIncome - TAX.taperStart) / 2))
        : TAX.PA;

    let paRem = pa;

    const nsNet = Math.max(0, nonSavings - paRem);
    paRem = Math.max(0, paRem - nonSavings);

    const savNet = Math.max(0, savings - paRem);
    paRem = Math.max(0, paRem - savings);

    const divNet = Math.max(0, dividends - paRem);

    const srsAvail = Math.max(0, TAX.srsLimit - nsNet);
    const srsCover = Math.min(savNet, srsAvail);
    const savAfterSRS = savNet - srsCover;

    const totalIncomeForPSA = nonSavings + savings + dividends;

    const psa =
      totalIncomeForPSA <= TAX.basicLimit
        ? TAX.psa.basic
        : totalIncomeForPSA <= TAX.additionalThreshold
        ? TAX.psa.higher
        : TAX.psa.additional;

    const psaCover = Math.min(savAfterSRS, psa);

    const savTaxable = Math.max(0, savAfterSRS - psaCover);
    const divTaxable = Math.max(0, divNet - TAX.dividendAllowance);

    const basicBand = Math.max(0, TAX.basicLimit - TAX.PA);
    const higherBand = Math.max(0, TAX.additionalThreshold - TAX.basicLimit);

    let nsTax = 0;
    let r = nsNet;

    const b = Math.min(r, basicBand);
    nsTax += b * TAX.nonSavingsRates.basic;
    r -= b;

    if (r > 0) {
      const h = Math.min(r, higherBand);
      nsTax += h * TAX.nonSavingsRates.higher;
      r -= h;
      if (r > 0) nsTax += r * TAX.nonSavingsRates.additional;
    }

    return {
      tax: nsTax,
      taxableIncomeAfterPA: nsNet,
      paUsed: pa - paRem,
      nsNet,
      savNet,
      divNet,
      savTaxable,
      divTaxable,
    };
  }

  function calcIncomeTax(nonSavings, savings, dividends, TAX) {
    return calcIncomeTaxDetailed(nonSavings, savings, dividends, TAX).tax;
  }

  function interestEffective(annualPct) {
    const daily = annualPct / 100 / 365;
    return Math.pow(1 + daily, 365) - 1;
  }

  function withdraw(balances, order, needed) {
    const drawn = { Cash: 0, GIA: 0, SIPP: 0, ISA: 0, sippTaxable: 0 };
    let rem = needed;

    for (const w of order) {
      if (rem <= 0) break;
      const avail = balances[w] || 0;
      if (avail <= 0) continue;

      const take = Math.min(avail, rem);
      drawn[w] += take;
      balances[w] -= take;
      rem -= take;

      if (w === 'SIPP') drawn.sippTaxable += take * 0.75;
    }

    return drawn;
  }

  function growBalances(b, growthRate) {
    b.Cash = b.Cash || 0;
    b.GIA = (b.GIA || 0) * (1 + growthRate);
    b.SIPP = (b.SIPP || 0) * (1 + growthRate);
    b.ISA = (b.ISA || 0) * (1 + growthRate);
  }

  function totalBal(b) {
    return (b.Cash || 0) + (b.GIA || 0) + (b.SIPP || 0) + (b.ISA || 0);
  }

  function getOrder(inputs, prefix, slots) {
    const o = [];
    for (let i = 1; i <= slots; i++) {
      o.push(inputs[prefix + 'Order' + i]);
    }
    return o;
  }

  window.RetireCalc = {
    summarisePortfolio,
    addAccount,
    removeAccount,
    calcCGT,
    calcEmployeeNI,
    calcIncomeTaxDetailed,
    calcIncomeTax,
    interestEffective,
    withdraw,
    growBalances,
    totalBal,
    getOrder,
  };
})();