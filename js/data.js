(function () {
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
    'p2Salary',
    'p1Salary',
    'p1SP',
    'p2SP',
    'p1Cash',
    'p2Cash',
    'p1SIPP',
    'p2SIPP',
    'p1ISA',
    'p2ISA',
    'p1GIA',
    'p2GIA',
    'bniP1GIA',
    'bniP2GIA',
  ]);

  const WRAPPERS = ['ISA', 'SIPP', 'GIA', 'Cash'];
  const ALLOC_CLASSES = ['equities', 'bonds', 'cashlike', 'cash'];
  const FIXED_CASH_WRAPPERS = new Set(['Cash']);
  const ISA_ALLOWANCE = 20000;

  function parseCurrency(val) {
    if (val === null || val === undefined) return 0;
    return Number(String(val).replace(/[^0-9.-]+/g, '')) || 0;
  }

  function formatCurrency(val) {
    if (val === null || val === undefined || val === '') return '';
    return Math.round(Number(val)).toLocaleString('en-GB');
  }

  function formatMoney(val) {
    if (val === null || val === undefined) return '£0';
    return '£' + Math.round(Number(val)).toLocaleString('en-GB');
  }

  window.RetireData = {
    TAX_RULES,
    MONEY_FIELDS,
    WRAPPERS,
    ALLOC_CLASSES,
    FIXED_CASH_WRAPPERS,
    ISA_ALLOWANCE,
    parseCurrency,
    formatCurrency,
    formatMoney,
  };
})();