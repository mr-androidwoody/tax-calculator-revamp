(function () {
  const D = window.RetireData;
  const C = window.RetireCalc;
  const R = window.RetireRender;

  const STORAGE_KEY = 'rukRetirementSetup';

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

  // ─────────────────────────────────────────────
  // PEOPLE / NAMES
  // ─────────────────────────────────────────────
  function ownerNames() {
    return [
      document.getElementById('sp-p1name').value.trim() || 'Person 1',
      document.getElementById('sp-p2name').value.trim() || 'Person 2',
    ];
  }

  // ─────────────────────────────────────────────
  // INPUT HELPERS
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GROWTH PRESET
  // ─────────────────────────────────────────────
  function applyGrowthPreset(preset) {
    const growthInput = document.getElementById('growth');
    const presetSelect = document.getElementById('growthPreset');
    if (!growthInput || !presetSelect) return;

    if (preset === 'defensive') growthInput.value = '3.0';
    else if (preset === 'baseline') growthInput.value = '3.5';
    else if (preset === 'optimistic') growthInput.value = '4.5';

    presetSelect.value = preset;
  }

  function syncGrowthPresetToValue() {
    const growthInput = document.getElementById('growth');
    const presetSelect = document.getElementById('growthPreset');
    if (!growthInput || !presetSelect) return;

    const value = parseFloat(growthInput.value);

    if (value === 3.0) presetSelect.value = 'defensive';
    else if (value === 3.5) presetSelect.value = 'baseline';
    else if (value === 4.5) presetSelect.value = 'optimistic';
    else presetSelect.value = 'custom';
  }

  // ─────────────────────────────────────────────
  // 🔴 CRITICAL FIX: DOM → STATE SYNC
  // ─────────────────────────────────────────────
  function syncAccountsFromDOM() {
    const rows = document.querySelectorAll('#acct-tbody tr');

    const updated = [];

    rows.forEach((row) => {
      const id = Number(row.id.replace('acct-row-', ''));

      const get = (field) =>
        row.querySelector(`[data-field="${field}"]`);

      updated.push({
        id,
        name: get('name')?.value || '',
        wrapper: get('wrapper')?.value || 'GIA',
        owner: get('owner')?.value || 'p1',
        value: D.parseCurrency(get('value')?.value || 0),
        alloc: {
          equities: Number(get('equities')?.value || 0),
          bonds: Number(get('bonds')?.value || 0),
          cashlike: Number(get('cashlike')?.value || 0),
          cash: Number(get('cash')?.value || 0),
        },
        rate: get('rate')?.value ? Number(get('rate').value) : null,
        monthlyDraw: get('monthlyDraw')?.value
          ? D.parseCurrency(get('monthlyDraw').value)
          : null,
      });
    });

    state.portfolioAccounts = updated;
  }

  // ─────────────────────────────────────────────
  // SETUP STATE
  // ─────────────────────────────────────────────
  function readSetupInputs() {
    return {
      version: 1,
      people: {
        p1: {
          name: document.getElementById('sp-p1name').value.trim(),
          age: parseInt(document.getElementById('sp-p1age').value, 10) || 0,
        },
        p2: {
          name: document.getElementById('sp-p2name').value.trim(),
          age: parseInt(document.getElementById('sp-p2age').value, 10) || 0,
        },
      },
      accounts: state.portfolioAccounts,
    };
  }

  function applySetupInputs(data) {
    document.getElementById('sp-p1name').value = data.people.p1.name || '';
    document.getElementById('sp-p1age').value = data.people.p1.age || '';
    document.getElementById('sp-p2name').value = data.people.p2.name || '';
    document.getElementById('sp-p2age').value = data.people.p2.age || '';

    state.portfolioAccounts = data.accounts || [];
    state.nextId =
      Math.max(1, ...state.portfolioAccounts.map((a) => a.id || 0)) + 1;

    document.getElementById('acct-tbody').innerHTML = '';

    state.portfolioAccounts.forEach((acc) => {
      R.renderAccountRow(acc, ownerNames());
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });

    refreshSetupSummary();
  }

  // ─────────────────────────────────────────────
  // SAVE / LOAD
  // ─────────────────────────────────────────────
  function saveSetup() {
    syncAccountsFromDOM(); // ← FIX

    const data = readSetupInputs();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    console.log('Saved setup:', data);
  }

  function loadSetup() {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      alert('No saved setup found.');
      return;
    }

    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) throw new Error();

      applySetupInputs(data);
    } catch {
      alert('Saved data is corrupted.');
    }
  }

  // ─────────────────────────────────────────────
  // SETUP SUMMARY
  // ─────────────────────────────────────────────
  function refreshSetupSummary() {
    R.refreshOwnerOptions(state.portfolioAccounts, ownerNames());

    const summary = C.summarisePortfolio(state.portfolioAccounts);
    R.renderSetupSummary(summary);

    state.portfolioAccounts.forEach((acc) => {
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });
  }

  // ─────────────────────────────────────────────
  // ACCOUNT MANAGEMENT
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // EVENT HANDLING
  // ─────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const action = e.target.dataset.action;

    if (!action) return;

    if (action === 'add-account') addAccount({});
    if (action === 'remove-account') removeAccount(Number(e.target.dataset.accountId));
    if (action === 'save-setup') saveSetup();
    if (action === 'load-setup') loadSetup();

    if (action === 'continue-to-main') {
      document.getElementById('setup-page').style.display = 'none';
      document.getElementById('main-app').style.display = '';
    }

    if (action === 'back-to-setup') {
      document.getElementById('setup-page').style.display = '';
      document.getElementById('main-app').style.display = 'none';
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.dataset.action === 'setup-summary-input') {
      refreshSetupSummary();
    }
  });

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────
  refreshSetupSummary();
})();