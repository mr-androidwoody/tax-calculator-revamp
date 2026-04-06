(function () {
  const D = window.RetireData;

  // ─────────────────────────────────────────────
  // CAPITAL GAINS TAX
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

  // ─────────────────────────────────────────────
  // NATIONAL INSURANCE
  // ─────────────────────────────────────────────
  function calcEmployeeNI(employmentIncome, TAX, atOrAboveStatePensionAge) {
    if (atOrAboveStatePensionAge || employmentIncome <= 0) return 0;

    const pt = TAX.ni.primaryThreshold;
    const uel = TAX.ni.upperEarningsLimit;

    const mainBand = Math.max(0, Math.min(employmentIncome, uel) - pt);
    const upperBand = Math.max(0, employmentIncome - uel);

    return mainBand * TAX.ni.mainRate + upperBand * TAX.ni.upperRate;
  }

  // ─────────────────────────────────────────────
  // INCOME TAX CORE
  // ─────────────────────────────────────────────
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

    // Non-savings
    let nsTax = 0;
    {
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
    }

    // Savings
    let savTax = 0;
    if (savTaxable > 0) {
      let r = savTaxable;
      const used = nsNet;

      const bLeft = Math.max(0, basicBand - used);
      const b = Math.min(r, bLeft);
      savTax += b * TAX.savingsRates.basic;
      r -= b;

      if (r > 0) {
        const hLeft = Math.max(0, higherBand - Math.max(0, used - basicBand));
        const h = Math.min(r, hLeft);
        savTax += h * TAX.savingsRates.higher;
        r -= h;

        if (r > 0) savTax += r * TAX.savingsRates.additional;
      }
    }

    // Dividends
    let divTax = 0;
    if (divTaxable > 0) {
      let r = divTaxable;
      const used = nsNet + savNet;

      const bLeft = Math.max(0, basicBand - used);
      const b = Math.min(r, bLeft);
      divTax += b * TAX.dividendRates.basic;
      r -= b;

      if (r > 0) {
        const hLeft = Math.max(0, higherBand - Math.max(0, used - basicBand));
        const h = Math.min(r, hLeft);
        divTax += h * TAX.dividendRates.higher;
        r -= h;

        if (r > 0) divTax += r * TAX.dividendRates.additional;
      }
    }

    return {
      tax: nsTax + savTax + divTax,
      taxableIncomeAfterPA: nsNet + savNet + divNet,
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

  // ─────────────────────────────────────────────
  // INTEREST
  // ─────────────────────────────────────────────
  function interestEffective(annualPct) {
    const daily = annualPct / 100 / 365;
    return Math.pow(1 + daily, 365) - 1;
  }

  // ─────────────────────────────────────────────
  // WITHDRAWALS
  // ─────────────────────────────────────────────
  function withdraw(balances, order, needed) {
    const drawn = {
      Cash: 0,
      GIA: 0,
      SIPP: 0,
      ISA: 0,
      sippTaxable: 0,
    };

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

  // ─────────────────────────────────────────────
  // GROWTH
  // ─────────────────────────────────────────────
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
    for (let i = 1; i <= slots; i += 1) {
      o.push(inputs[prefix + 'Order' + i]);
    }
    return o;
  }

  // ─────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────
  window.RetireCalc = {
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