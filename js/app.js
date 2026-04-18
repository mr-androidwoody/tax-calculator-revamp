(function () {
  const D  = window.RetireData;
  const C  = window.RetireCalc;
  const R  = window.RetireRender;
  const E  = window.RetireEngine;
  const CR = window.RetireCalcRender;

  const STORAGE_KEY     = 'rukRetirementSetup';
  const ASSUMPTIONS_KEY = 'rukRetirementAssumptions';

  const state = {
    portfolioAccounts: [],
    nextId: 1,
    activeTab: 'setup',
    p2enabled: true,
    simulationMode: 'deterministic', // kept for backwards compat with saved assumptions
    projectionRun: false,
    riskRun: false,    // true once MC has completed at least once
    riskStale: false,  // true when projection has been re-run since last MC run
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
  // SAVE BUTTON FEEDBACK
  // Default state: btn-success (solid green).
  // Saving state:  btn-saving  (ghost green — white bg, green border, green text).
  // After 800ms:   resets to btn-success + original label.
  // ─────────────────────────────
  function triggerSaveFeedback(btn, originalLabel, saveFn) {
    try {
      saveFn();
    } catch (err) {
      console.error(err);
      showToast('Save failed – see console', true);
      return;
    }

    // Flip to ghost saving state
    btn.textContent = 'Saving…';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-saving');
    clearTimeout(btn._saveTimer);

    btn._saveTimer = window.setTimeout(() => {
      btn.textContent = originalLabel;
      btn.classList.remove('btn-saving');
      btn.classList.add('btn-success');
    }, 800);
  }

  // ─────────────────────────────
  // LOAD BUTTON FEEDBACK
  // Flips button to "Loading…" + ghost blue (btn-loading) immediately.
  // Resets to original label + btn-secondary after resetMs (default 800ms).
  // For Load Excel, pass a longer resetMs and call resetLoadBtn() manually
  // on the excel-loaded event so the button resets when data actually arrives.
  // ─────────────────────────────
  function triggerLoadFeedback(btn, originalLabel, resetMs) {
    btn.textContent = 'Loading…';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-loading');
    btn.disabled = true;
    clearTimeout(btn._loadTimer);

    btn._loadTimer = window.setTimeout(() => {
      resetLoadBtn(btn, originalLabel);
    }, resetMs || 800);
  }

  function resetLoadBtn(btn, originalLabel) {
    clearTimeout(btn._loadTimer);
    btn.textContent = originalLabel;
    btn.classList.remove('btn-loading');
    btn.classList.add('btn-secondary');
    btn.disabled = false;
  }

  // ─────────────────────────────
  // DELETE CONFIRM HELPERS
  // First click: hides trigger button, shows block confirm box.
  // Cancel: restores. Confirm: executes deleteFn then restores.
  // ─────────────────────────────
  function wireDeleteConfirm(triggerId, confirmId, confirmBtnId, cancelBtnId, deleteFn) {
    const triggerBtn = safeEl(triggerId);
    const confirmEl  = safeEl(confirmId);
    const confirmBtn = safeEl(confirmBtnId);
    const cancelBtn  = safeEl(cancelBtnId);
    if (!triggerBtn || !confirmEl || !confirmBtn || !cancelBtn) return;

    function showConfirm() {
      triggerBtn.style.display = 'none';
      confirmEl.style.display  = 'flex';
    }

    function hideConfirm() {
      confirmEl.style.display  = 'none';
      triggerBtn.style.display = '';
    }

    triggerBtn.addEventListener('click', showConfirm);
    cancelBtn.addEventListener('click',  hideConfirm);
    confirmBtn.addEventListener('click', () => {
      hideConfirm();
      try {
        deleteFn();
      } catch (err) {
        console.error(err);
        showToast('Delete failed – see console', true);
      }
    });
  }

  // ─────────────────────────────
  // DOM → STATE
  // ─────────────────────────────
  function syncAccountsFromDOM() {
    const rows = document.querySelectorAll('#acct-tbody tr');
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
        rate:        get('rate')?.value        ? safeNumber(get('rate').value)                         : null,
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
      version: 2,
      p2enabled: state.p2enabled,
      people: {
        p1: {
          name:          safeValue('sp-p1name').trim(),
          dob:           safeNumber(safeValue('sp-p1dob')),
          spAge:         safeValue('p1SPAge'),
          sp:            safeValue('p1SP'),
          salary:        safeValue('p1Salary'),
          salaryStopAge: safeValue('p1SalaryStopAge'),
        },
        p2: {
          name:          safeValue('sp-p2name').trim(),
          dob:           safeNumber(safeValue('sp-p2dob')),
          spAge:         safeValue('p2SPAge'),
          sp:            safeValue('p2SP'),
          salary:        safeValue('p2Salary'),
          salaryStopAge: safeValue('p2SalaryStopAge'),
        },
      },
      startYear: safeNumber(safeValue('sp-startYear')),
      endYear:   safeNumber(safeValue('sp-endYear')),
      accounts:  state.portfolioAccounts,
    };
  }

  function readAssumptionsInputs() {
    return {
      spending:          safeValue('spending'),
      stepDownPct:       safeValue('stepDownPct'),
      growth:            safeValue('growth'),
      growthPreset:      document.querySelector('input[name="growthPreset"]:checked')?.value || null,
      inflation:         safeValue('inflation'),
      thresholdMode:     document.querySelector('input[name="thresholdMode"]:checked')?.value || 'frozen',
      thresholdFromYear: safeValue('thresholdFromYearVal'),
      withdrawalStrategy: document.querySelector('input[name="withdrawalStrategy"]:checked')?.value || 'balanced',
      bniEnabled:        document.querySelector('input[name="bniEnabled"]:checked')?.value === 'true',
      bniP1GIA:          safeValue('bniP1GIA'),
      bniP2GIA:          safeValue('bniP2GIA'),
      dividendYield:     safeValue('dividendYield'),
      dividendMode:      document.querySelector('input[name="dividendMode"]:checked')?.value ?? 'payout',
      startYear:         safeValue('sp-startYear'),
      endYear:           safeValue('sp-endYear'),
    };
  }

  function applySetupInputs(data) {
    if (!data) return;

    const sv    = (id, val) => { const el = safeEl(id); if (el && val != null) el.value = val; };
    const svCur = (id, val) => { const el = safeEl(id); if (el && val != null) R.applyCurrencyFormattingToInput(Object.assign(el, { value: String(val) })); };
    sv('sp-p1name',       data.people?.p1?.name          || '');
    sv('sp-p1dob',        data.people?.p1?.dob           || '');
    sv('p1SPAge',         data.people?.p1?.spAge         || '');
    svCur('p1SP',         data.people?.p1?.sp            || '');
    svCur('p1Salary',     data.people?.p1?.salary        || '');
    sv('p1SalaryStopAge', data.people?.p1?.salaryStopAge || '');
    sv('sp-p2name',       data.people?.p2?.name          || '');
    sv('sp-p2dob',        data.people?.p2?.dob           || '');
    sv('p2SPAge',         data.people?.p2?.spAge         || '');
    svCur('p2SP',         data.people?.p2?.sp            || '');
    svCur('p2Salary',     data.people?.p2?.salary        || '');
    sv('p2SalaryStopAge', data.people?.p2?.salaryStopAge || '');
    sv('sp-startYear',    data.startYear                 || '');
    sv('sp-endYear',      data.endYear                   || '');

    state.p2enabled = data.p2enabled !== false;
    const p2cb = safeEl('p2enabled');
    if (p2cb) p2cb.checked = state.p2enabled;
    applyP2State();

    state.portfolioAccounts = data.accounts || [];
    state.nextId = Math.max(1, ...state.portfolioAccounts.map(a => a.id || 0)) + 1;
    const tbody = safeEl('acct-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      const ownerNames = getOwnerNames();
      state.portfolioAccounts.forEach(acc => {
        R.renderAccountRow(acc, ownerNames);
        R.updateRowBadge(acc);
        R.applyWrapperFieldState(acc);
      });
    }
    refreshSetupSummary();
    refreshPortfolioUI();
  }

  function applyAssumptionsInputs(a) {
    if (!a) return;

    const sv = (id, val) => { const el = safeEl(id); if (el && val != null) el.value = val; };

    sv('spending',             a.spending);
    sv('stepDownPct',          a.stepDownPct);
    sv('growth',               a.growth);
    const gp = document.querySelector(`input[name="growthPreset"][value="${a.growthPreset}"]`);
    document.querySelectorAll('input[name="growthPreset"]').forEach(r => r.checked = false);
    if (gp) gp.checked = true;
    sv('inflation',            a.inflation);
    sv('thresholdFromYearVal', a.thresholdFromYear);
    sv('dividendYield',        a.dividendYield);
    const dm = document.querySelector(`input[name="dividendMode"][value="${a.dividendMode ?? 'payout'}"]`);
    if (dm) dm.checked = true;
    sv('bniP1GIA',             a.bniP1GIA);
    sv('bniP2GIA',             a.bniP2GIA);

    if (a.thresholdMode) {
      const r = document.querySelector(`input[name="thresholdMode"][value="${a.thresholdMode}"]`);
      if (r) r.checked = true;
    }
    if (a.withdrawalStrategy) {
      const r = document.querySelector(`input[name="withdrawalStrategy"][value="${a.withdrawalStrategy}"]`);
      if (r) r.checked = true;
    }

    const bniRadio = document.querySelector(`input[name="bniEnabled"][value="${a.bniEnabled ? 'true' : 'false'}"]`);
    if (bniRadio) bniRadio.checked = true;
    applyBniState(!!a.bniEnabled);

    if (a.startYear) { const el = safeEl('sp-startYear'); if (el) el.value = a.startYear; }
    if (a.endYear)   { const el = safeEl('sp-endYear');   if (el) el.value = a.endYear;   }

    updateSidebarNames();
    applyP2State();
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
  // SAVE / LOAD — core data functions
  // ─────────────────────────────
  function saveSetupData() {
    syncAccountsFromDOM();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readSetupInputs()));
  }

  function saveAssumptionsData() {
    syncSetupToAssumptions();
    localStorage.setItem(ASSUMPTIONS_KEY, JSON.stringify(readAssumptionsInputs()));
    refreshTabGating(_isPortfolioValid());
  }

  function deleteAssumptionsData() {
    localStorage.removeItem(ASSUMPTIONS_KEY);
    refreshTabGating(_isPortfolioValid());
    applyAssumptionsInputs({
      spending: '', stepDownPct: '0', growth: '', inflation: '',
      thresholdMode: 'frozen', withdrawalStrategy: 'balanced',
      dividendYield: '1.5', bniEnabled: false,
    });
    showToast('Assumptions deleted');
  }

  function deletePortfolioData() {
    const _sv = (id) => { const el = safeEl(id); if (el) el.value = ""; };
    _sv("sp-p1name"); _sv("sp-p1dob");
    _sv("sp-p2name"); _sv("sp-p2dob");
    state.portfolioAccounts = [];
    state.nextId = 1;
    const tbody = safeEl('acct-tbody');
    if (tbody) tbody.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    refreshSetupSummary();
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
    refreshPortfolioUI();
  }

  function removeAccount(el) {
    const row = el.closest('tr');
    if (row) row.remove();
    syncAccountsFromDOM();
    refreshSetupSummary();
    refreshPortfolioUI();
  }

  // ─────────────────────────────
  // PORTFOLIO VALIDATION UI
  // ─────────────────────────────
  function _isPortfolioValid() {
    const accounts = state.portfolioAccounts;
    if (accounts.length === 0) return false;
    return accounts.every(acc => {
      const total = D.ALLOC_CLASSES.reduce((s, c) => s + (acc.alloc[c] || 0), 0);
      return Math.round(total) === 100;
    });
  }

  function refreshPortfolioUI() {
    const alertBox    = safeEl('portAlertBox');
    const addBtn      = safeEl('addAccountBtn');
    const continueBtn = safeEl('continueToAssumptionsBtn');

    const accounts = state.portfolioAccounts;
    const hasNone  = accounts.length === 0;

    const unbalancedCount = accounts.filter(acc => {
      const total = D.ALLOC_CLASSES.reduce((s, c) => s + (acc.alloc[c] || 0), 0);
      return Math.round(total) !== 100;
    }).length;

    let message = null;
    if (hasNone) {
      message = 'Add at least one account';
    } else if (unbalancedCount > 0) {
      message = `Balance ${unbalancedCount} account${unbalancedCount > 1 ? 's' : ''} below so they equal exactly 100%`;
    }

    const isValid = message === null;

    if (alertBox) {
      alertBox.textContent   = message || '';
      alertBox.style.display = message ? '' : 'none';
    }

    // Add account button always visible — no toggling needed

    // Continue button: disabled when invalid
    if (continueBtn) {
      continueBtn.disabled = !isValid;
    }

    // Gate nav tabs
    refreshTabGating(isValid);
  }

  // ─────────────────────────────
  // TAB GATING
  // ─────────────────────────────
  function refreshTabGating(portfolioValid) {
    const assumptionsSaved = !!localStorage.getItem(ASSUMPTIONS_KEY);

    const tabAssumptions = document.querySelector('.tab-btn[data-tab="assumptions"]');
    const tabResults     = document.querySelector('.tab-btn[data-tab="results"]');

    if (tabAssumptions) {
      tabAssumptions.disabled = !portfolioValid;
      tabAssumptions.classList.toggle('tab-btn--disabled', !portfolioValid);
    }
    if (tabResults) {
      const resultsEnabled = portfolioValid && assumptionsSaved && state.projectionRun;
      tabResults.disabled = !resultsEnabled;
      tabResults.classList.toggle('tab-btn--disabled', !resultsEnabled);
    }
  }

  // ─────────────────────────────
  // SUMMARY
  // ─────────────────────────────
  function refreshSetupSummary() {
    const summary = C.summarisePortfolio(state.portfolioAccounts);
    R.renderSetupSummary(summary);
  }

  // ─────────────────────────────
  // SIDEBAR NAME SYNC
  // ─────────────────────────────
  function updateSidebarNames() {
    const p1 = safeValue('sp-p1name').trim() || 'Person 1';
    const p2 = safeValue('sp-p2name').trim() || 'Person 2';

    document.querySelectorAll('[data-p1]').forEach(el => {
      const suffix = el.getAttribute('data-p1');
      el.textContent = suffix ? `${p1} ${suffix}` : p1;
    });
    document.querySelectorAll('[data-p2]').forEach(el => {
      const suffix = el.getAttribute('data-p2');
      el.textContent = suffix ? `${p2} ${suffix}` : p2;
    });

    document.querySelectorAll('[data-p1-stepdown]').forEach(el => {
      el.textContent = 'Reduced spending';
      el.setAttribute('title', `Reduces the gross spending target from the year ${p1} turns 75.`);
    });
    document.querySelectorAll('[data-p1-stepdown-hint]').forEach(el => {
      el.textContent = `Reduces the gross spending target from the year ${p1} turns 75.`;
    });

    document.querySelectorAll('[data-p1-btn]').forEach(el => { el.textContent = p1; });
    document.querySelectorAll('[data-p2-btn]').forEach(el => { el.textContent = p2; });
  }

  // ─────────────────────────────
  // P2 TOGGLE
  // ─────────────────────────────
  const P2_FIELD_IDS = [
    'p2DOB', 'p2Salary', 'p2SalaryStopAge', 'p2SPAge', 'p2SP',
    'p2Cash', 'p2SIPP', 'p2ISA', 'p2GIA',
    'bniP2GIA',
  ];

  function applyBniState(enabled) {
    document.querySelectorAll('.bni-field').forEach(row => {
      row.style.opacity      = enabled ? '' : '0.45';
      row.style.pointerEvents = enabled ? '' : 'none';
    });
    ['bniP1GIA', 'bniP2GIA'].forEach(id => {
      const el = safeEl(id);
      if (el) el.disabled = !enabled;
    });
  }

  function applyP2State() {
    const enabled = state.p2enabled;

    P2_FIELD_IDS.forEach(id => {
      const el = safeEl(id);
      if (!el) return;
      el.disabled = !enabled;
      el.style.opacity = enabled ? '' : '0.45';
    });

    document.querySelectorAll('.p2-field').forEach(el => {
      el.classList.toggle('p2-disabled', !enabled);
    });

    const p2setup = safeEl('p2-setup-fields');
    if (p2setup) {
      p2setup.classList.toggle('p2-disabled', !enabled);
      p2setup.querySelectorAll('input').forEach(inp => { inp.disabled = !enabled; });
    }

    document.querySelectorAll('#acct-tbody tr').forEach(row => {
      const ownerSel = row.querySelector('[data-field="owner"]');
      if (!ownerSel) return;
      if (ownerSel.value === 'p2') {
        row.classList.toggle('p2-disabled', !enabled);
        row.querySelectorAll('input, select').forEach(inp => { inp.disabled = !enabled; });
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

    const setText = (id, val) => {
      const el = safeEl(id);
      if (el) el.textContent = (val === undefined || val === null || val === '') ? '–' : val;
    };

    const setHidden = (id, val) => {
      const el = safeEl(id);
      if (!el) return;
      el.value = (val === undefined || val === null || val === '')
        ? '' : D.MONEY_FIELDS.has(id) ? String(Math.round(Number(val) || 0)) : val;
    };

    const p1dob     = safeValue('sp-p1dob');
    const p2dob     = safeValue('sp-p2dob');
    const sy        = safeValue('sp-startYear');
    const ey        = safeValue('sp-endYear');
    const p1sal     = D.parseCurrency(safeEl('p1Salary')?.value      || '');
    const p1salstop = safeEl('p1SalaryStopAge')?.value || '–';
    const p1spage   = safeEl('p1SPAge')?.value          || '–';
    const p1sp      = D.parseCurrency(safeEl('p1SP')?.value           || '');
    const p2sal     = D.parseCurrency(safeEl('p2Salary')?.value      || '');
    const p2salstop = safeEl('p2SalaryStopAge')?.value || '–';
    const p2spage   = safeEl('p2SPAge')?.value          || '–';
    const p2sp      = D.parseCurrency(safeEl('p2SP')?.value           || '');

    setText('ai-p1name',       p1name);
    setText('ai-p1dob',        p1dob  || '–');
    setText('ai-p1salary',     p1sal  ? D.formatMoney(p1sal)  : '–');
    setText('ai-p1salarystop', p1salstop);
    setText('ai-p1spage',      p1spage);
    setText('ai-p1sp',         p1sp   ? D.formatMoney(p1sp)   : '–');
    setText('ai-p2name',       p2name);
    setText('ai-p2dob',        p2dob  || '–');
    setText('ai-p2salary',     p2sal  ? D.formatMoney(p2sal)  : '–');
    setText('ai-p2salarystop', p2salstop);
    setText('ai-p2spage',      p2spage);
    setText('ai-p2sp',         p2sp   ? D.formatMoney(p2sp)   : '–');
    setText('ai-startyear',    sy || '–');
    setText('ai-endyear',      ey || '–');

    setHidden('p1DOB',           p1dob);
    setHidden('p2DOB',           p2dob);
    setHidden('startYear',       sy);
    setHidden('endYear',         ey);
    setHidden('p1Salary',        p1sal);
    setHidden('p1SalaryStopAge', p1salstop !== '–' ? p1salstop : '');
    setHidden('p1SPAge',         p1spage   !== '–' ? p1spage   : '');
    setHidden('p1SP',            p1sp);
    setHidden('p2Salary',        p2sal);
    setHidden('p2SalaryStopAge', p2salstop !== '–' ? p2salstop : '');
    setHidden('p2SPAge',         p2spage   !== '–' ? p2spage   : '');
    setHidden('p2SP',            p2sp);

    const p1cash = sumBy('p1', 'Cash');
    const p2cash = sumBy('p2', 'Cash');
    const p1sipp = sumBy('p1', 'SIPP');
    const p2sipp = sumBy('p2', 'SIPP');
    const p1isa  = sumBy('p1', 'ISA');
    const p2isa  = sumBy('p2', 'ISA');
    const p1gia  = sumBy('p1', 'GIA');
    const p2gia  = sumBy('p2', 'GIA');

    setText('ai-p1cash', D.formatMoney(p1cash));
    setText('ai-p1sipp', D.formatMoney(p1sipp));
    setText('ai-p1isa',  D.formatMoney(p1isa));
    setText('ai-p1gia',  D.formatMoney(p1gia));
    setText('ai-p2cash', D.formatMoney(p2cash));
    setText('ai-p2sipp', D.formatMoney(p2sipp));
    setText('ai-p2isa',  D.formatMoney(p2isa));
    setText('ai-p2gia',  D.formatMoney(p2gia));

    // Portfolio footer totals
    const totIsa  = p1isa  + p2isa;
    const totSipp = p1sipp + p2sipp;
    const totGia  = p1gia  + p2gia;
    const totCash = p1cash + p2cash;
    const totAll  = totIsa + totSipp + totGia + totCash;
    setText('ai-total',      D.formatMoney(totAll));
    setText('ai-total-isa',  D.formatMoney(totIsa));
    setText('ai-total-sipp', D.formatMoney(totSipp));
    setText('ai-total-gia',  D.formatMoney(totGia));
    setText('ai-total-cash', D.formatMoney(totCash));

    setHidden('p1Cash', p1cash);
    setHidden('p2Cash', p2cash);
    setHidden('p1SIPP', p1sipp);
    setHidden('p2SIPP', p2sipp);
    setHidden('p1ISA',  p1isa);
    setHidden('p2ISA',  p2isa);
    setHidden('p1GIA',  p1gia);
    setHidden('p2GIA',  p2gia);

    // ── GIA equity/cashlike split for MC worker ────────────────────────────
    // Each GIA account carries a cashlike % in its alloc. We weight by value
    // to compute how much of each person's total GIA is cashlike vs equity.
    const giaAccts = (owner) => state.portfolioAccounts.filter(
      a => a.owner === owner && a.wrapper === 'GIA'
    );
    const giaSplit = (owner) => {
      const accts = giaAccts(owner);
      const total = accts.reduce((s, a) => s + (a.value || 0), 0);
      if (total <= 0) return { eq: 0, cash: 0 };
      const cashFrac = accts.reduce((s, a) => {
        const w = (a.value || 0) / total;
        return s + w * ((a.alloc?.cashlike || 0) / 100);
      }, 0);
      return { eq: Math.round(total * (1 - cashFrac)), cash: Math.round(total * cashFrac) };
    };
    const p1giaSplit = giaSplit('p1');
    const p2giaSplit = giaSplit('p2');
    setHidden('p1GIAeq',   p1giaSplit.eq);
    setHidden('p2GIAeq',   p2giaSplit.eq);
    setHidden('p1GIAcash', p1giaSplit.cash);
    setHidden('p2GIAcash', p2giaSplit.cash);

    const intAccts = state.portfolioAccounts.filter(isYieldAccount);
    const listEl = safeEl('int-accts-list');
    if (listEl) {
      if (!intAccts.length) {
        listEl.innerHTML = '';
      } else {
        listEl.innerHTML =
          `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#4a7fd4;margin-bottom:6px">
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

    const total  = state.portfolioAccounts.reduce((s, a) => s + (a.value || 0), 0);
    const nAccts = state.portfolioAccounts.length;
    // Banner removed — wizard layout has no .assump-cards container

    updateSidebarNames();
    applyP2State();
  }

  // ─────────────────────────────
  // GATHER INPUTS
  // ─────────────────────────────
  function gv(id)  { return D.parseCurrency(safeEl(id)?.value || ''); }
  function gvi(id) { return parseInt(String(D.parseCurrency(safeEl(id)?.value || '')), 10) || 0; }
  function gvs(id) { return safeEl(id)?.value || ''; }

  function gatherInputs() {
    const bniEnabled   = document.querySelector('input[name="bniEnabled"]:checked')?.value === 'true';
    const growthRaw    = gv('growth');
    const inflationRaw = gv('inflation');

    return {
      startYear:         gvi('startYear'),
      endYear:           gvi('endYear'),
      p1DOB:             gvi('p1DOB'),
      p2DOB:             gvi('p2DOB'),
      p1name:            safeEl('sp-p1name')?.value?.trim() || 'Person 1',
      p2name:            safeEl('sp-p2name')?.value?.trim() || 'Person 2',
      p2enabled:         state.p2enabled,
      spending:          gv('spending'),
      stepDownPct:       gvi('stepDownPct'),
      p1Salary:          gv('p1Salary'),
      p1SalaryStop:      gvi('p1SalaryStopAge'),
      p2Salary:          state.p2enabled ? gv('p2Salary')         : 0,
      p2SalaryStop:      state.p2enabled ? gvi('p2SalaryStopAge') : 0,
      p1SPAge:           gvi('p1SPAge'),
      p1SPAmt:           gv('p1SP'),
      p2SPAge:           state.p2enabled ? gvi('p2SPAge') : 0,
      p2SPAmt:           state.p2enabled ? gv('p2SP')    : 0,
      growth:            growthRaw    / 100,
      inflation:         inflationRaw / 100,
      thresholdMode:     document.querySelector('input[name="thresholdMode"]:checked')?.value || 'frozen',
      thresholdFromYear: parseInt(safeEl('thresholdFromYearVal')?.value) || 2028,
      bniEnabled,
      bniP1GIA:          bniEnabled ? gv('bniP1GIA') : 0,
      bniP1Years:        bniEnabled ? gvi('bniP1Years') : 0,
      bniP2GIA:          (bniEnabled && state.p2enabled) ? gv('bniP2GIA') : 0,
      bniP2Years:        (bniEnabled && state.p2enabled) ? gvi('bniP2Years') : 0,
      dividendYield:     (parseFloat(safeEl('dividendYield')?.value) || 1.5) / 100,
      dividendMode:      document.querySelector('input[name="dividendMode"]:checked')?.value ?? 'payout',
      strategy:          document.querySelector('input[name="withdrawalStrategy"]:checked')?.value || 'balanced',
      p1Bal: {
        Cash:    gv('p1Cash'),
        GIAeq:   gv('p1GIAeq'),
        GIAcash: gv('p1GIAcash'),
        SIPP:    gv('p1SIPP'),
        ISA:     gv('p1ISA'),
      },
      p2Bal: {
        Cash:    state.p2enabled ? gv('p2Cash')    : 0,
        GIAeq:   state.p2enabled ? gv('p2GIAeq')   : 0,
        GIAcash: state.p2enabled ? gv('p2GIAcash')  : 0,
        SIPP:    state.p2enabled ? gv('p2SIPP')    : 0,
        ISA:     state.p2enabled ? gv('p2ISA')     : 0,
      },
      p1Order: ['GIA', 'SIPP', 'ISA'],
      p2Order: ['GIA', 'SIPP', 'ISA'],
    };
  }

  // ─────────────────────────────
  // RUN PROJECTION
  // ─────────────────────────────
  async function runProjection() {
    syncSetupToAssumptions();
    const inputs = gatherInputs();

    // Stash inputs so runRisk() can use them without re-gathering.
    state.lastInputs = inputs;

    const runBtn = document.querySelector('[data-action="run-projection"]');
    const originalLabel = runBtn ? runBtn.textContent : 'Run projection';

    if (runBtn) {
      runBtn.textContent = 'Running…';
      runBtn.classList.add('btn-loading');
      runBtn.disabled = true;
    }

    function resetBtn() {
      if (!runBtn) return;
      runBtn.textContent = originalLabel;
      runBtn.classList.remove('btn-loading');
      runBtn.disabled = false;
    }

    try {
      const result = E.runProjection(inputs, state.portfolioAccounts);
      if (!result) { resetBtn(); return; }

      resetBtn();

      state.projectionRun = true;
      refreshTabGating(_isPortfolioValid());
      CR.setResults(result, inputs.strategy, inputs.p2enabled);
      CR.renderMetrics();
      CR.renderCharts();
      RetireTabs.switchTab('results');
      state.activeTab = 'results';

      // Land on Sources of Income (first chart tab) — never auto-trigger MC
      const incomeBtn = document.querySelector('.results-tab[data-results-tab="income"]');
      if (incomeBtn) incomeBtn.click();

      // If risk has been run before, mark results as stale and hide outlook tab
      if (state.riskRun) {
        state.riskStale = true;
        window.RetireMCRender?.setStale(true);
        const outlookTab = document.getElementById('tab-btn-outlook');
        if (outlookTab) outlookTab.classList.add('results-tab--hidden');
      }

      // Show the Test my plan button
      const testPlanBtn = document.getElementById('btn-test-plan');
      if (testPlanBtn) {
        testPlanBtn.style.display = '';
        testPlanBtn.classList.remove('btn-test-plan--stale');
      }

    } catch (err) {
      resetBtn();
      console.error('runProjection error:', err);
      showToast('Run failed — see console', true);
    }
  }

  // ─────────────────────────────
  // RUN RISK (Monte Carlo)
  // ─────────────────────────────
  function _setRiskReady(ready) {
    const tabBtn = document.querySelector('.results-tab[data-results-tab="outlook"]');
    if (!tabBtn) return;
    tabBtn.classList.toggle('results-tab--risk-ready', ready);
  }

  // ── MC loader state ───────────────────────────────────────────────────────
  let _loaderMsgInterval = null;

  const _LOADER_MESSAGES = [
    'Simulating 10,000 retirement paths…',
    'Stress-testing against poor sequence returns…',
    'Calculating sustainable spending level…',
    'Running delay perturbation scenarios…',
    'Preparing your outlook…',
  ];

  function _setLoadingPhase(text) {
    const el = safeEl('mc-loading-phase');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
      el.textContent = text;
      el.style.opacity = '1';
    }, 200);
  }

  function _setLoadingProgress(pct) {
    const bar = safeEl('mc-loading-bar-fill');
    if (bar) bar.style.width = pct + '%';
  }

  function _showLoadingState() {
    const el = safeEl('mc-narrative');
    if (!el) return;

    el.innerHTML = `
      <div class="mc-loading">
        <svg class="mc-loading__wave" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
          <path class="mc-loading__wave-path mc-loading__wave-path--back"
            d="M-300,30 C-225,10 -175,50 -100,30 C-25,10 25,50 100,30 C175,10 225,50 300,30 C375,10 425,50 500,30 C575,10 625,50 700,30"/>
          <path class="mc-loading__wave-path mc-loading__wave-path--front"
            d="M-300,30 C-225,15 -175,45 -100,30 C-25,15 25,45 100,30 C175,15 225,45 300,30 C375,15 425,45 500,30 C575,15 625,45 700,30"/>
        </svg>
        <p class="mc-loading__phase" id="mc-loading-phase">${_LOADER_MESSAGES[0]}</p>
        <div class="mc-loading__bar-wrap">
          <div class="mc-loading__bar-fill" id="mc-loading-bar-fill"></div>
        </div>
      </div>`;

    // Cycle through messages on an interval, cross-fading each
    let msgIdx = 0;
    if (_loaderMsgInterval) clearInterval(_loaderMsgInterval);
    _loaderMsgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % _LOADER_MESSAGES.length;
      _setLoadingPhase(_LOADER_MESSAGES[msgIdx]);
    }, 2200);
  }

  function _hideLoader() {
    if (_loaderMsgInterval) {
      clearInterval(_loaderMsgInterval);
      _loaderMsgInterval = null;
    }
  }

  async function runRisk() {
    const inputs = state.lastInputs;
    if (!inputs) return;

    const MCE = window.RetireMCEngine;
    if (!MCE) {
      showToast('MC engine not loaded', true);
      return;
    }

    // ── Button: loading state ─────────────────────────────────────────────
    const testPlanBtn = document.getElementById('btn-test-plan');
    if (testPlanBtn) {
      testPlanBtn.classList.add('btn-test-plan--loading');
      testPlanBtn.disabled = true;
    }

    // ── Reveal and navigate to the outlook tab immediately ────────────────
    const outlookTab = document.getElementById('tab-btn-outlook');
    if (outlookTab) {
      outlookTab.classList.remove('results-tab--hidden');
      outlookTab.click();
    }

    _showLoadingState();
    _setRiskReady(false);
    const _outlookTabBtn = document.querySelector('.results-tab[data-results-tab="outlook"]');
    if (_outlookTabBtn) _outlookTabBtn.classList.add('results-tab--simulating');

    const _loaderStart   = Date.now();
    const _MIN_LOADER_MS = 4000;
    const _loaderDelay   = () => {
      const elapsed    = Date.now() - _loaderStart;
      const remaining  = _MIN_LOADER_MS - elapsed;
      return remaining > 0
        ? new Promise(res => setTimeout(res, remaining))
        : Promise.resolve();
    };

    function _resetTestPlanBtn() {
      if (!testPlanBtn) return;
      testPlanBtn.classList.remove('btn-test-plan--loading');
      testPlanBtn.disabled = false;
    }

    try {
      // ── Main run: 10,000 paths at current spending ─────────────────────
      const result = await MCE.run({
        inputs,
        simCount:     10_000,
        equityVol:    0.16,
        inflationVol: 0.015,
        onProgress:   (pct) => _setLoadingProgress(pct),
      });

      // ── Bisection: find spending level at TARGET_CONFIDENCE ─────────────
      const TARGET_CONFIDENCE = 0.90;
      const BISECT_SIMS       = 2_000;
      const BISECT_ITERS      = 12;

      let sustainableSpending = null;
      let sustainableIsFloor  = false;

      if (result.successRate >= TARGET_CONFIDENCE) {
        const rHigh = (await MCE.run({
          inputs:      { ...inputs, spending: inputs.spending * 1.50 },
          simCount:    BISECT_SIMS,
          equityVol:   0.16,
          inflationVol: 0.015,
        })).successRate;

        if (rHigh >= TARGET_CONFIDENCE) {
          sustainableSpending = Math.round(inputs.spending * 1.50);
          sustainableIsFloor  = true;
        }
      }

      _setLoadingPhase('Finding sustainable spending level…');
      _setLoadingProgress(0);

      if (!sustainableIsFloor) {
        let lo = inputs.spending * 0.40;
        let hi = result.successRate >= TARGET_CONFIDENCE
          ? inputs.spending * 1.50
          : inputs.spending;

        for (let i = 0; i < BISECT_ITERS; i++) {
          const mid    = (lo + hi) / 2;
          const midRes = await MCE.run({
            inputs:       { ...inputs, spending: mid },
            simCount:     BISECT_SIMS,
            equityVol:    0.16,
            inflationVol: 0.015,
          });
          if (midRes.successRate >= TARGET_CONFIDENCE) {
            lo = mid;
          } else {
            hi = mid;
          }
          _setLoadingProgress(Math.round(((i + 1) / BISECT_ITERS) * 100));
        }
        sustainableSpending = Math.round((lo + hi) / 2);
      }

      // ── Delay perturbations ───────────────────────────────────────────
      const DELAY_SIMS = 2_000;
      const delay1 = await MCE.run({ inputs: { ...inputs, deferYears: 1 }, simCount: DELAY_SIMS, equityVol: 0.16, inflationVol: 0.015 });
      const delay2 = await MCE.run({ inputs: { ...inputs, deferYears: 2 }, simCount: DELAY_SIMS, equityVol: 0.16, inflationVol: 0.015 });
      const delay3 = await MCE.run({ inputs: { ...inputs, deferYears: 3 }, simCount: DELAY_SIMS, equityVol: 0.16, inflationVol: 0.015 });
      const delayPerturbations = [
        { yearsDelay: 1, successRate: delay1.successRate },
        { yearsDelay: 2, successRate: delay2.successRate },
        { yearsDelay: 3, successRate: delay3.successRate },
      ];

      _setLoadingPhase('Stress-testing delay scenarios…');
      _setLoadingProgress(0);

      await _loaderDelay();

      const MCR = window.RetireMCRender;
      if (!MCR) throw new Error('RetireMCRender not loaded');
      _hideLoader();
      MCR.setResults(result, inputs.inflation, {
        currentSpending:     inputs.spending,
        sustainableSpending: sustainableSpending,
        sustainableIsFloor,
        targetConfidence:    TARGET_CONFIDENCE,
        openingPortfolio:    Object.values(inputs.p1Bal).reduce((s, v) => s + v, 0) +
                             Object.values(inputs.p2Bal).reduce((s, v) => s + v, 0),
        delayPerturbations,
      });
      MCR.render();
      _setRiskReady(true);
      if (_outlookTabBtn) _outlookTabBtn.classList.remove('results-tab--simulating');

      // ── Mark risk as complete and fresh ──────────────────────────────
      state.riskRun   = true;
      state.riskStale = false;
      MCR.setStale(false);
      _resetTestPlanBtn();

    } catch (err) {
      _hideLoader();
      if (_outlookTabBtn) _outlookTabBtn.classList.remove('results-tab--simulating');
      // On error: hide the tab again and restore button
      if (outlookTab) outlookTab.classList.add('results-tab--hidden');
      _setLoadingPhase('Simulation failed — please try again.');
      _resetTestPlanBtn();
      console.error('runRisk error:', err);
      showToast('Simulation failed — see console', true);
    }
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
  // LIVE INPUT — account table
  // ─────────────────────────────
  document.addEventListener('input', (e) => {
    if (!e.target.closest('#acct-tbody')) return;

    syncAccountsFromDOM();
    refreshSetupSummary();

    if (e.target.dataset.field === 'cashlike') {
      const accountId = Number(e.target.dataset.accountId);
      const acc = state.portfolioAccounts.find(a => a.id === accountId);
      if (acc) {
        R.updateRowBadge(acc);
        R.applyWrapperFieldState(acc);
        syncAccountsFromDOM();
      }
    }

    if (['equities','bonds','cashlike','cash'].includes(e.target.dataset.field)) {
      const accountId = Number(e.target.dataset.accountId);
      const acc = state.portfolioAccounts.find(a => a.id === accountId);
      if (acc) R.updateRowBadge(acc);
      refreshPortfolioUI();
    }
  });

  // ─────────────────────────────
  // CHANGE — selects and checkboxes
  // ─────────────────────────────
  document.addEventListener('change', (e) => {
    const accountId = e.target.dataset?.accountId;
    if (accountId) {
      const field = e.target.dataset.field;
      syncAccountsFromDOM();
      refreshSetupSummary();

      if (field === 'wrapper') {
        const acc = state.portfolioAccounts.find(a => a.id === Number(accountId));
        if (acc) {
          R.applyWrapperFieldState(acc);
          // Re-sync after applyWrapperFieldState has corrected the DOM values
          // so state reflects the fixed alloc (e.g. Cash % = 100)
          syncAccountsFromDOM();
          refreshSetupSummary();
        }
      }
      if (field === 'owner') {
        R.refreshOwnerOptions(state.portfolioAccounts, getOwnerNames());
      }
      return;
    }

    if (e.target.name === 'bniEnabled') {
      applyBniState(e.target.value === 'true');
      return;
    }

    if (e.target.id === 'p2enabled') {
      state.p2enabled = e.target.checked;
      applyP2State();
      return;
    }
  });

  // ─────────────────────────────
  // GLOBAL CLICK DISPATCHER
  // ─────────────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.disabled || el.classList.contains('tab-btn--disabled')) return;

    const action = el.dataset.action;

    if (action === 'add-account')    return addAccount();
    if (action === 'remove-account') return removeAccount(el);
    if (action === 'run-projection') return runProjection();
    if (action === 'run-risk')       return runRisk();
    // load-setup and load-excel handled by direct ID listeners below

    if (action === 'switch-tab') {
      const tab = el.dataset.tab;
      if (state.activeTab === 'setup') syncSetupToAssumptions();
      state.activeTab = tab;
      // Restore metrics band when leaving results tab
      if (tab !== 'results') {
        const band = document.querySelector('.metrics-band');
        if (band) band.style.display = '';
      }
      // Reapply comma formatting to currency inputs when returning to setup
      if (tab === 'setup') {
        document.querySelectorAll('.currency-input').forEach(R.applyCurrencyFormattingToInput);
      }
      // Restore growth preset radio to match the current growth value
      if (tab === 'assumptions') {
        const growthVal = safeEl('growth')?.value?.trim();
        document.querySelectorAll('input[name="growthPreset"]').forEach(r => {
          r.checked = r.value === growthVal;
        });
      }
      return RetireTabs.switchTab(tab);
    }

    if (action === 'view-both') return CR.setView('both', el);
    if (action === 'view-p1')   return CR.setView('p1', el);
    if (action === 'view-p2')   return CR.setView('p2', el);
    if (action === 'real-on')   return CR.setReal(true, el);
    if (action === 'real-off')  return CR.setReal(false, el);

    if (action === 'mc-real-on')  return window.RetireMCRender?.setReal(true);
    if (action === 'mc-real-off') return window.RetireMCRender?.setReal(false);
  });

  // ─────────────────────────────
  // SAVE PORTFOLIO — ghost feedback on click
  // ─────────────────────────────
  const savePortfolioBtn = safeEl('savePortfolioBtn');
  if (savePortfolioBtn) {
    savePortfolioBtn.addEventListener('click', () => {
      triggerSaveFeedback(savePortfolioBtn, 'Save portfolio', saveSetupData);
    });
  }

  // ─────────────────────────────
  // LOAD EXCEL — ghost blue while file picker is open.
  // Resets on excel-loaded event (success) or after 8s fallback
  // (user cancelled the picker or load took too long).
  // ─────────────────────────────
  const loadExcelBtn = safeEl('loadExcelBtn');
  if (loadExcelBtn) {
    loadExcelBtn.addEventListener('click', () => {
      triggerLoadFeedback(loadExcelBtn, 'Load Excel', 8000);
      window.RetireExcelLoader.openFilePicker();
    });
  }

  // ─────────────────────────────
  // DELETE PORTFOLIO — inline confirm
  // ─────────────────────────────
  wireDeleteConfirm(
    'deletePortfolioBtn',
    'deletePortfolioConfirm',
    'confirmDeletePortfolioBtn',
    'cancelDeletePortfolioBtn',
    deletePortfolioData
  );

  // ─────────────────────────────
  // SAVE ASSUMPTIONS — ghost feedback on click
  // ─────────────────────────────
  const saveAssumptionsBtn = safeEl('saveAssumptionsBtn');
  if (saveAssumptionsBtn) {
    saveAssumptionsBtn.addEventListener('click', () => {
      triggerSaveFeedback(saveAssumptionsBtn, 'Save assumptions', saveAssumptionsData);
    });
  }

  // ─────────────────────────────
  // DELETE ASSUMPTIONS — inline confirm
  // ─────────────────────────────
  wireDeleteConfirm(
    'deleteAssumptionsBtn',
    'deleteAssumptionsConfirm',
    'confirmDeleteAssumptionsBtn',
    'cancelDeleteAssumptionsBtn',
    deleteAssumptionsData
  );

  // ─────────────────────────────
  // EXCEL LOAD
  // ─────────────────────────────
  document.addEventListener('excel-loaded', (e) => {
    // Reset the Load Excel button immediately when data arrives
    const loadExcelBtn = safeEl('loadExcelBtn');
    if (loadExcelBtn) resetLoadBtn(loadExcelBtn, 'Load Excel');
    const { accounts, params } = e.detail;

    state.portfolioAccounts = [];
    state.nextId = 1;

    const tbody = safeEl('acct-tbody');
    if (tbody) tbody.innerHTML = '';

    const ownerNames = [
      String(params.p1name || 'Person 1'),
      String(params.p2name || 'Person 2'),
    ];

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

    const MONEY = D.MONEY_FIELDS;
    Object.entries(params).forEach(([k, v]) => {
      if (k === 'p1name' || k === 'p2name') return;
      const el = safeEl(k);
      if (!el) return;

      if (el.type === 'checkbox') {
        el.checked = String(v).toLowerCase() === 'true';
        return;
      }

      if (el.type === 'radio') return;
      el.value = MONEY.has(k) ? formatCurrency(Number(v) || 0) : v;
    });

    if (params.thresholdMode) {
      const radio = document.querySelector(`input[name="thresholdMode"][value="${params.thresholdMode}"]`);
      if (radio) radio.checked = true;
    }

    if (params.bniEnabled !== undefined) {
      const bniRadio = document.querySelector(`input[name="bniEnabled"][value="${params.bniEnabled ? 'true' : 'false'}"]`);
      if (bniRadio) bniRadio.checked = true;
      applyBniState(!!params.bniEnabled);
    }

    if (params.p1DOB     && safeEl('sp-p1dob'))     safeEl('sp-p1dob').value     = params.p1DOB;
    if (params.p2DOB     && safeEl('sp-p2dob'))     safeEl('sp-p2dob').value     = params.p2DOB;
    if (params.startYear && safeEl('sp-startYear')) safeEl('sp-startYear').value = params.startYear;
    if (params.endYear   && safeEl('sp-endYear'))   safeEl('sp-endYear').value   = params.endYear;

    showToast(`Loaded ${accounts.length} accounts from Excel ✓`);
    updateSidebarNames();
    applyP2State();
    refreshPortfolioUI();
  });

  // ─────────────────────────────
  // STEPPER BUTTONS
  // ─────────────────────────────
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;

    const targetId = btn.dataset.stepFor;
    const dir      = Number(btn.dataset.stepDirection);
    const input    = targetId
      ? document.getElementById(targetId)
      : btn.closest('.stepper-input')?.querySelector('input');
    if (!input) return;

    const isCurrency = input.type === 'text';
    const step   = Number(btn.dataset.stepAmount) || Number(input.step) || 1;
    const val    = isCurrency ? (D.parseCurrency(input.value) || 0) : (Number(input.value) || 0);
    const min    = input.min !== '' ? Number(input.min) : -Infinity;
    const max    = input.max !== '' ? Number(input.max) :  Infinity;

    // Derive decimal places from step to avoid float drift (e.g. 4.2 not 4.199999…)
    const decimals  = (step.toString().split('.')[1] || '').length;
    const newVal    = parseFloat(Math.min(max, Math.max(min, val + dir * step)).toFixed(decimals));

    input.value = isCurrency ? D.formatCurrency(newVal) : newVal;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ─────────────────────────────
  // INIT
  // ─────────────────────────────
  refreshSetupSummary();
  R.initialiseCurrencyInputs();
  applyBniState(false);
  RetireTabs.init();
  CR.initResultsTabs();
  CR.initTableSelector();

  // ── Hide metrics band when Your outlook sub-tab is active ──────────────
  document.querySelectorAll('.results-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const band = document.querySelector('.metrics-band');
      if (!band) return;
      band.style.display = btn.dataset.resultsTab === 'outlook' ? 'none' : '';
    });
  });

  const savedPortfolio = localStorage.getItem(STORAGE_KEY);
  if (savedPortfolio) {
    try {
      applySetupInputs(JSON.parse(savedPortfolio));
    } catch (e) {
      console.error(e);
    }
  }

  const savedAssumptions = localStorage.getItem(ASSUMPTIONS_KEY);
  if (savedAssumptions) {
    try {
      applyAssumptionsInputs(JSON.parse(savedAssumptions));
    } catch (e) {
      console.error(e);
    }
  }

  // Gate tabs after everything is loaded — must run after RetireTabs.init()
  // so our disabled state wins over any defaults set by the tab system
  refreshPortfolioUI();

})();
