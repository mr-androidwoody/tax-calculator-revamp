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
    activeTab: 'setup',
    p2enabled: true,
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
      p2enabled: state.p2enabled,
      people: {
        p1: { name: safeValue('sp-p1name').trim(), dob: safeNumber(safeValue('sp-p1dob')) },
        p2: { name: safeValue('sp-p2name').trim(), dob: safeNumber(safeValue('sp-p2dob')) },
      },
      startYear: safeNumber(safeValue('sp-startYear')),
      endYear:   safeNumber(safeValue('sp-endYear')),
      accounts: state.portfolioAccounts,
    };
  }

  function applySetupInputs(data) {
    if (!data) return;
    if (safeEl('sp-p1name'))    safeEl('sp-p1name').value    = data.people?.p1?.name || '';
    if (safeEl('sp-p1dob'))     safeEl('sp-p1dob').value     = data.people?.p1?.dob  || '';
    if (safeEl('sp-p2name'))    safeEl('sp-p2name').value    = data.people?.p2?.name || '';
    if (safeEl('sp-p2dob'))     safeEl('sp-p2dob').value     = data.people?.p2?.dob  || '';
    if (safeEl('sp-startYear')) safeEl('sp-startYear').value = data.startYear || '';
    if (safeEl('sp-endYear'))   safeEl('sp-endYear').value   = data.endYear   || '';

    // Restore p2 toggle state
    state.p2enabled = data.p2enabled !== false; // default true if not saved
    const p2cb = safeEl('p2enabled');
    if (p2cb) p2cb.checked = state.p2enabled;
    applyP2State();

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
  // SIDEBAR NAME SYNC
  // ─────────────────────────────
  function updateSidebarNames() {
    const p1 = safeValue('sp-p1name').trim() || 'Person 1';
    const p2 = safeValue('sp-p2name').trim() || 'Person 2';

    // [data-p1="suffix"] → "{p1} suffix"
    document.querySelectorAll('[data-p1]').forEach(el => {
      const suffix = el.getAttribute('data-p1');
      el.textContent = suffix ? `${p1} ${suffix}` : p1;
    });
    document.querySelectorAll('[data-p2]').forEach(el => {
      const suffix = el.getAttribute('data-p2');
      el.textContent = suffix ? `${p2} ${suffix}` : p2;
    });

    // Step-down label and hint
    document.querySelectorAll('[data-p1-stepdown]').forEach(el => {
      el.textContent = `Reduce spending from ${p1}'s age 75 by`;
    });
    document.querySelectorAll('[data-p1-stepdown-hint]').forEach(el => {
      el.textContent = `Reduces the gross spending target from the year ${p1} turns 75.`;
    });

    // View toggle buttons
    document.querySelectorAll('[data-p1-btn]').forEach(el => { el.textContent = p1; });
    document.querySelectorAll('[data-p2-btn]').forEach(el => { el.textContent = p2; });
  }

  // ─────────────────────────────
  // P2 TOGGLE
  // ─────────────────────────────

  // All field IDs that belong to Person 2 in the Assumptions tab.
  const P2_FIELD_IDS = [
    'p2DOB',
    'p2Salary', 'p2SalaryStopAge',
    'p2SPAge', 'p2SP',
    'p2Cash',
    'p2SIPP',
    'p2ISA',
    'p2GIA',
    'p2Order1', 'p2Order2', 'p2Order3',
    'bniP2GIA',
  ];

  function applyP2State() {
    const enabled = state.p2enabled;

    // ── Assumptions tab: individual named inputs ──
    P2_FIELD_IDS.forEach(id => {
      const el = safeEl(id);
      if (!el) return;
      el.disabled = !enabled;
      el.style.opacity = enabled ? '' : '0.45';
    });

    // ── Assumptions tab: .p2-field containers (labels, subsection headers, order-rows) ──
    document.querySelectorAll('.p2-field').forEach(el => {
      el.classList.toggle('p2-disabled', !enabled);
    });

    // ── Setup tab: Person 2 name/dob inputs ──
    const p2setup = safeEl('p2-setup-fields');
    if (p2setup) {
      p2setup.classList.toggle('p2-disabled', !enabled);
      p2setup.querySelectorAll('input').forEach(inp => {
        inp.disabled = !enabled;
      });
    }

    // ── Accounts table: rows owned by p2 ──
    document.querySelectorAll('#acct-tbody tr').forEach(row => {
      const ownerSel = row.querySelector('[data-field="owner"]');
      if (!ownerSel) return;
      if (ownerSel.value === 'p2') {
        row.classList.toggle('p2-disabled', !enabled);
        row.querySelectorAll('input, select').forEach(inp => {
          inp.disabled = !enabled;
        });
      }
    });
  }

  // ─────────────────────────────
  // HANDOFF: setup → assumptions
  // ─────────────────────────────
  function syncSetupToAssumptions() {
    syncAccountsFromDOM();
    const data   = readSetupInputs();
    const p1name = data.people.p1.name || 'Person 1';
    const p2name = data.people.p2.name || 'Person 2';

    const isYieldAccount = a => a.rate != null || a.monthlyDraw != null;

    const sumBy = (owner, wrapper, excludeYield = false) =>
      state.portfolioAccounts
        .filter(a =>
          a.owner === owner &&
          a.wrapper === wrapper &&
          (!excludeYield || !isYieldAccount(a))
        )
        .reduce((s, a) => s + (a.value || 0), 0);

    // ── Helper: set a plain-text span ──
    const setText = (id, val) => {
      const el = safeEl(id);
      if (el) el.textContent = (val === undefined || val === null || val === '') ? '–' : val;
    };

    // ── Helper: set a hidden input (for gatherInputs()) ──
    const setHidden = (id, val) => {
      const el = safeEl(id);
      if (!el) return;
      el.value = (val === undefined || val === null || val === '')
        ? '' : D.MONEY_FIELDS.has(id) ? String(Math.round(Number(val) || 0)) : val;
    };

    // ── Card 1: People & Projection ──
    const p1dob  = safeValue('sp-p1dob');
    const p2dob  = safeValue('sp-p2dob');
    const sy     = safeValue('sp-startYear');
    const ey     = safeValue('sp-endYear');

    // Find salary/SP for each person from setup inputs
    const p1sal      = D.parseCurrency(safeEl('p1Salary')?.value      || '');
    const p1salstop  = safeEl('p1SalaryStopAge')?.value || '–';
    const p1spage    = safeEl('p1SPAge')?.value          || '–';
    const p1sp       = D.parseCurrency(safeEl('p1SP')?.value           || '');
    const p2sal      = D.parseCurrency(safeEl('p2Salary')?.value      || '');
    const p2salstop  = safeEl('p2SalaryStopAge')?.value || '–';
    const p2spage    = safeEl('p2SPAge')?.value          || '–';
    const p2sp       = D.parseCurrency(safeEl('p2SP')?.value           || '');

    setText('ai-p1name',      p1name);
    setText('ai-p1dob',       p1dob  || '–');
    setText('ai-p1salary',    p1sal  ? D.formatMoney(p1sal)  : '–');
    setText('ai-p1salarystop', p1salstop);
    setText('ai-p1spage',     p1spage);
    setText('ai-p1sp',        p1sp   ? D.formatMoney(p1sp)   : '–');

    setText('ai-p2name',      p2name);
    setText('ai-p2dob',       p2dob  || '–');
    setText('ai-p2salary',    p2sal  ? D.formatMoney(p2sal)  : '–');
    setText('ai-p2salarystop', p2salstop);
    setText('ai-p2spage',     p2spage);
    setText('ai-p2sp',        p2sp   ? D.formatMoney(p2sp)   : '–');

    setText('ai-startyear', sy || '–');
    setText('ai-endyear',   ey || '–');

    // Hidden inputs consumed by gatherInputs()
    setHidden('p1DOB',          p1dob);
    setHidden('p2DOB',          p2dob);
    setHidden('startYear',      sy);
    setHidden('endYear',        ey);
    setHidden('p1Salary',       p1sal);
    setHidden('p1SalaryStopAge', p1salstop !== '–' ? p1salstop : '');
    setHidden('p1SPAge',        p1spage !== '–' ? p1spage : '');
    setHidden('p1SP',           p1sp);
    setHidden('p2Salary',       p2sal);
    setHidden('p2SalaryStopAge', p2salstop !== '–' ? p2salstop : '');
    setHidden('p2SPAge',        p2spage !== '–' ? p2spage : '');
    setHidden('p2SP',           p2sp);

    // ── Card 3: Portfolio Balances ──
    const p1cash = sumBy('p1', 'Cash');
    const p2cash = sumBy('p2', 'Cash');
    const p1sipp = sumBy('p1', 'SIPP');
    const p2sipp = sumBy('p2', 'SIPP');
    const p1isa  = sumBy('p1', 'ISA');
    const p2isa  = sumBy('p2', 'ISA');
    const p1gia  = sumBy('p1', 'GIA', true);
    const p2gia  = sumBy('p2', 'GIA', true);

    setText('ai-p1cash', D.formatMoney(p1cash));
    setText('ai-p1sipp', D.formatMoney(p1sipp));
    setText('ai-p1isa',  D.formatMoney(p1isa));
    setText('ai-p1gia',  D.formatMoney(p1gia));
    setText('ai-p2cash', D.formatMoney(p2cash));
    setText('ai-p2sipp', D.formatMoney(p2sipp));
    setText('ai-p2isa',  D.formatMoney(p2isa));
    setText('ai-p2gia',  D.formatMoney(p2gia));

    // Hidden inputs for gatherInputs()
    setHidden('p1Cash', p1cash);
    setHidden('p2Cash', p2cash);
    setHidden('p1SIPP', p1sipp);
    setHidden('p2SIPP', p2sipp);
    setHidden('p1ISA',  p1isa);
    setHidden('p2ISA',  p2isa);
    setHidden('p1GIA',  p1gia);
    setHidden('p2GIA',  p2gia);

    // ── Interest accounts list (Card 3) ──
    const intAccts = state.portfolioAccounts.filter(isYieldAccount);
    const listEl = safeEl('int-accts-list');
    if (listEl) {
      if (!intAccts.length) {
        listEl.innerHTML = '';
      } else {
        listEl.innerHTML = `
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#4a7fd4;margin-bottom:6px">
            Interest-bearing accounts
          </div>` +
          intAccts.map(a => {
            const owner = a.owner === 'p1' ? p1name : p2name;
            const rate  = a.rate != null ? a.rate + '%' : '–';
            const draw  = a.monthlyDraw != null ? D.formatMoney(a.monthlyDraw) + '/mo' : '–';
            return `<div class="assump-int-row">
              <span class="assump-int-name">${a.name || '(unnamed)'}</span>
              <span class="assump-int-meta">${owner} · ${a.wrapper} · ${rate} · draw ${draw} · ${D.formatMoney(a.value || 0)}</span>
            </div>`;
          }).join('');
      }
    }

    // ── Handoff banner ──
    const total  = state.portfolioAccounts.reduce((s, a) => s + (a.value || 0), 0);
    const nAccts = state.portfolioAccounts.length;
    let banner   = safeEl('handoff-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'handoff-banner';
      banner.style.cssText = 'background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:8px 10px;font-size:12px;color:#166534;margin:0 0 0.75rem';
      const assumpPanel = document.querySelector('#tab-assumptions .assump-cards');
      if (assumpPanel) assumpPanel.prepend(banner);
    }
    banner.innerHTML = `✓ Portfolio loaded: ${nAccts} accounts, ${D.formatMoney(total)} total`;

    updateSidebarNames();
    applyP2State();
  }

  // ─────────────────────────────
  // SIDEBAR COLLAPSIBLES (removed — kept as no-op for safety)
  // ─────────────────────────────
  function toggleAllSections() { /* collapse UI removed */ }

  // ─────────────────────────────
  // GATHER INPUTS (DOM → plain object)
  // Single source of truth for all sidebar DOM reads.
  // engine.js must contain zero document.* calls.
  // ─────────────────────────────
  function gv(id)  { return D.parseCurrency(safeEl(id)?.value || ''); }
  function gvi(id) { return parseInt(String(D.parseCurrency(safeEl(id)?.value || '')), 10) || 0; }
  function gvs(id) { return safeEl(id)?.value || ''; }

  function getOrder(prefix, slots) {
    const o = [];
    for (let i = 1; i <= slots; i++) o.push(gvs(prefix + 'Order' + i));
    return o;
  }

  function gatherInputs() {
    const bniEnabled = safeEl('bniEnabled')?.checked || false;
    const growthRaw    = gv('growth');
    const inflationRaw = gv('inflation');

    return {
      startYear:        gvi('startYear'),
      endYear:          gvi('endYear'),
      p1DOB:            gvi('p1DOB'),
      p2DOB:            gvi('p2DOB'),
      p1name:           safeEl('sp-p1name')?.value?.trim() || 'Person 1',
      p2name:           safeEl('sp-p2name')?.value?.trim() || 'Person 2',
      p2enabled:        state.p2enabled,
      spending:         gv('spending'),
      stepDownPct:      gvi('stepDownPct'),
      p1Salary:         gv('p1Salary'),
      p1SalaryStop:     gvi('p1SalaryStopAge'),
      p2Salary:         state.p2enabled ? gv('p2Salary')         : 0,
      p2SalaryStop:     state.p2enabled ? gvi('p2SalaryStopAge') : 0,
      p1SPAge:          gvi('p1SPAge'),
      p1SPAmt:          gv('p1SP'),
      p2SPAge:          state.p2enabled ? gvi('p2SPAge') : 0,
      p2SPAmt:          state.p2enabled ? gv('p2SP')    : 0,
      growth:           growthRaw / 100,
      inflation:        inflationRaw / 100,
      thresholdMode:    document.querySelector('input[name="thresholdMode"]:checked')?.value || 'frozen',
      thresholdFromYear: parseInt(safeEl('thresholdFromYearVal')?.value) || 2028,
      bniEnabled,
      bniP1GIA:         bniEnabled ? gv('bniP1GIA') : 0,
      bniP2GIA:         (bniEnabled && state.p2enabled) ? gv('bniP2GIA') : 0,
      dividendYield:    (parseFloat(safeEl('dividendYield')?.value) || 1.5) / 100,
      withdrawalMode:   document.querySelector('input[name="withdrawalMode"]:checked')?.value || '50/50',
      p1Bal: {
        Cash: gv('p1Cash'),
        GIA:  gv('p1GIA'),
        SIPP: gv('p1SIPP'),
        ISA:  gv('p1ISA'),
      },
      p2Bal: {
        Cash: state.p2enabled ? gv('p2Cash') : 0,
        GIA:  state.p2enabled ? gv('p2GIA')  : 0,
        SIPP: state.p2enabled ? gv('p2SIPP') : 0,
        ISA:  state.p2enabled ? gv('p2ISA')  : 0,
      },
      p1Order: getOrder('p1', 3),
      p2Order: getOrder('p2', 3),
    };
  }

  // ─────────────────────────────
  // RUN PROJECTION
  // ─────────────────────────────
  function runProjection() {
    const result = E.runProjection(gatherInputs(), state.portfolioAccounts);
    if (!result) return;
    CR.setResults(result.rows);
    CR.renderAlerts(result.depletions);
    CR.renderMetrics();
    CR.renderCharts();
    // Auto-advance to Results tab
    RetireTabs.switchTab('results');
    state.activeTab = 'results';
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
    if (action === 'load-excel')     return window.RetireExcelLoader.openFilePicker();
    if (action === 'run-projection') return runProjection();

    if (action === 'switch-tab') {
      const tab = el.dataset.tab;
      if (state.activeTab === 'setup') syncSetupToAssumptions();
      state.activeTab = tab;
      return RetireTabs.switchTab(tab);
    }

    if (action === 'view-both')  return CR.setView('both', el);
    if (action === 'view-p1') return CR.setView('p1',   el);
    if (action === 'view-p2') return CR.setView('p2',   el);
    if (action === 'real-on')    return CR.setReal(true,  el);
    if (action === 'real-off')   return CR.setReal(false, el);
    if (action === 'tab-charts') return CR.setTab('charts', el);
    if (action === 'tab-tables') return CR.setTab('tables', el);
  });

  // BNI checkbox — enable/disable inputs (fields always visible)
  document.addEventListener('change', (e) => {
    if (e.target.id === 'bniEnabled') {
      const enabled = e.target.checked;
      ['bniP1GIA', 'bniP2GIA'].forEach(id => {
        const el = safeEl(id);
        if (el) {
          el.disabled = !enabled;
          el.style.opacity = enabled ? '' : '0.45';
        }
      });
    }

    // P2 toggle checkbox
    if (e.target.id === 'p2enabled') {
      state.p2enabled = e.target.checked;
      applyP2State();
    }
  });

  // ─────────────────────────────
  // EXCEL LOAD
  // ─────────────────────────────
  document.addEventListener('excel-loaded', (e) => {
    const { accounts, params } = e.detail;

    // ── Setup page accounts ──────────────────
    state.portfolioAccounts = [];
    state.nextId = 1;
    const tbody = safeEl('acct-tbody');
    if (tbody) tbody.innerHTML = '';
    const ownerNames = [
      String(params.p1name || 'Person 1'),
      String(params.p2name || 'Person 2'),
    ];
    // Update name fields
    if (safeEl('sp-p1name')) safeEl('sp-p1name').value = ownerNames[0];
    if (safeEl('sp-p2name')) safeEl('sp-p2name').value = ownerNames[1];

    accounts.forEach(a => {
      const acc = { id: state.nextId++, ...a };
      state.portfolioAccounts.push(acc);
      R.renderAccountRow(acc, ownerNames);
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });
    refreshSetupSummary();

    // ── Calculator sidebar params ────────────
    const MONEY = D.MONEY_FIELDS;
    Object.entries(params).forEach(([k, v]) => {
      if (k === 'p1name' || k === 'p2name') return; // handled above
      const el = safeEl(k);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = String(v).toLowerCase() === 'true';
        if (el.id === 'bniEnabled') {
          // Enable/disable BNI inputs to match loaded state
          ['bniP1GIA', 'bniP2GIA'].forEach(fid => {
            const f = safeEl(fid);
            if (f) { f.disabled = !el.checked; f.style.opacity = el.checked ? '' : '0.45'; }
          });
        }
        return;
      }
      if (el.type === 'radio') return; // handled separately below
      el.value = MONEY.has(k) ? formatCurrency(Number(v) || 0) : v;
    });

    // thresholdMode radio
    if (params.thresholdMode) {
      const radio = document.querySelector(`input[name="thresholdMode"][value="${params.thresholdMode}"]`);
      if (radio) radio.checked = true;
    }

    // DOBs — write directly to setup page fields
    if (params.p1DOB && safeEl('sp-p1dob'))
      safeEl('sp-p1dob').value = params.p1DOB;
    if (params.p2DOB && safeEl('sp-p2dob'))
      safeEl('sp-p2dob').value = params.p2DOB;

    showToast(`Loaded ${accounts.length} accounts from Excel ✓`);
    updateSidebarNames();
    applyP2State();
  });

  // ─────────────────────────────
  // INIT
  // ─────────────────────────────
  refreshSetupSummary();
  R.initialiseCurrencyInputs();
  RetireTabs.init();
})();
