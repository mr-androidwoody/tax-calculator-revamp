(function () {
  const D  = window.RetireData;
  const C  = window.RetireCalc;
  const R  = window.RetireRender;
  const E  = window.RetireEngine;
  const CR = window.RetireCalcRender;

  const STORAGE_KEY = 'rukRetirementSetup';

  const state = {
    portfolioAccounts: [],
    nextId: 1,
    interestAccounts: [],
  };

  // ─────────────────────────────
  // SAFE HELPERS
  // ─────────────────────────────
  function safeEl(id)    { return document.getElementById(id); }
  function safeValue(id) { const el = safeEl(id); return el ? el.value : ''; }
  function safeNumber(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

  function formatCurrency(val) {
    return D?.formatCurrency ? D.formatCurrency(val) : (val || 0).toLocaleString('en-GB');
  }

  // ─────────────────────────────
  // TOAST
  // ─────────────────────────────
  function showToast(msg, isError) {
    let toast = safeEl('rup-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rup-toast';
      Object.assign(toast.style, {
        position: 'fixed', bottom: '24px', right: '24px',
        padding: '10px 18px', borderRadius: '6px',
        fontFamily: 'sans-serif', fontSize: '14px', color: '#fff',
        zIndex: 9999, opacity: 0, transition: 'opacity 0.2s ease', pointerEvents: 'none',
      });
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.background = isError ? '#c0392b' : '#27ae60';
    toast.style.opacity = 1;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = 0; }, 2500);
  }

  // ─────────────────────────────
  // DOM → STATE
  // ─────────────────────────────
  function syncAccountsFromDOM() {
    const rows   = document.querySelectorAll('#acct-tbody tr');
    const updated = [];
    rows.forEach((row) => {
      const id  = Number(row.id.replace('acct-row-', ''));
      const get = field => row.querySelector(`[data-field="${field}"]`);
      updated.push({
        id,
        name:    get('name')?.value    || '',
        wrapper: get('wrapper')?.value || 'GIA',
        owner:   get('owner')?.value   || 'p1',
        value:   safeNumber(D.parseCurrency(get('value')?.value || 0)),
        alloc: {
          equities: safeNumber(get('equities')?.value),
          bonds:    safeNumber(get('bonds')?.value),
          cashlike: safeNumber(get('cashlike')?.value),
          cash:     safeNumber(get('cash')?.value),
        },
        rate:        get('rate')?.value        ? safeNumber(get('rate').value)                       : null,
        monthlyDraw: get('monthlyDraw')?.value ? safeNumber(D.parseCurrency(get('monthlyDraw').value)) : null,
      });
    });
    state.portfolioAccounts = updated;
  }

  // ─────────────────────────────
  // SETUP STATE
  // ─────────────────────────────
  function readSetupInputs() {
    return {
      version: 1,
      people: {
        p1: { name: safeValue('sp-p1name').trim(), age: safeNumber(safeValue('sp-p1age')) },
        p2: { name: safeValue('sp-p2name').trim(), age: safeNumber(safeValue('sp-p2age')) },
      },
      accounts: state.portfolioAccounts,
    };
  }

  function applySetupInputs(data) {
    if (!data) return;
    if (safeEl('sp-p1name')) safeEl('sp-p1name').value = data.people?.p1?.name || '';
    if (safeEl('sp-p1age'))  safeEl('sp-p1age').value  = data.people?.p1?.age  || '';
    if (safeEl('sp-p2name')) safeEl('sp-p2name').value = data.people?.p2?.name || '';
    if (safeEl('sp-p2age'))  safeEl('sp-p2age').value  = data.people?.p2?.age  || '';

    state.portfolioAccounts = data.accounts || [];
    state.nextId = Math.max(1, ...state.portfolioAccounts.map(a => a.id || 0)) + 1;

    const tbody = safeEl('acct-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const ownerNames = getOwnerNames();
    state.portfolioAccounts.forEach(acc => {
      R.renderAccountRow(acc, ownerNames);
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });
    refreshSetupSummary();
  }

  // ─────────────────────────────
  // OWNER NAMES
  // ─────────────────────────────
  function getOwnerNames() {
    return [
      safeValue('sp-p1name').trim() || 'Person 1',
      safeValue('sp-p2name').trim() || 'Person 2',
    ];
  }

  // ─────────────────────────────
  // SAVE / LOAD
  // ─────────────────────────────
  function saveSetup() {
    syncAccountsFromDOM();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readSetupInputs()));
      showToast('Setup saved ✓');
    } catch (err) {
      console.error(err);
      showToast('Save failed – see console', true);
    }
  }

  function loadSetup() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return showToast('No saved setup found.', true);
    try {
      applySetupInputs(JSON.parse(raw));
      showToast('Setup loaded ✓');
    } catch (err) {
      console.error(err);
      showToast('Load failed – see console', true);
    }
  }

  // ─────────────────────────────
  // PRELOAD
  // ─────────────────────────────
  function preloadSetup() {
    state.portfolioAccounts = [];
    state.nextId = 1;
    const tbody = safeEl('acct-tbody');
    if (tbody) tbody.innerHTML = '';
    const ownerNames = getOwnerNames();
    D.PRELOAD_ACCOUNTS.forEach(a => {
      const acc = { id: state.nextId++, ...a, alloc: { ...a.alloc } };
      state.portfolioAccounts.push(acc);
      R.renderAccountRow(acc, ownerNames);
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });
    refreshSetupSummary();
    showToast('Preloaded ✓');
  }

  function preloadCalc() {
    Object.entries(D.PRELOAD).forEach(([k, val]) => {
      const el = safeEl(k);
      if (!el) return;
      el.value = D.MONEY_FIELDS.has(k) && val !== '' ? formatCurrency(val) : val;
    });
    const tm = safeEl('thresholdFrozen');
    if (tm) tm.checked = true;
    const bniCb = safeEl('bniEnabled');
    if (bniCb) {
      bniCb.checked = true;
      const f = safeEl('bni-fields');
      if (f) f.style.display = '';
    }
  }

  // ─────────────────────────────
  // ACCOUNTS
  // ─────────────────────────────
  function addAccount() {
    const acc = {
      id: state.nextId++, name: '', wrapper: 'GIA', owner: 'p1', value: 0,
      alloc: { equities: 100, bonds: 0, cashlike: 0, cash: 0 }, rate: null, monthlyDraw: null,
    };
    state.portfolioAccounts.push(acc);
    R.renderAccountRow(acc, getOwnerNames());
    R.updateRowBadge(acc);
    R.applyWrapperFieldState(acc);
    refreshSetupSummary();
  }

  function removeAccount(el) {
    const row = el.closest('tr');
    if (row) row.remove();
    syncAccountsFromDOM();
    refreshSetupSummary();
  }

  // ─────────────────────────────
  // SUMMARY
  // ─────────────────────────────
  function refreshSetupSummary() {
    CR && CR.setResults && CR.setResults([]); // clear any stale results on setup changes
    const summary = C.summarisePortfolio(state.portfolioAccounts);
    R.renderSetupSummary(summary);
  }

  // ─────────────────────────────
  // HANDOFF: setup → calculator
  // ─────────────────────────────
  function continueToMain() {
    syncAccountsFromDOM();
    const data   = readSetupInputs();
    const p1name = data.people.p1.name || 'Woody';
    const p2name = data.people.p2.name || 'Heidi';

    const sumBy = (owner, wrapper) =>
      state.portfolioAccounts
        .filter(a => a.owner === owner && a.wrapper === wrapper)
        .reduce((s, a) => s + (a.value || 0), 0);

    const set = (id, val) => {
      const el = safeEl(id);
      if (!el) return;
      el.value = (val === undefined || val === null || val === '')
        ? '' : D.MONEY_FIELDS.has(id) ? formatCurrency(val) : val;
    };

    set('woodySIPP', sumBy('p1', 'SIPP'));
    set('heidiSIPP', sumBy('p2', 'SIPP'));
    set('woodyISA',  sumBy('p1', 'ISA'));
    set('heidiISA',  sumBy('p2', 'ISA'));
    set('woodyCash', sumBy('p1', 'Cash'));
    set('heidiCash', sumBy('p2', 'Cash'));

    // Plain GIA only (accounts without a rate); interest-bearing GIA handled separately
    set('woodyGIA', state.portfolioAccounts
      .filter(a => a.owner === 'p1' && a.wrapper === 'GIA' && !a.rate)
      .reduce((s, a) => s + (a.value || 0), 0));
    set('heidiGIA', state.portfolioAccounts
      .filter(a => a.owner === 'p2' && a.wrapper === 'GIA' && !a.rate)
      .reduce((s, a) => s + (a.value || 0), 0));

    // Build interest accounts list for engine (owner mapped to display name)
    state.interestAccounts = state.portfolioAccounts
      .filter(a => a.wrapper === 'GIA' && a.rate)
      .map(a => ({ ...a, balance: a.value || 0, owner: a.owner === 'p1' ? p1name : p2name }));

    // Banner
    const total  = state.portfolioAccounts.reduce((s, a) => s + (a.value || 0), 0);
    const nAccts = state.portfolioAccounts.length;
    let banner   = safeEl('handoff-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'handoff-banner';
      banner.style.cssText = 'background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:8px 10px;font-size:12px;color:#166534;margin:0 0 0.75rem';
      const sidebarBody = document.querySelector('#main-app .sidebar-body');
      if (sidebarBody) sidebarBody.prepend(banner);
    }
    banner.innerHTML = `✓ Portfolio loaded: ${nAccts} accounts, ${D.formatMoney(total)} total`;

    R.updateInterestAccountsBanner(state.interestAccounts, [p1name, p2name]);

    safeEl('setup-page').style.display = 'none';
    safeEl('main-app').style.display   = '';
  }

  // ─────────────────────────────
  // SIDEBAR COLLAPSIBLES
  // ─────────────────────────────
  function toggleSection(titleEl) {
    const body    = titleEl.nextElementSibling;
    const chevron = titleEl.querySelector('.section-chevron');
    const nowCollapsed = body.classList.toggle('collapsed');
    if (chevron) chevron.textContent = nowCollapsed ? '▸' : '▾';
    syncExpandBtn();
  }

  function syncExpandBtn() {
    const btn = safeEl('expand-all-btn');
    if (!btn) return;
    const allOpen = [...document.querySelectorAll('[data-collapsible] .section-body')]
      .every(b => !b.classList.contains('collapsed'));
    btn.textContent = allOpen ? 'Close all' : 'Expand all';
  }

  function toggleAllSections() {
    const bodies  = [...document.querySelectorAll('[data-collapsible] .section-body')];
    const allOpen = bodies.every(b => !b.classList.contains('collapsed'));
    bodies.forEach(b => {
      const chevron = b.previousElementSibling?.querySelector('.section-chevron');
      if (allOpen) { b.classList.add('collapsed');    if (chevron) chevron.textContent = '▸'; }
      else         { b.classList.remove('collapsed'); if (chevron) chevron.textContent = '▾'; }
    });
    syncExpandBtn();
  }

  // ─────────────────────────────
  // RUN PROJECTION
  // ─────────────────────────────
  function runProjection() {
    const result = E.runProjection(state.interestAccounts);
    if (!result) return;
    CR.setResults(result.rows);
    CR.renderAlerts(result.depletions);
    CR.renderMetrics();
    CR.renderCharts();
  }

  // ─────────────────────────────
  // CURRENCY FORMATTING
  // ─────────────────────────────
  document.addEventListener('focusin', (e) => {
    if (!e.target.matches('.currency-input')) return;
    if (String(e.target.value).trim() === '') return;
    e.target.value = String(Math.round(D.parseCurrency(e.target.value)));
  });
  document.addEventListener('focusout', (e) => {
    if (!e.target.matches('.currency-input')) return;
    R.applyCurrencyFormattingToInput(e.target);
  });

  // ─────────────────────────────
  // GLOBAL CLICK DISPATCHER
  // ─────────────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'add-account')    return addAccount();
    if (action === 'remove-account') return removeAccount(el);
    if (action === 'save-setup')     return saveSetup();
    if (action === 'load-setup')     return loadSetup();
    if (action === 'preload-setup')  return preloadSetup();
    if (action === 'preload-calc')   return preloadCalc();
    if (action === 'run-projection') return runProjection();
    if (action === 'toggle-section') return toggleSection(el);
    if (action === 'toggle-all')     return toggleAllSections();

    if (action === 'continue-to-main') return continueToMain();
    if (action === 'back-to-setup') {
      safeEl('setup-page').style.display = '';
      safeEl('main-app').style.display   = 'none';
    }

    if (action === 'view-both')  return CR.setView('both',  el);
    if (action === 'view-woody') return CR.setView('woody', el);
    if (action === 'view-heidi') return CR.setView('heidi', el);
    if (action === 'real-on')    return CR.setReal(true,  el);
    if (action === 'real-off')   return CR.setReal(false, el);
    if (action === 'tab-charts') return CR.setTab('charts', el);
    if (action === 'tab-tables') return CR.setTab('tables', el);
  });

  // BNI checkbox (not a button, so not caught by click dispatcher)
  document.addEventListener('change', (e) => {
    if (e.target.id === 'bniEnabled') {
      const f = safeEl('bni-fields');
      if (f) f.style.display = e.target.checked ? '' : 'none';
    }
  });

  // ─────────────────────────────
  // INIT
  // ─────────────────────────────
  refreshSetupSummary();
  R.initialiseCurrencyInputs();
})();
