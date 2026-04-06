(function () {
  const PRELOAD = {
    woodyDOB: 1968,
    heidiDOB: 1967,
    startYear: 2026,
    endYear: 2060,
    spending: 45000,
    stepDownPct: 0,
    heidiSalary: 15000,
    heidiSalaryStopAge: 63,
    woodySPAge: 67,
    woodySP: 12000,
    heidiSPAge: 67,
    heidiSP: 12547,
    growth: 4,
    inflation: 2.5,
    thresholdFromYearVal: 2028,
    bniWoodyGIA: 20000,
    bniHeidiGIA: 5000,
  };

  const TAX_RULES = {
    '2026-27': {
      PA: 12570,
      basicLimit: 50270,
      additionalThreshold: 125140,
      taperStart: 100000,
      nonSavingsRates: { basic: 0.20, higher: 0.40, additional: 0.45 },
      savingsRates: { basic: 0.20, higher: 0.40, additional: 0.45 },
      dividendRates: { basic: 0.1075, higher: 0.3575, additional: 0.3935 },
      dividendAllowance: 500,
      psa: { basic: 1000, higher: 500, additional: 0 },
      srsLimit: 5000,
      cgtExempt: 3000,
      cgtRates: { basic: 0.18, higher: 0.24 },
      ni: {
        primaryThreshold: 12570,
        upperEarningsLimit: 50270,
        mainRate: 0.08,
        upperRate: 0.02,
      },
    },
    '2027-28+': {
      PA: 12570,
      basicLimit: 50270,
      additionalThreshold: 125140,
      taperStart: 100000,
      nonSavingsRates: { basic: 0.20, higher: 0.40, additional: 0.45 },
      savingsRates: { basic: 0.22, higher: 0.42, additional: 0.47 },
      dividendRates: { basic: 0.1075, higher: 0.3575, additional: 0.3935 },
      dividendAllowance: 500,
      psa: { basic: 1000, higher: 500, additional: 0 },
      srsLimit: 5000,
      cgtExempt: 3000,
      cgtRates: { basic: 0.18, higher: 0.24 },
      ni: {
        primaryThreshold: 12570,
        upperEarningsLimit: 50270,
        mainRate: 0.08,
        upperRate: 0.02,
      },
    },
  };

  const MONEY_FIELDS = new Set([
    'spending',
    'heidiSalary',
    'woodySP',
    'heidiSP',
    'woodyCash',
    'heidiCash',
    'woodySIPP',
    'heidiSIPP',
    'woodyISA',
    'heidiISA',
    'woodyGIA',
    'heidiGIA',
    'bniWoodyGIA',
    'bniHeidiGIA',
  ]);

  const WRAPPERS = ['ISA', 'SIPP', 'GIA', 'Cash'];
  const ALLOC_CLASSES = ['equities', 'bonds', 'cashlike', 'cash'];
  const FIXED_CASH_WRAPPERS = new Set(['Cash']);
  const ISA_ALLOWANCE = 20000;

  // IMPORTANT: owner now uses 'p1' / 'p2' — NOT names
  const PRELOAD_ACCOUNTS = [
    {
      name: 'SIPP',
      wrapper: 'SIPP',
      owner: 'p1',
      value: 450000,
      alloc: { equities: 65, bonds: 35, cashlike: 0, cash: 0 },
      rate: null,
      monthlyDraw: null,
    },
    {
      name: 'SIPP',
      wrapper: 'SIPP',
      owner: 'p2',
      value: 190000,
      alloc: { equities: 65, bonds: 35, cashlike: 0, cash: 0 },
      rate: null,
      monthlyDraw: null,
    },
    {
      name: 'ISA',
      wrapper: 'ISA',
      owner: 'p1',
      value: 260000,
      alloc: { equities: 100, bonds: 0, cashlike: 0, cash: 0 },
      rate: null,
      monthlyDraw: null,
    },
    {
      name: 'ISA',
      wrapper: 'ISA',
      owner: 'p2',
      value: 140000,
      alloc: { equities: 100, bonds: 0, cashlike: 0, cash: 0 },
      rate: null,
      monthlyDraw: null,
    },
    {
      name: 'GIA',
      wrapper: 'GIA',
      owner: 'p1',
      value: 150000,
      alloc: { equities: 100, bonds: 0, cashlike: 0, cash: 0 },
      rate: null,
      monthlyDraw: null,
    },
    {
      name: 'QMMF',
      wrapper: 'GIA',
      owner: 'p1',
      value: 420000,
      alloc: { equities: 0, bonds: 0, cashlike: 100, cash: 0 },
      rate: 4.5,
      monthlyDraw: null,
    },
    {
      name: 'Cash',
      wrapper: 'Cash',
      owner: 'p1',
      value: 100000,
      alloc: { equities: 0, bonds: 0, cashlike: 0, cash: 100 },
      rate: null,
      monthlyDraw: null,
    },
  ];

  function parseCurrency(val) {
    if (val === null || val === undefined) return 0;
    return Number(String(val).replace(/[^0-9.-]+/g, '')) || 0;
  }

  function formatCurrency(val) {
    if (val === null || val === undefined || val === '') return '';
    return Number(val).toLocaleString('en-GB');
  }

  function formatMoney(val) {
    if (val === null || val === undefined) return '£0';
    return '£' + Number(val).toLocaleString('en-GB');
  }

  window.RetireData = {
    PRELOAD,
    TAX_RULES,
    MONEY_FIELDS,
    WRAPPERS,
    ALLOC_CLASSES,
    FIXED_CASH_WRAPPERS,
    ISA_ALLOWANCE,
    PRELOAD_ACCOUNTS,
    parseCurrency,
    formatCurrency,
    formatMoney,
  };
})();