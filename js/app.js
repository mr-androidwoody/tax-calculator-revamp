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
      inflation:         safeValue('inflation'),
      thresholdMode:     document.querySelector('input[name="thresholdMode"]:checked')?.value || 'frozen',
      thresholdFromYear: safeValue('thresholdFromYearVal'),
      withdrawalMode:    document.querySelector('input[name="withdrawalMode"]:checked')?.value || 'tax-aware',
      p1Order1:          safeValue('p1Order1'),
      p1Order2:          safeValue('p1Order2'),
      p1Order3:          safeValue('p1Order3'),
      p2Order1:          safeValue('p2Order1'),
      p2Order2:          safeValue('p2Order2'),
      p2Order3:          safeValue('p2Order3'),
      bniEnabled:        document.querySelector('input[name="bniEnabled"]:checked')?.value === 'true',
      bniP1GIA:          safeValue('bniP1GIA'),
      bniP2GIA:          safeValue('bniP2GIA'),
      dividendYield:     safeValue('dividendYield'),
      dividendMode:      document.querySelector('input[name="dividendMode"]:checked')?.value ?? 'payout',
    };
  }

  function applySetupInputs(data) {
    if (!data) return;

    const sv = (id, val) => { const el = safeEl(id); if (el && val != null) el.value = val; };
    sv('sp-p1name',       data.people?.p1?.name          || '');
    sv('sp-p1dob',        data.people?.p1?.dob           || '');
    sv('p1SPAge',         data.people?.p1?.spAge         || '');
    sv('p1SP',            data.people?.p1?.sp            || '');
    sv('p1Salary',        data.people?.p1?.salary        || '');
    sv('p1SalaryStopAge', data.people?.p1?.salaryStopAge || '');
    sv('sp-p2name',       data.people?.p2?.name          || '');
    sv('sp-p2dob',        data.people?.p2?.dob           || '');
    sv('p2SPAge',         data.people?.p2?.spAge         || '');
    sv('p2SP',            data.people?.p2?.sp            || '');
    sv('p2Salary',        data.people?.p2?.salary        || '');
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
  }

  function applyAssumptionsInputs(a) {
    if (!a) return;

    const sv = (id, val) => { const el = safeEl(id); if (el && val != null) el.value = val; };

    sv('spending',             a.spending);
    sv('stepDownPct',          a.stepDownPct);
    sv('growth',               a.growth);
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
    if (a.withdrawalMode) {
      const r = document.querySelector(`input[name="withdrawalMode"][value="${a.withdrawalMode}"]`);
      if (r) r.checked = true;
    }

    ['p1Order1','p1Order2','p1Order3','p2Order1','p2Order2','p2Order3']
      .forEach(id => sv(id, a[id]));

    const bniRadio = document.querySelector(`input[name="bniEnabled"][value="${a.bniEnabled ? 'true' : 'false'}"]`);
    if (bniRadio) bniRadio.checked = true;
    applyBniState(!!a.bniEnabled);

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
  }

  function deleteAssumptionsData() {
    localStorage.removeItem(ASSUMPTIONS_KEY);
    applyAssumptionsInputs({
      spending: '', stepDownPct: '0', growth: '', inflation: '',
      thresholdMode: 'frozen', withdrawalMode: 'tax-aware',
      dividendYield: '1.5', bniEnabled: false,
    });
    showToast('Assumptions deleted');
  }

  function deletePortfolioData() {
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
    'p2Order1', 'p2Order2', 'p2Order3', 'bniP2GIA',
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
    let banner = safeEl('handoff-banner');
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
  // GATHER INPUTS
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
      bniP2GIA:          (bniEnabled && state.p2enabled) ? gv('bniP2GIA') : 0,
      dividendYield:     (parseFloat(safeEl('dividendYield')?.value) || 1.5) / 100,
      dividendMode:      document.querySelector('input[name="dividendMode"]:checked')?.value ?? 'payout',
      withdrawalMode:    document.querySelector('input[name="withdrawalMode"]:checked')?.value || '50/50',
      p1Bal: {
        Cash: gv('p1Cash'), GIA: gv('p1GIA'), SIPP: gv('p1SIPP'), ISA: gv('p1ISA'),
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

      CR.setResults(result);
      CR.renderMetrics();
      CR.renderCharts();
      RetireTabs.switchTab('results');
      state.activeTab = 'results';

      // Mark Risk Outcomes stale and re-enable the Run risk outcomes button.
      _setRiskReady(false);
      const riskRunBtn = safeEl('runRiskBtn');
      if (riskRunBtn) {
        riskRunBtn.disabled = false;
        riskRunBtn.classList.remove('btn-run-risk--disabled');
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
    const tabBtn = document.querySelector('.results-tab[data-results-tab="risk"]');
    if (!tabBtn) return;
    tabBtn.classList.toggle('results-tab--risk-ready', ready);
  }

  async function runRisk() {
    const inputs = state.lastInputs;
    if (!inputs) {
      showToast('Run a projection first', true);
      return;
    }

    const MCE = window.RetireMCEngine;
    if (!MCE) {
      showToast('MC engine not loaded', true);
      return;
    }

    const riskRunBtn = safeEl('runRiskBtn');
    const originalLabel = riskRunBtn ? riskRunBtn.textContent : 'Run risk outcomes';
    if (riskRunBtn) {
      riskRunBtn.textContent = 'Simulating…';
      riskRunBtn.classList.add('btn-loading');
      riskRunBtn.disabled = true;
    }

    function resetBtn() {
      if (!riskRunBtn) return;
      riskRunBtn.textContent = originalLabel;
      riskRunBtn.classList.remove('btn-loading');
      riskRunBtn.disabled = false;
    }

    try {
      const result = await MCE.run({
        inputs,
        simCount:     10_000,
        equityVol:    0.16,
        inflationVol: 0.015,
      });

      // Disable until next projection run.
      if (riskRunBtn) {
        riskRunBtn.textContent = originalLabel;
        riskRunBtn.classList.remove('btn-loading');
        riskRunBtn.disabled = true;
        riskRunBtn.classList.add('btn-run-risk--disabled');
      }

      const MCR = window.RetireMCRender;
      if (!MCR) throw new Error('RetireMCRender not loaded');
      MCR.setResults(result);
      MCR.render();

      // Switch to Results → Risk Outcomes sub-tab and mark ready (red).
      RetireTabs.switchTab('results');
      state.activeTab = 'results';
      const riskTabBtn = document.querySelector('.results-tab[data-results-tab="risk"]');
      if (riskTabBtn) riskTabBtn.click();
      _setRiskReady(true);

    } catch (err) {
      resetBtn();
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
        if (acc) { R.applyWrapperFieldState(acc); syncAccountsFromDOM(); }
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
      return RetireTabs.switchTab(tab);
    }

    if (action === 'view-both') return CR.setView('both', el);
    if (action === 'view-p1')   return CR.setView('p1', el);
    if (action === 'view-p2')   return CR.setView('p2', el);
    if (action === 'real-on')   return CR.setReal(true, el);
    if (action === 'real-off')  return CR.setReal(false, el);
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

    if (params.p1DOB && safeEl('sp-p1dob')) safeEl('sp-p1dob').value = params.p1DOB;
    if (params.p2DOB && safeEl('sp-p2dob')) safeEl('sp-p2dob').value = params.p2DOB;

    showToast(`Loaded ${accounts.length} accounts from Excel ✓`);
    updateSidebarNames();
    applyP2State();
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

})();
