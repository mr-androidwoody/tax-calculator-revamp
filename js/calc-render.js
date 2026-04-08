(function () {
  const D = window.RetireData;

  // State shared within this module
  let _rows       = [];
  let _viewPerson = 'both';
  let _useReal    = true;
  let _activeTab  = 'charts';
  let _incomeChart     = null;
  let _taxChart        = null;
  let _wealthChart     = null;
  let _spendingChart   = null;

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
  }

  // ─────────────────────────────────────────────
  // VIEW TOGGLES
  // ─────────────────────────────────────────────
  function setView(vp, btn) {
    _viewPerson = vp;
    btn.closest('.toggle-group').querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCharts();
    renderMetrics();
  }

  function setReal(r, btn) {
    _useReal = r;
    btn.closest('.toggle-group').querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCharts();
    renderMetrics();
    if (_activeTab === 'tables') renderTables();
  }

  function setTab(tab, btn) {
    _activeTab = tab;
    btn.closest('.toggle-group').querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const charts = document.querySelector('.charts');
    const tables = document.getElementById('tables-panel');
    if (tab === 'charts') {
      if (charts) charts.style.display = 'flex';
      if (tables) tables.style.display = 'none';
    } else {
      if (charts) charts.style.display = 'none';
      if (tables) tables.style.display = 'flex';
      renderTables();
    }
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
    function renderIncomeLegend(chart) {
      const host = document.getElementById('incomeLegend');
      if (!host) return;
      host.innerHTML = '';
    
      const datasets = chart.data.datasets || [];
      const { p1, p2 } = getNames();
    
      const p1sets = datasets.map((ds, i) => ({ ds, i }))
        .filter(x => x.ds.label.endsWith(p1));

      const p2sets = datasets.map((ds, i) => ({ ds, i }))
        .filter(x => x.ds.label.endsWith(p2));
    
      function cleanLabel(label, name) {
        return label.replace(`– ${name}`, '').trim();
      }
    
      // helper to normalise label lengths
      function shortLabel(label) {
        return label
          .replace('State Pension', 'Pension')
          .replace('Interest draw', 'Interest')
          .replace('Cash draw', 'Cash')
          .replace('Dividends', 'Divs')
          .trim();
      }
    
      function makeGroup(title, items, personName) {
        if (!items.length) return null;
    
        const group = document.createElement('div');
        group.className = 'legend-group';
    
        const heading = document.createElement('div');
        heading.className = 'legend-heading';
        heading.textContent = title;
    
        const row = document.createElement('div');
        row.className = 'split-legend-row';
    
        items.forEach(({ ds, i }) => {
          const item = document.createElement('div');
          item.className = 'split-legend-item';
          if (!chart.isDatasetVisible(i)) item.classList.add('is-hidden');
    
          const swatch = document.createElement('span');
          swatch.className = 'split-legend-swatch';
          swatch.style.background = ds.backgroundColor;
    
          const label = document.createElement('span');
          label.textContent = shortLabel(cleanLabel(ds.label, personName));
    
          item.appendChild(swatch);
          item.appendChild(label);
    
          item.addEventListener('click', () => {
            chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
            chart.update();
            renderIncomeLegend(chart);
          });
    
          row.appendChild(item);
        });
    
        const wrapper = document.createElement('div');
        wrapper.className = 'legend-line';
        
        wrapper.appendChild(heading);
        wrapper.appendChild(row);
        
        group.appendChild(wrapper);
    
        return group;
      }
    
      // ✅ THIS WAS MISSING — REQUIRED
      const g1 = makeGroup(p1, p1sets, p1);
      const g2 = makeGroup(p2, p2sets, p2);
    
      if (g1) host.appendChild(g1);
      if (g2) host.appendChild(g2);

      // Shortfall indicator — always visible, not toggleable
      const shortfallIdx = chart.data.datasets.findIndex(d => d.label === 'Spending shortfall');
      if (shortfallIdx >= 0) {
        const item = document.createElement('div');
        item.className = 'split-legend-item';
        item.style.marginTop = '4px';
        const swatch = document.createElement('span');
        swatch.className = 'split-legend-swatch';
        swatch.style.background = '#DC2626';
        const label = document.createElement('span');
        label.textContent = 'Spending shortfall';
        item.appendChild(swatch);
        item.appendChild(label);
        host.appendChild(item);
      }
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
      p1Divs: '#C0392B',
      p2Divs: '#E74C3C',
      p1Cash: '#B0B0B0',
      salary: '#FF7F7F',
      target: '#1F2937',
      net: '#2563EB',
      shortfall: '#DC2626',
      surplus: '#16A34A',
    };

    function ds(label, fn, color) {
      return {
        label,
        data: _rows.map(r => Math.round(adj(fn(r), r) / 1000)),
        backgroundColor: color,
        stack: 'income',
      };
    }

    // ─────────────────────────────────────────────
    // INCOME CHART
    // ─────────────────────────────────────────────
    let sets = [];

    if (_viewPerson === 'both' || _viewPerson === 'p1') {
      sets.push(ds(`State Pension – ${p1}`, r => r.p1SP, COLOURS.p1SP));
      sets.push(ds(`Salary – ${p1}`, r => r.p1SalInc || 0, COLOURS.salary));
      sets.push(ds(`SIPP – ${p1}`, r => r.p1Drawn.SIPP, COLOURS.p1SIPP));
      sets.push(ds(`ISA – ${p1}`, r => r.p1Drawn.ISA, COLOURS.p1ISA));
      sets.push(ds(`GIA – ${p1}`, r => r.p1Drawn.GIA, COLOURS.p1GIA));
      sets.push(ds(`Interest draw – ${p1}`, r => r.p1IntDraw, COLOURS.intDraw));
      sets.push(ds(`Dividends – ${p1}`, r => r.p1Divs || 0, COLOURS.p1Divs));
      sets.push(ds(`Cash draw – ${p1}`, r => r.p1Drawn.Cash, COLOURS.p1Cash));
    }

    if (_viewPerson === 'both' || _viewPerson === 'p2') {
      sets.push(ds(`State Pension – ${p2}`, r => r.p2SP, COLOURS.p2SP));
      sets.push(ds(`Salary – ${p2}`, r => r.p2SalInc || 0, COLOURS.salary));
      sets.push(ds(`SIPP – ${p2}`, r => r.p2Drawn.SIPP, COLOURS.p2SIPP));
      sets.push(ds(`ISA – ${p2}`, r => r.p2Drawn.ISA, COLOURS.p2ISA));
      sets.push(ds(`GIA – ${p2}`, r => r.p2Drawn.GIA, COLOURS.p2GIA));
      sets.push(ds(`Interest draw – ${p2}`, r => r.p2IntDraw, COLOURS.intDraw));
      sets.push(ds(`Dividends – ${p2}`, r => r.p2Divs || 0, COLOURS.p2Divs));
      sets.push(ds(`Cash draw – ${p2}`, r => r.p2Drawn.Cash, COLOURS.p1Cash));
    }

    // Shortfall bar — stacked on top in red, shows unmet portion of spending target
    sets.push({
      label: 'Spending shortfall',
      data: _rows.map(r => Math.round(adj(r.spendingShortfall || 0, r) / 1000)),
      backgroundColor: COLOURS.shortfall,
      stack: 'income',
    });

    // Target line — dashed, not stacked; should be flat in Real terms
    sets.push({
      label: 'Spending target',
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
                  if (ctx.dataset.label === 'Spending shortfall') return `Shortfall: ${D.formatMoney(val)}`;
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

              max: Math.ceil(
                Math.max(
                  ..._rows.map(r => Math.round(adj(r.target || 0, r) / 1000)),
                  ...labels.map((_, i) => sets
                    .filter(s => s.stack === 'income')
                    .reduce((sum, s) => sum + (s.data[i] || 0), 0))
                ) * 1.1 / 5
              ) * 5,
            
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
      renderIncomeLegend(_incomeChart);
    }

    // ─────────────────────────────────────────────
    // WITHDRAWAL RATE CHART
    // Annual portfolio drawdown as % of portfolio value, with 4% reference line
    // ─────────────────────────────────────────────
    const spendingCtx = document.getElementById('spendingChart')?.getContext('2d');
    if (spendingCtx) {

      // Drawdown = everything pulled from invested wrappers (SIPP, ISA, GIA, Cash)
      // excluding interest account draws (those aren't portfolio drawdown)
      function getDrawdown(r) {
        if (_viewPerson === 'p1') {
          return (r.p1Drawn.SIPP || 0) + (r.p1Drawn.ISA || 0)
               + (r.p1Drawn.GIA  || 0) + (r.p1Drawn.Cash || 0);
        }
        if (_viewPerson === 'p2') {
          return (r.p2Drawn.SIPP || 0) + (r.p2Drawn.ISA || 0)
               + (r.p2Drawn.GIA  || 0) + (r.p2Drawn.Cash || 0);
        }
        return (r.p1Drawn.SIPP || 0) + (r.p1Drawn.ISA || 0)
             + (r.p1Drawn.GIA  || 0) + (r.p1Drawn.Cash || 0)
             + (r.p2Drawn.SIPP || 0) + (r.p2Drawn.ISA || 0)
             + (r.p2Drawn.GIA  || 0) + (r.p2Drawn.Cash || 0);
      }

      function getPortfolio(r) {
        const s = r.snap;
        if (_viewPerson === 'p1') {
          return (s.p1Cash || 0) + (s.p1IntBal || 0) + (s.p1GIA || 0)
               + (s.p1SIPP || 0) + (s.p1ISA || 0);
        }
        if (_viewPerson === 'p2') {
          return (s.p2Cash || 0) + (s.p2IntBal || 0) + (s.p2GIA || 0)
               + (s.p2SIPP || 0) + (s.p2ISA || 0);
        }
        return r.totalPortfolio;
      }

      // Withdrawal rate = drawdown / portfolio at start of year (snap is end-of-year,
      // so use previous row's snap as opening balance, fall back to current for first year)
      const withdrawalRateData = _rows.map((r, i) => {
        const drawdown  = getDrawdown(r);
        const openingPortfolio = i === 0
          ? getPortfolio(r) + drawdown   // approximate: add back what was drawn
          : getPortfolio(_rows[i - 1]);
        if (openingPortfolio <= 0) return 0;
        return parseFloat((drawdown / openingPortfolio * 100).toFixed(2));
      });

      // Colour each point: green ≤4%, amber 4–6%, red >6%
      const pointColours = withdrawalRateData.map(v =>
        v <= 4 ? COLOURS.surplus : v <= 6 ? '#F59E0B' : COLOURS.shortfall
      );

      // Static 4% reference line
      const refLine = _rows.map(() => 4);

      if (_spendingChart) _spendingChart.destroy();

      _spendingChart = new Chart(spendingCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Withdrawal rate',
              data: withdrawalRateData,
              borderColor: COLOURS.net,
              backgroundColor: 'rgba(37,99,235,0.08)',
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: pointColours,
              pointBorderColor: pointColours,
              tension: 0.2,
              fill: true,
              order: 2,
            },
            {
              label: '4% guideline',
              data: refLine,
              borderColor: COLOURS.shortfall,
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderDash: [6, 3],
              pointRadius: 0,
              tension: 0,
              order: 1,
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
                  if (ctx.dataset.label === '4% guideline') return '4% guideline';
                  const v   = ctx.parsed.y || 0;
                  const idx = ctx.dataIndex;
                  const drawdown = getDrawdown(_rows[idx]);
                  return [
                    `Withdrawal rate: ${v.toFixed(2)}%`,
                    `Drawdown: ${D.formatMoney(drawdown)}`,
                  ];
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              title: {
                display: true,
                text: 'Withdrawal rate %',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v + '%',
              },
              suggestedMin: 0,
            },
          },
        },
      });

      // Update chart panel heading if present
      const heading = document.getElementById('spendingChartTitle');
      if (heading) heading.textContent = 'Withdrawal rate';
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
          data: _rows.map(r => Math.round(adj((r.snap.p1Cash || 0) + (r.snap.p1IntBal || 0), r))),
          backgroundColor: '#B0B0B0',
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
          data: _rows.map(r => Math.round(adj((r.snap.p2Cash || 0) + (r.snap.p2IntBal || 0), r))),
          backgroundColor: '#D0D0D0',
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
            ? wealthData.slice(0, 4)
            : _viewPerson === 'p2'
              ? wealthData.slice(4)
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
    setTab,
    renderAlerts,
    renderMetrics,
    renderCharts,
    renderTables,
  };
})();
