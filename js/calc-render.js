(function () {
  const D = window.RetireData;

  // State shared within this module
  let _rows       = [];
  let _strategy   = 'balanced';
  let _annotations = [];
  let _depletions  = {};
  let _viewPerson = 'both';
  let _useReal    = false;
  let _p2enabled  = true;
  let _activeResultsTab = 'income';
  let _incomeChart     = null;
  let _taxChart        = null;
  let _wealthChart     = null;
  let _spendingChart   = null;
  let _engineShortfall = [];

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  const L   = window.RetireCalcRenderLogic;
  const adj = (val, row) => L.adj(val, row, _useReal);
  const fmt = n => D.formatMoney(n);

  function getNames() {
    const p1 = (document.getElementById('sp-p1name')?.value || '').trim() || 'Person 1';
    const p2 = (document.getElementById('sp-p2name')?.value || '').trim() || 'Person 2';
    return { p1, p2 };
  }

  // ─────────────────────────────────────────────
  // PUBLIC: receive new projection results
  // ─────────────────────────────────────────────
  function setResults(result, strategy, p2enabled) {
    _rows        = result.rows || result; // backwards-compat if bare array passed
    _annotations = result.annotations || [];
    _depletions  = result.depletions  || {};
    if (strategy) _strategy = strategy;
    _p2enabled = (p2enabled !== false);

    // Update the Results page h1 to show active strategy
    const strategyLabels = { balanced: 'Tax Band Optimiser', isaFirst: 'Pension Preservation', sippFirst: 'Pension Front-Loading', taxMin: 'Allowance Maximiser' };
    document.querySelectorAll('h1').forEach(el => {
      if (el.textContent.startsWith('Projection')) {
        el.textContent = 'Projection: ' + (strategyLabels[_strategy] || _strategy);
      }
    });

    // Single-person mode: force view to p1, hide Both and P2 toggle buttons.
    // Two-person mode: restore all toggle buttons.
    const bothBtns = document.querySelectorAll('[data-action="view-both"]');
    const p2Btns   = document.querySelectorAll('[data-action="view-p2"]');
    if (!_p2enabled) {
      _viewPerson = 'p1';
      document.querySelectorAll('[data-action="view-both"],[data-action="view-p1"],[data-action="view-p2"]')
        .forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('[data-action="view-p1"]')
        .forEach(b => b.classList.add('is-active'));
      bothBtns.forEach(b => { b.style.display = 'none'; });
      p2Btns.forEach(b =>   { b.style.display = 'none'; });
    } else {
      bothBtns.forEach(b => { b.style.display = ''; });
      p2Btns.forEach(b =>   { b.style.display = ''; });
    }
  }

  // ─────────────────────────────────────────────
  // VIEW TOGGLES
  // ─────────────────────────────────────────────
  function setView(vp, btn) {
    _viewPerson = vp;
    // sync all person toggle-groups across every sidebar
    document.querySelectorAll('[data-action="view-both"],[data-action="view-p1"],[data-action="view-p2"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${btn.dataset.action}"]`)
      .forEach(b => b.classList.add('is-active'));
    renderCharts();
    renderMetrics();
  }

  function setReal(r, btn) {
    _useReal = r;
    // sync all real/nominal toggle-groups across every sidebar
    document.querySelectorAll('[data-action="real-on"],[data-action="real-off"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${btn.dataset.action}"]`)
      .forEach(b => b.classList.add('is-active'));
    renderCharts();
    renderMetrics();
    if (_activeResultsTab === 'tables') renderTables();
  }

  function initResultsTabs() {
    // Wire up disclaimer link
    initDisclaimerLink();

    document.querySelectorAll('.results-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.resultsTab;
        _activeResultsTab = tab;

        // Update tab button states
        document.querySelectorAll('.results-tab').forEach(b => {
          b.classList.toggle('results-tab--active', b === btn);
          b.classList.toggle('results-tab--inactive', b !== btn);
        });

        // Show the matching panel, hide others.
        // Full-width panels (tables, outlook) use display:block;
        // chart panels with a sidebar (including summary) use display:grid.
        const fullWidthPanels = new Set(['tables', 'outlook']);
        document.querySelectorAll('.chart-panel').forEach(panel => {
          const isActive = panel.id === `results-panel-${tab}`;
          panel.style.display = isActive
            ? (fullWidthPanels.has(tab) ? 'block' : 'grid')
            : 'none';
        });

        // Show/hide deterministic disclaimer
        const disclaimer = document.getElementById('det-disclaimer');
        if (disclaimer) disclaimer.classList.toggle('det-disclaimer--hidden', tab === 'outlook' || tab === 'summary');

        // Hide metrics band on summary and outlook tabs
        const metricsBand = document.querySelector('.metrics-band');
        if (metricsBand) metricsBand.style.display = (tab === 'outlook') ? 'none' : '';

        // Hide Test my plan button on outlook tab, or permanently if MC has
        // already been run (window.RetireMCEngine tracks this via app.js state).
        const testPlanBtn = document.getElementById('btn-test-plan');
        if (testPlanBtn) {
          const riskDone = document.body.dataset.riskRun === 'true';
          testPlanBtn.style.display = (tab === 'outlook' || riskDone) ? 'none' : '';
        }

        // Render tables on first visit
        if (tab === 'tables') renderTables();

        // Render plan summary on first visit (or when stale after a new projection)
        if (tab === 'summary') window.RetireSummary?.render();
      });
    });
  }

  function initDisclaimerLink() {
    const btn = document.querySelector('.det-disclaimer__link[data-results-tab="outlook"]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const outlookTab = document.querySelector('.results-tab[data-results-tab="outlook"]');
      if (outlookTab) outlookTab.click();
    });
  }

  function initTableSelector() {
    document.querySelectorAll('[data-table-select]').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.tableSelect;

        // Update selector button states
        document.querySelectorAll('[data-table-select]').forEach(b => {
          b.classList.toggle('is-active', b === btn);
        });

        // Show matching sub-view
        document.getElementById('tables-tax-view').style.display      = which === 'tax'      ? '' : 'none';
        document.getElementById('tables-wealth-view').style.display    = which === 'wealth'   ? '' : 'none';
        document.getElementById('tables-drawdown-view').style.display  = which === 'drawdown' ? '' : 'none';
      });
    });
  }

  // ─────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────
  function renderMetrics() {
    if (!_rows.length) return;

    const { totalTax, avgRate, lastPortfolio: _lp } = L.buildMetrics(_rows, _viewPerson, _useReal);

    const spending    = D.parseCurrency(document.getElementById('spending')?.value || '0');
    const stepDownPct = parseFloat(document.getElementById('stepDownPct')?.value) || 0;
    const fmtK = n => '£' + Math.round(n).toLocaleString('en-GB');
    let incomeTargetStr;
    let incomeTargetSub = '';
    if (stepDownPct > 0) {
      const reduced = spending * (1 - stepDownPct / 100);
      incomeTargetStr = fmtK(spending) + ' reducing to ' + fmtK(reduced);
      incomeTargetSub = 'Income steps down at age 75';
    } else {
      incomeTargetStr = fmtK(spending) + ' per year';
    }

    const mTax    = document.getElementById('m-tax');
    const mRate   = document.getElementById('m-rate');
    const mTarget = document.getElementById('m-income-target');
    const mPort   = document.getElementById('m-port');
    if (mTax)    mTax.textContent    = fmt(totalTax);
    if (mRate)   mRate.textContent   = (avgRate * 100).toFixed(1) + '%';
    if (mTarget) mTarget.textContent = incomeTargetStr;
    const mIncomeSub = document.getElementById('m-income-sublabel');
    if (mIncomeSub) mIncomeSub.textContent = incomeTargetSub;
    if (mPort)   mPort.textContent   = fmt(_lp);

    // ── MC comparison icon + tooltip ──────────────────────────────────
    // Compare raw nominal values — avoids real/nominal toggle mismatch.
    if (mPort) {
      const nominalDetEnd = _rows.length ? (_rows[_rows.length - 1]?.totalPortfolio || 0) : 0;
      const mcNominal     = window.RetireMCResults?.medianEndPortfolioNominal ?? null;
      let mcIcon = document.getElementById('m-port-mc-icon');

      if (mcNominal !== null && nominalDetEnd > 0) {
        const gap    = (nominalDetEnd - mcNominal) / nominalDetEnd;
        const gapPct = Math.round(gap * 100);
        const tipBody = gap >= 0.25
          ? `Based on fixed return assumptions, real markets vary. Typical market outcome is ${gapPct}% lower. See Plan Outlook for a market-adjusted view.`
          : `Assumes consistent returns. Plan Outlook may differ as it accounts for market fluctuations and investment variability.`;
        const tipTitle = 'Straight-line estimate';

        if (!mcIcon) {
          mcIcon = document.createElement('span');
          mcIcon.id = 'm-port-mc-icon';
          mcIcon.style.cssText = 'display:inline-block;margin-left:6px;cursor:default;vertical-align:middle;opacity:0.7;font-size:0.85rem;color:#3460e8';
          mcIcon.textContent = 'ⓘ';
          // Insert into the metric-value-row wrapper, after the value
          const row = mPort.closest('.metric-value-row') || mPort.parentElement;
          row.appendChild(mcIcon);
        }
        mcIcon.style.display = '';
        mcIcon.onmouseenter = e => showTooltip(mcIcon, tipBody, tipTitle);
        mcIcon.onmouseleave = hideTooltip;
      } else if (mcIcon) {
        mcIcon.style.display = 'none';
      }
    }
  }

  // ─────────────────────────────────────────────
  // INCOME LEGEND
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────
  // LEGEND TOOLTIPS
  // ─────────────────────────────────────────────

  // Shared tooltip element — created once, reused on every hover
  let _tooltip = null;
  function getTooltip() {
    if (!_tooltip) {
      _tooltip = document.createElement('div');
      _tooltip.id = 'legend-tooltip';
      document.body.appendChild(_tooltip);
    }
    return _tooltip;
  }

  function showTooltip(anchorEl, text, title) {
    const tip = getTooltip();
    // Build two-part panel: blue header with (i) + title, white body with text
    const iIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:5px;flex-shrink:0" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="white" stroke-width="1.5"/><line x1="8" y1="7" x2="8" y2="11.5" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="4.5" r="0.85" fill="white"/></svg>`;
    tip.innerHTML = `
      <div class="tooltip-header">${iIcon}<span class="tooltip-title">${title || ''}</span></div>
      <div class="tooltip-body">${text}</div>
    `;
    tip.classList.add('is-visible');
    const rect = anchorEl.getBoundingClientRect();
    // Position above the icon, centred on it
    tip.style.left = '0';
    tip.style.top  = '0';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2 + window.scrollX;
    let top  = rect.top - th - 8 + window.scrollY;
    // Keep within viewport horizontally
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
  }

  function hideTooltip() {
    if (_tooltip) _tooltip.classList.remove('is-visible');
  }

  function buildTooltipText(label, rows, viewPerson) {
    if (!rows || !rows.length) return null;

    const fmt0 = n => '£' + Math.round(n).toLocaleString('en-GB');

    if (label === 'Salary'       || label.endsWith("'s Salary")) {
      const hasSal  = rows.find(r => (r.p1SalInc || 0) + (r.p2SalInc || 0) > 0);
      if (!hasSal) return null;
      const p1name  = (document.getElementById('sp-p1name')?.value || 'Person 1').trim();
      const p2name  = (document.getElementById('sp-p2name')?.value || 'Person 2').trim();
      const p1Has   = hasSal.p1SalInc > 0;
      const p2Has   = hasSal.p2SalInc > 0;

      if (p1Has && p2Has && viewPerson === 'both') {
        // Both have salary — show combined detail
        const lastP1  = [...rows].reverse().find(r => (r.p1SalInc || 0) > 0);
        const lastP2  = [...rows].reverse().find(r => (r.p2SalInc || 0) > 0);
        const p1Annual = hasSal.p1SalInc;
        const p2Annual = hasSal.p2SalInc;
        const combined = p1Annual + p2Annual;
        return `${p1name}'s salary of ${fmt0(p1Annual)}/yr (to age ${lastP1.p1Age}) and ${p2name}'s salary of ${fmt0(p2Annual)}/yr (to age ${lastP2.p2Age}), combined ${fmt0(combined)}/yr`;
      }

      // Single person has salary, or person filter active
      const p1Show  = viewPerson === 'p2' ? false : p1Has;
      const name    = p1Show ? p1name : p2name;
      const annual  = p1Show ? hasSal.p1SalInc : hasSal.p2SalInc;
      const lastSal = [...rows].reverse().find(r => (p1Show ? r.p1SalInc : r.p2SalInc) > 0);
      return `${name}'s salary of ${fmt0(annual)}/yr, drawn until ${lastSal.year} (age ${p1Show ? lastSal.p1Age : lastSal.p2Age})`;
    }

    if (label === 'Cash'         || label.endsWith("'s Cash")) {
      const firstCash = rows.find(r => (r.p1Drawn?.Cash || 0) + (r.p2Drawn?.Cash || 0) > 0);
      const lastCash  = [...rows].reverse().find(r => (r.p1Drawn?.Cash || 0) + (r.p2Drawn?.Cash || 0) > 0);
      if (!firstCash) return null;
      const yrs = lastCash.year - firstCash.year + 1;
      return `Liquid cash reserves drawn in early retirement to bridge spending before investment wrappers — used across ${yrs} year${yrs !== 1 ? 's' : ''} (${firstCash.year}–${lastCash.year})`;
    }

    if (label === 'Interest'     || label.endsWith("'s Interest")) {
      const firstInt = rows.find(r => (r.p1IntDraw || 0) + (r.p2IntDraw || 0) > 0);
      const lastInt  = [...rows].reverse().find(r => (r.p1IntDraw || 0) + (r.p2IntDraw || 0) > 0);
      if (!firstInt) return null;
      const yrs = lastInt.year - firstInt.year + 1;
      return `Monthly draws from interest-bearing accounts (e.g. money market funds) over ${yrs} years (${firstInt.year}–${lastInt.year}), at their configured draw rate`;
    }

    if (label === 'Dividends'    || label.endsWith("'s Dividends")) {
      // Average GIA balance across years that have dividends
      const divRows = rows.filter(r => (r.p1Divs || 0) + (r.p2Divs || 0) > 0);
      if (!divRows.length) return null;
      const avgGIA = divRows.reduce((s, r) => s + (r.snap?.p1GIA || 0) + (r.snap?.p2GIA || 0), 0) / divRows.length;
      const sampleDiv = divRows[0].p1Divs + divRows[0].p2Divs;
      const sampleGIA = (divRows[0].snap?.p1GIA || 0) + (divRows[0].snap?.p2GIA || 0);
      const yieldPct  = sampleGIA > 0 ? ((sampleDiv / sampleGIA) * 100).toFixed(1) : '?';
      return `Estimated dividend income from GIA holdings — average GIA balance of ${fmt0(avgGIA)} at a ${yieldPct}% annual yield. Shown separately from GIA capital withdrawals`;
    }

    if (label === 'GIA'          || label.endsWith("'s GIA")) {
      const firstGIA = rows.find(r => (r.p1Drawn?.GIA || 0) + (r.p2Drawn?.GIA || 0) > 0);
      const lastGIA  = [...rows].reverse().find(r => (r.p1Drawn?.GIA || 0) + (r.p2Drawn?.GIA || 0) > 0);
      const totalDivs = rows.reduce((s, r) => s + (r.p1Divs || 0) + (r.p2Divs || 0), 0);
      if (!firstGIA) return null;
      const yrs = lastGIA.year - firstGIA.year + 1;
      return `Capital withdrawals from GIA over ${yrs} years (${firstGIA.year}–${lastGIA.year}). Excludes ${fmt0(totalDivs)} dividend income shown separately — GIA gains within annual CGT exemption where possible`;
    }

    if (label === 'ISA'          || label.endsWith("'s ISA")) {
      const firstISA = rows.find(r => (r.p1Drawn?.ISA || 0) + (r.p2Drawn?.ISA || 0) > 0);
      const lastISA  = [...rows].reverse().find(r => (r.p1Drawn?.ISA || 0) + (r.p2Drawn?.ISA || 0) > 0);
      if (!firstISA) return null;
      return `Completely tax-free withdrawals from ISA, drawn from ${firstISA.year} onwards. No income tax, CGT or dividend tax on any ISA income`;
    }

    if (label === 'SIPP / WP'    || label.endsWith("'s SIPP / WP")) {
      const totalGross = rows.reduce((s, r) => s + (r.p1Drawn?.SIPP || 0) + (r.p2Drawn?.SIPP || 0), 0);
      const totalTaxable = rows.reduce((s, r) => s + (r.p1Drawn?.sippTaxable || 0) + (r.p2Drawn?.sippTaxable || 0), 0);
      const taxFree = totalGross - totalTaxable;
      const firstSIPP = rows.find(r => (r.p1Drawn?.SIPP || 0) + (r.p2Drawn?.SIPP || 0) > 0);
      if (!firstSIPP) return null;
      return `Gross pension withdrawals from ${firstSIPP.year} — ${fmt0(taxFree)} tax-free (25%) and ${fmt0(totalTaxable)} taxable (75%). The largest single investment source over retirement`;
    }

    if (label === 'State Pension' || label.endsWith("'s State Pension")) {
      const p1SP = rows.find(r => r.p1SP > 0);
      const p2SP = rows.find(r => r.p2SP > 0);
      const p1Name = (document.getElementById('sp-p1name')?.value || 'Person 1').trim();
      const p2Name = (document.getElementById('sp-p2name')?.value || 'Person 2').trim();
      const parts = [];
      if (p1SP) parts.push(`${p1Name}'s State Pension from ${p1SP.year} (age ${p1SP.p1Age})`);
      if (p2SP) parts.push(`${p2Name}'s State Pension from ${p2SP.year} (age ${p2SP.p2Age})`);
      return `Combined state pension — ${parts.join(', ')}. The largest single lifetime income source`;
    }

    if (label === 'Shortfall') {
      const sfRows = rows.filter(r => (r.cashflowShortfall || 0) > 0);
      if (!sfRows.length) return 'Portfolio fully meets the spending target across all years — no shortfall';
      return `Spending target unmet in ${sfRows.length} year${sfRows.length !== 1 ? 's' : ''}, first occurring in ${sfRows[0].year}`;
    }

    return null;
  }

  function renderIncomeLegend(chart, recomputeShortfall) {
    const host = document.getElementById('incomeLegend');
    if (!host) return;
    host.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows how your retirement income is drawn from each source year by year. Click any legend item to show or hide it in the chart.';
    host.appendChild(intro);

    const header = document.createElement('div');
    header.className = 'sidebar-legend__header';
    header.innerHTML = '<span>Source</span><span>Lifetime</span>';
    host.appendChild(header);

    chart.data.datasets.forEach((ds, i) => {
      if (ds.stack !== 'income') return;
      if (ds.label === 'Shortfall') return;

      const item = document.createElement('div');
      item.className = 'sidebar-legend__item';
      if (!chart.isDatasetVisible(i)) item.classList.add('is-hidden');

      const swatch = document.createElement('span');
      swatch.className = 'sidebar-legend__swatch';
      swatch.style.background = ds.backgroundColor;

      const label = document.createElement('span');
      label.textContent = ds.label;
      label.style.flex = '1';

      const value = document.createElement('span');
      value.className = 'sidebar-legend__value';
      const raw = ds._lifetimeValue || 0;
      value.textContent = raw > 0 ? fmt(raw) : '—';

      item.appendChild(swatch);
      item.appendChild(label);

      // Info icon — shows contextual tooltip on hover
      const tipText = buildTooltipText(ds.label, _rows, _viewPerson);
      if (tipText) {
        const info = document.createElement('span');
        info.className = 'sidebar-legend__info';
        info.textContent = 'ⓘ';
        info.addEventListener('mouseenter', e => { e.stopPropagation(); showTooltip(info, tipText, _tooltipTitle(ds.label)); });
        info.addEventListener('mouseleave', hideTooltip);
        item.appendChild(info);
      }

      item.appendChild(value);

      item.addEventListener('click', () => {
        chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
        recomputeShortfall(chart);
        chart.update();
        renderIncomeLegend(chart, recomputeShortfall);
      });

      host.appendChild(item);
    });

    // Shortfall — always shown, not toggleable
    // Read from the live chart dataset so the value updates when items are toggled
    // Base shortfall: engine values filtered to >=20k (real/nominal-adj'd)
    const sfBase = _engineShortfall.reduce((s, v) => (v || 0) * 1000 >= 20000 ? s + (v || 0) * 1000 : s, 0);
    // Add lifetime value of any hidden sources — toggling them off increases the gap
    const sfHidden = chart.data.datasets.reduce((s, d, i) => {
      if (d.stack !== 'income' || d.label === 'Shortfall') return s;
      return s + (chart.isDatasetVisible(i) ? 0 : (d._lifetimeValue || 0));
    }, 0);
    const sfRaw = sfBase + sfHidden;
    const sfItem = document.createElement('div');
    sfItem.className = 'sidebar-legend__item sidebar-legend__item--fixed';
    const sfSwatch = document.createElement('span');
    sfSwatch.className = 'sidebar-legend__swatch';
    sfSwatch.style.background = '#DC2626';
    const sfLabel = document.createElement('span');
    sfLabel.textContent = 'Shortfall';
    sfLabel.style.flex = '1';
    sfItem.appendChild(sfSwatch);
    sfItem.appendChild(sfLabel);
    const sfTipText = buildTooltipText('Shortfall', _rows, _viewPerson);
    if (sfTipText) {
      const sfInfo = document.createElement('span');
      sfInfo.className = 'sidebar-legend__info';
      sfInfo.textContent = 'ⓘ';
      sfInfo.addEventListener('mouseenter', e => { e.stopPropagation(); showTooltip(sfInfo, sfTipText, _tooltipTitle('Shortfall')); });
      sfInfo.addEventListener('mouseleave', hideTooltip);
      sfItem.appendChild(sfInfo);
    }
    if (sfRaw > 0) {
      const sfVal = document.createElement('span');
      sfVal.className = 'sidebar-legend__value';
      sfVal.textContent = fmt(sfRaw);
      sfItem.appendChild(sfVal);
    } else {
      const sfNote = document.createElement('span');
      sfNote.className = 'sidebar-legend__fixed-note';
      sfNote.textContent = 'always on';
      sfNote.style.marginLeft = 'auto';
      sfItem.appendChild(sfNote);
    }
    host.appendChild(sfItem);
  }

  // ─────────────────────────────────────────────
  // GROSS VS NET LEGEND
  // ─────────────────────────────────────────────
  function renderGrossNetLegend(chart) {
    const host = document.getElementById('spendingLegend');
    if (!host) return;
    host.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows gross income drawn each year split between net spending and tax paid. Click any legend item to show or hide it in the chart.';
    host.appendChild(intro);

    const header = document.createElement('div');
    header.className = 'sidebar-legend__header';
    header.innerHTML = '<span>Source</span><span>Lifetime</span>';
    host.appendChild(header);

    chart.data.datasets.forEach((ds, i) => {
      if (ds.type === 'line') return;

      const fixed = ds._fixed === true;
      const item = document.createElement('div');
      item.className = 'sidebar-legend__item' + (fixed ? ' sidebar-legend__item--fixed' : '');
      if (!fixed && !chart.isDatasetVisible(i)) item.classList.add('is-hidden');

      const swatch = document.createElement('span');
      swatch.className = 'sidebar-legend__swatch';
      swatch.style.background = ds.backgroundColor;

      const label = document.createElement('span');
      label.textContent = ds.label;
      label.style.flex = '1';

      const value = document.createElement('span');
      value.className = 'sidebar-legend__value';
      const raw = ds._lifetimeValue || 0;
      value.textContent = raw > 0 ? fmt(raw) : '—';

      item.appendChild(swatch);
      item.appendChild(label);
      item.appendChild(value);

      if (!fixed) {
        item.addEventListener('click', () => {
          chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
          chart.update('none');
          renderGrossNetLegend(chart);
        });
      }

      host.appendChild(item);
    });


  }

  // ─────────────────────────────────────────────
  // TAX LEGEND
  // ─────────────────────────────────────────────
  function renderTaxLegend(chart) {
    const host = document.getElementById('taxLegend');
    if (!host) return;
    host.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows total income tax and CGT paid each year, with the effective rate on the right axis. Click either item to show or hide it.';
    host.appendChild(intro);

    function toggleDataset(idx) {
      const visible = chart.isDatasetVisible(idx);
      chart.setDatasetVisibility(idx, !visible);
      // Bar (idx 0) hides left y axis; line (idx 1) hides right y1 axis
      const axisKey = idx === 0 ? 'y' : 'y1';
      if (chart.options.scales && chart.options.scales[axisKey]) {
        chart.options.scales[axisKey].display = !visible;
      }
      chart.update();
      renderTaxLegend(chart);
    }

    // Tax paid — bar item
    const barVisible = chart.isDatasetVisible(0);
    const barItem = document.createElement('div');
    barItem.className = 'sidebar-legend__item' + (barVisible ? '' : ' is-hidden');
    barItem.style.cursor = 'pointer';

    const barSwatch = document.createElement('span');
    barSwatch.className = 'sidebar-legend__swatch';
    barSwatch.style.background = '#C55A11';

    const barLabel = document.createElement('span');
    barLabel.textContent = 'Tax paid';
    barLabel.style.flex = '1';

    const barValue = document.createElement('span');
    barValue.className = 'sidebar-legend__value';
    const totalTax = _rows.reduce((s, r) => {
      const t = _viewPerson === 'p1' ? (r.p1IncomeTax ?? 0) + (r.p1CGT ?? 0) + (r.p1NI ?? 0)
              : _viewPerson === 'p2' ? (r.p2IncomeTax ?? 0) + (r.p2CGT ?? 0) + (r.p2NI ?? 0)
              : (r.p1IncomeTax ?? 0) + (r.p1CGT ?? 0) + (r.p1NI ?? 0) +
                (r.p2IncomeTax ?? 0) + (r.p2CGT ?? 0) + (r.p2NI ?? 0);
      return s + adj(t, r);
    }, 0);
    barValue.textContent = fmt(totalTax);

    barItem.appendChild(barSwatch);
    barItem.appendChild(barLabel);
    barItem.appendChild(barValue);
    barItem.addEventListener('click', () => toggleDataset(0));
    host.appendChild(barItem);

    // Effective tax rate — line item
    const lineVisible = chart.isDatasetVisible(1);
    const lineItem = document.createElement('div');
    lineItem.className = 'sidebar-legend__item' + (lineVisible ? '' : ' is-hidden');
    lineItem.style.cursor = 'pointer';

    const lineSwatch = document.createElement('span');
    lineSwatch.className = 'sidebar-legend__swatch';
    lineSwatch.style.background = 'none';
    lineSwatch.style.borderTop = '2px solid #7F6000';
    lineSwatch.style.height = '0';
    lineSwatch.style.alignSelf = 'center';

    const lineLabel = document.createElement('span');
    lineLabel.textContent = 'Effective tax rate';
    lineLabel.style.flex = '1';

    const avgRate = _rows.length
      ? (() => {
          const { avgRate: r } = L.buildMetrics(_rows, _viewPerson, _useReal);
          return (r * 100).toFixed(1);
        })()
      : '0.0';

    const lineValue = document.createElement('span');
    lineValue.className = 'sidebar-legend__value';
    lineValue.textContent = avgRate + '% avg';

    lineItem.appendChild(lineSwatch);
    lineItem.appendChild(lineLabel);
    lineItem.appendChild(lineValue);
    lineItem.addEventListener('click', () => toggleDataset(1));
    host.appendChild(lineItem);
  }

  // ─────────────────────────────────────────────
  // INSIGHT BUTTON + PANE (shared by Income and Wealth charts)
  // ─────────────────────────────────────────────
  let _wealthPaneOpen = false;
  let _incomePaneOpen = false;

  const ANNOTATION_GROUPS = [
    { event: 'cash_surplus', emoji: '💰', label: 'Surplus cash' },
    { event: 'sp_starts',   emoji: '🏦', label: 'State Pension' },
    { event: 'salary_stop', emoji: '💼', label: 'Salary stops' },
    { event: 'depletion',   emoji: '🛑', label: 'Depletions' },
  ];

  function fmt0(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }

  // Inject ⓘ button into chart header anchor. chartId = 'income' | 'wealth'
  function renderInsightButton(chartId, hasContent) {
    const anchor = document.getElementById(chartId === 'income' ? 'income-insight-anchor' : 'wealth-insight-anchor');
    if (!anchor) return;

    anchor.innerHTML = '';
    if (!hasContent) return;

    const isOpen = chartId === 'income' ? _incomePaneOpen : _wealthPaneOpen;

    const btn = document.createElement('button');
    btn.className = 'chart-insight-btn' + (isOpen ? ' is-active' : '');
    btn.setAttribute('aria-label', 'Show chart insights');
    btn.innerHTML = `<span class="chart-insight-btn__icon">ⓘ</span><span class="chart-insight-btn__label">${chartId === 'income' ? 'Shortfall info' : 'Insights'}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chartId === 'income') _incomePaneOpen = !_incomePaneOpen;
      else _wealthPaneOpen = !_wealthPaneOpen;
      renderInsightPane(chartId);
      renderInsightButton(chartId, true);
    });
    anchor.appendChild(btn);
  }

  // Build and inject (or remove) the insight pane over the chart canvas
  function renderInsightPane(chartId) {
    const wrap = document.getElementById(chartId === 'income' ? 'incomeChart' : 'wealthChart')
      ?.closest('.chart-wrap');
    if (!wrap) return;
    const existing = wrap.querySelector('.chart-insight-pane');
    if (existing) existing.remove();

    const isOpen = chartId === 'income' ? _incomePaneOpen : _wealthPaneOpen;
    if (!isOpen) return;

    const pane = document.createElement('div');
    pane.className = 'chart-insight-pane';

    const header = document.createElement('div');
    header.className = 'chart-insight-pane__header';
    const title = document.createElement('span');
    title.className = 'chart-insight-pane__title';
    title.textContent = chartId === 'income' ? '⚠️ Shortfall detected' : 'ⓘ Projection insights';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'chart-insight-pane__close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chartId === 'income') _incomePaneOpen = false;
      else _wealthPaneOpen = false;
      renderInsightPane(chartId);
      renderInsightButton(chartId, true);
    });
    header.appendChild(title);
    header.appendChild(closeBtn);
    pane.appendChild(header);

    const body = document.createElement('div');
    body.className = 'chart-insight-pane__body';

    if (chartId === 'income') {
      body.appendChild(buildShortfallInsight());
    } else {
      body.appendChild(buildWealthInsights());
    }

    pane.appendChild(body);

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(e) {
        if (!pane.contains(e.target) && !e.target.closest('.chart-insight-btn')) {
          if (chartId === 'income') _incomePaneOpen = false;
          else _wealthPaneOpen = false;
          renderInsightPane(chartId);
          renderInsightButton(chartId, true);
          document.removeEventListener('click', outsideClick);
        }
      });
    }, 0);

    wrap.appendChild(pane);
  }

  function buildShortfallInsight() {
    const NEAR_DEPLETION = 20000;
    const allSfRows  = _rows.filter((r, i) => (_engineShortfall[i] || 0) * 1000 >= 20000);
    const frag = document.createDocumentFragment();
    if (!allSfRows.length) return frag;

    const sfAmounts  = allSfRows.map(r => (_engineShortfall[_rows.indexOf(r)] || 0) * 1000);
    const total      = sfAmounts.reduce((s, v) => s + v, 0);
    const peak       = Math.max(...sfAmounts);
    const peakRow    = allSfRows[sfAmounts.indexOf(peak)];
    const first    = allSfRows[0];
    const last     = allSfRows[allSfRows.length - 1];
    const sfRows   = allSfRows; // alias kept for items block below

    // Determine severity from minimum portfolio value across all shortfall years
    const minPortfolio = Math.min(...allSfRows.map(r => r.totalPortfolio || 0));
    const isExhausted  = minPortfolio === 0;
    const isNearDepleted = minPortfolio <= NEAR_DEPLETION;
    const severityLabel  = isExhausted
      ? '🛑 Portfolio exhausted — spending target cannot be met'
      : isNearDepleted
        ? `⚠️ Portfolio nearly exhausted (${fmt0(minPortfolio)} min remaining)`
        : '⚠️ Spending shortfall — portfolio does not fully meet target';

    const banner = document.createElement('div');
    banner.className = 'chart-insight-banner' + (isExhausted || isNearDepleted ? ' chart-insight-banner--danger' : ' chart-insight-banner--warn');
    banner.textContent = severityLabel;
    frag.appendChild(banner);

    const items = [
      { label: 'From',            value: `${first.year}` },
      { label: 'Duration',        value: `${sfRows.length} year${sfRows.length !== 1 ? 's' : ''} (${first.year}–${last.year})` },
      { label: 'Total gap',       value: fmt0(total) },
      { label: 'Peak annual gap', value: `${fmt0(peak)} in ${peakRow.year}` },
    ];

    items.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'chart-insight-row';
      row.innerHTML = `<span class="chart-insight-row__label">${label}</span><span class="chart-insight-row__value">${value}</span>`;
      frag.appendChild(row);
    });

    const note = document.createElement('p');
    note.className = 'chart-insight-note';
    note.textContent = 'Red bars on the chart show the annual gap. Adjust your spending target or add to your portfolio to eliminate the shortfall.';
    frag.appendChild(note);
    return frag;
  }

  function buildWealthInsights() {
    const frag = document.createDocumentFragment();
    if (!_annotations.length) return frag;

    ANNOTATION_GROUPS.forEach(({ event, emoji, label }) => {
      const items = _annotations.filter(a => a.event === event);
      if (!items.length) return;

      const group = document.createElement('div');
      group.className = 'chart-insight-group';

      const heading = document.createElement('div');
      heading.className = 'chart-insight-group__heading';
      heading.textContent = `${emoji} ${label}`;
      group.appendChild(heading);

      // Summarise repeating events; show discrete ones as-is
      if (event === 'cash_surplus' && items.length > 1) {
        const first = items[0], last = items[items.length - 1];
        const total = _rows
          .filter(r => r.year >= first.year && r.year <= last.year)
          .reduce((s, r) => s + Math.max(0, (r.p1SP || 0) + (r.p2SP || 0) + (r.p1SalInc || 0) + (r.p2SalInc || 0) + (r.p1Divs || 0) + (r.p2Divs || 0) - (r.target || 0)), 0);
        const firstAmt = items[0].message.match(/£[\d,]+/)?.[0] || '';
        const lastAmt  = last.message.match(/£[\d,]+/)?.[0] || '';
        const row = document.createElement('div');
        row.className = 'chart-insight-summary';
        row.textContent = `${first.year}–${last.year}: Annual household surplus above target parked in ${items[0].message.split('parked in ')[1]} — ${firstAmt} rising to ${lastAmt}/yr (total ${fmt0(total)})`;
        group.appendChild(row);
      } else {
        items.forEach(a => {
          const row = document.createElement('div');
          row.className = 'chart-insight-summary';
          // For depletions, look up age from _depletions keyed by account name
          let suffix = '';
          if (a.event === 'depletion') {
            const accountName = a.message.replace(' depleted', '').replace("'s ", ' ');
            const dep = _depletions[accountName];
            if (dep) suffix = ` (age ${dep.age})`;
          }
          row.innerHTML = `<span class="chart-insight-year">${a.year}</span> ${a.message}${suffix}`;
          group.appendChild(row);
        });
      }

      frag.appendChild(group);
    });

    return frag;
  }

  // ─────────────────────────────────────────────
  // WEALTH LEGEND
  // ─────────────────────────────────────────────
  function buildWealthTooltip(label) {
    if (label.includes('SIPP')) return 'Pension fund balance — tax-free growth inside the wrapper. Withdrawals are subject to income tax (75% taxable, 25% tax-free). Subject to IHT on death before age 75 in some cases.';
    if (label.includes('ISA'))  return 'ISA balance — completely tax-free growth, income, and withdrawals. No CGT, income tax, or dividend tax on any gains.';
    if (label.includes('GIA'))  return 'General Investment Account — subject to CGT on gains above the annual exemption (£3,000) and dividend tax above the allowance (£500). Growth is otherwise unrestricted.';
    if (label.includes('Interest')) return 'Interest-bearing accounts (e.g. money market funds) — interest taxed as savings income, within the Starting Rate for Savings (£5,000) and Personal Savings Allowance (£1,000) where available.';
    if (label.includes('Cash')) return 'Liquid cash reserves — interest taxed as savings income within standard allowances. Used to bridge spending before investment wrappers are drawn.';
    return null;
  }
  function _tooltipTitle(label) {
    if (label === 'Shortfall')                          return 'Spending shortfall';
    if (label === 'Salary'      || label.endsWith("'s Salary"))       return 'Employment income';
    if (label === 'Cash'        || label.endsWith("'s Cash"))         return 'Cash reserves';
    if (label === 'Interest'    || label.endsWith("'s Interest"))     return 'Interest income';
    if (label === 'Dividends'   || label.endsWith("'s Dividends"))    return 'Dividend income';
    if (label === 'GIA'         || label.endsWith("'s GIA"))          return 'GIA withdrawals';
    if (label === 'ISA'         || label.endsWith("'s ISA"))          return 'ISA withdrawals';
    if (label === 'SIPP / WP'   || label.endsWith("'s SIPP / WP"))   return 'Pension withdrawals';
    if (label === 'State Pension'|| label.endsWith("'s State Pension")) return 'State Pension';
    if (label.includes('SIPP')) return 'Pension (SIPP)';
    if (label.includes('ISA'))  return 'ISA';
    if (label.includes('GIA'))  return 'General Investment Account';
    if (label.includes('Interest')) return 'Interest accounts';
    if (label.includes('Cash')) return 'Cash';
    return label;
  }


  function renderWealthLegend(chart) {
    const host = document.getElementById('wealthLegend');
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('sidebar-legend--scrollable');

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows portfolio balance by wrapper at end of each year. Click any legend item to show or hide it in the chart.';
    host.appendChild(intro);

    const header = document.createElement('div');
    header.className = 'sidebar-legend__header';
    header.innerHTML = '<span>Wrapper</span><span>Now</span>';
    host.appendChild(header);

    chart.data.datasets.forEach((ds, i) => {
      const item = document.createElement('div');
      item.className = 'sidebar-legend__item';
      if (!chart.isDatasetVisible(i)) item.classList.add('is-hidden');

      const swatch = document.createElement('span');
      swatch.className = 'sidebar-legend__swatch';
      swatch.style.background = ds.backgroundColor;

      const label = document.createElement('span');
      label.textContent = ds.label;
      label.style.flex = '1';

      // Current (first year) balance as the "now" value
      const nowVal = ds.data[0] || 0;
      const value = document.createElement('span');
      value.className = 'sidebar-legend__value';
      value.textContent = nowVal > 0 ? fmt(nowVal) : '—';

      item.appendChild(swatch);
      item.appendChild(label);

      const tipText = buildWealthTooltip(ds.label);
      if (tipText) {
        const info = document.createElement('span');
        info.className = 'sidebar-legend__info';
        info.textContent = 'ⓘ';
        info.addEventListener('mouseenter', e => { e.stopPropagation(); showTooltip(info, tipText, _tooltipTitle(ds.label)); });
        info.addEventListener('mouseleave', hideTooltip);
        item.appendChild(info);
      }

      item.appendChild(value);

      item.addEventListener('click', () => {
        chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
        chart.update('none');
        renderWealthLegend(chart);
      });

      host.appendChild(item);
    });
  }

    function renderCharts() {
    if (!_rows.length) return;
    try { _rows.forEach(L.validateRow); } catch (e) {
      console.error('[RetireCalcRender] Schema validation failed — rendering aborted.', e);
      return;
    }

    // Update chart and table titles with active strategy as subtitle
    const strategyLabels = { balanced: 'Tax Band Optimiser', isaFirst: 'Pension Preservation', sippFirst: 'Pension Front-Loading', taxMin: 'Allowance Maximiser' };
    const stratLabel = strategyLabels[_strategy] || _strategy;
    const stratSubtitle = `<p class="chart-title-strategy">${stratLabel} strategy</p>`;

    const titleEl = document.getElementById('income-chart-title');
    if (titleEl) titleEl.innerHTML = 'Sources of income' + stratSubtitle;
    const spendTitleEl = document.getElementById('spendingChartTitle');
    if (spendTitleEl) spendTitleEl.innerHTML = 'Gross vs net income' + stratSubtitle;
    const taxTitleEl = document.getElementById('taxChartTitle');
    if (taxTitleEl) taxTitleEl.innerHTML = 'Tax paid & effective rate' + stratSubtitle;
    const wealthTitleEl = document.getElementById('wealthChartTitle');
    if (wealthTitleEl) wealthTitleEl.innerHTML = 'Wealth by type' + stratSubtitle;
    const taxTableTitleEl = document.getElementById('taxTableTitle');
    if (taxTableTitleEl) taxTableTitleEl.innerHTML = 'Tax by year' + stratSubtitle;
    const wealthTableTitleEl = document.getElementById('wealthTableTitle');
    if (wealthTableTitleEl) wealthTableTitleEl.innerHTML = 'Investment values by year' + stratSubtitle;
    const drawdownTableTitleEl = document.getElementById('drawdownTableTitle');
    if (drawdownTableTitleEl) drawdownTableTitleEl.innerHTML = 'Drawdown by year' + stratSubtitle;

    const labels = _rows.map(r => r.year);
    const { p1, p2 } = getNames();

    // ─────────────────────────────────────────────
    // INCOME CHART
    // ─────────────────────────────────────────────

    // Full household target — always used for shortfall regardless of person toggle
    const _targetData      = _rows.map(r => adj(r.target || 0, r) / 1000);

    const sets = L.buildIncomeDatasets(_rows, _viewPerson, _useReal, p1, p2);

    // Extract the engine shortfall from the Shortfall dataset for legend use
    _engineShortfall = sets[sets.length - 1].data.slice();

    // Recompute shortfall when sources are toggled on/off in the legend
    function recomputeShortfall(chart) {
      const sfIdx = chart.data.datasets.findIndex(d => d.label === 'Shortfall');
      if (sfIdx < 0) return;
      const sourceSets = chart.data.datasets.filter(
        d => d.stack === 'income' && d.label !== 'Shortfall'
      );
      chart.data.datasets[sfIdx].data = _targetData.map((tgt, i) => {
        const visibleGross = sourceSets.reduce((sum, d) => {
          return sum + (chart.isDatasetVisible(chart.data.datasets.indexOf(d)) ? (d.data[i] || 0) : 0);
        }, 0);
        return Math.max(_engineShortfall[i], tgt - visibleGross);
      });
    }

    const incCtx = document.getElementById('incomeChart')?.getContext('2d');
    if (incCtx) {
      if (_incomeChart) _incomeChart.destroy();
      _incomeChart = new Chart(incCtx, {
        type: 'bar',
        data: { labels, datasets: sets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = (ctx.parsed.y || 0) * 1000;
                  if (!val) return null;
                  if (ctx.dataset.label === 'Shortfall') return `Shortfall: ${D.formatMoney(val)}`;
                  if (ctx.dataset.label === 'Spending target')    return `Target: ${D.formatMoney(val)}`;
                  return `${ctx.dataset.label}: ${D.formatMoney(val)}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: _useReal ? 'Real £k' : 'Nominal £k',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v + 'k',
              },
            },
          },
        },
      });
      renderIncomeLegend(_incomeChart, recomputeShortfall);
      const hasGenuineShortfall = _engineShortfall.some(v => (v || 0) * 1000 >= 20000);
      renderInsightButton('income', hasGenuineShortfall);
    }

    // ─────────────────────────────────────────────
    // TAX / RATE DATA — used by both Gross vs Net and Tax charts
    // ─────────────────────────────────────────────
    const { taxData, rateData } = L.buildTaxChartData(_rows, _viewPerson, _useReal);

    // ─────────────────────────────────────────────
    // GROSS VS NET INCOME CHART
    // Two segments only: Net income (bottom) + Tax (top).
    // Bar total = gross drawn. Tax segment shows what's lost.
    // ─────────────────────────────────────────────
    const spendingCtx = document.getElementById('spendingChart')?.getContext('2d');
    if (spendingCtx) {
      const grossNetSets = L.buildGrossNetDatasets(_rows, _viewPerson, _useReal);

      if (_spendingChart) _spendingChart.destroy();
      _spendingChart = new Chart(spendingCtx, {
        type: 'bar',
        data: { labels, datasets: grossNetSets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = (ctx.parsed.y || 0) * 1000;
                  if (!val) return null;
                  if (ctx.dataset.label === 'Spending target') return `Target: ${D.formatMoney(val)}`;
                  return `${ctx.dataset.label}: ${D.formatMoney(val)}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: _useReal ? 'Real £k' : 'Nominal £k',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v + 'k',
              },
            },
          },
        },
      });

      renderGrossNetLegend(_spendingChart);

    }

    // ─────────────────────────────────────────────
    // TAX CHART
    // Rate line scaled to share the left axis so it tracks bar heights.
    // Right axis back-calculates scaled values to show real % labels.
    // ─────────────────────────────────────────────
    const taxCtx = document.getElementById('taxChart')?.getContext('2d');
    if (taxCtx) {
      const maxTax  = Math.max(...taxData, 1);
      const maxRate = Math.max(...rateData, 1);
      const rateScaled = rateData.map(v => (v / maxRate) * maxTax);

      if (_taxChart) _taxChart.destroy();
      _taxChart = new Chart(taxCtx, {
        data: {
          labels,
          datasets: [
            {
              type: 'bar',
              label: 'Tax paid',
              data: taxData,
              backgroundColor: '#C55A11',
              yAxisID: 'y',
              order: 2,
            },
            {
              type: 'line',
              label: 'Effective tax rate',
              data: rateScaled,
              borderColor: '#7F6000',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.2,
              yAxisID: 'y',
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.label === 'Effective tax rate') {
                    const realRate = maxTax > 0 ? (ctx.parsed.y / maxTax * maxRate).toFixed(1) : '0.0';
                    return `Effective tax rate: ${realRate}%`;
                  }
                  return `Tax paid: ${D.formatMoney(ctx.parsed.y || 0)}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              position: 'left',
              min: 0,
              max: maxTax * 1.05,
              title: {
                display: true,
                text: _useReal ? 'Real £' : 'Nominal £',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => '£' + Math.round(v).toLocaleString('en-GB'),
              },
            },
            y1: {
              position: 'right',
              min: 0,
              max: maxRate * 1.05,
              grid: { drawOnChartArea: false },
              title: {
                display: true,
                text: 'Rate %',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v.toFixed(1) + '%',
              },
            },
          },
        },
      });
      renderTaxLegend(_taxChart);
    }

    // ─────────────────────────────────────────────
    // WEALTH CHART
    // ─────────────────────────────────────────────
    const wealthCtx = document.getElementById('wealthChart')?.getContext('2d');
    if (wealthCtx) {
      const wealthDatasets = L.buildWealthDatasets(_rows, _viewPerson, _useReal, p1, p2);

      if (_wealthChart) _wealthChart.destroy();
      _wealthChart = new Chart(wealthCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: wealthDatasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${D.formatMoney(ctx.parsed.y || 0)}`,
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: _useReal ? 'Real £' : 'Nominal £',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => '£' + Math.round(v).toLocaleString('en-GB'),
              },
            },
          },
        },
      });
      renderWealthLegend(_wealthChart);
      renderInsightButton('wealth', _annotations.length > 0);
    }

    // Update depletion alert on income chart after every render
    _updateDepletionAlert();
  }

  // ─────────────────────────────────────────────
  // DEPLETION ALERT
  // Shown top-right of the income chart canvas when the total portfolio
  // drops below 15% of its starting value at any point in the projection.
  // ─────────────────────────────────────────────
  function _updateDepletionAlert() {
    const wrap = document.getElementById('income-chart-wrap');
    if (!wrap) return;

    const existing = document.getElementById('depletion-alert');

    if (!_rows.length) {
      if (existing) existing.remove();
      return;
    }

    const startPortfolio = _rows[0]?.totalPortfolio || 0;
    const threshold      = startPortfolio * 0.15;
    const depletionRisk  = startPortfolio > 0 &&
      _rows.some(r => r.totalPortfolio < threshold);

    if (!depletionRisk) {
      if (existing) existing.remove();
      return;
    }

    // Already present — nothing to do
    if (existing) return;

    const alert = document.createElement('div');
    alert.id = 'depletion-alert';
    alert.innerHTML = `
      <span class="depletion-alert__icon">&#9888;</span>
      <div class="depletion-alert__text">
        <strong>Portfolio approaches depletion.</strong>
        Stress-test across 10,000 market scenarios.
        <button class="depletion-alert__cta" id="depletion-alert-cta">Test my plan &rarr;</button>
      </div>`;

    alert.querySelector('#depletion-alert-cta').addEventListener('click', () => {
      document.getElementById('btn-test-plan')?.click();
    });

    wrap.appendChild(alert);
  }


  // ─────────────────────────────────────────────
  // TABLES
  // ─────────────────────────────────────────────
  function renderTables() {
    if (!_rows.length) return;
    const f = n => D.formatMoney(n);
    const { p1, p2 } = getNames();

    // Tax table
    const taxTbl = document.getElementById('tax-table');
    if (taxTbl) {
      const taxRows = L.buildTableTaxRows(_rows, _useReal);
      let grandWI = 0, grandWC = 0, grandWN = 0, grandHI = 0, grandHC = 0, grandHN = 0;

      const TCOL = {
        meta:  { bg: '#F2F2F2', hdr: '#444444', txt: '#222' },
        p1:    { bg: '#FEF3EC', hdr: '#ED7D31', txt: '#7e3a0a' },
        p2:    _p2enabled
               ? { bg: '#EBF5FB', hdr: '#2E86C1', txt: '#1a4a6e' }
               : { bg: '#F5F5F5', hdr: '#AAAAAA', txt: '#AAAAAA' },
        total: { bg: '#F8F9FA', hdr: '#555555', txt: '#222'    },
      };
      const tcs  = col => `style="background:${col.bg};color:${col.txt}"`;
      const tth  = (col, content, extra = '') =>
        `<th ${extra} style="background:${col.hdr};color:#fff;border-color:${col.hdr}">${content}</th>`;
      // In single-person mode, P2 cells show — instead of values
      const tp2  = val => _p2enabled ? f(val) : '—';

      let body = '<tbody>';
      taxRows.forEach(row => {
        const { year, p1Age, p2Age, wi, wc, wn, wt, hi, hc, hn, ht, hh, cumTax } = row;
        grandWI += wi; grandWC += wc; grandWN += wn;
        grandHI += hi; grandHC += hc; grandHN += hn;
        body += `<tr>
          <td>${year}</td><td>${p1Age}</td><td ${tcs(TCOL.p2)}>${_p2enabled ? p2Age : '—'}</td>
          <td ${tcs(TCOL.p1)}>${f(wi)}</td><td ${tcs(TCOL.p1)}>${f(wc)}</td><td ${tcs(TCOL.p1)}>${f(wn)}</td><td ${tcs(TCOL.p1)}><strong>${f(wt)}</strong></td>
          <td ${tcs(TCOL.p2)}>${tp2(hi)}</td><td ${tcs(TCOL.p2)}>${tp2(hc)}</td><td ${tcs(TCOL.p2)}>${tp2(hn)}</td><td ${tcs(TCOL.p2)}><strong>${tp2(ht)}</strong></td>
          <td ${tcs(TCOL.total)}><strong>${f(hh)}</strong></td><td ${tcs(TCOL.total)}>${f(cumTax)}</td>
        </tr>`;
      });
      const grand = grandWI + grandWC + grandWN + grandHI + grandHC + grandHN;
      body += `<tr class="total-row">
        <td colspan="3">Total</td>
        <td ${tcs(TCOL.p1)}>${f(grandWI)}</td><td ${tcs(TCOL.p1)}>${f(grandWC)}</td><td ${tcs(TCOL.p1)}>${f(grandWN)}</td><td ${tcs(TCOL.p1)}><strong>${f(grandWI+grandWC+grandWN)}</strong></td>
        <td ${tcs(TCOL.p2)}>${tp2(grandHI)}</td><td ${tcs(TCOL.p2)}>${tp2(grandHC)}</td><td ${tcs(TCOL.p2)}>${tp2(grandHN)}</td><td ${tcs(TCOL.p2)}><strong>${tp2(grandHI+grandHC+grandHN)}</strong></td>
        <td ${tcs(TCOL.total)}><strong>${f(grand)}</strong></td><td ${tcs(TCOL.total)}>${f(grand)}</td>
      </tr></tbody>`;
      taxTbl.innerHTML = `<thead>
        <tr>
          ${tth(TCOL.meta, 'Year',     'rowspan="2"')}
          ${tth(TCOL.meta, p1 + '<br>age', 'rowspan="2"')}
          ${tth(TCOL.meta, p2 + '<br>age', 'rowspan="2"')}
          ${tth(TCOL.p1,   p1 + "'s tax", 'colspan="4"')}
          ${tth(TCOL.p2,   p2 + "'s tax", 'colspan="4"')}
          ${tth(TCOL.total,'Household',   'rowspan="2"')}
          ${tth(TCOL.total,'Cumulative',  'rowspan="2"')}
        </tr>
        <tr>
          ${tth(TCOL.p1, 'Income tax')}${tth(TCOL.p1, 'CGT')}${tth(TCOL.p1, 'NI')}${tth(TCOL.p1, 'Total')}
          ${tth(TCOL.p2, 'Income tax')}${tth(TCOL.p2, 'CGT')}${tth(TCOL.p2, 'NI')}${tth(TCOL.p2, 'Total')}
        </tr>
      </thead>` + body;
    }

    // Wealth table
    const wTbl = document.getElementById('wealth-table');
    if (wTbl) {
      const wealthRows = L.buildTableWealthRows(_rows, _useReal);
      const rowByYear  = Object.fromEntries(_rows.map(r => [r.year, r]));

      const WCOL = {
        meta:  { bg: '#F2F2F2', hdr: '#444444', txt: '#222' },
        p1:    { bg: '#FEF3EC', hdr: '#ED7D31', txt: '#7e3a0a' },
        p2:    _p2enabled
               ? { bg: '#EBF5FB', hdr: '#2E86C1', txt: '#1a4a6e' }
               : { bg: '#F5F5F5', hdr: '#AAAAAA', txt: '#AAAAAA' },
        total: { bg: '#F8F9FA', hdr: '#555555', txt: '#222'    },
      };
      const wcs  = col => `style="background:${col.bg};color:${col.txt}"`;
      const wth  = (col, content, extra = '') =>
        `<th ${extra} style="background:${col.hdr};color:#fff;border-color:${col.hdr}">${content}</th>`;
      const wp2  = val => _p2enabled ? f(val) : '—';

      let body = '<tbody>';
      wealthRows.forEach(row => {
        const { year, p1Age, p2Age,
                p1Cash, p1IntBal, p1GIA, p1SIPP, p1ISA,
                p2Cash, p2IntBal, p2GIA, p2SIPP, p2ISA, total } = row;
        const rawRow = rowByYear[year];
        const s = rawRow?.snap ?? {};
        const cell = (col, adjVal, snapVal) => {
          if (!_p2enabled && col === WCOL.p2) return `<td ${wcs(col)}>—</td>`;
          return `<td ${wcs(col)}${adjVal < 1 && snapVal > 0 ? ' class="depleted"' : ''}>${f(adjVal)}</td>`;
        };
        body += `<tr>
          <td>${year}</td><td>${p1Age}</td><td ${wcs(WCOL.p2)}>${_p2enabled ? p2Age : '—'}</td>
          ${cell(WCOL.p1, p1Cash,   s.p1Cash   ?? 0)}${cell(WCOL.p1, p1IntBal, s.p1IntBal ?? 0)}${cell(WCOL.p1, p1GIA,   s.p1GIA   ?? 0)}${cell(WCOL.p1, p1SIPP, s.p1SIPP ?? 0)}${cell(WCOL.p1, p1ISA, s.p1ISA ?? 0)}
          ${cell(WCOL.p2, p2Cash,   s.p2Cash   ?? 0)}${cell(WCOL.p2, p2IntBal, s.p2IntBal ?? 0)}${cell(WCOL.p2, p2GIA,   s.p2GIA   ?? 0)}${cell(WCOL.p2, p2SIPP, s.p2SIPP ?? 0)}${cell(WCOL.p2, p2ISA, s.p2ISA ?? 0)}
          <td ${wcs(WCOL.total)}><strong>${f(total)}</strong></td>
        </tr>`;
      });
      body += '</tbody>';
      wTbl.innerHTML = `<thead>
        <tr>
          ${wth(WCOL.meta, 'Year',         'rowspan="2"')}
          ${wth(WCOL.meta, p1 + '<br>age', 'rowspan="2"')}
          ${wth(WCOL.meta, p2 + '<br>age', 'rowspan="2"')}
          ${wth(WCOL.p1,   p1 + "'s wealth", 'colspan="5"')}
          ${wth(WCOL.p2,   p2 + "'s wealth", 'colspan="5"')}
          ${wth(WCOL.total,'Total',         'rowspan="2"')}
        </tr>
        <tr>
          ${wth(WCOL.p1, 'Cash')}${wth(WCOL.p1, 'Interest')}${wth(WCOL.p1, 'GIA')}${wth(WCOL.p1, 'SIPP')}${wth(WCOL.p1, 'ISA')}
          ${wth(WCOL.p2, 'Cash')}${wth(WCOL.p2, 'Interest')}${wth(WCOL.p2, 'GIA')}${wth(WCOL.p2, 'SIPP')}${wth(WCOL.p2, 'ISA')}
        </tr>
      </thead>` + body;
    }

    // Drawdown table
    const dTbl = document.getElementById('drawdown-table');
    if (dTbl) {
      const drawRows = L.buildTableDrawdownRows(_rows, _useReal);
      let body = '<tbody>';
      let grandP1SP = 0, grandP2SP = 0, grandP1Sal = 0, grandP2Sal = 0;
      let grandP1Int = 0, grandP2Int = 0, grandP1Divs = 0, grandP2Divs = 0;
      let grandP1Cash = 0, grandP1GIA = 0, grandP1SIPP = 0, grandP1ISA = 0;
      let grandP2Cash = 0, grandP2GIA = 0, grandP2SIPP = 0, grandP2ISA = 0;

      // Colour palette — matches Sources of income chart colours
      const COL = {
        sp:    { bg: '#EBF0FB', hdr: '#4472C4', txt: '#1a3a7a' },
        sal:   { bg: '#FFF0F0', hdr: '#FF7F7F', txt: '#8b0000' },
        int:   { bg: '#F5EEF8', hdr: '#9B59B6', txt: '#4a235a' },
        div:   { bg: '#EAFAF1', hdr: '#27AE60', txt: '#145a32' },
        p1:    { bg: '#FEF3EC', hdr: '#ED7D31', txt: '#7e3a0a' },
        p2:    _p2enabled
               ? { bg: '#EBF5FB', hdr: '#2E86C1', txt: '#1a4a6e' }
               : { bg: '#F5F5F5', hdr: '#AAAAAA', txt: '#AAAAAA' },
        total: { bg: '#F8F9FA', hdr: '#555',    txt: '#222'    },
        sf:    { bg: '#FEF2F2', hdr: '#DC2626', txt: '#7f1d1d' },
      };
      const cs  = (col) => `style="background:${col.bg};color:${col.txt}"`;
      const th  = (col, content, extra = '') =>
        `<th ${extra} style="background:${col.hdr};color:#fff;border-color:${col.hdr}">${content}</th>`;
      // In single-person mode, P2 cells show — instead of values
      const dp2 = val => _p2enabled ? f(val) : '—';

      drawRows.forEach(row => {
        const { year, p1Age, p2Age,
                p1SP, p2SP, p1Sal, p2Sal, p1Int, p2Int, p1Divs, p2Divs,
                p1Cash, p1GIA, p1SIPP, p1ISA,
                p2Cash, p2GIA, p2SIPP, p2ISA,
                rowTotal, shortfall } = row;
        grandP1SP += p1SP; grandP2SP += p2SP;
        grandP1Sal += p1Sal; grandP2Sal += p2Sal;
        grandP1Int += p1Int; grandP2Int += p2Int;
        grandP1Divs += p1Divs; grandP2Divs += p2Divs;
        grandP1Cash += p1Cash; grandP1GIA += p1GIA; grandP1SIPP += p1SIPP; grandP1ISA += p1ISA;
        grandP2Cash += p2Cash; grandP2GIA += p2GIA; grandP2SIPP += p2SIPP; grandP2ISA += p2ISA;
        const sfCell = shortfall > 100
          ? `<td style="background:${COL.sf.bg};color:${COL.sf.txt};font-weight:600">${f(shortfall)}</td>`
          : `<td style="background:${COL.total.bg}">—</td>`;

        body += `<tr>
          <td>${year}</td><td>${p1Age}</td><td ${cs(COL.p2)}>${_p2enabled ? p2Age : '—'}</td>
          <td ${cs(COL.sp)}>${f(p1SP)}</td><td ${cs(COL.sp)}>${dp2(p2SP)}</td>
          <td ${cs(COL.sal)}>${f(p1Sal)}</td><td ${cs(COL.sal)}>${dp2(p2Sal)}</td>
          <td ${cs(COL.int)}>${f(p1Int)}</td><td ${cs(COL.int)}>${dp2(p2Int)}</td>
          <td ${cs(COL.div)}>${f(p1Divs)}</td><td ${cs(COL.div)}>${dp2(p2Divs)}</td>
          <td ${cs(COL.p1)}>${f(p1Cash)}</td><td ${cs(COL.p1)}>${f(p1GIA)}</td><td ${cs(COL.p1)}>${f(p1SIPP)}</td><td ${cs(COL.p1)}>${f(p1ISA)}</td>
          <td ${cs(COL.p2)}>${dp2(p2Cash)}</td><td ${cs(COL.p2)}>${dp2(p2GIA)}</td><td ${cs(COL.p2)}>${dp2(p2SIPP)}</td><td ${cs(COL.p2)}>${dp2(p2ISA)}</td>
          <td ${cs(COL.total)}><strong>${f(rowTotal)}</strong></td>${sfCell}
        </tr>`;
      });
      const grandTotal = grandP1SP + grandP2SP + grandP1Sal + grandP2Sal
                       + grandP1Int + grandP2Int + grandP1Divs + grandP2Divs
                       + grandP1Cash + grandP1GIA + grandP1SIPP + grandP1ISA
                       + grandP2Cash + grandP2GIA + grandP2SIPP + grandP2ISA;
      body += `<tr class="total-row">
        <td colspan="3">Total</td>
        <td ${cs(COL.sp)}>${f(grandP1SP)}</td><td ${cs(COL.sp)}>${dp2(grandP2SP)}</td>
        <td ${cs(COL.sal)}>${f(grandP1Sal)}</td><td ${cs(COL.sal)}>${dp2(grandP2Sal)}</td>
        <td ${cs(COL.int)}>${f(grandP1Int)}</td><td ${cs(COL.int)}>${dp2(grandP2Int)}</td>
        <td ${cs(COL.div)}>${f(grandP1Divs)}</td><td ${cs(COL.div)}>${dp2(grandP2Divs)}</td>
        <td ${cs(COL.p1)}>${f(grandP1Cash)}</td><td ${cs(COL.p1)}>${f(grandP1GIA)}</td><td ${cs(COL.p1)}>${f(grandP1SIPP)}</td><td ${cs(COL.p1)}>${f(grandP1ISA)}</td>
        <td ${cs(COL.p2)}>${dp2(grandP2Cash)}</td><td ${cs(COL.p2)}>${dp2(grandP2GIA)}</td><td ${cs(COL.p2)}>${dp2(grandP2SIPP)}</td><td ${cs(COL.p2)}>${dp2(grandP2ISA)}</td>
        <td ${cs(COL.total)}><strong>${f(grandTotal)}</strong></td><td ${cs(COL.total)}>—</td>
      </tr></tbody>`;

      dTbl.innerHTML = `<thead>
        <tr>
          <th rowspan="2" style="background:#444;color:#fff">Year</th>
          <th rowspan="2" style="background:#444;color:#fff">${p1}<br>age</th>
          <th rowspan="2" style="background:#444;color:#fff">${p2}<br>age</th>
          ${th(COL.sp,  'State Pension', 'colspan="2"')}
          ${th(COL.sal, 'Salary',        'colspan="2"')}
          ${th(COL.int, 'Interest',      'colspan="2"')}
          ${th(COL.div, 'Dividends',     'colspan="2"')}
          ${th(COL.p1,  `${p1}'s wrapper draws`, 'colspan="4"')}
          ${th(COL.p2,  `${p2}'s wrapper draws`, 'colspan="4"')}
          ${th(COL.total, 'Total',     'rowspan="2"')}
          ${th(COL.sf,    'Shortfall', 'rowspan="2"')}
        </tr>
        <tr>
          ${th(COL.sp,  p1)}${th(COL.sp,  p2)}
          ${th(COL.sal, p1)}${th(COL.sal, p2)}
          ${th(COL.int, p1)}${th(COL.int, p2)}
          ${th(COL.div, p1)}${th(COL.div, p2)}
          ${th(COL.p1, 'Cash')}${th(COL.p1, 'GIA')}${th(COL.p1, 'SIPP')}${th(COL.p1, 'ISA')}
          ${th(COL.p2, 'Cash')}${th(COL.p2, 'GIA')}${th(COL.p2, 'SIPP')}${th(COL.p2, 'ISA')}
        </tr>
      </thead>` + body;
    }
  }

  window.RetireCalcRender = {
    setResults,
    setView,
    setReal,
    initResultsTabs,
    initDisclaimerLink,
    initTableSelector,
    renderMetrics,
    renderCharts,
    renderTables,
  };
})();
