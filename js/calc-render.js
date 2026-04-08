(function () {
  const D = window.RetireData;

  // State shared within this module
  let _rows       = [];
  let _viewPerson = 'both';
  let _useReal    = true;
  let _activeResultsTab = 'income';
  let _incomeChart     = null;
  let _taxChart        = null;
  let _wealthChart     = null;
  let _spendingChart   = null;
  let _engineShortfall = [];

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  const adj = (val, row) => _useReal ? val * row.realDeflator : val;
  const fmt = n => D.formatMoney(n);

  function getNames() {
    const p1 = (document.getElementById('sp-p1name')?.value || '').trim() || 'Person 1';
    const p2 = (document.getElementById('sp-p2name')?.value || '').trim() || 'Person 2';
    return { p1, p2 };
  }

  // ─────────────────────────────────────────────
  // PUBLIC: receive new projection results
  // ─────────────────────────────────────────────
  function setResults(rows) {
    _rows = rows;
    window._debugRows = rows; // TEMP DEBUG — remove after diagnosis
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
    document.querySelectorAll('.results-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.resultsTab;
        _activeResultsTab = tab;

        // Update tab button states
        document.querySelectorAll('.results-tab').forEach(b => {
          b.classList.toggle('results-tab--active', b === btn);
          b.classList.toggle('results-tab--inactive', b !== btn);
        });

        // Show the matching panel, hide others
        document.querySelectorAll('.chart-panel').forEach(panel => {
          panel.style.display = panel.id === `results-panel-${tab}` ? 'grid' : 'none';
        });

        // Render tables on first visit
        if (tab === 'tables') renderTables();
      });
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
        document.getElementById('tables-tax-view').style.display    = which === 'tax'    ? '' : 'none';
        document.getElementById('tables-wealth-view').style.display  = which === 'wealth' ? '' : 'none';
      });
    });
  }

  // ─────────────────────────────────────────────
  // ALERTS
  // ─────────────────────────────────────────────
  function renderAlerts(depletions) {
    const c = document.getElementById('alerts-container');
    if (!c) return;
    c.innerHTML = '';
    const entries = Object.entries(depletions || {}).sort((a, b) => a[1].year - b[1].year);
    entries.forEach(([key, { year, age }]) => {
      const d = document.createElement('div');
      d.className = 'alert alert-warn';
      d.innerHTML = `⚠ <strong>${key}</strong> depleted in <strong>${year}</strong> (age ${age})`;
      c.appendChild(d);
    });
  }

  // ─────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────
  function renderMetrics() {
    if (!_rows.length) return;

    const totalTax = _rows.reduce((s, r) => {
      const t = _viewPerson === 'p1' ? r.p1IncomeTax + r.p1CGT + r.p1NI
              : _viewPerson === 'p2' ? r.p2IncomeTax + r.p2CGT + r.p2NI
              : r.p1IncomeTax + r.p1CGT + r.p1NI + r.p2IncomeTax + r.p2CGT + r.p2NI;
      return s + adj(t, r);
    }, 0);

    const avgRate = _rows.reduce((s, r) => {
      const tax = _viewPerson === 'p1' ? r.p1IncomeTax + r.p1CGT + r.p1NI
                : _viewPerson === 'p2' ? r.p2IncomeTax + r.p2CGT + r.p2NI
                : r.p1IncomeTax + r.p1CGT + r.p1NI + r.p2IncomeTax + r.p2CGT + r.p2NI;
      const p1Gross = r.p1SP + (r.p1SalInc || 0) + r.p1Drawn.SIPP + r.p1Drawn.ISA + r.p1Drawn.GIA + r.p1IntDraw + r.p1Drawn.Cash;
      const p2Gross = r.p2SP + r.p2SalInc + r.p2Drawn.SIPP + r.p2Drawn.ISA + r.p2Drawn.GIA + r.p2IntDraw + r.p2Drawn.Cash;
      const gross = _viewPerson === 'p1' ? p1Gross : _viewPerson === 'p2' ? p2Gross : p1Gross + p2Gross;
      return s + (gross > 0 ? tax / gross : 0);
    }, 0) / _rows.length;

    let peakYear = _rows[0].year, peakTax = 0;
    _rows.forEach(r => {
      const t = _viewPerson === 'p1' ? r.p1Tax : _viewPerson === 'p2' ? r.p2Tax : r.p1Tax + r.p2Tax;
      if (t > peakTax) { peakTax = t; peakYear = r.year; }
    });

    const last = _rows[_rows.length - 1];
    const mTax  = document.getElementById('m-tax');
    const mRate = document.getElementById('m-rate');
    const mPeak = document.getElementById('m-peak');
    const mPort = document.getElementById('m-port');
    if (mTax)  mTax.textContent  = fmt(totalTax);
    if (mRate) mRate.textContent = (avgRate * 100).toFixed(1) + '%';
    if (mPeak) mPeak.textContent = peakYear;
    if (mPort) mPort.textContent = fmt(adj(last.totalPortfolio, last));
  }

  // ─────────────────────────────────────────────
  // INCOME LEGEND
  // ─────────────────────────────────────────────
  function renderIncomeLegend(chart, recomputeShortfall) {
    const host = document.getElementById('incomeLegend');
    if (!host) return;
    host.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'sidebar-legend__hint';
    hint.textContent = 'Click to toggle';
    host.appendChild(hint);

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
      const raw = ds._firstYearValue || 0;
      value.textContent = raw > 0 ? fmt(raw) : '—';

      item.appendChild(swatch);
      item.appendChild(label);
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
    const sfRaw = (_rows[0] ? _engineShortfall[0] * 1000 : 0);
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
    if (sfRaw > 0) {
      const sfVal = document.createElement('span');
      sfVal.className = 'sidebar-legend__value';
      sfVal.textContent = fmt(sfRaw);
      sfItem.appendChild(sfVal);
    } else {
      const sfNote = document.createElement('span');
      sfNote.className = 'sidebar-legend__fixed-note';
      sfNote.textContent = 'always on';
      sfItem.appendChild(sfNote);
    }
    host.appendChild(sfItem);
  }

  // ─────────────────────────────────────────────
  // CHARTS
  // ─────────────────────────────────────────────
    function renderCharts() {
    if (!_rows.length) return;
    const labels = _rows.map(r => r.year);
    const { p1, p2 } = getNames();

    const COLOURS = {
      p1SP: '#4472C4',
      p2SP: '#70AD47',
      p1SIPP: '#ED7D31',
      p2SIPP: '#FFC000',
      p1ISA: '#5B9BD5',
      p2ISA: '#2E86C1',
      p1GIA: '#A9D18E',
      p2GIA: '#78C86A',
      intDraw: '#9B59B6',
      p1Divs: '#27AE60',
      p2Divs: '#E74C3C',
      p1Cash: '#B0B0B0',
      salary: '#FF7F7F',
      target: '#1F2937',
      net: '#2563EB',
      shortfall: '#DC2626',
      surplus: '#16A34A',
    };

    // ds builds a dataset for the income chart.
    // p1fn / p2fn extract the p1 and p2 portions separately so the
    // _viewPerson toggle can show only the relevant person's contribution
    // while always measuring shortfall against the full household target.
    function ds(label, p1fn, p2fn, color) {
      const both = r => (p1fn(r) || 0) + (p2fn(r) || 0);
      const fn   = _viewPerson === 'p1' ? p1fn
                 : _viewPerson === 'p2' ? p2fn
                 : both;
      const r0 = _rows[0];
      return {
        label,
        data: _rows.map(r => adj(fn(r) || 0, r) / 1000),
        backgroundColor: color,
        stack: 'income',
        _firstYearValue: adj(fn(r0) || 0, r0),
      };
    }

    // ─────────────────────────────────────────────
    // INCOME CHART
    // One dataset per source type; filtered by _viewPerson.
    // Shortfall always measured against full household target (65k).
    // Red shortfall fills the gap when visible income can't meet the target.
    // ─────────────────────────────────────────────

    // Full household target — always the 65k line regardless of person toggle
    const _targetData      = _rows.map(r => adj(r.target || 0, r) / 1000);
    // Engine shortfall — gap between visible person's gross income and full household target
    _engineShortfall = _rows.map(r => {
      const p1Gross = (r.p1SP || 0) + (r.p1SalInc || 0) + (r.p1Drawn.SIPP || 0) +
                      (r.p1Drawn.ISA || 0) + (r.p1Drawn.GIA || 0) +
                      (r.p1IntDraw || 0) + (r.p1Divs || 0) + (r.p1Drawn.Cash || 0);
      const p2Gross = (r.p2SP || 0) + (r.p2SalInc || 0) + (r.p2Drawn.SIPP || 0) +
                      (r.p2Drawn.ISA || 0) + (r.p2Drawn.GIA || 0) +
                      (r.p2IntDraw || 0) + (r.p2Divs || 0) + (r.p2Drawn.Cash || 0);
      const visibleGross = _viewPerson === 'p1' ? p1Gross
                         : _viewPerson === 'p2' ? p2Gross
                         : p1Gross + p2Gross;
      return adj(Math.max(0, (r.target || 0) - visibleGross), r) / 1000;
    });

    let sets = [];
    sets.push(ds('Salary',        r => r.p1SalInc     || 0, r => r.p2SalInc     || 0, COLOURS.salary));
    sets.push(ds('Cash',          r => r.p1Drawn.Cash || 0, r => r.p2Drawn.Cash || 0, COLOURS.p1Cash));
    sets.push(ds('Interest',      r => r.p1IntDraw    || 0, r => r.p2IntDraw    || 0, COLOURS.intDraw));
    sets.push(ds('Dividends',     r => r.p1Divs       || 0, r => r.p2Divs       || 0, COLOURS.p1Divs));
    sets.push(ds('GIA',           r => r.p1Drawn.GIA  || 0, r => r.p2Drawn.GIA  || 0, COLOURS.p1GIA));
    sets.push(ds('ISA',           r => r.p1Drawn.ISA  || 0, r => r.p2Drawn.ISA  || 0, COLOURS.p1ISA));
    sets.push(ds('SIPP / WP',     r => r.p1Drawn.SIPP || 0, r => r.p2Drawn.SIPP || 0, COLOURS.p1SIPP));
    sets.push(ds('State Pension', r => r.p1SP         || 0, r => r.p2SP         || 0, COLOURS.p1SP));

    // Red shortfall — gap between visible income and full household target
    // Seeded from engine shortfall (zero in funded years); grows as sources are toggled off
    sets.push({
      label: 'Shortfall',
      data: _engineShortfall.slice(),
      backgroundColor: COLOURS.shortfall,
      stack: 'income',
    });

    // Recompute shortfall when sources are toggled on/off
    // Always measures against the full household target
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
    }

    // ─────────────────────────────────────────────
    // GROSS VS NET INCOME CHART
    // Stacked gross bars + flat gross target line + net income line.
    // Gap between bars and net line = tax paid each year.
    // ─────────────────────────────────────────────
    const spendingCtx = document.getElementById('spendingChart')?.getContext('2d');
    if (spendingCtx) {
      const grossNetSets = [];

      // Same source stacks as income chart
      function gds(label, fn, color) {
        return {
          label,
          data: _rows.map(r => Math.round(adj(fn(r), r) / 1000)),
          backgroundColor: color,
          stack: 'gross',
          type: 'bar',
        };
      }
      grossNetSets.push(gds('State Pension', r => (r.p1SP         || 0) + (r.p2SP         || 0), COLOURS.p1SP));
      grossNetSets.push(gds('Salary',        r => (r.p1SalInc     || 0) + (r.p2SalInc     || 0), COLOURS.salary));
      grossNetSets.push(gds('SIPP',          r => (r.p1Drawn.SIPP || 0) + (r.p2Drawn.SIPP || 0), COLOURS.p1SIPP));
      grossNetSets.push(gds('ISA',           r => (r.p1Drawn.ISA  || 0) + (r.p2Drawn.ISA  || 0), COLOURS.p1ISA));
      grossNetSets.push(gds('GIA',           r => (r.p1Drawn.GIA  || 0) + (r.p2Drawn.GIA  || 0), COLOURS.p1GIA));
      grossNetSets.push(gds('Interest',      r => (r.p1IntDraw    || 0) + (r.p2IntDraw    || 0), COLOURS.intDraw));
      grossNetSets.push(gds('Dividends',     r => (r.p1Divs       || 0) + (r.p2Divs       || 0), COLOURS.p1Divs));
      grossNetSets.push(gds('Cash',          r => (r.p1Drawn.Cash || 0) + (r.p2Drawn.Cash || 0), COLOURS.p1Cash));

      // Flat gross spending target line
      grossNetSets.push({
        label: 'Spending target (gross)',
        data: _rows.map(r => Math.round(adj(r.target || 0, r) / 1000)),
        type: 'line',
        stack: undefined,
        backgroundColor: 'transparent',
        borderColor: COLOURS.target,
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
        tension: 0,
        order: 0,
      });

      // Net income line — what actually lands after all tax
      grossNetSets.push({
        label: 'Net income',
        data: _rows.map(r => Math.round(adj(r.householdNetIncome || 0, r) / 1000)),
        type: 'line',
        stack: undefined,
        backgroundColor: 'transparent',
        borderColor: COLOURS.net,
        borderWidth: 2,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0,
        order: 0,
      });

      if (_spendingChart) _spendingChart.destroy();
      _spendingChart = new Chart(spendingCtx, {
        type: 'bar',
        data: { labels, datasets: grossNetSets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = (ctx.parsed.y || 0) * 1000;
                  if (!val) return null;
                  if (ctx.dataset.label === 'Spending target (gross)') return `Gross target: ${D.formatMoney(val)}`;
                  if (ctx.dataset.label === 'Net income') return `Net income: ${D.formatMoney(val)}`;
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

      // Update chart panel heading if present
      const heading = document.getElementById('spendingChartTitle');
      if (heading) heading.textContent = 'Gross vs net income';
    }

    // ─────────────────────────────────────────────
    // TAX CHART
    // ─────────────────────────────────────────────
    const taxData = _rows.map(r => {
      const t = _viewPerson === 'p1'
        ? r.p1IncomeTax + r.p1CGT
        : _viewPerson === 'p2'
          ? r.p2IncomeTax + r.p2CGT
          : r.p1IncomeTax + r.p1CGT + r.p2IncomeTax + r.p2CGT;
      return Math.round(adj(t, r));
    });

    const rateData = _rows.map(r => {
      const tax = _viewPerson === 'p1'
        ? r.p1IncomeTax + r.p1CGT
        : _viewPerson === 'p2'
          ? r.p2IncomeTax + r.p2CGT
          : r.p1IncomeTax + r.p1CGT + r.p2IncomeTax + r.p2CGT;

      const gross = _viewPerson === 'p1'
        ? (r.p1GrossIncome || 0)
        : _viewPerson === 'p2'
          ? (r.p2GrossIncome || 0)
          : (r.householdGrossIncome || 0);

      return gross > 0 ? parseFloat((tax / gross * 100).toFixed(1)) : 0;
    });

    const taxCtx = document.getElementById('taxChart')?.getContext('2d');
    if (taxCtx) {
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
            },
            {
              type: 'line',
              label: 'Effective tax rate',
              data: rateData,
              borderColor: '#7F6000',
              backgroundColor: '#7F6000',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.2,
              yAxisID: 'y1',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.yAxisID === 'y1') return `${ctx.dataset.label}: ${ctx.parsed.y}%`;
                  return `${ctx.dataset.label}: ${D.formatMoney(ctx.parsed.y || 0)}`;
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
              grid: { drawOnChartArea: false },
              title: {
                display: true,
                text: 'Rate %',
                font: { size: 11 },
              },
              ticks: {
                callback: v => v + '%',
              },
            },
          },
        },
      });
    }

    // ─────────────────────────────────────────────
    // WEALTH CHART
    // ─────────────────────────────────────────────
    const wealthCtx = document.getElementById('wealthChart')?.getContext('2d');
    if (wealthCtx) {
      const wealthData = [
        {
          label: `${p1} Cash`,
          data: _rows.map(r => Math.round(adj(r.snap.p1Cash || 0, r))),
          backgroundColor: '#B0B0B0',
          stack: 'wealth',
        },
        {
          label: `${p1} Interest`,
          data: _rows.map(r => Math.round(adj(r.snap.p1IntBal || 0, r))),
          backgroundColor: '#9B59B6',
          stack: 'wealth',
        },
        {
          label: `${p1} GIA`,
          data: _rows.map(r => Math.round(adj(r.snap.p1GIA || 0, r))),
          backgroundColor: '#A9D18E',
          stack: 'wealth',
        },
        {
          label: `${p1} SIPP`,
          data: _rows.map(r => Math.round(adj(r.snap.p1SIPP || 0, r))),
          backgroundColor: '#ED7D31',
          stack: 'wealth',
        },
        {
          label: `${p1} ISA`,
          data: _rows.map(r => Math.round(adj(r.snap.p1ISA || 0, r))),
          backgroundColor: '#5B9BD5',
          stack: 'wealth',
        },
        {
          label: `${p2} Cash`,
          data: _rows.map(r => Math.round(adj(r.snap.p2Cash || 0, r))),
          backgroundColor: '#D0D0D0',
          stack: 'wealth',
        },
        {
          label: `${p2} Interest`,
          data: _rows.map(r => Math.round(adj(r.snap.p2IntBal || 0, r))),
          backgroundColor: '#C39BD3',
          stack: 'wealth',
        },
        {
          label: `${p2} GIA`,
          data: _rows.map(r => Math.round(adj(r.snap.p2GIA || 0, r))),
          backgroundColor: '#78C86A',
          stack: 'wealth',
        },
        {
          label: `${p2} SIPP`,
          data: _rows.map(r => Math.round(adj(r.snap.p2SIPP || 0, r))),
          backgroundColor: '#FFC000',
          stack: 'wealth',
        },
        {
          label: `${p2} ISA`,
          data: _rows.map(r => Math.round(adj(r.snap.p2ISA || 0, r))),
          backgroundColor: '#2E86C1',
          stack: 'wealth',
        },
      ];

      if (_wealthChart) _wealthChart.destroy();
      _wealthChart = new Chart(wealthCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: _viewPerson === 'p1'
            ? wealthData.slice(0, 5)
            : _viewPerson === 'p2'
              ? wealthData.slice(5)
              : wealthData,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true },
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
    }
  }

  function _renderWealthChart(labels, p1, p2) {
    if (!p1 || !p2) { const n = getNames(); p1 = n.p1; p2 = n.p2; }
    function wds(label, fn, color) {
      return { label, data: _rows.map(r => Math.round(adj(fn(r.snap), r) / 1000)), backgroundColor: color, stack: 'wealth' };
    }
    const datasets = [];
    if (_viewPerson === 'both' || _viewPerson === 'p1') {
      datasets.push(wds(`SIPP – ${p1}`,           s => s.p1SIPP,        '#E84D4D'));
      datasets.push(wds(`ISA – ${p1}`,            s => s.p1ISA,         '#4472C4'));
      datasets.push(wds(`GIA – ${p1}`,            s => s.p1GIA,         '#FFC000'));
      datasets.push(wds(`Interest accts – ${p1}`, s => s.p1IntBal || 0, '#9B59B6'));
      datasets.push(wds(`Cash – ${p1}`,           s => s.p1Cash,        '#B0B0B0'));
    }
    if (_viewPerson === 'both' || _viewPerson === 'p2') {
      datasets.push(wds(`SIPP – ${p2}`,           s => s.p2SIPP,        '#FF8C8C'));
      datasets.push(wds(`ISA – ${p2}`,            s => s.p2ISA,         '#5B9BD5'));
      datasets.push(wds(`GIA – ${p2}`,            s => s.p2GIA,         '#FFD966'));
      datasets.push(wds(`Interest accts – ${p2}`, s => s.p2IntBal || 0, '#C39BD3'));
      datasets.push(wds(`Cash – ${p2}`,           s => s.p2Cash,        '#D0D0D0'));
    }
    const wCtx = document.getElementById('wealthChart')?.getContext('2d');
    if (!wCtx) return;
    if (_wealthChart) _wealthChart.destroy();
    _wealthChart = new Chart(wCtx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${D.formatMoney((ctx.parsed.y || 0) * 1000)}` } },
        },
        scales: {
          x: { stacked: true, ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { stacked: true,
            title: { display: true, text: _useReal ? 'Real £k' : 'Nominal £k', font: { size: 11 } },
            ticks: { font: { size: 11 }, callback: v => v + 'k' } },
        },
      },
    });
  }

  // ─────────────────────────────────────────────
  // TABLES
  // ─────────────────────────────────────────────
  function renderTables() {
    if (!_rows.length) return;
    const f = n => D.formatMoney(n);
    const a = (val, row) => _useReal ? val * row.realDeflator : val;
    const { p1, p2 } = getNames();

    // Tax table
    const taxTbl = document.getElementById('tax-table');
    if (taxTbl) {
      let cumTax = 0;
      let grandWI = 0, grandWC = 0, grandHI = 0, grandHC = 0;
      let body = '<tbody>';
      _rows.forEach(r => {
        const wi = a(r.p1IncomeTax, r), wc = a(r.p1CGT, r);
        const hi = a(r.p2IncomeTax, r), hc = a(r.p2CGT, r);
        const wt = wi + wc, ht = hi + hc, hh = wt + ht;
        cumTax += hh;
        grandWI += wi; grandWC += wc; grandHI += hi; grandHC += hc;
        body += `<tr>
          <td>${r.year}</td><td>${r.p1Age}</td><td>${r.p2Age}</td>
          <td>${f(wi)}</td><td>${f(wc)}</td><td>${f(wt)}</td>
          <td>${f(hi)}</td><td>${f(hc)}</td><td>${f(ht)}</td>
          <td>${f(hh)}</td><td>${f(cumTax)}</td>
        </tr>`;
      });
      const grand = grandWI + grandWC + grandHI + grandHC;
      body += `<tr class="total-row">
        <td colspan="3">Total</td>
        <td>${f(grandWI)}</td><td>${f(grandWC)}</td><td>${f(grandWI+grandWC)}</td>
        <td>${f(grandHI)}</td><td>${f(grandHC)}</td><td>${f(grandHI+grandHC)}</td>
        <td>${f(grand)}</td><td>${f(grand)}</td>
      </tr></tbody>`;
      taxTbl.innerHTML = `<thead><tr>
        <th>Year</th><th>${p1} age</th><th>${p2} age</th>
        <th>${p1} income tax</th><th>${p1} CGT</th><th>${p1} total</th>
        <th>${p2} income tax</th><th>${p2} CGT</th><th>${p2} total</th>
        <th>Household tax</th><th>Cumulative tax</th>
      </tr></thead>` + body;
    }

    // Wealth table
    const wTbl = document.getElementById('wealth-table');
    if (wTbl) {
      let body = '<tbody>';
      _rows.forEach(r => {
        const s  = r.snap;
        const av = v => a(v, r);
        const cell = v => { const adj2 = a(v, r); return `<td${adj2 < 1 && v > 0 ? ' class="depleted"' : ''}>${f(adj2)}</td>`; };
        const wTotal = av((s.p1Cash||0)+(s.p1IntBal||0)+(s.p1GIA||0)+(s.p1SIPP||0)+(s.p1ISA||0)
                         +(s.p2Cash||0)+(s.p2IntBal||0)+(s.p2GIA||0)+(s.p2SIPP||0)+(s.p2ISA||0));
        body += `<tr>
          <td>${r.year}</td><td>${r.p1Age}</td><td>${r.p2Age}</td>
          ${cell(s.p1Cash)}${cell(s.p1IntBal||0)}${cell(s.p1GIA)}${cell(s.p1SIPP)}${cell(s.p1ISA)}
          ${cell(s.p2Cash)}${cell(s.p2IntBal||0)}${cell(s.p2GIA)}${cell(s.p2SIPP)}${cell(s.p2ISA)}
          <td>${f(wTotal)}</td>
        </tr>`;
      });
      body += '</tbody>';
      wTbl.innerHTML = `<thead><tr>
        <th>Year</th><th>${p1} age</th><th>${p2} age</th>
        <th>${p1} Cash</th><th>${p1} Interest</th><th>${p1} GIA</th><th>${p1} SIPP</th><th>${p1} ISA</th>
        <th>${p2} Cash</th><th>${p2} Interest</th><th>${p2} GIA</th><th>${p2} SIPP</th><th>${p2} ISA</th>
        <th>Total</th>
      </tr></thead>` + body;
    }
  }

  window.RetireCalcRender = {
    setResults,
    setView,
    setReal,
    initResultsTabs,
    initTableSelector,
    renderAlerts,
    renderMetrics,
    renderCharts,
    renderTables,
  };
})();
