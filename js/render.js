(function () {
  const D = window.RetireData;

  function ensureCurrencyInput(el) {
    if (el) el.classList.add('currency-input');
  }

  function initialiseCurrencyInputs() {
    D.MONEY_FIELDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('currency-input');
    });
    document.querySelectorAll('[data-currency-input="true"]').forEach((el) => {
      el.classList.add('currency-input');
    });
  }

  function applyCurrencyFormattingToInput(el) {
    if (!el) return;
    const raw = el.value;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      el.value = '';
      return;
    }
    const parsed = D.parseCurrency(raw);
    el.value = D.formatCurrency(parsed);
  }

  function renderSetupSummary(summary) {
    document.getElementById('sp-total').textContent = D.formatMoney(summary.total);

    D.WRAPPERS.forEach((w) => {
      const el = document.getElementById('wt-' + w);
      if (el) el.textContent = D.formatMoney(summary.wrapperTotals[w] || 0);
    });

    const rows = document.querySelectorAll('#alloc-summary .alloc-row');
    const classes = ['equities', 'bonds', 'cashlike', 'cash'];
    const colors = ['#4472C4', '#70AD47', '#FFC000', '#B0B0B0'];

    classes.forEach((cls, i) => {
      const weighted = summary.overallAllocation[cls] || 0;
      const row = rows[i];
      if (!row) return;

      row.querySelector('.alloc-pct').textContent = weighted.toFixed(1) + '%';
      row.querySelector('.alloc-bar').style.width = weighted.toFixed(1) + '%';
      row.querySelector('.alloc-bar').style.background = colors[i];
    });

    const lbl = document.getElementById('alloc-total-label');
    const pct = Math.round(summary.overallPct);
    lbl.textContent = pct === 100 ? '100.0% Balanced' : summary.overallPct.toFixed(1) + '%';
    lbl.style.color = pct === 100 ? '#16a34a' : '#a16207';
  }

  function updateInterestAccountsBanner(interestAccounts, ownerNames) {
    const banner = document.getElementById('interest-accounts-banner');
    if (!banner) return;

    if (!interestAccounts || !interestAccounts.length) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }

    banner.style.display = '';
    banner.style.cssText =
      'display:block;background:#f8faff;border:1px solid #dbe7ff;border-radius:6px;padding:8px 10px;font-size:12px;color:#334155';

    banner.innerHTML = interestAccounts
      .map((a) => {
        const rate = a.rate != null ? a.rate + '%' : '–';
        const draw = a.monthlyDraw != null ? D.formatMoney(a.monthlyDraw) + '/mo' : '–';

        const ownerLabel = a.owner === 'p1' ? ownerNames[0] : ownerNames[1];

        return `<div style="margin-bottom:4px">
          <strong>${a.name}</strong> (${ownerLabel}, ${a.wrapper})
          – rate ${rate}, draw ${draw}, balance ${D.formatMoney(a.balance || 0)}
        </div>`;
      })
      .join('');
  }

  function renderAccountRow(acc, ownerNames) {
    const tbody = document.getElementById('acct-tbody');
    const tr = document.createElement('tr');
    tr.id = 'acct-row-' + acc.id;

    const fixed = D.FIXED_CASH_WRAPPERS.has(acc.wrapper);

    const wrapperOptions = D.WRAPPERS.map(
      (w) => `<option value="${w}" ${acc.wrapper === w ? 'selected' : ''}>${w}</option>`
    ).join('');

    const ownerOptions = [
      { id: 'p1', name: ownerNames[0] },
      { id: 'p2', name: ownerNames[1] },
    ]
      .map(
        (o) =>
          `<option value="${o.id}" ${acc.owner === o.id ? 'selected' : ''}>${o.name}</option>`
      )
      .join('');

    const allocInputs = D.ALLOC_CLASSES.map(
      (cls) => `
      <td class="col-alloc">
        <input type="number" min="0" max="100" step="1"
          data-account-id="${acc.id}"
          data-field="${cls}"
          value="${acc.alloc[cls]}"
          ${fixed ? 'disabled' : ''}>
      </td>
    `
    ).join('');

    tr.innerHTML = `
      <td class="col-name">
        <input type="text" value="${acc.name}" placeholder="Account name"
          data-account-id="${acc.id}" data-field="name">
      </td>

      <td class="col-wrap">
        <select data-account-id="${acc.id}" data-field="wrapper">${wrapperOptions}</select>
      </td>

      <td class="col-owner">
        <select data-account-id="${acc.id}" data-field="owner">${ownerOptions}</select>
      </td>

      <td class="col-value">
        <input type="text" inputmode="numeric" data-currency-input="true"
          data-account-id="${acc.id}" data-field="value"
          value="${acc.value ? D.formatCurrency(acc.value) : ''}" placeholder="0">
      </td>

      ${allocInputs}

      <td class="col-rate">
        <input type="number" min="0" max="20" step="0.01"
          value="${acc.rate ?? ''}" placeholder="–"
          data-account-id="${acc.id}" data-field="rate">
      </td>

      <td class="col-draw">
        <input type="text" inputmode="numeric" data-currency-input="true"
          data-account-id="${acc.id}" data-field="monthlyDraw"
          value="${
            acc.monthlyDraw != null ? D.formatCurrency(acc.monthlyDraw) : ''
          }" placeholder="–">
      </td>

      <td class="col-total" id="badge-${acc.id}"></td>

      <td class="col-action">
        <button type="button" class="btn-remove"
          data-action="remove-account"
          data-account-id="${acc.id}">
          Remove
        </button>
      </td>
    `;

    tbody.appendChild(tr);
    initialiseCurrencyInputs();
  }

  function updateRowBadge(acc) {
    const el = document.getElementById('badge-' + acc.id);
    if (!el) return;

    const total = D.ALLOC_CLASSES.reduce((s, c) => s + (acc.alloc[c] || 0), 0);
    const pct = Math.round(total);

    let cls = 'total-warn';
    let label = pct + '%';

    if (pct === 100) {
      cls = 'total-ok';
      label = '100%<br><span style="font-weight:400;font-size:10px">Ready</span>';
    } else if (pct > 100) {
      cls = 'total-err';
    }

    el.innerHTML = `<span class="total-badge ${cls}">${label}</span>`;
  }

  function refreshOwnerOptions(accounts, ownerNames) {
    accounts.forEach((acc) => {
      const row = document.getElementById('acct-row-' + acc.id);
      if (!row) return;

      const select = row.querySelector('select[data-field="owner"]');
      if (!select) return;

      select.innerHTML = [
        { id: 'p1', name: ownerNames[0] },
        { id: 'p2', name: ownerNames[1] },
      ]
        .map(
          (o) =>
            `<option value="${o.id}" ${acc.owner === o.id ? 'selected' : ''}>${o.name}</option>`
        )
        .join('');
    });
  }

  function applyWrapperFieldState(acc) {
    const row = document.getElementById('acct-row-' + acc.id);
    if (!row) return;

    const fixed = D.FIXED_CASH_WRAPPERS.has(acc.wrapper);

    D.ALLOC_CLASSES.forEach((cls) => {
      const inp = row.querySelector(`[data-field="${cls}"]`);
      if (!inp) return;
      inp.disabled = fixed;
    });
  }

  window.RetireRender = {
    renderSetupSummary,
    renderAccountRow,
    updateRowBadge,
    refreshOwnerOptions,
    applyWrapperFieldState,
    updateInterestAccountsBanner,
    initialiseCurrencyInputs,
    applyCurrencyFormattingToInput,
  };
})();