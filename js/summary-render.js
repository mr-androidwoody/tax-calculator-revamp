(function () {
  'use strict';

  const D = window.RetireData;
  const C = window.RetireCalc;

  let _inputs   = null;
  let _result   = null;
  let _accounts = [];
  let _stale    = true;

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
      el.innerHTML = '<div class="ps-empty"><strong>No projection run yet</strong>Run a projection to see a summary of your plan assumptions and verdicts.</div>';
      return;
    }
    el.innerHTML = _buildHTML(_inputs, _result, _accounts);
    _stale = false;
  }

  function chip(colour, label) {
    return '<span class="ps-chip ps-chip--' + colour + '"><span class="ps-chip__dot"></span>' + label + '</span>';
  }

  function valLine(val, chipHTML, pname) {
    const n = pname ? '<span class="ps-pname">' + pname + '</span>' : '';
    return '<div class="ps-val-line">' + n + '<span class="ps-val">' + val + '</span>' + (chipHTML || '') + '</div>';
  }

  function noteEl(text) {
    return text ? '<div class="ps-note">' + text + '</div>' : '';
  }

  function row(label, rightHTML) {
    return '<div class="ps-row"><div class="ps-row__label">' + label + '</div><div class="ps-row__right">' + rightHTML + '</div></div>';
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

  function _bniVerdict(enabled, annualAmt, years, startingGIA, depletionYear, lastTransferYear, startYear, rows, snapKey) {
    if (!enabled || !(annualAmt > 0) || !(years > 0)) {
      return { planned: ['amber','Not configured'], survival: ['info','n/a'], survivalLabel: 'n/a', survivalNote: '' };
    }
    const pct      = startingGIA > 0 ? (annualAmt * years / startingGIA) * 100 : 100;
    const plannedC = pct >= 98 ? 'green' : 'amber';
    const plannedL = pct >= 98 ? 'Full shelter' : 'Partial';

    if (depletionYear && depletionYear <= lastTransferYear) {
      const failYr  = depletionYear - startYear + 1;
      const safeYrs = failYr - 1;
      return {
        planned: [plannedC, plannedL],
        survival: ['red','At risk'],
        survivalLabel: 'GIA depletes year ' + failYr,
        survivalNote: 'GIA exhausted in year ' + failYr + ' before the ' + years + '-year period ends. Transfers in the remaining years will not occur. Consider reducing to ' + safeYrs + ' year' + (safeYrs !== 1 ? 's' : '') + '.',
      };
    }
    const finalRow = rows.find(function(r) { return r.year === lastTransferYear; });
    const giaAtEnd = (finalRow && finalRow.snap && finalRow.snap[snapKey]) || 0;
    if (giaAtEnd < annualAmt * 0.2) {
      return {
        planned: [plannedC, plannedL],
        survival: ['amber','Marginal'],
        survivalLabel: 'Transfers may be partial',
        survivalNote: 'GIA balance in the final transfer year is low. A market downturn could prevent the last transfer completing in full.',
      };
    }
    return {
      planned: [plannedC, plannedL],
      survival: ['green','On track'],
      survivalLabel: 'GIA funds all transfers',
      survivalNote: 'GIA balance is sufficient to fund all planned transfers. The strategy should complete as set.',
    };
  }

  function _buildHTML(inputs, result, accounts) {
    var dual = inputs.p2enabled;
    var rows = result.rows || [];
    var p1   = inputs.p1name || 'Person 1';
    var p2   = inputs.p2name || 'Person 2';

    if (!rows.length) {
      return '<div class="ps-empty"><strong>No data</strong>Projection produced no rows.</div>';
    }

    var portSum      = C.summarisePortfolio(accounts);
    var equityPct    = Math.round(portSum.overallAllocation.equities || 0);
    var totalPort    = rows[0] ? rows[0].totalPortfolio || 0 : 0;

    var p1Total = (inputs.p1Bal.Cash || 0) + (inputs.p1Bal.GIAeq || 0) + (inputs.p1Bal.GIAcash || 0) + (inputs.p1Bal.SIPP || 0) + (inputs.p1Bal.ISA || 0);
    var p2Total = dual ? (inputs.p2Bal.Cash || 0) + (inputs.p2Bal.GIAeq || 0) + (inputs.p2Bal.GIAcash || 0) + (inputs.p2Bal.SIPP || 0) + (inputs.p2Bal.ISA || 0) : 0;
    var p1GIA   = (inputs.p1Bal.GIAeq || 0) + (inputs.p1Bal.GIAcash || 0);
    var p2GIA   = dual ? (inputs.p2Bal.GIAeq || 0) + (inputs.p2Bal.GIAcash || 0) : 0;
    var giaTotal = p1GIA + p2GIA;

    var wrRate    = totalPort > 0 ? (inputs.spending / totalPort) * 100 : 0;
    var wrRateStr = wrRate.toFixed(1);
    var wrV       = wrRate < 3.5 ? ['green','Low risk'] : wrRate < 4.5 ? ['amber','Moderate'] : ['red','High risk'];

    var gPct  = (inputs.growth || 0) * 100;
    var growV = gPct < 2 ? ['red','Very low'] : gPct < 4 ? ['amber','Conservative'] : gPct <= 6 ? ['green','Reasonable'] : gPct <= 8 ? ['amber','Optimistic'] : ['red','Very high'];

    var iPct  = (inputs.inflation || 0) * 100;
    var inflV = iPct < 1.5 ? ['amber','Low'] : iPct <= 3 ? ['green','Reasonable'] : iPct <= 4 ? ['amber','Elevated'] : ['red','High'];

    var eqV   = equityPct < 60 ? ['amber','Conservative'] : equityPct <= 90 ? ['green','Balanced'] : ['amber','Aggressive'];

    var giaPct = totalPort > 0 ? (giaTotal / totalPort) * 100 : 0;
    var giaV   = giaPct < 20 ? ['green','Low'] : giaPct < 40 ? ['amber','High'] : ['red','Very high'];

    var tmV = inputs.thresholdMode === 'frozen' ? ['green','Conservative'] : inputs.thresholdMode === 'always' ? ['amber','Optimistic'] : ['info','Mixed'];

    var p1EndAge = inputs.endYear - inputs.p1DOB;
    var p2EndAge = dual ? inputs.endYear - inputs.p2DOB : null;
    var endV = p1EndAge >= 90 ? ['green','Prudent'] : p1EndAge >= 85 ? ['amber','Moderate'] : ['red','Short horizon'];

    function spVFn(amt) { return amt <= 0 ? ['amber','Not set'] : amt > 12500 ? ['amber','Above full SP'] : ['green','Plausible']; }

    var p1RetAge = inputs.p1SalaryStop > 0 ? inputs.p1SalaryStop : (inputs.startYear - inputs.p1DOB);
    var p2RetAge = dual && inputs.p2SalaryStop > 0 ? inputs.p2SalaryStop : (dual ? inputs.startYear - inputs.p2DOB : null);
    function retVFn(age) { return age >= 57 ? ['green','Fine'] : ['red','Pre-57 \u2014 SIPP locked']; }

    var p1GIADep = (result.depletions && result.depletions[p1 + ' GIA']) ? result.depletions[p1 + ' GIA'].year : null;
    var p2GIADep = dual && result.depletions && result.depletions[p2 + ' GIA'] ? result.depletions[p2 + ' GIA'].year : null;
    var bniP1Last = inputs.startYear + (inputs.bniP1Years || 0) - 1;
    var bniP2Last = inputs.startYear + (inputs.bniP2Years || 0) - 1;

    var p1BniV = _bniVerdict(inputs.bniEnabled, inputs.bniP1GIA, inputs.bniP1Years, p1GIA, p1GIADep, bniP1Last, inputs.startYear, rows, 'p1GIA');
    var p2BniV = dual ? _bniVerdict(inputs.bniEnabled, inputs.bniP2GIA, inputs.bniP2Years, p2GIA, p2GIADep, bniP2Last, inputs.startYear, rows, 'p2GIA') : null;

    var stratLabels = { balanced: 'Tax Band Optimiser', isaFirst: 'ISA first', sippFirst: 'Pension first' };
    var stratNotes  = {
      balanced:  'Draws from wrappers in the order that minimises marginal tax each year, blending GIA, SIPP, and ISA.',
      isaFirst:  'Prioritises drawing from the ISA first, preserving taxable wrappers.',
      sippFirst: 'Draws from the pension first, reducing its future taxable balance.',
    };

    var intAccts = accounts.filter(function(a) { return a.rate != null || a.monthlyDraw != null; });

    // ── Card 1: People and timeline ──
    var c1 = card(
      heading('People and timeline') +
      row('Retirement age',
        (dual
          ? valLine('Age ' + p1RetAge + ' (' + (inputs.p1DOB + p1RetAge) + ')', chip.apply(null, retVFn(p1RetAge)), p1) +
            valLine('Age ' + p2RetAge + ' (' + (inputs.p2DOB + p2RetAge) + ')', chip.apply(null, retVFn(p2RetAge || 0)), p2)
          : valLine('Age ' + p1RetAge + ' (' + (inputs.p1DOB + p1RetAge) + ')', chip.apply(null, retVFn(p1RetAge)))) +
        noteEl(p1RetAge >= 57
          ? 'Both above the minimum pension access age of 57 (from 2028).'
          : 'SIPP locked until age 57 from 2028. GIA and ISA can be drawn before that.')
      ) +
      row('State Pension',
        (dual
          ? valLine(D.formatMoney(inputs.p1SPAmt) + '/yr at ' + inputs.p1SPAge, chip.apply(null, spVFn(inputs.p1SPAmt)), p1) +
            valLine(D.formatMoney(inputs.p2SPAmt) + '/yr at ' + inputs.p2SPAge, chip.apply(null, spVFn(inputs.p2SPAmt)), p2)
          : valLine(D.formatMoney(inputs.p1SPAmt) + '/yr at ' + inputs.p1SPAge, chip.apply(null, spVFn(inputs.p1SPAmt)))) +
        noteEl('Full new State Pension is \u00a311,502/yr (2025/26). Check your Government Gateway forecast.')
      ) +
      row('Salary',
        (dual
          ? valLine(inputs.p1Salary > 0 ? D.formatMoney(inputs.p1Salary) + '/yr to ' + inputs.p1SalaryStop : 'None', null, p1) +
            valLine(inputs.p2Salary > 0 ? D.formatMoney(inputs.p2Salary) + '/yr to ' + inputs.p2SalaryStop : 'None', inputs.p2Salary > 0 ? chip('info','Note') : null, p2)
          : valLine(inputs.p1Salary > 0 ? D.formatMoney(inputs.p1Salary) + '/yr to ' + inputs.p1SalaryStop : 'None', null)) +
        noteEl(inputs.p2Salary > 0
          ? p2 + "'s salary reduces portfolio draws in early years, easing sequence-of-returns risk."
          : inputs.p1Salary > 0 ? p1 + "'s salary reduces portfolio draws until retirement."
          : 'No salary income modelled. Portfolio draws begin immediately.')
      ) +
      row('Projection end',
        valLine(inputs.endYear + ' \u2014 ' + p1 + ' age ' + p1EndAge + (dual && p2EndAge ? ', ' + p2 + ' age ' + p2EndAge : ''), chip.apply(null, endV)) +
        noteEl((inputs.endYear - inputs.startYear) + '-year horizon. ' + (p1EndAge >= 90 ? 'A sound upper bound for longevity planning.' : 'Consider extending to age 90+ for a more prudent buffer.'))
      )
    );

    // ── Card 2: Spending + Returns ──
    var c2 = card(
      heading('Spending') +
      row('Spending target',
        valLine(D.formatMoney(inputs.spending) + '/yr', chip.apply(null, wrV)) +
        noteEl(wrRateStr + '% withdrawal rate. ' + (
          wrRate < 3.5 ? 'Well within the low-risk range.'
          : wrRate < 4.5 ? 'Above the 3.5% low-risk threshold. Leaves limited buffer.'
          : 'Exceeds the 4.5% caution threshold. High depletion risk \u2014 stress-test with Test my plan.'
        ))
      ) +
      (inputs.stepDownPct > 0 ? row('Step-down at 75',
        valLine(inputs.stepDownPct + '% (' + D.formatMoney(inputs.spending * (1 - inputs.stepDownPct / 100)) + ' from 75)', chip('info','Note')) +
        noteEl('Spending reduces in the year ' + p1 + ' turns 75. Eases late-stage drawdown pressure.')
      ) : '') +
      subheading('Returns and inflation') +
      row('Growth rate',
        valLine(gPct.toFixed(1) + '% nominal', chip.apply(null, growV)) +
        noteEl(gPct <= 6 ? 'Within the 4\u20136% cautious-to-balanced range. Consistent with long-run global equity returns.'
          : gPct <= 8 ? 'Above the typical 4\u20136% range. Verify this is realistic for your asset mix.'
          : 'Significantly above long-run averages. Results will be optimistic.')
      ) +
      row('Inflation',
        valLine(iPct.toFixed(1) + '%', chip.apply(null, inflV)) +
        noteEl(iPct <= 3 ? 'Aligned with the Bank of England long-run target.' : 'Above the BoE target \u2014 spending power erodes faster.')
      ) +
      row('Tax thresholds',
        valLine(
          inputs.thresholdMode === 'frozen' ? 'Frozen' : inputs.thresholdMode === 'always' ? 'Uprated with inflation' : 'Uprated from ' + inputs.thresholdFromYear,
          chip.apply(null, tmV)
        ) +
        noteEl(inputs.thresholdMode === 'frozen' ? 'Fiscal drag fully modelled. Pessimistic but prudent.'
          : inputs.thresholdMode === 'always' ? 'Optimistic \u2014 reduces modelled fiscal drag.'
          : 'Frozen until ' + inputs.thresholdFromYear + ', then uprated. A middle-ground assumption.')
      )
    );

    // ── Card 3: Portfolio ──
    var c3 = card(
      heading('Portfolio') +
      row('Total portfolio',
        (dual
          ? valLine(D.formatMoney(p1Total), null, p1) + valLine(D.formatMoney(p2Total), null, p2)
          : valLine(D.formatMoney(p1Total), null)) +
        valLine(wrRateStr + '% of ' + D.formatMoney(totalPort), chip.apply(null, wrV)) +
        noteEl('Use Test my plan to stress-test this across 10,000 market scenarios.')
      ) +
      row('Equity allocation',
        valLine(equityPct + '% equities', chip.apply(null, eqV)) +
        noteEl(equityPct < 60
          ? 'May limit long-run growth. Consider raising for a long retirement horizon.'
          : equityPct <= 90 ? 'Appropriate for a long retirement horizon.'
          : 'High equity tilt increases sequence-of-returns risk in early retirement.')
      ) +
      row('GIA exposure',
        (dual
          ? valLine(D.formatMoney(p1GIA), null, p1) + valLine(D.formatMoney(p2GIA), null, p2)
          : valLine(D.formatMoney(p1GIA), null)) +
        valLine('', chip.apply(null, giaV)) +
        noteEl('Assets in a taxable wrapper. Bed-and-ISA can shelter up to \u00a320k/yr per person.')
      ) +
      row('Dividend yield',
        valLine(((inputs.dividendYield || 0) * 100).toFixed(1) + '%', chip('green','Reasonable')) +
        noteEl('GIA dividends taxed on an arising basis each year regardless of payout or reinvest mode.')
      )
    );

    // ── Card 4: Strategy + BnI ──
    var bniContent = '';
    if (inputs.bniEnabled) {
      var p1Pl = inputs.bniP1GIA > 0 ? D.formatMoney(inputs.bniP1GIA) + '/yr x ' + inputs.bniP1Years + ' yr' + (inputs.bniP1Years !== 1 ? 's' : '') : 'Not configured';
      var p2Pl = dual ? (inputs.bniP2GIA > 0 ? D.formatMoney(inputs.bniP2GIA) + '/yr x ' + inputs.bniP2Years + ' yr' + (inputs.bniP2Years !== 1 ? 's' : '') : 'Not configured') : null;

      var survNote = p1BniV.survival[0] === 'red' ? p1BniV.survivalNote
        : (p2BniV && p2BniV.survival[0] === 'red') ? p2BniV.survivalNote
        : p1BniV.survival[0] === 'amber' ? p1BniV.survivalNote
        : (p2BniV && p2BniV.survival[0] === 'amber') ? p2BniV.survivalNote
        : p1BniV.survivalNote;

      bniContent = subheading('Bed-and-ISA') +
        row('Transfers planned',
          (dual
            ? valLine(p1Pl, chip.apply(null, p1BniV.planned), p1) + valLine(p2Pl, chip.apply(null, p2BniV.planned), p2)
            : valLine(p1Pl, chip.apply(null, p1BniV.planned))) +
          noteEl('Sells GIA and rebuys within an ISA, sheltering future gains and income. Annual ISA cap: \u00a320k/person.')
        ) +
        row('GIA funds transfers?',
          (dual
            ? valLine(p1BniV.survivalLabel, chip.apply(null, p1BniV.survival), p1) +
              valLine(p2BniV ? p2BniV.survivalLabel : 'n/a', p2BniV ? chip.apply(null, p2BniV.survival) : '', p2)
            : valLine(p1BniV.survivalLabel, chip.apply(null, p1BniV.survival))) +
          noteEl(survNote)
        );
    } else if (giaTotal > 20000) {
      bniContent = subheading('Bed-and-ISA') +
        row('Bed-and-ISA',
          valLine('Not enabled', chip('amber','Opportunity')) +
          noteEl('GIA holdings of ' + D.formatMoney(giaTotal) + ' could be progressively sheltered via Bed-and-ISA transfers of up to \u00a320k/yr per person.')
        );
    }

    var c4 = card(
      heading('Strategy') +
      row('Withdrawal strategy',
        valLine(stratLabels[inputs.strategy] || inputs.strategy, chip('info','Active')) +
        noteEl(stratNotes[inputs.strategy] || '')
      ) +
      row('Dividend mode',
        valLine(inputs.dividendMode === 'reinvest' ? 'Reinvest' : 'Payout', chip('info','Note')) +
        noteEl(inputs.dividendMode === 'reinvest'
          ? 'GIA dividends compound inside the wrapper but are still taxed annually on an arising basis.'
          : 'GIA dividends paid out as income. Taxed on an arising basis regardless.')
      ) +
      bniContent
    );

    // ── Card 5: Interest-bearing accounts (full width) ──
    var c5 = '';
    if (intAccts.length) {
      c5 = card(
        heading('Interest-bearing accounts') +
        intAccts.map(function(a) {
          var owner   = a.owner === 'p1' ? p1 : p2;
          var rateStr = a.rate != null ? ' \u00b7 ' + a.rate + '% AER' : '';
          var drawStr = a.monthlyDraw ? ' \u00b7 ' + D.formatMoney(a.monthlyDraw) + '/mo draw' : '';
          return row(a.name || '(unnamed)',
            valLine(D.formatMoney(a.value || 0) + rateStr + drawStr + ' \u2014 ' + owner, chip('info','Included')) +
            noteEl('Handled separately from GIA equity balance. Interest taxed on arising basis; excluded from dividend calculations.')
          );
        }).join(''),
        true
      );
    }

    return '<div class="ps-grid">' + c1 + c2 + c3 + c4 + c5 + '</div>';
  }

  window.RetireSummary = { setData: setData, render: render };

})();
