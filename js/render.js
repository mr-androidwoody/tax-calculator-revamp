(function () {
  const D = window.RetireData;

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

    const idMap = { equities: 'alloc-eq-pct', bonds: 'alloc-bd-pct', cashlike: 'alloc-cl-pct', cash: 'alloc-c-pct' };
    Object.entries(idMap).forEach(([cls, id]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (summary.overallAllocation[cls] || 0).toFixed(1) + '%';
    });

    const lbl = document.getElementById('alloc-total-label');
    if (lbl) {
      const pct = Math.round(summary.overallPct);
      lbl.textContent = pct === 100 ? '100.0% Balanced' : summary.overallPct.toFixed(1) + '%';
      lbl.style.color = pct === 100 ? '#16a34a' : '#a16207';
    }
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

  // Rate % and Monthly Draw are only available for accounts that have a
  // cashlike allocation > 0. Wrapper type is irrelevant — it's the presence
  // of cashlike instruments that determines whether interest/draw makes sense.
  function _isCashlikeless(acc) {
    return !((acc.alloc?.cashlike || 0) > 0);
  }

  function renderAccountRow(acc, ownerNames) {
    const tbody = document.getElementById('acct-tbody');
    const tr = document.createElement('tr');
    tr.id = 'acct-row-' + acc.id;

    const fixed      = D.FIXED_CASH_WRAPPERS.has(acc.wrapper);
    const noInterest = _isCashlikeless(acc);

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

    // Rate and draw are cleared and disabled when cashlike % is zero.
    const rateValue          = noInterest ? '' : (acc.rate ?? '');
    const drawValue          = noInterest ? '' : (acc.monthlyDraw != null ? D.formatCurrency(acc.monthlyDraw) : '');
    const interestDisabledAttr = noInterest ? 'disabled style="opacity:0.35"' : '';

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
          value="${rateValue}" placeholder="–"
          data-account-id="${acc.id}" data-field="rate"
          ${interestDisabledAttr}>
      </td>

      <td class="col-draw">
        <input type="text" inputmode="numeric" data-currency-input="true"
          data-account-id="${acc.id}" data-field="monthlyDraw"
          value="${drawValue}" placeholder="–"
          ${interestDisabledAttr}>
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
        el.innerHTML = `
          <div class="status status-ok">
            <span class="total-badge">100%</span>
            <span class="status-label">Ready</span>
          </div>
        `;
        return;
      }
    
      if (pct > 100) {
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

  // Recomputes field states for a single account row based on current values.
  // Called after any change that could affect rate/draw availability
  // (cashlike % edit) or alloc disabled state (wrapper change).
  function applyWrapperFieldState(acc) {
    const row = document.getElementById('acct-row-' + acc.id);
    if (!row) return;

    // Alloc % inputs — disabled for fixed Cash wrappers
    const fixed = D.FIXED_CASH_WRAPPERS.has(acc.wrapper);
    D.ALLOC_CLASSES.forEach((cls) => {
      const inp = row.querySelector(`[data-field="${cls}"]`);
      if (!inp) return;
      inp.disabled = fixed;
    });

    // Rate and monthly draw — enabled only when cashlike % > 0
    const noInterest = _isCashlikeless(acc);
    const rateInp = row.querySelector('[data-field="rate"]');
    const drawInp = row.querySelector('[data-field="monthlyDraw"]');

    if (rateInp) {
      rateInp.disabled      = noInterest;
      rateInp.style.opacity = noInterest ? '0.35' : '';
      if (noInterest) rateInp.value = '';
    }
    if (drawInp) {
      drawInp.disabled      = noInterest;
      drawInp.style.opacity = noInterest ? '0.35' : '';
      if (noInterest) drawInp.value = '';
    }
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
