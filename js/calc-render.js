(function () {
  const D = window.RetireData;

  // State shared within this module
  let _rows       = [];
  let _viewPerson = 'both';
  let _useReal    = true;
  let _activeTab  = 'charts';
  let _incomeChart  = null;
  let _taxChart     = null;
  let _wealthChart  = null;

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  const adj = (val, row) => _useReal ? val * row.realDeflator : val;
  const fmt = n => D.formatMoney(n);

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
      const t = _viewPerson === 'woody' ? r.woodyIncomeTax + r.woodyCGT + r.woodyNI
              : _viewPerson === 'heidi' ? r.heidiIncomeTax + r.heidiCGT + r.heidiNI
              : r.woodyIncomeTax + r.woodyCGT + r.woodyNI + r.heidiIncomeTax + r.heidiCGT + r.heidiNI;
      return s + adj(t, r);
    }, 0);

    const avgRate = _rows.reduce((s, r) => {
      const tax = _viewPerson === 'woody' ? r.woodyIncomeTax + r.woodyCGT + r.woodyNI
                : _viewPerson === 'heidi' ? r.heidiIncomeTax + r.heidiCGT + r.heidiNI
                : r.woodyIncomeTax + r.woodyCGT + r.woodyNI + r.heidiIncomeTax + r.heidiCGT + r.heidiNI;
      const woodyGross = r.woodySP + r.woodyDrawn.SIPP + r.woodyDrawn.ISA + r.woodyDrawn.GIA + r.woodyIntDraw + r.woodyDrawn.Cash;
      const heidiGross = r.heidiSP + r.heidiSalInc + r.heidiDrawn.SIPP + r.heidiDrawn.ISA + r.heidiDrawn.GIA + r.heidiIntDraw + r.heidiDrawn.Cash;
      const gross = _viewPerson === 'woody' ? woodyGross : _viewPerson === 'heidi' ? heidiGross : woodyGross + heidiGross;
      return s + (gross > 0 ? tax / gross : 0);
    }, 0) / _rows.length;

    let peakYear = _rows[0].year, peakTax = 0;
    _rows.forEach(r => {
      const t = _viewPerson === 'woody' ? r.woodyTax : _viewPerson === 'heidi' ? r.heidiTax : r.woodyTax + r.heidiTax;
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
    const woody = datasets.map((ds, i) => ({ ds, i })).filter(x => x.ds.label.includes('Woody'));
    const heidi = datasets.map((ds, i) => ({ ds, i })).filter(x => x.ds.label.includes('Heidi'));

    function makeRow(items) {
      const row = document.createElement('div');
      row.className = 'split-legend-row';
      items.forEach(({ ds, i }) => {
        const item   = document.createElement('div');
        item.className = 'split-legend-item';
        if (!chart.isDatasetVisible(i)) item.classList.add('is-hidden');
        const swatch = document.createElement('span');
        swatch.className = 'split-legend-swatch';
        swatch.style.background = ds.backgroundColor;
        const label  = document.createElement('span');
        label.textContent = ds.label;
        item.appendChild(swatch);
        item.appendChild(label);
        item.addEventListener('click', () => {
          chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
          chart.update();
          renderIncomeLegend(chart);
        });
        row.appendChild(item);
      });
      return row;
    }
    if (woody.length) host.appendChild(makeRow(woody));
    if (heidi.length) host.appendChild(makeRow(heidi));
  }

  // ─────────────────────────────────────────────
  // CHARTS
  // ─────────────────────────────────────────────
  function renderCharts() {
    if (!_rows.length) return;
    const labels = _rows.map(r => r.year);

    const COLOURS = {
      woodySP: '#4472C4', heidiSP: '#70AD47',
      woodySIPP: '#ED7D31', heidiSIPP: '#FFC000',
      woodyISA: '#5B9BD5', heidiISA: '#2E86C1',
      woodyGIA: '#A9D18E', heidiGIA: '#78C86A',
      intDraw: '#9B59B6', woodyCash: '#B0B0B0',
      salary: '#FF7F7F',
    };

    function ds(label, fn, color) {
      return { label, data: _rows.map(r => Math.round(adj(fn(r), r) / 1000)), backgroundColor: color, stack: 'income' };
    }

    let sets = [];
    if (_viewPerson === 'both' || _viewPerson === 'woody') {
      sets.push(ds('State Pension – Woody',    r => r.woodySP,          COLOURS.woodySP));
      sets.push(ds('SIPP – Woody',             r => r.woodyDrawn.SIPP,  COLOURS.woodySIPP));
      sets.push(ds('ISA – Woody',              r => r.woodyDrawn.ISA,   COLOURS.woodyISA));
      sets.push(ds('GIA – Woody',              r => r.woodyDrawn.GIA,   COLOURS.woodyGIA));
      sets.push(ds('Interest draw – Woody',    r => r.woodyIntDraw,     COLOURS.intDraw));
      sets.push(ds('Cash draw – Woody',        r => r.woodyDrawn.Cash,  COLOURS.woodyCash));
    }
    if (_viewPerson === 'both' || _viewPerson === 'heidi') {
      sets.push(ds('State Pension – Heidi',    r => r.heidiSP,          COLOURS.heidiSP));
      sets.push(ds('Salary – Heidi',           r => r.heidiSalInc,      COLOURS.salary));
      sets.push(ds('SIPP – Heidi',             r => r.heidiDrawn.SIPP,  COLOURS.heidiSIPP));
      sets.push(ds('ISA – Heidi',              r => r.heidiDrawn.ISA,   COLOURS.heidiISA));
      sets.push(ds('GIA – Heidi',              r => r.heidiDrawn.GIA,   COLOURS.heidiGIA));
      sets.push(ds('Interest draw – Heidi',    r => r.heidiIntDraw,     COLOURS.intDraw));
      sets.push(ds('Cash draw – Heidi',        r => r.heidiDrawn.Cash,  COLOURS.woodyCash));
    }

    const incCtx = document.getElementById('incomeChart')?.getContext('2d');
    if (incCtx) {
      if (_incomeChart) _incomeChart.destroy();
      _incomeChart = new Chart(incCtx, {
        type: 'bar',
        data: { labels, datasets: sets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
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
      renderIncomeLegend(_incomeChart);
    }

    const taxData  = _rows.map(r => {
      const t = _viewPerson === 'woody' ? r.woodyIncomeTax + r.woodyCGT
              : _viewPerson === 'heidi' ? r.heidiIncomeTax + r.heidiCGT
              : r.woodyIncomeTax + r.woodyCGT + r.heidiIncomeTax + r.heidiCGT;
      return Math.round(adj(t, r));
    });
    const rateData = _rows.map(r => {
      const tax = _viewPerson === 'woody' ? r.woodyIncomeTax + r.woodyCGT
                : _viewPerson === 'heidi' ? r.heidiIncomeTax + r.heidiCGT
                : r.woodyIncomeTax + r.woodyCGT + r.heidiIncomeTax + r.heidiCGT;
      const woodyGross = r.woodySP + r.woodyDrawn.SIPP + r.woodyDrawn.ISA + r.woodyDrawn.GIA + r.woodyIntDraw + r.woodyDrawn.Cash;
      const heidiGross = r.heidiSP + r.heidiSalInc + r.heidiDrawn.SIPP + r.heidiDrawn.ISA + r.heidiDrawn.GIA + r.heidiIntDraw + r.heidiDrawn.Cash;
      const gross = _viewPerson === 'woody' ? woodyGross : _viewPerson === 'heidi' ? heidiGross : woodyGross + heidiGross;
      return gross > 0 ? parseFloat((tax / gross * 100).toFixed(1)) : 0;
    });

    const taxCtx = document.getElementById('taxChart')?.getContext('2d');
    if (taxCtx) {
      if (_taxChart) _taxChart.destroy();
      _taxChart = new Chart(taxCtx, {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'Tax paid (£)', data: taxData, backgroundColor: '#4472C4', yAxisID: 'y', order: 2 },
          { label: 'Effective rate (%)', data: rateData, type: 'line', borderColor: '#E84D4D', backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2, yAxisID: 'y2', order: 1 },
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y2' ? `${ctx.dataset.label}: ${ctx.parsed.y}%` : `${ctx.dataset.label}: ${D.formatMoney(ctx.parsed.y || 0)}` } },
          },
          scales: {
            x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
            y: { position: 'left', title: { display: true, text: _useReal ? 'Real £' : 'Nominal £', font: { size: 11 } },
              ticks: { font: { size: 11 }, callback: v => D.formatMoney(v) } },
            y2: { position: 'right', grid: { drawOnChartArea: false },
              title: { display: true, text: 'Effective rate %', font: { size: 11 } },
              ticks: { font: { size: 11 }, callback: v => v + '%' }, min: 0 },
          },
        },
      });
    }

    _renderWealthChart(labels);
  }

  function _renderWealthChart(labels) {
    function wds(label, fn, color) {
      return { label, data: _rows.map(r => Math.round(adj(fn(r.snap), r) / 1000)), backgroundColor: color, stack: 'wealth' };
    }
    const datasets = [];
    if (_viewPerson === 'both' || _viewPerson === 'woody') {
      datasets.push(wds('SIPP – Woody',            s => s.woodySIPP,        '#E84D4D'));
      datasets.push(wds('ISA – Woody',             s => s.woodyISA,         '#4472C4'));
      datasets.push(wds('GIA – Woody',             s => s.woodyGIA,         '#FFC000'));
      datasets.push(wds('Interest accts – Woody',  s => s.woodyIntBal || 0, '#9B59B6'));
      datasets.push(wds('Cash – Woody',            s => s.woodyCash,        '#B0B0B0'));
    }
    if (_viewPerson === 'both' || _viewPerson === 'heidi') {
      datasets.push(wds('SIPP – Heidi',            s => s.heidiSIPP,        '#FF8C8C'));
      datasets.push(wds('ISA – Heidi',             s => s.heidiISA,         '#5B9BD5'));
      datasets.push(wds('GIA – Heidi',             s => s.heidiGIA,         '#FFD966'));
      datasets.push(wds('Interest accts – Heidi',  s => s.heidiIntBal || 0, '#C39BD3'));
      datasets.push(wds('Cash – Heidi',            s => s.heidiCash,        '#D0D0D0'));
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

    // Tax table
    const taxTbl = document.getElementById('tax-table');
    if (taxTbl) {
      let cumTax = 0;
      let grandWI = 0, grandWC = 0, grandHI = 0, grandHC = 0, grandBni = 0;
      let body = '<tbody>';
      _rows.forEach(r => {
        const wi = a(r.woodyIncomeTax, r), wc = a(r.woodyCGT, r);
        const hi = a(r.heidiIncomeTax, r), hc = a(r.heidiCGT, r);
        const bc = a(r.bniCGTBill || 0, r);
        const wt = wi + wc, ht = hi + hc, hh = wt + ht + bc;
        cumTax += hh;
        grandWI += wi; grandWC += wc; grandHI += hi; grandHC += hc; grandBni += bc;
        body += `<tr>
          <td>${r.year}</td><td>${r.woodyAge}</td><td>${r.heidiAge}</td>
          <td>${f(wi)}</td><td>${f(wc)}</td><td>${f(wt)}</td>
          <td>${f(hi)}</td><td>${f(hc)}</td><td>${f(ht)}</td>
          <td>${f(bc)}</td><td>${f(hh)}</td><td>${f(cumTax)}</td>
        </tr>`;
      });
      const grand = grandWI + grandWC + grandHI + grandHC + grandBni;
      body += `<tr class="total-row">
        <td colspan="3">Total</td>
        <td>${f(grandWI)}</td><td>${f(grandWC)}</td><td>${f(grandWI+grandWC)}</td>
        <td>${f(grandHI)}</td><td>${f(grandHC)}</td><td>${f(grandHI+grandHC)}</td>
        <td>${f(grandBni)}</td><td>${f(grand)}</td><td>${f(grand)}</td>
      </tr></tbody>`;
      taxTbl.innerHTML = `<thead><tr>
        <th>Year</th><th>Woody age</th><th>Heidi age</th>
        <th>Woody income tax</th><th>Woody CGT</th><th>Woody total</th>
        <th>Heidi income tax</th><th>Heidi CGT</th><th>Heidi total</th>
        <th>B&amp;ISA CGT</th><th>Household tax</th><th>Cumulative tax</th>
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
        const wTotal = av((s.woodyCash||0)+(s.woodyIntBal||0)+(s.woodyGIA||0)+(s.woodySIPP||0)+(s.woodyISA||0)
                         +(s.heidiCash||0)+(s.heidiIntBal||0)+(s.heidiGIA||0)+(s.heidiSIPP||0)+(s.heidiISA||0));
        body += `<tr>
          <td>${r.year}</td><td>${r.woodyAge}</td><td>${r.heidiAge}</td>
          ${cell(s.woodyCash)}${cell(s.woodyIntBal||0)}${cell(s.woodyGIA)}${cell(s.woodySIPP)}${cell(s.woodyISA)}
          ${cell(s.heidiCash)}${cell(s.heidiIntBal||0)}${cell(s.heidiGIA)}${cell(s.heidiSIPP)}${cell(s.heidiISA)}
          <td>${f(wTotal)}</td>
        </tr>`;
      });
      body += '</tbody>';
      wTbl.innerHTML = `<thead><tr>
        <th>Year</th><th>Woody age</th><th>Heidi age</th>
        <th>Woody Cash</th><th>Woody Interest</th><th>Woody GIA</th><th>Woody SIPP</th><th>Woody ISA</th>
        <th>Heidi Cash</th><th>Heidi Interest</th><th>Heidi GIA</th><th>Heidi SIPP</th><th>Heidi ISA</th>
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
