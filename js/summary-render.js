(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // summary-render.js
  //
  // Renders the Plan Summary tab after a projection run.
  //
  // Public API (window.RetireSummary):
  //   setData(inputs, result, accounts) — called by app.js after runProjection
  //   render()                          — called by calc-render.js tab switcher
  //                                       on first activation of the summary tab
  //
  // The render is lazy: setData marks the content as stale, render() rebuilds
  // it only when the tab is actually visited. Subsequent projection runs mark
  // it stale again so the next visit gets fresh content.
  // ─────────────────────────────────────────────────────────────────────────

  const D = window.RetireData;
  const C = window.RetireCalc;

  let _inputs   = null;
  let _result   = null;
  let _accounts = [];
  let _stale    = true;

  // ─────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────

  function setData(inputs, result, accounts) {
    _inputs   = inputs;
    _result   = result;
    _accounts = accounts || [];
    _stale    = true;
  }

  function render() {
    if (!_stale) return;
    const el = document.getElementById('plan-summary-content');
    if (!el) return;

    if (!_inputs || !_result) {
      el.innerHTML = `<div class="ps-empty">
        <strong>No projection run yet</strong>
        Run a projection to see a summary of your plan assumptions and verdicts.
      </div>`;
      return;
    }

    el.innerHTML = _buildHTML(_inputs, _result, _accounts);
    _stale = false;
  }

  // ─────────────────────────────────────────────
  // CHIP + ROW HELPERS
  // ─────────────────────────────────────────────

  function chip(colour, label) {
    return `<span class="ps-chip ps-chip--${colour}"><span class="ps-chip__dot"></span>${label}</span>`;
  }

  // Single-value cell (no person split)
  function singleVal(v) {
    return `<div class="ps-row__value">${v}</div>`;
  }

  // Two-person value cells. When p2 is disabled, renders just the p1 block.
  function dualVal(dual, p1name, v1, chip1, p2name, v2, chip2) {
    if (!dual) {
      return `<div class="ps-row__value">${v1}</div>`;
    }
    return `
      <div class="ps-person">
        <div class="ps-person__name">${p1name}</div>
        <div class="ps-person__value">${v1}</div>
        ${chip1 ? `<div class="ps-person__chip">${chip1}</div>` : ''}
      </div>
      <div class="ps-person">
        <div class="ps-person__name">${p2name}</div>
        <div class="ps-person__value">${v2}</div>
        ${chip2 ? `<div class="ps-person__chip">${chip2}</div>` : ''}
      </div>`;
  }

  // A single verdict row.
  // isDual controls whether the value area uses 1 or 2 person columns.
  // When isDual=false a spacer div fills the unused second value column.
  function row(label, valHTML, verdictHTML, note, isDual, dual) {
    const cls = (isDual && dual) ? 'ps-row ps-row--dual' : 'ps-row ps-row--single';
    const spacer = (!isDual || !dual) ? '<div></div>' : '';
    return `<div class="${cls}">
      <div class="ps-row__label">${label}</div>
      ${valHTML}
      ${spacer}
      <div class="ps-row__verdict">${verdictHTML}<div class="ps-row__note">${note}</div></div>
    </div>`;
  }

  function section(label, rows) {
    const content = rows.filter(Boolean).join('');
    if (!content) return '';
    return `<div class="ps-section">
      <div class="ps-section__label">${label}</div>
      ${content}
    </div>`;
  }

  // ─────────────────────────────────────────────
  // BnI VERDICT HELPER
  // ─────────────────────────────────────────────

  // Returns { planned, survival, survivalLabel, survivalNote }
  // where planned and survival are each [colour, label] pairs.
  function _bniVerdict(enabled, annualAmt, years, startingGIA, depletionYear, lastTransferYear, startYear, rows, snapGIAKey) {
    if (!enabled || !(annualAmt > 0) || !(years > 0)) {
      return {
        planned:       ['amber', 'Not configured'],
        survival:      ['info',  'n/a'],
        survivalLabel: 'n/a',
        survivalNote:  '',
      };
    }

    const totalShelter  = annualAmt * years;
    const pctSheltered  = startingGIA > 0 ? (totalShelter / startingGIA) * 100 : 100;
    const plannedColour = pctSheltered >= 98 ? 'green' : 'amber';
    const plannedLabel  = pctSheltered >= 98 ? 'Full shelter' : 'Partial';

    // Red: GIA depletes before the final transfer year
    if (depletionYear && depletionYear <= lastTransferYear) {
      const failYr = depletionYear - startYear + 1;
      const safeYrs = failYr - 1;
      return {
        planned:       [plannedColour, plannedLabel],
        survival:      ['red', 'At risk'],
        survivalLabel: `GIA depletes year ${failYr}`,
        survivalNote:  `GIA is exhausted in year ${failYr} before the ${years}-year transfer period ends. ` +
                       `Transfers in the remaining years will not occur. ` +
                       `Consider reducing the duration to ${safeYrs} year${safeYrs !== 1 ? 's' : ''}.`,
      };
    }

    // Amber: GIA survives but the final year's balance is less than 20% of the annual transfer amount
    const finalRow   = rows.find(r => r.year === lastTransferYear);
    const giaAtEnd   = finalRow?.snap?.[snapGIAKey] || 0;
    if (giaAtEnd < annualAmt * 0.2) {
      return {
        planned:       [plannedColour, plannedLabel],
        survival:      ['amber', 'Marginal'],
        survivalLabel: 'Transfers may be partial',
        survivalNote:  `GIA balance in the final transfer year is low relative to the planned ` +
                       `${D.formatMoney(annualAmt)} transfer. A market downturn could prevent ` +
                       `the last transfer completing in full.`,
      };
    }

    // Green: GIA comfortably funds all transfers
    return {
      planned:       [plannedColour, plannedLabel],
      survival:      ['green', 'On track'],
      survivalLabel: 'GIA funds all transfers',
      survivalNote:  `GIA balance is sufficient to fund all planned transfers. ` +
                     `The strategy should complete as set.`,
    };
  }

  // ─────────────────────────────────────────────
  // MAIN BUILD FUNCTION
  // ─────────────────────────────────────────────

  function _buildHTML(inputs, result, accounts) {
    const dual = inputs.p2enabled;
    const rows = result.rows || [];
    const p1   = inputs.p1name || 'Person 1';
    const p2   = inputs.p2name || 'Person 2';

    if (!rows.length) {
      return `<div class="ps-empty"><strong>No data</strong>Projection produced no rows.</div>`;
    }

    // ── Portfolio summary ──────────────────────────────────────────────────
    const portSummary  = C.summarisePortfolio(accounts);
    const equityPct    = Math.round(portSummary.overallAllocation.equities || 0);
    const totalPortfolio = rows[0]?.totalPortfolio || 0;

    // Per-person starting portfolio (sum of all wrappers)
    const p1Total = (inputs.p1Bal.Cash || 0) + (inputs.p1Bal.GIAeq || 0) +
                    (inputs.p1Bal.GIAcash || 0) + (inputs.p1Bal.SIPP || 0) + (inputs.p1Bal.ISA || 0);
    const p2Total = dual
      ? (inputs.p2Bal.Cash || 0) + (inputs.p2Bal.GIAeq || 0) +
        (inputs.p2Bal.GIAcash || 0) + (inputs.p2Bal.SIPP || 0) + (inputs.p2Bal.ISA || 0)
      : 0;

    const p1GIA = (inputs.p1Bal.GIAeq || 0) + (inputs.p1Bal.GIAcash || 0);
    const p2GIA = dual ? (inputs.p2Bal.GIAeq || 0) + (inputs.p2Bal.GIAcash || 0) : 0;
    const giaTotal = p1GIA + p2GIA;

    // ── Withdrawal rate ────────────────────────────────────────────────────
    const wrRate   = totalPortfolio > 0 ? (inputs.spending / totalPortfolio) * 100 : 0;
    const wrRateStr = wrRate.toFixed(1);
    const wrVerdict = wrRate < 3.5  ? ['green', 'Low risk']
                    : wrRate < 4.5  ? ['amber', 'Moderate']
                    :                 ['red',   'High risk'];

    // ── Growth ─────────────────────────────────────────────────────────────
    const growthPct = (inputs.growth || 0) * 100;
    const growthVerdict = growthPct < 2   ? ['red',   'Very low']
                        : growthPct < 4   ? ['amber', 'Conservative']
                        : growthPct <= 6  ? ['green', 'Reasonable']
                        : growthPct <= 8  ? ['amber', 'Optimistic']
                        :                   ['red',   'Very high'];

    // ── Inflation ──────────────────────────────────────────────────────────
    const inflPct = (inputs.inflation || 0) * 100;
    const inflVerdict = inflPct < 1.5  ? ['amber', 'Low']
                      : inflPct <= 3   ? ['green', 'Reasonable']
                      : inflPct <= 4   ? ['amber', 'Elevated']
                      :                  ['red',   'High'];

    // ── Equity allocation ──────────────────────────────────────────────────
    const eqVerdict = equityPct < 60  ? ['amber', 'Conservative']
                    : equityPct <= 90 ? ['green', 'Balanced']
                    :                   ['amber', 'Aggressive'];

    // ── GIA exposure ───────────────────────────────────────────────────────
    const giaPct    = totalPortfolio > 0 ? (giaTotal / totalPortfolio) * 100 : 0;
    const giaVerdict = giaPct < 20 ? ['green', 'Low']
                     : giaPct < 40 ? ['amber', 'High']
                     :               ['red',   'Very high'];

    // ── Tax thresholds ─────────────────────────────────────────────────────
    const tmVerdict = inputs.thresholdMode === 'frozen'   ? ['green', 'Conservative']
                    : inputs.thresholdMode === 'always'   ? ['amber', 'Optimistic']
                    :                                       ['info',  'Mixed'];

    // ── Projection end longevity ───────────────────────────────────────────
    const p1EndAge  = inputs.endYear - inputs.p1DOB;
    const p2EndAge  = dual ? inputs.endYear - inputs.p2DOB : null;
    const endVerdict = p1EndAge >= 90 ? ['green', 'Prudent']
                     : p1EndAge >= 85 ? ['amber', 'Moderate']
                     :                  ['red',   'Short horizon'];

    // ── State Pension plausibility (full SP 2025/26 ≈ £11,502) ────────────
    const spVerdictFn = (amt) => amt <= 0          ? ['amber', 'Not set']
                               : amt > 12500        ? ['amber', 'Above full SP']
                               :                      ['green', 'Plausible'];

    // ── Retirement age ─────────────────────────────────────────────────────
    const p1RetAge = inputs.p1SalaryStop > 0
      ? inputs.p1SalaryStop
      : (inputs.startYear - inputs.p1DOB);
    const p2RetAge = dual && inputs.p2SalaryStop > 0
      ? inputs.p2SalaryStop
      : (dual ? inputs.startYear - inputs.p2DOB : null);

    const retVerdictFn = (age) => age >= 57 ? ['green', 'Fine'] : ['red', 'Pre-57 — SIPP locked'];

    // ── BnI depletions ─────────────────────────────────────────────────────
    const p1GIADepletionYear = result.depletions?.[`${p1} GIA`]?.year || null;
    const p2GIADepletionYear = dual ? (result.depletions?.[`${p2} GIA`]?.year || null) : null;

    const bniP1LastYear = inputs.startYear + (inputs.bniP1Years || 0) - 1;
    const bniP2LastYear = inputs.startYear + (inputs.bniP2Years || 0) - 1;

    const p1BniV = _bniVerdict(
      inputs.bniEnabled, inputs.bniP1GIA, inputs.bniP1Years,
      p1GIA, p1GIADepletionYear, bniP1LastYear, inputs.startYear, rows, 'p1GIA'
    );
    const p2BniV = dual ? _bniVerdict(
      inputs.bniEnabled, inputs.bniP2GIA, inputs.bniP2Years,
      p2GIA, p2GIADepletionYear, bniP2LastYear, inputs.startYear, rows, 'p2GIA'
    ) : null;

    // ── Interest-bearing accounts ──────────────────────────────────────────
    const intAccts = accounts.filter(a => a.rate != null || a.monthlyDraw != null);

    // ── Strategy label ─────────────────────────────────────────────────────
    const stratLabels = {
      balanced:  'Tax Band Optimiser',
      isaFirst:  'ISA first',
      sippFirst: 'Pension first',
    };
    const stratLabel = stratLabels[inputs.strategy] || inputs.strategy;
    const stratNotes = {
      balanced:  'Draws from wrappers in the order that minimises marginal tax each year, blending GIA, SIPP, and ISA.',
      isaFirst:  'Prioritises drawing from the ISA first, preserving taxable wrappers. Best when the ISA is large relative to spending needs.',
      sippFirst: 'Draws from the pension first, reducing its future tax exposure. Best suited to plans with a large SIPP balance.',
    };

    // ══════════════════════════════════════════════════════════════════════
    // BUILD SECTIONS
    // ══════════════════════════════════════════════════════════════════════

    // ── 1. People and timeline ─────────────────────────────────────────────
    const peopleSection = section('People and timeline', [

      row('Retirement age',
        dualVal(dual,
          p1, `Age ${p1RetAge} (${inputs.p1DOB + p1RetAge})`, dual ? chip(...retVerdictFn(p1RetAge)) : null,
          p2, p2RetAge ? `Age ${p2RetAge} (${inputs.p2DOB + p2RetAge})` : '–', chip(...retVerdictFn(p2RetAge || 0))
        ),
        dual ? '' : chip(...retVerdictFn(p1RetAge)),
        p1RetAge >= 57
          ? `Both above the minimum pension access age of 57. SIPP accessible from age 57 (from 2028).`
          : `SIPP is locked until age 57 from 2028. GIA and ISA can be drawn before that.`,
        true, dual),

      row('State Pension',
        dualVal(dual,
          p1, `${D.formatMoney(inputs.p1SPAmt)}/yr at ${inputs.p1SPAge}`, dual ? chip(...spVerdictFn(inputs.p1SPAmt)) : null,
          p2, `${D.formatMoney(inputs.p2SPAmt)}/yr at ${inputs.p2SPAge}`, chip(...spVerdictFn(inputs.p2SPAmt))
        ),
        dual ? '' : chip(...spVerdictFn(inputs.p1SPAmt)),
        'Close to the full new State Pension (£11,502/yr 2025/26). Consistent with a complete NI record.',
        true, dual),

      row('Salary',
        dualVal(dual,
          p1, inputs.p1Salary > 0 ? `${D.formatMoney(inputs.p1Salary)}/yr to age ${inputs.p1SalaryStop}` : 'None', null,
          p2, inputs.p2Salary > 0 ? `${D.formatMoney(inputs.p2Salary)}/yr to age ${inputs.p2SalaryStop}` : 'None', null
        ),
        chip('info', 'Note'),
        inputs.p2Salary > 0
          ? `${p2}'s salary reduces portfolio draws in early years, easing sequence-of-returns risk.`
          : inputs.p1Salary > 0
            ? `${p1}'s salary reduces portfolio draws until retirement.`
            : 'No salary income modelled. Portfolio draws begin immediately.',
        true, dual),

      row('Projection end',
        singleVal(`${inputs.endYear} — ${p1} age ${p1EndAge}${dual && p2EndAge ? `, ${p2} age ${p2EndAge}` : ''}`),
        chip(...endVerdict),
        `${inputs.endYear - inputs.startYear}-year horizon. ` +
        (p1EndAge >= 90
          ? 'A sound upper bound for longevity planning for a couple in their late 50s.'
          : 'Consider extending to age 90+ for a more prudent longevity buffer.'),
        false, dual),
    ]);

    // ── 2. Spending ────────────────────────────────────────────────────────
    const spendingSection = section('Spending', [

      row('Spending target',
        singleVal(`${D.formatMoney(inputs.spending)}/yr`),
        chip(...wrVerdict) + `&ensp;${wrRateStr}% withdrawal rate`,
        wrRate < 3.5
          ? 'Well within the low-risk withdrawal range. Portfolio should grow or hold steady in most scenarios.'
          : wrRate < 4.5
            ? 'Above the 3.5% low-risk threshold. Sustainable in most scenarios but leaves limited buffer.'
            : 'Exceeds the 4.5% caution threshold. High risk of portfolio depletion. Stress-test with Test my plan.',
        false, dual),

      inputs.stepDownPct > 0
        ? row('Step-down at 75',
            singleVal(`${inputs.stepDownPct}% (${D.formatMoney(inputs.spending * (1 - inputs.stepDownPct / 100))} from age 75)`),
            chip('info', 'Note'),
            `Spending reduces by ${inputs.stepDownPct}% in the year ${p1} turns 75. Eases late-stage drawdown pressure.`,
            false, dual)
        : '',
    ]);

    // ── 3. Returns and inflation ───────────────────────────────────────────
    const returnsSection = section('Returns and inflation', [

      row('Growth rate',
        singleVal(`${growthPct.toFixed(1)}% nominal`),
        chip(...growthVerdict),
        growthPct <= 6
          ? 'Within the 4–6% cautious-to-balanced range. Consistent with long-run global equity returns net of fees.'
          : growthPct <= 8
            ? 'Above the typical 4–6% range. Verify this is realistic for your asset mix and fee level.'
            : 'Significantly above long-run averages. Results will be optimistic — consider a lower assumption.',
        false, dual),

      row('Inflation',
        singleVal(`${inflPct.toFixed(1)}%`),
        chip(...inflVerdict),
        inflPct <= 3
          ? 'Aligned with the Bank of England long-run target.'
          : 'Above the BoE target. Spending power erodes faster — verify the plan still holds at this rate.',
        false, dual),

      row('Tax thresholds',
        singleVal(
          inputs.thresholdMode === 'frozen'   ? 'Frozen' :
          inputs.thresholdMode === 'always'   ? 'Uprated with inflation' :
          `Uprated from ${inputs.thresholdFromYear}`
        ),
        chip(...tmVerdict),
        inputs.thresholdMode === 'frozen'
          ? 'Fiscal drag fully modelled. Pessimistic but prudent — thresholds have been frozen since 2021.'
          : inputs.thresholdMode === 'always'
            ? 'Thresholds rise with inflation. Optimistic — reduces the modelled impact of fiscal drag.'
            : `Thresholds frozen until ${inputs.thresholdFromYear}, then uprated. A reasonable middle-ground assumption.`,
        false, dual),
    ]);

    // ── 4. Portfolio ───────────────────────────────────────────────────────
    const portfolioSection = section('Portfolio', [

      row('Total portfolio',
        dualVal(dual,
          p1, D.formatMoney(p1Total), null,
          p2, D.formatMoney(p2Total), null
        ),
        chip(...wrVerdict) + (dual ? `&ensp;${wrRateStr}% of ${D.formatMoney(totalPortfolio)}` : ''),
        'Historically sustainable over 30 years in most market environments. Use Test my plan to stress-test.',
        true, dual),

      row('Equity allocation',
        singleVal(`${equityPct}% equities`),
        chip(...eqVerdict),
        equityPct < 60
          ? 'Low equity allocation may limit long-run growth. Consider whether this matches your risk tolerance for a long retirement.'
          : equityPct <= 90
            ? 'Appropriate for a long retirement horizon.'
            : 'High equity tilt increases sequence-of-returns risk in early retirement years.',
        false, dual),

      row('GIA exposure',
        dualVal(dual,
          p1, D.formatMoney(p1GIA), null,
          p2, D.formatMoney(p2GIA), null
        ),
        chip(...giaVerdict),
        'Significant assets in a taxable wrapper. Bed-and-ISA can shelter up to £20k/yr per person into an ISA.',
        true, dual),

      row('Dividend yield',
        singleVal(`${((inputs.dividendYield || 0) * 100).toFixed(1)}%`),
        chip('green', 'Reasonable'),
        'GIA dividends are taxed on an arising basis each year regardless of payout or reinvest mode.',
        false, dual),
    ]);

    // ── 5. Strategy ────────────────────────────────────────────────────────
    const strategySection = section('Strategy', [

      row('Withdrawal strategy',
        singleVal(stratLabel),
        chip('info', 'Active'),
        stratNotes[inputs.strategy] || '',
        false, dual),

      row('Dividend mode',
        singleVal(inputs.dividendMode === 'reinvest' ? 'Reinvest' : 'Payout'),
        chip('info', 'Note'),
        inputs.dividendMode === 'reinvest'
          ? 'GIA dividends compound inside the wrapper but are still taxed on an arising basis each year.'
          : 'GIA dividends are paid out and counted as cashflow income. Taxed on an arising basis regardless.',
        false, dual),
    ]);

    // ── 6. Bed-and-ISA ────────────────────────────────────────────────────
    let bniSection = '';
    if (inputs.bniEnabled) {

      const p1BniPlanned = inputs.bniP1GIA > 0
        ? `${D.formatMoney(inputs.bniP1GIA)}/yr x ${inputs.bniP1Years} yr${inputs.bniP1Years !== 1 ? 's' : ''}`
        : 'Not configured';
      const p2BniPlanned = dual
        ? (inputs.bniP2GIA > 0
            ? `${D.formatMoney(inputs.bniP2GIA)}/yr x ${inputs.bniP2Years} yr${inputs.bniP2Years !== 1 ? 's' : ''}`
            : 'Not configured')
        : '–';

      bniSection = section('Bed-and-ISA', [

        row('Transfers planned',
          dualVal(dual,
            p1, p1BniPlanned, chip(...p1BniV.planned),
            p2, p2BniPlanned, p2BniV ? chip(...p2BniV.planned) : ''
          ),
          dual ? '' : chip(...p1BniV.planned),
          `Sells GIA holdings and rebuys within an ISA, sheltering future gains and income from tax. Annual ISA allowance cap: £20k per person.`,
          true, dual),

        row('GIA funds transfers?',
          dualVal(dual,
            p1, p1BniV.survivalLabel, chip(...p1BniV.survival),
            p2, p2BniV ? p2BniV.survivalLabel : 'n/a', p2BniV ? chip(...p2BniV.survival) : ''
          ),
          dual ? '' : chip(...p1BniV.survival),
          // Show the most severe note — red takes priority over amber
          (p1BniV.survival[0] === 'red'
            ? p1BniV.survivalNote
            : p2BniV?.survival[0] === 'red'
              ? p2BniV.survivalNote
              : p1BniV.survival[0] === 'amber'
                ? p1BniV.survivalNote
                : p2BniV?.survival[0] === 'amber'
                  ? p2BniV.survivalNote
                  : p1BniV.survivalNote),
          true, dual),
      ]);

    } else if (giaTotal > 20000) {
      // BnI disabled but GIA is significant — surface as an opportunity
      bniSection = section('Bed-and-ISA', [
        row('Bed-and-ISA',
          singleVal('Not enabled'),
          chip('amber', 'Opportunity'),
          `GIA holdings of ${D.formatMoney(giaTotal)} could be progressively sheltered via Bed-and-ISA transfers of up to £20k/yr per person.`,
          false, dual),
      ]);
    }

    // ── 7. Interest-bearing accounts ───────────────────────────────────────
    const intSection = intAccts.length ? section('Interest-bearing accounts',
      intAccts.map(a => {
        const owner    = a.owner === 'p1' ? p1 : p2;
        const rateStr  = a.rate != null ? ` · ${a.rate}% AER` : '';
        const drawStr  = a.monthlyDraw ? ` · ${D.formatMoney(a.monthlyDraw)}/mo draw` : '';
        return row(
          a.name || '(unnamed)',
          singleVal(`${D.formatMoney(a.value || 0)}${rateStr}${drawStr} — ${owner}`),
          chip('info', 'Included'),
          'Handled separately from GIA equity balance. Interest is taxed on an arising basis and is excluded from dividend calculations.',
          false, dual
        );
      })
    ) : '';

    return [
      peopleSection,
      spendingSection,
      returnsSection,
      portfolioSection,
      strategySection,
      bniSection,
      intSection,
    ].join('');
  }

  // ─────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────
  window.RetireSummary = { setData, render };

})();
