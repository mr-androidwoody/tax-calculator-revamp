(function () {
  const D = window.RetireData;
  const C = window.RetireCalc;
  const R = window.RetireRender;

  const state = {
    rows: [],
    viewPerson: 'both',
    useReal: true,
    activeTab: 'charts',
    charts: { incomeChart: null, taxChart: null, wealthChart: null },
    portfolioAccounts: [],
    nextId: 1,
    interestAccounts: [],
  };

  function ownerNames() {
    return [
      document.getElementById('sp-p1name').value.trim() || 'Woody',
      document.getElementById('sp-p2name').value.trim() || 'Heidi',
    ];
  }

  function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function getCurrencyValue(id) {
    return D.parseCurrency(getInputValue(id));
  }

  function getIntValue(id) {
    return parseInt(String(D.parseCurrency(getInputValue(id))), 10) || 0;
  }

  function applyGrowthPreset(preset) {
    const growthInput = document.getElementById('growth');
    const presetSelect = document.getElementById('growthPreset');
    if (!growthInput || !presetSelect) return;

    if (preset === 'defensive') {
      growthInput.value = '3.0';
    } else if (preset === 'baseline') {
      growthInput.value = '3.5';
    } else if (preset === 'optimistic') {
      growthInput.value = '4.5';
    }

    presetSelect.value = preset;
  }

  function syncGrowthPresetToValue() {
    const growthInput = document.getElementById('growth');
    const presetSelect = document.getElementById('growthPreset');
    if (!growthInput || !presetSelect) return;

    const value = parseFloat(growthInput.value);

    if (value === 3.0) {
      presetSelect.value = 'defensive';
    } else if (value === 3.5) {
      presetSelect.value = 'baseline';
    } else if (value === 4.5) {
      presetSelect.value = 'optimistic';
    } else {
      presetSelect.value = 'custom';
    }
  }    

  function handleInputOrChange(target) {
    if (target.matches('[data-action="setup-summary-input"]')) {
      refreshSetupSummary();
      return;
    }
    if (target.hasAttribute('data-account-id') && target.hasAttribute('data-field')) {
      updateAccount(parseInt(target.getAttribute('data-account-id'), 10), target.getAttribute('data-field'), target.value);
      return;
    }
    if (target.id === 'growthPreset') {
      applyGrowthPreset(target.value);
      return;
    }
    if (target.id === 'growth') {
      syncGrowthPresetToValue();
     return;
    }
    if (target.id === 'bniEnabled') {
      document.getElementById('bni-fields').style.display = target.checked ? '' : 'none';
    }
  } 

  function refreshSetupSummary() {
    R.refreshOwnerOptions(state.portfolioAccounts, ownerNames());
    const summary = C.summarisePortfolio(state.portfolioAccounts);
    R.renderSetupSummary(summary);
    state.portfolioAccounts.forEach((acc) => {
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });
  }

  function preload() {
    Object.entries(D.PRELOAD).forEach(([k, val]) => {
      const el = document.getElementById(k);
      if (!el) return;
      el.value = D.MONEY_FIELDS.has(k) && val !== '' ? D.formatCurrency(val) : val;
    });
    const tm = document.getElementById('thresholdFrozen');
    if (tm) tm.checked = true;
    const bniCb = document.getElementById('bniEnabled');
    if (bniCb) {
      bniCb.checked = true;
      document.getElementById('bni-fields').style.display = '';
    }
  }

  function toggleSection(titleEl) {
    const body = titleEl.nextElementSibling;
    const chevron = titleEl.querySelector('.section-chevron');
    const nowCollapsed = body.classList.toggle('collapsed');
    if (chevron) chevron.textContent = nowCollapsed ? '▸' : '▾';
    syncExpandBtn();
  }

  function syncExpandBtn() {
    const btn = document.getElementById('expand-all-btn');
    if (!btn) return;
    const allOpen = Array.from(document.querySelectorAll('[data-collapsible] .section-body')).every((b) => !b.classList.contains('collapsed'));
    btn.textContent = allOpen ? 'Close all' : 'Expand all';
  }

  function toggleAllSections() {
    const bodies = Array.from(document.querySelectorAll('[data-collapsible] .section-body'));
    const allOpen = bodies.every((b) => !b.classList.contains('collapsed'));
    bodies.forEach((b) => {
      const chevron = b.previousElementSibling && b.previousElementSibling.querySelector('.section-chevron');
      if (allOpen) {
        b.classList.add('collapsed');
        if (chevron) chevron.textContent = '▸';
      } else {
        b.classList.remove('collapsed');
        if (chevron) chevron.textContent = '▾';
      }
    });
    syncExpandBtn();
  }

  function addAccount(data) {
    const result = C.addAccount(state.portfolioAccounts, state.nextId, data);
    state.portfolioAccounts = result.accounts;
    state.nextId = result.nextId;
    R.renderAccountRow(result.account, ownerNames());
    R.updateRowBadge(result.account);
    refreshSetupSummary();
  }

  function removeAccount(id) {
    state.portfolioAccounts = C.removeAccount(state.portfolioAccounts, id);
    const row = document.getElementById('acct-row-' + id);
    if (row) row.remove();
    refreshSetupSummary();
  }

  function updateAccount(id, field, value) {
    state.portfolioAccounts = C.updateAccount(state.portfolioAccounts, id, field, value);
    const acc = state.portfolioAccounts.find((a) => a.id === id);
    if (!acc) return;
    R.applyWrapperFieldState(acc);
    R.updateRowBadge(acc);
    refreshSetupSummary();
  }

  function preloadSetup() {
    state.portfolioAccounts = [];
    state.nextId = 1;
    document.getElementById('acct-tbody').innerHTML = '';
    D.PRELOAD_ACCOUNTS.forEach((a) => addAccount({ ...a, alloc: { ...a.alloc } }));
    R.initialiseCurrencyInputs();
    refreshSetupSummary();
  }

  function continueToMain() {
    const names = ownerNames();
    const handoff = C.continueToMainData(state.portfolioAccounts, names[0], names[1]);
    Object.entries(handoff.mainValues).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (val === undefined || val === null || val === '') {
        el.value = '';
      } else {
        el.value = D.MONEY_FIELDS.has(id) ? D.formatCurrency(val) : val;
      }
    });
    state.interestAccounts = handoff.interestAccounts;
    R.updateInterestAccountsBanner(state.interestAccounts);
    R.renderHandoffBanner(handoff.banner);
    document.getElementById('setup-page').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
  }

  function backToSetup() {
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('setup-page').style.display = 'block';
  }

  function readProjectionInputs() {
    const names = ownerNames();
    return {
      p1name: names[0],
      p2name: names[1],
      woodyDOB: getIntValue('woodyDOB'),
      heidiDOB: getIntValue('heidiDOB'),
      startYear: getIntValue('startYear'),
      endYear: getIntValue('endYear'),
      spending: getCurrencyValue('spending'),
      stepDownPct: getIntValue('stepDownPct'),
      heidiSalary: getCurrencyValue('heidiSalary'),
      heidiSalaryStopAge: getIntValue('heidiSalaryStopAge'),
      woodySPAge: getIntValue('woodySPAge'),
      woodySP: getCurrencyValue('woodySP'),
      heidiSPAge: getIntValue('heidiSPAge'),
      heidiSP: getCurrencyValue('heidiSP'),
      woodyCash: getCurrencyValue('woodyCash'),
      heidiCash: getCurrencyValue('heidiCash'),
      woodySIPP: getCurrencyValue('woodySIPP'),
      heidiSIPP: getCurrencyValue('heidiSIPP'),
      woodyISA: getCurrencyValue('woodyISA'),
      heidiISA: getCurrencyValue('heidiISA'),
      woodyGIA: getCurrencyValue('woodyGIA'),
      heidiGIA: getCurrencyValue('heidiGIA'),
      woodyOrder1: getInputValue('woodyOrder1'),
      woodyOrder2: getInputValue('woodyOrder2'),
      woodyOrder3: getInputValue('woodyOrder3'),
      woodyOrder4: getInputValue('woodyOrder4'),
      heidiOrder1: getInputValue('heidiOrder1'),
      heidiOrder2: getInputValue('heidiOrder2'),
      heidiOrder3: getInputValue('heidiOrder3'),
      heidiOrder4: getInputValue('heidiOrder4'),
      growth: getCurrencyValue('growth'),
      inflation: getCurrencyValue('inflation'),
      thresholdMode: document.querySelector('input[name="thresholdMode"]:checked')?.value || 'frozen',
      thresholdFromYearVal: parseInt(document.getElementById('thresholdFromYearVal')?.value, 10) || 2028,
      bniEnabled: document.getElementById('bniEnabled')?.checked || false,
      bniWoodyGIA: getCurrencyValue('bniWoodyGIA'),
      bniHeidiGIA: getCurrencyValue('bniHeidiGIA'),
      interestAccounts: state.interestAccounts.map((a) => ({ ...a })),
    };
  }

  function runProjection() {
    const inputs = readProjectionInputs();
    if (!inputs.startYear || !inputs.endYear || inputs.endYear <= inputs.startYear) {
      alert('Please enter valid start and end years.');
      return;
    }
    const result = C.runProjection(inputs);
    state.rows = result.rows;
    R.renderAlerts(result.depletions);
    R.renderMetrics(state.rows, state.viewPerson, state.useReal);
    R.renderCharts(state.rows, state.viewPerson, state.useReal, state.charts);
    if (state.activeTab === 'tables') {
      R.renderTables(state.rows, state.useReal);
    }
  }

  function setView(vp, btn) {
    state.viewPerson = vp;
    btn.closest('.toggle-group').querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    R.renderCharts(state.rows, state.viewPerson, state.useReal, state.charts);
    R.renderMetrics(state.rows, state.viewPerson, state.useReal);
  }

  function setReal(r, btn) {
    state.useReal = r;
    btn.closest('.toggle-group').querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    R.renderCharts(state.rows, state.viewPerson, state.useReal, state.charts);
    R.renderMetrics(state.rows, state.viewPerson, state.useReal);
    if (document.getElementById('tables-panel').style.display !== 'none') {
      R.renderTables(state.rows, state.useReal);
    }
  }

  function setTab(tab, btn) {
    state.activeTab = tab;
    btn.closest('.toggle-group').querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const charts = document.querySelector('.charts');
    const tables = document.getElementById('tables-panel');
    if (tab === 'charts') {
      charts.style.display = 'flex';
      tables.style.display = 'none';
    } else {
      charts.style.display = 'none';
      tables.style.display = 'flex';
      R.renderTables(state.rows, state.useReal);
    }
  }

  function handleActionClick(target) {
    const actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');
    switch (action) {
      case 'preload-setup': preloadSetup(); break;
      case 'continue-to-main': continueToMain(); break;
      case 'back-to-setup': backToSetup(); break;
      case 'preload-main': preload(); break;
      case 'run-projection': runProjection(); break;
      case 'toggle-section': toggleSection(actionEl); break;
      case 'toggle-all-sections': toggleAllSections(); break;
      case 'add-account': addAccount(); break;
      case 'remove-account': removeAccount(parseInt(actionEl.getAttribute('data-account-id'), 10)); break;
      case 'set-view': setView(actionEl.getAttribute('data-value'), actionEl); break;
      case 'set-real': setReal(actionEl.getAttribute('data-value') === 'true', actionEl); break;
      case 'set-tab': setTab(actionEl.getAttribute('data-value'), actionEl); break;
      default: break;
    }
  }

  function init() {
    R.initialiseCurrencyInputs();
    refreshSetupSummary();
    initCurrencyFocusHandlers();
    document.addEventListener('click', (e) => handleActionClick(e.target));
    document.addEventListener('input', (e) => handleInputOrChange(e.target));
    document.addEventListener('change', (e) => handleInputOrChange(e.target));
    syncGrowthPresetToValue();
  }

  window.RetireApp = {
    state,
    preload,
    preloadSetup,
    continueToMain,
    backToSetup,
    runProjection,
    addAccount,
    removeAccount,
    updateAccount,
  };

  document.addEventListener('DOMContentLoaded', init);
}());
