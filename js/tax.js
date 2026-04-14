(function () {
  const C = window.RetireCalc;

  // ─────────────────────────────────────────────
  // calculateTax
  //
  // Single entry point for all tax calculations per person per year.
  // Orchestrates income tax, CGT, and NI from the RetireCalc primitives.
  //
  // income {
  //   nonSavings,        — SP + salary + sippTaxable (income tax base)
  //   employmentIncome,  — salary only (NI base; excludes SP and SIPP draws)
  //   interest,          — taxable interest (post-SRS/PSA logic handled inside calcIncomeTaxDetailed)
  //   dividends,         — taxable dividends (GIA arising basis)
  //   annualGains,       — raw GIA capital gains before CGT exemption
  //   atOrAboveSPA,      — boolean; true suppresses employee NI
  // }
  //
  // thresholds  — effThresholds from the engine (already uprated for the year)
  // jurisdiction — string; only 'england' is implemented (covers England, Wales, NI)
  //               Pass 'scotland' when Scottish rate bands are added — an explicit
  //               error is thrown now so the gap is visible rather than silent.
  //
  // Returns a flat object — all fields from calcIncomeTaxDetailed spread in, plus:
  //   cgt        — capital gains tax for the year
  //   ni         — employee NI for the year
  //   totalTax   — income tax + cgt + ni
  // ─────────────────────────────────────────────

  function calculateTax(income, thresholds, jurisdiction) {
    const jur = jurisdiction || 'england';

    if (jur !== 'england') {
      throw new Error(
        `Unsupported jurisdiction: "${jur}". ` +
        `Only "england" is currently implemented. ` +
        `Scottish rate bands can be added to data.js and dispatched here.`
      );
    }

    const {
      nonSavings       = 0,
      employmentIncome = 0,
      interest         = 0,
      dividends        = 0,
      annualGains      = 0,
      atOrAboveSPA     = false,
    } = income;

    // ── 1. Income tax ────────────────────────────────────────────────────
    const incDetail = C.calcIncomeTaxDetailed(nonSavings, interest, dividends, thresholds);

    // ── 2. CGT — exemption applied here; engine passes raw gains ─────────
    const taxableGain = Math.max(0, annualGains - thresholds.cgtExempt);
    const cgt = C.calcCGT(
      incDetail.taxableIncomeAfterPA,
      taxableGain,
      thresholds,
      incDetail.taperedPA        // correct basic-band width after £100k taper
    );

    // ── 3. Employee NI — employment income only, zero at/above SPA ───────
    const ni = C.calcEmployeeNI(employmentIncome, thresholds, atOrAboveSPA);

    // ── 4. Assemble flat result ───────────────────────────────────────────
    return {
      // All income tax detail fields (tax, taperedPA, taxableIncomeAfterPA,
      // pa, paUsed, nsNet, savNet, divNet, srsCover, savTaxable, divTaxable,
      // psa, nsTax, savTax, divTax)
      ...incDetail,

      // CGT and NI
      cgt,
      ni,

      // Combined
      totalTax: incDetail.tax + cgt + ni,
    };
  }

  window.RetireTax = { calculateTax };
})();
