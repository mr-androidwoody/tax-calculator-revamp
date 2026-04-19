(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // summary-render.js  — Plan Summary tab
  //
  // Three-column row layout per card:
  //   Col 1 (.ps-row__label)   — assumption name
  //   Col 2 (.ps-row__right)   — stacked value lines (one per person if dual)
  //   Col 3 (.ps-row__verdict) — chip on top, contextual note beneath
  // ─────────────────────────────────────────────────────────────────────────

  var D = window.RetireData;
  var C = window.RetireCalc;

  var _inputs   = null;
  var _result   = null;
  var _accounts = [];
  var _stale    = true;

  function setData(inputs, result, accounts) {
    _inputs   = inputs;
    _result   = result;
    _accounts = accounts || [];
    _stale    = true;
  }

  function render() {
    if (!_stale) return;
    var el = document.getElementById('plan-summary-content');
    if (!el) return;
    if (!_inputs || !_result) {
      el.innerHTML = '<div class="ps-empty"><strong>No projection run yet</strong>Run a projection to see a verdict on every assumption in your plan.</div>';
      return;
    }
    el.innerHTML = _buildHTML(_inputs, _result, _accounts);
    _stale = false;
  }

  // ─────────────────────────────────────────────
  // PRIMITIVES
  // ─────────────────────────────────────────────

  function chip(colour, label) {
    return '<span class="ps-chip ps-chip--' + colour + '"><span class="ps-chip__dot"></span>' + label + '</span>';
  }

  // One value line. pname optional (omit for single-person rows).
  function vline(val, pname) {
    var n = pname ? '<span class="ps-pname">' + pname + '</span>' : '';
    return '<div class="ps-val-line">' + n + '<span class="ps-val">' + val + '</span></div>';
  }

  // Three-column row: label | right-column HTML | verdict-column HTML
  function row(label, rightHTML, chipHTML, noteText) {
    var verdict = '<div class="ps-row__verdict">'
      + chipHTML
      + (noteText ? '<div class="ps-note">' + noteText + '</div>' : '')
      + '</div>';
    return '<div class="ps-row">'
      + '<div class="ps-row__label">' + label + '</div>'
      + '<div class="ps-row__right">' + rightHTML + '</div>'
      + verdict
      + '</div>';
  }

  function heading(text) {
    return '<div class="ps-card__heading">' + text + '</div>';
  }

  function subheading(text) {
    return '<div class="ps-card__heading ps-card__heading--sub">' + text + '</div>';
  }

  function card(inner, fullWidth) {
    return '<div class="ps-card' + (fullWidth ? ' ps-card--full' : '') + '">' + inner + '</div>';
  }

  function money(n) { return D.formatMoney(n); }

  // ─────────────────────────────────────────────
  // BnI SURVIVAL VERDICT
  // ─────────────────────────────────────────────

  function _bniVerdict(enabled, annualAmt, years, startingGIA, depletionYear, lastTransferYear, startYear, rows, snapKey) {
    if (!enabled || !(annualAmt > 0) || !(years > 0)) {
      return { planned: ['amber','Not configured'], survival: ['info','n/a'], survivalLabel: 'n/a', survivalNote: '' };
    }
    var pct      = startingGIA > 0 ? (annualAmt * years / startingGIA) * 100 : 100;
    var plannedC = pct >= 98 ? 'green' : 'amber';
    var plannedL = pct >= 98 ? 'Full shelter' : 'Partial (' + Math.round(pct) + '% of GIA)';

    if (depletionYear && depletionYear <= lastTransferYear) {
      var failYr  = depletionYear - startYear + 1;
      var safeYrs = failYr - 1;
      return {
        planned: [plannedC, plannedL],
        survival: ['red', 'At risk'],
        survivalLabel: 'GIA runs out in year ' + failYr,
        survivalNote: 'GIA is exhausted before all transfers complete. Years ' + failYr + ' onwards will not execute. Reduce the duration to ' + safeYrs + (safeYrs !== 1 ? ' years' : ' year') + ' to match what the GIA can fund.',
      };
    }
    var finalRow = rows.find(function(r) { return r.year === lastTransferYear; });
    var giaAtEnd = (finalRow && finalRow.snap && finalRow.snap[snapKey]) || 0;
    if (giaAtEnd < annualAmt * 0.2) {
      return {
        planned: [plannedC, plannedL],
        survival: ['amber', 'Marginal'],
        survivalLabel: 'Final transfer uncertain',
        survivalNote: 'The GIA balance in the final transfer year is thin. A single poor market year could prevent it completing. Consider trimming the duration by one year as a precaution.',
      };
    }
    return {
      planned: [plannedC, plannedL],
      survival: ['green', 'On track'],
      survivalLabel: 'All transfers funded',
      survivalNote: 'The GIA holds enough at each transfer year to complete the full programme as planned.',
    };
  }

  // ─────────────────────────────────────────────
  // MAIN BUILD
  // ─────────────────────────────────────────────

  function _buildHTML(inputs, result, accounts) {
    var dual = inputs.p2enabled;
    var rows = result.rows || [];
    var p1   = inputs.p1name || 'Person 1';
    var p2   = inputs.p2name || 'Person 2';

    if (!rows.length) {
      return '<div class="ps-empty"><strong>No data</strong>Projection produced no rows.</div>';
    }

    // ── Derived values ─────────────────────────────────────────────────────
    var portSum   = C.summarisePortfolio(accounts);
    var equityPct = Math.round(portSum.overallAllocation.equities || 0);
    var totalPort = rows[0] ? (rows[0].totalPortfolio || 0) : 0;

    var p1Total = (inputs.p1Bal.Cash || 0) + (inputs.p1Bal.GIAeq || 0) + (inputs.p1Bal.GIAcash || 0) + (inputs.p1Bal.SIPP || 0) + (inputs.p1Bal.ISA || 0);
    var p2Total = dual ? ((inputs.p2Bal.Cash || 0) + (inputs.p2Bal.GIAeq || 0) + (inputs.p2Bal.GIAcash || 0) + (inputs.p2Bal.SIPP || 0) + (inputs.p2Bal.ISA || 0)) : 0;
    var p1GIA   = (inputs.p1Bal.GIAeq || 0) + (inputs.p1Bal.GIAcash || 0);
    var p2GIA   = dual ? ((inputs.p2Bal.GIAeq || 0) + (inputs.p2Bal.GIAcash || 0)) : 0;
    var giaTotal = p1GIA + p2GIA;

    var wrRate    = totalPort > 0 ? (inputs.spending / totalPort) * 100 : 0;
    var wrRateStr = wrRate.toFixed(1);
    var wrV = wrRate < 3.5 ? ['green','Low risk'] : wrRate < 4.5 ? ['amber','Moderate'] : ['red','High risk'];
    var wrNote = wrRate < 3.5
      ? 'At ' + wrRateStr + '%, the plan should grow or hold steady in most market environments. The portfolio has room to absorb a run of poor returns without threatening income.'
      : wrRate < 4.5
        ? 'At ' + wrRateStr + '%, the plan is workable but not conservative. A sustained period of below-average returns or higher-than-expected spending could erode the portfolio faster than expected. Test my plan will show how often this holds up across 10,000 scenarios.'
        : 'At ' + wrRateStr + '%, the plan is drawing faster than most historical safe withdrawal rates support. The portfolio is at meaningful risk of running low in later years, particularly if markets underperform in the first decade of retirement. Reducing spending or deferring retirement would have the most impact here.';

    var gPct  = (inputs.growth || 0) * 100;
    var growV = gPct < 2 ? ['red','Very low'] : gPct < 4 ? ['amber','Conservative'] : gPct <= 6 ? ['green','Reasonable'] : gPct <= 8 ? ['amber','Optimistic'] : ['red','Very high'];
    var growNote = gPct <= 6
      ? 'A ' + gPct.toFixed(1) + '% nominal return is consistent with a diversified equity portfolio net of platform fees. It bakes in some real growth above inflation without being heroic.'
      : gPct <= 8
        ? 'A ' + gPct.toFixed(1) + '% return is achievable but sits above the long-run average for global equities. If actual returns come in lower, the plan will run shorter than projected.'
        : 'At ' + gPct.toFixed(1) + '%, this assumption is well above historical long-run equity averages. The projection will look better than is realistic. Consider stress-testing with a lower rate.';

    var iPct  = (inputs.inflation || 0) * 100;
    var inflV = iPct < 1.5 ? ['amber','Low'] : iPct <= 3 ? ['green','Reasonable'] : iPct <= 4 ? ['amber','Elevated'] : ['red','High'];
    var inflNote = iPct <= 3
      ? iPct.toFixed(1) + '% is close to the Bank of England long-run target and a reasonable base case. Each year of retirement spending will cost around ' + iPct.toFixed(1) + '% more than the last in nominal terms.'
      : 'At ' + iPct.toFixed(1) + '%, inflation is above the BoE target. Spending power erodes faster, and the spending target will grow more steeply in nominal terms. Worth testing how the plan holds if inflation stays elevated for a decade.';

    var eqV = equityPct < 60 ? ['amber','Conservative'] : equityPct <= 90 ? ['green','Balanced'] : ['amber','Aggressive'];
    var eqNote = equityPct < 60
      ? equityPct + '% in equities may not generate enough long-run growth to support a multi-decade retirement. Even moving to 70% would meaningfully improve expected outcomes, with sequence risk managed through a cash buffer.'
      : equityPct <= 90
        ? equityPct + '% in equities is well-suited to a long retirement horizon. The portfolio should generate real growth over time while the remaining allocation provides some cushion in down markets.'
        : equityPct + '% in equities is high. The portfolio will grow faster in good markets but is exposed to large drawdowns in the early years of retirement, which is when sequence risk does the most damage. A modest reduction in equity weighting now would reduce this exposure.';

    var giaPct = totalPort > 0 ? (giaTotal / totalPort) * 100 : 0;
    var giaV   = giaPct < 20 ? ['green','Low'] : giaPct < 40 ? ['amber','High'] : ['red','Very high'];
    var giaNote = giaPct < 20
      ? 'Most assets sit in tax-sheltered wrappers. GIA exposure is modest and the ongoing tax drag from dividends and gains will be limited.'
      : giaPct < 40
        ? Math.round(giaPct) + '% in GIA means a meaningful portion of portfolio growth and income is taxable each year. Bed-and-ISA transfers can reduce this over time, sheltering gains and future income inside an ISA.'
        : Math.round(giaPct) + '% in GIA is high. Dividends are taxed annually on an arising basis and withdrawals may trigger CGT. Prioritising Bed-and-ISA transfers will reduce the tax drag significantly over the projection period.';

    var tmV = inputs.thresholdMode === 'frozen' ? ['green','Conservative'] : inputs.thresholdMode === 'always' ? ['amber','Optimistic'] : ['info','Mixed'];
    var tmNote = inputs.thresholdMode === 'frozen'
      ? 'Tax thresholds are held flat in nominal terms, so fiscal drag compounds as inflation pushes income into higher bands. This is the prudent assumption: it is what has happened in practice since 2021.'
      : inputs.thresholdMode === 'always'
        ? 'Thresholds rise with inflation each year, which keeps effective tax rates stable. This is the optimistic assumption: it has not been government policy in recent years and may overstate post-tax income.'
        : 'Thresholds are frozen until ' + inputs.thresholdFromYear + ', then uprated with inflation. A pragmatic middle path that reflects near-term political reality while allowing for future indexation.';

    var p1EndAge = inputs.endYear - inputs.p1DOB;
    var p2EndAge = dual ? (inputs.endYear - inputs.p2DOB) : null;
    var endV = p1EndAge >= 90 ? ['green','Prudent'] : p1EndAge >= 85 ? ['amber','Moderate'] : ['red','Short horizon'];
    var endNote = p1EndAge >= 90
      ? 'Planning to ' + p1EndAge + ' covers the realistic upper end of life expectancy for someone retiring now. The plan should not run short unless returns are very poor for an extended period.'
      : p1EndAge >= 85
        ? 'Planning to ' + p1EndAge + ' covers average life expectancy with some headroom. There is a reasonable chance of living longer, so extending to age 90 would give the plan a more robust longevity buffer.'
        : 'Planning to only age ' + p1EndAge + ' is a short horizon for a retirement that could last 35 or more years. Extending the end year significantly reduces the risk of outliving the plan.';

    var FULL_SP = 12547;
    function spVFn(amt) {
      return amt <= 0 ? ['amber','Not set'] : amt > FULL_SP ? ['amber','Above full SP'] : ['green','Plausible'];
    }
    function spNote(amt, age) {
      if (amt <= 0) return 'No State Pension entered. If you expect to receive one, add it: it is the most inflation-proof income stream in the plan.';
      if (amt > FULL_SP) return money(amt) + '/yr exceeds the full new State Pension (\u00a3' + FULL_SP.toLocaleString('en-GB') + '/yr in 2026\u201327). Check your Government Gateway forecast to confirm this is correct.';
      return money(amt) + '/yr at age ' + age + ' is consistent with a full or near-full NI record. State Pension is triple-lock linked and index-proof, making it the most reliable income source in the plan.';
    }

    var p1RetAge = inputs.p1SalaryStop > 0 ? inputs.p1SalaryStop : (inputs.startYear - inputs.p1DOB);
    var p2RetAge = dual && inputs.p2SalaryStop > 0 ? inputs.p2SalaryStop : (dual ? inputs.startYear - inputs.p2DOB : null);
    function retVFn(age) { return age >= 57 ? ['green','Fine'] : ['red','Pre-57: SIPP locked']; }
    function retNote(age, name, salary) {
      if (age < 57) return name + ' retires before the minimum pension access age of 57 (from 2028). The SIPP cannot be touched until then. GIA and ISA can bridge the gap, but make sure there is enough in those wrappers to cover the shortfall years.';
      return name + ' retires at ' + age + ', above the minimum pension access age. All wrappers are available from day one.';
    }

    function salNote(sal, stop, name) {
      if (!sal || sal <= 0) return name + ' has no salary income in the projection. Portfolio draws begin immediately from the start year.';
      return money(sal) + '/yr from ' + name + ' until age ' + stop + ' directly offsets portfolio draws in those years, reducing sequence-of-returns risk in the critical early phase of retirement.';
    }

    var stratLabels = { balanced: 'Tax Band Optimiser', isaFirst: 'ISA first', sippFirst: 'Pension first' };
    var stratNotes  = {
      balanced:  'Each year the engine draws from whichever wrapper keeps tax lowest, blending GIA, SIPP, and ISA withdrawals to stay within efficient tax bands. Best for most two-wrapper or three-wrapper portfolios.',
      isaFirst:  'ISA is drawn first before touching taxable wrappers. This preserves the SIPP and GIA for later but can deplete the ISA earlier than optimal. Best when the ISA is large relative to annual spending.',
      sippFirst: 'SIPP is drawn down early, reducing its size and the future tax exposure on large pension balances. Can be effective when the SIPP is very large and would otherwise cause higher-rate tax in later years.',
    };

    var divNote = inputs.dividendMode === 'reinvest'
      ? 'GIA dividends are reinvested rather than paid out. The balance compounds inside the wrapper, but dividends are still taxed on an arising basis each year. The tax cost is the same regardless of whether cash is received.'
      : 'GIA dividends are paid out as income and counted against the household spending target. Taxed on an arising basis each year using the dividend allowance (currently \u00a3500) and dividend tax rates.';

    // BnI
    var p1GIADep  = (result.depletions && result.depletions[p1 + ' GIA']) ? result.depletions[p1 + ' GIA'].year : null;
    var p2GIADep  = dual && result.depletions && result.depletions[p2 + ' GIA'] ? result.depletions[p2 + ' GIA'].year : null;
    var bniP1Last = inputs.startYear + (inputs.bniP1Years || 0) - 1;
    var bniP2Last = inputs.startYear + (inputs.bniP2Years || 0) - 1;

    var p1BniV = _bniVerdict(inputs.bniEnabled, inputs.bniP1GIA, inputs.bniP1Years, p1GIA, p1GIADep, bniP1Last, inputs.startYear, rows, 'p1GIA');
    var p2BniV = dual ? _bniVerdict(inputs.bniEnabled, inputs.bniP2GIA, inputs.bniP2Years, p2GIA, p2GIADep, bniP2Last, inputs.startYear, rows, 'p2GIA') : null;

    var intAccts = accounts.filter(function(a) { return a.rate != null || a.monthlyDraw != null; });

    // ══════════════════════════════════════════════════════════════════════
    // CARD 1 — People and timeline
    // ══════════════════════════════════════════════════════════════════════
    var c1 = card(
      heading('People and timeline') +

      row('Retirement age',
        dual
          ? vline('Age ' + p1RetAge + ' (' + (inputs.p1DOB + p1RetAge) + ')', p1) +
            vline('Age ' + p2RetAge + ' (' + (inputs.p2DOB + p2RetAge) + ')', p2)
          : vline('Age ' + p1RetAge + ' (' + (inputs.p1DOB + p1RetAge) + ')'),
        dual
          ? chip.apply(null, retVFn(p1RetAge)) + (p2RetAge < 57 ? ' ' + chip.apply(null, retVFn(p2RetAge)) : '')
          : chip.apply(null, retVFn(p1RetAge)),
        retNote(p1RetAge, p1, inputs.p1Salary) + (dual && p2RetAge < 57 ? ' ' + retNote(p2RetAge, p2, inputs.p2Salary) : '')
      ) +

      row('State Pension',
        dual
          ? vline(money(inputs.p1SPAmt) + '/yr at ' + inputs.p1SPAge, p1) +
            vline(money(inputs.p2SPAmt) + '/yr at ' + inputs.p2SPAge, p2)
          : vline(money(inputs.p1SPAmt) + '/yr at ' + inputs.p1SPAge),
        dual
          ? chip.apply(null, spVFn(inputs.p1SPAmt)) + ' ' + chip.apply(null, spVFn(inputs.p2SPAmt))
          : chip.apply(null, spVFn(inputs.p1SPAmt)),
        spNote(dual ? Math.max(inputs.p1SPAmt, inputs.p2SPAmt) : inputs.p1SPAmt, inputs.p1SPAge)
      ) +

      row('Salary',
        dual
          ? vline(inputs.p1Salary > 0 ? money(inputs.p1Salary) + '/yr to ' + inputs.p1SalaryStop : 'None', p1) +
            vline(inputs.p2Salary > 0 ? money(inputs.p2Salary) + '/yr to ' + inputs.p2SalaryStop : 'None', p2)
          : vline(inputs.p1Salary > 0 ? money(inputs.p1Salary) + '/yr to ' + inputs.p1SalaryStop : 'None'),
        inputs.p1Salary > 0 || inputs.p2Salary > 0 ? chip('info','Note') : chip('info','None'),
        salNote(inputs.p2Salary || inputs.p1Salary, inputs.p2SalaryStop || inputs.p1SalaryStop, inputs.p2Salary > 0 ? p2 : p1)
      ) +

      row('Projection end',
        vline('From ' + inputs.startYear + ' to ' + inputs.endYear + ' (' + (inputs.endYear - inputs.startYear) + ' years)') +
        (dual && p2EndAge
          ? vline(p1 + ' age ' + p1EndAge) + vline(p2 + ' age ' + p2EndAge)
          : vline(p1 + ' age ' + p1EndAge)),
        chip.apply(null, endV),
        endNote
      )
    );

    // ══════════════════════════════════════════════════════════════════════
    // CARD 2 — Spending + Returns
    // ══════════════════════════════════════════════════════════════════════
    var c2 = card(
      heading('Spending') +

      row('Spending target',
        vline(money(inputs.spending) + '/yr'),
        chip.apply(null, wrV),
        wrNote
      ) +

      (inputs.stepDownPct > 0 ? row('Step-down at 75',
        vline(inputs.stepDownPct + '% (\u2192 ' + money(inputs.spending * (1 - inputs.stepDownPct / 100)) + '/yr)'),
        chip('info','Note'),
        'Gross spending drops by ' + inputs.stepDownPct + '% in the year ' + p1 + ' turns 75. This reflects the well-documented reduction in discretionary spending in later retirement and eases pressure on the portfolio in the final decade.'
      ) : '') +

      subheading('Returns and inflation') +

      row('Growth rate',
        vline(gPct.toFixed(1) + '% nominal'),
        chip.apply(null, growV),
        growNote
      ) +

      row('Inflation',
        vline(iPct.toFixed(1) + '%'),
        chip.apply(null, inflV),
        inflNote
      ) +

      row('Tax thresholds',
        vline(inputs.thresholdMode === 'frozen' ? 'Frozen' : inputs.thresholdMode === 'always' ? 'Uprated with inflation' : 'Uprated from ' + inputs.thresholdFromYear),
        chip.apply(null, tmV),
        tmNote
      )
    );

    // ══════════════════════════════════════════════════════════════════════
    // CARD 3 — Portfolio
    // ══════════════════════════════════════════════════════════════════════
    var portSummaryVal = wrRateStr + '% of ' + money(totalPort);
    var c3 = card(
      heading('Portfolio') +

      row('Withdrawal rate',
        dual
          ? vline(money(p1Total), p1) + vline(money(p2Total), p2) + vline(portSummaryVal)
          : vline(portSummaryVal),
        chip.apply(null, wrV),
        wrNote
      ) +

      row('Equity allocation',
        vline(equityPct + '% equities'),
        chip.apply(null, eqV),
        eqNote
      ) +

      row('GIA exposure',
        dual
          ? vline(money(p1GIA), p1) + vline(money(p2GIA), p2)
          : vline(money(p1GIA)),
        chip.apply(null, giaV),
        giaNote
      ) +

      row('Dividend yield',
        vline(((inputs.dividendYield || 0) * 100).toFixed(1) + '%'),
        chip('green','Reasonable'),
        'GIA dividends are taxed on an arising basis each year regardless of whether they are paid out or reinvested. The yield assumption affects both the tax model and the cashflow available to meet spending.'
      )
    );

    // ══════════════════════════════════════════════════════════════════════
    // CARD 4 — Strategy + BnI
    // ══════════════════════════════════════════════════════════════════════
    var bniContent = '';
    if (inputs.bniEnabled) {
      var p1Pl = inputs.bniP1GIA > 0
        ? money(inputs.bniP1GIA) + '/yr \xd7 ' + inputs.bniP1Years + ' yr' + (inputs.bniP1Years !== 1 ? 's' : '')
        : 'Not configured';
      var p2Pl = dual
        ? (inputs.bniP2GIA > 0
            ? money(inputs.bniP2GIA) + '/yr \xd7 ' + inputs.bniP2Years + ' yr' + (inputs.bniP2Years !== 1 ? 's' : '')
            : 'Not configured')
        : null;

      var survChip = p1BniV.survival[0] === 'red' || (p2BniV && p2BniV.survival[0] === 'red')
        ? chip('red', 'At risk')
        : p1BniV.survival[0] === 'amber' || (p2BniV && p2BniV.survival[0] === 'amber')
          ? chip('amber', 'Marginal')
          : chip('green', 'On track');

      var survNote = p1BniV.survival[0] === 'red' ? p1BniV.survivalNote
        : (p2BniV && p2BniV.survival[0] === 'red') ? p2BniV.survivalNote
        : p1BniV.survival[0] === 'amber' ? p1BniV.survivalNote
        : (p2BniV && p2BniV.survival[0] === 'amber') ? p2BniV.survivalNote
        : p1BniV.survivalNote;

      bniContent = subheading('Bed-and-ISA') +

        row('Transfers planned',
          dual
            ? vline(p1Pl, p1) + vline(p2Pl, p2)
            : vline(p1Pl),
          chip.apply(null, p1BniV.planned),
          'Each year up to \u00a320,000 per person is sold from the GIA and immediately repurchased inside an ISA. Future growth and income on the transferred amount becomes permanently tax-free. CGT may be triggered at the point of transfer.'
        ) +

        row('GIA funds transfers?',
          dual
            ? vline(p1BniV.survivalLabel, p1) + vline(p2BniV ? p2BniV.survivalLabel : 'n/a', p2)
            : vline(p1BniV.survivalLabel),
          survChip,
          survNote
        );

    } else if (giaTotal > 20000) {
      bniContent = subheading('Bed-and-ISA') +
        row('Bed-and-ISA',
          vline('Not enabled'),
          chip('amber','Opportunity'),
          money(giaTotal) + ' sits in a taxable wrapper. Enabling Bed-and-ISA and transferring up to \u00a320k/yr per person into an ISA would shelter that growth from future CGT and reduce the annual dividend tax drag.'
        );
    }

    var c4 = card(
      heading('Strategy') +

      row('Withdrawal strategy',
        vline(stratLabels[inputs.strategy] || inputs.strategy),
        chip('info','Active'),
        stratNotes[inputs.strategy] || ''
      ) +

      row('Dividend mode',
        vline(inputs.dividendMode === 'reinvest' ? 'Reinvest' : 'Payout'),
        chip('info','Note'),
        divNote
      ) +

      bniContent
    );

    // ══════════════════════════════════════════════════════════════════════
    // CARD 5 — Interest-bearing accounts (full width, only if present)
    // ══════════════════════════════════════════════════════════════════════
    var c5 = '';
    if (intAccts.length) {
      c5 = card(
        heading('Interest-bearing accounts') +
        intAccts.map(function(a) {
          var owner   = a.owner === 'p1' ? p1 : p2;
          var rateStr = a.rate != null ? ' \u00b7 ' + a.rate + '% AER' : '';
          var drawStr = a.monthlyDraw ? ' \u00b7 ' + money(a.monthlyDraw) + '/mo draw' : '';
          return row(
            a.name || '(unnamed)',
            vline(money(a.value || 0) + rateStr + drawStr + ', ' + owner),
            chip('info','Included'),
            'This account is modelled separately from the main GIA balance. Interest is taxed as savings income each year using the Starting Rate for Savings, Personal Savings Allowance, and standard savings rates as applicable. Its balance is excluded from the dividend yield calculation to prevent double-counting.'
          );
        }).join(''),
        true
      );
    }

    var intro = '<p class="ps-intro">This page summarises every assumption driving your projection and gives each one a verdict. Green means the assumption is sound. Amber means it’s worth a second look. Red means it’s likely to cause a problem and should be addressed. If you want to change anything, go back to Your plan, adjust the inputs, and re-run the projection to see the updated results here.</p>';

    return intro + '<div class="ps-grid">' + c1 + c2 + c3 + c4 + c5 + '</div>';
  }

  window.RetireSummary = { setData: setData, render: render };

})();
