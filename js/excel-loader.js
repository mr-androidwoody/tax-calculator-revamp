(function () {

  // ─────────────────────────────────────────────
  // LABEL → ELEMENT ID MAP
  // Parameters sheet col A (human label) → DOM element ID
  // ─────────────────────────────────────────────
  const PARAM_MAP = {
    'Person 1 – birth year':                    'p1DOB',
    'Person 2 – birth year':                    'p2DOB',
    'Person 1 name':                            'p1name',
    'Person 2 name':                            'p2name',
    'Start year':                               'startYear',
    'End year':                                 'endYear',
    'Annual household spending (£)':            'spending',
    'Step-down at age 75 (%)':                  'stepDownPct',
    'Person 1 – gross annual salary (£)':       'p1Salary',
    'Person 1 – salary stop age':               'p1SalaryStopAge',
    'Gross annual salary (£)':                  'p2Salary',
    'Stop age':                                 'p2SalaryStopAge',
    'Person 1 – start age':                     'p1SPAge',
    'Person 1 – annual amount (£)':             'p1SP',
    'Person 2 – start age':                     'p2SPAge',
    'Person 2 – annual amount (£)':             'p2SP',
    'Portfolio growth (%/yr)':                  'growth',
    'Inflation (%/yr)':                         'inflation',
    'Threshold uprating mode':                  'thresholdMode',
    'Uprate from year':                         'thresholdFromYearVal',
    'Enable bed-and-ISA':                       'bniEnabled',
    'Person 1 GIA→ISA per year (£)':            'bniP1GIA',
    'Person 2 GIA→ISA per year (£)':            'bniP2GIA',
  };

  // Reverse map: human label keyed by elementId — used for friendly error messages
  const ID_TO_LABEL = Object.fromEntries(
    Object.entries(PARAM_MAP).map(([label, id]) => [id, label])
  );

  const REQUIRED_IDS = ['p1DOB', 'p2DOB', 'startYear', 'endYear', 'spending'];

  // ─────────────────────────────────────────────
  // FUZZY LABEL LOOKUP (Option B)
  // Normalise: lowercase, collapse whitespace, strip –-()£%/
  // Pre-computed once at module load.
  // ─────────────────────────────────────────────
  function normaliseLabel(s) {
    return s
      .toLowerCase()
      .replace(/[–\-\(\)£%\/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const NORMALISED_PARAM_MAP = Object.fromEntries(
    Object.entries(PARAM_MAP).map(([label, id]) => [normaliseLabel(label), id])
  );

  // ─────────────────────────────────────────────
  // WRAPPER NORMALISATION
  // Accept SIPP/WP as a synonym for SIPP.
  // Normalise to canonical form before storage.
  // ─────────────────────────────────────────────
  const WRAPPER_SYNONYMS = {
    'SIPP/WP': 'SIPP',
  };

  const VALID_WRAPPERS = new Set(['ISA', 'SIPP', 'GIA', 'Cash']);

  function normaliseWrapper(raw) {
    const trimmed = String(raw || '').trim();
    // Try exact match first (preserves 'Cash' mixed-case)
    if (VALID_WRAPPERS.has(trimmed)) return trimmed;
    // Try case-insensitive synonym lookup
    const upper = trimmed.toUpperCase();
    for (const [synonym, canonical] of Object.entries(WRAPPER_SYNONYMS)) {
      if (upper === synonym.toUpperCase()) return canonical;
    }
    // Try case-insensitive match against valid wrappers
    for (const w of VALID_WRAPPERS) {
      if (w.toUpperCase() === upper) return w;
    }
    // Return original (will fail validation with a clear message)
    return trimmed;
  }

  // Allocation defaults by wrapper
  const ALLOC_DEFAULTS = {
    ISA:  { equities: 100, bonds: 0, cashlike: 0, cash: 0 },
    SIPP: { equities: 100, bonds: 0, cashlike: 0, cash: 0 },
    GIA:  { equities: 100, bonds: 0, cashlike: 0, cash: 0 },
    Cash: { equities: 0,   bonds: 0, cashlike: 0, cash: 100 },
  };

  // ─────────────────────────────────────────────
  // PUBLIC: trigger file picker
  // ─────────────────────────────────────────────
  function openFilePicker() {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.xlsx,.xls';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (file) readFile(file);
      document.body.removeChild(input);
    });
    input.click();
  }

  // ─────────────────────────────────────────────
  // READ FILE via SheetJS
  // ─────────────────────────────────────────────
  function readFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = XLSX.read(data, { type: 'array' });
        parseWorkbook(wb);
      } catch (err) {
        console.error('Excel load error:', err);
        alert('Failed to read Excel file – see console.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ─────────────────────────────────────────────
  // PARSE WORKBOOK
  // ─────────────────────────────────────────────
  function parseWorkbook(wb) {
    const accounts = parseAccounts(wb);
    const params   = parseParams(wb);
    const errors   = validate(accounts, params);

    if (errors.length) {
      alert('Excel load issues:\n\n' + errors.join('\n'));
      return;
    }

    document.dispatchEvent(new CustomEvent('excel-loaded', {
      detail: { accounts, params }
    }));
  }

  // ─────────────────────────────────────────────
  // SHEET 1 — Accounts
  // Columns: name, wrapper, owner, value,
  //          equities, bonds, cashlike, cash,
  //          rate, monthlyDraw, notes (ignored)
  // Row 1 = title, Row 2 = headers, Row 3+ = data
  // ─────────────────────────────────────────────
  function parseAccounts(wb) {
    const sheet = wb.Sheets['Accounts'];
    if (!sheet) throw new Error('No "Accounts" sheet found.');

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      range:  2,
    });

    const accounts = [];

    rows.forEach((row) => {
      const name    = String(row[0] || '').trim();
      const wrapper = normaliseWrapper(row[1]);
      // Skip rows with no name or unrecognisable wrapper
      if (!name || (!VALID_WRAPPERS.has(wrapper) && wrapper === String(row[1] || '').trim())) {
        // If name is present but wrapper is unrecognisable, still push so validate() can report it
        if (name) {
          accounts.push({ name, wrapper, owner: String(row[2] || 'p1').trim(),
            value: parseNum(row[3]),
            alloc: { equities: 0, bonds: 0, cashlike: 0, cash: 0 },
            rate: null, monthlyDraw: null, _rawWrapper: String(row[1] || '').trim() });
        }
        return;
      }
      if (!name) return;

      const owner       = String(row[2] || 'p1').trim();
      const value       = parseNum(row[3]);
      const equities    = parseNum(row[4]);
      const bonds       = parseNum(row[5]);
      const cashlike    = parseNum(row[6]);
      const cash        = parseNum(row[7]);
      const rate        = row[8] !== '' && row[8] !== null ? parseNum(row[8]) : null;
      const monthlyDraw = row[9] !== '' && row[9] !== null ? parseNum(row[9]) : null;

      // Apply wrapper-based allocation defaults when all four columns are blank/zero
      const allAllocBlank = [row[4], row[5], row[6], row[7]]
        .every(v => v === '' || v === null || v === undefined);
      const alloc = allAllocBlank
        ? { ...ALLOC_DEFAULTS[wrapper] }
        : { equities, bonds, cashlike, cash };

      accounts.push({ name, wrapper, owner, value, alloc, rate, monthlyDraw });
    });

    return accounts;
  }

  // ─────────────────────────────────────────────
  // SHEET 2 — Parameters
  // Reads cells directly by address to avoid SheetJS merged-cell row issues.
  // Supports both formats:
  //   Old: col A = label, col B = key(elementId), col C = value
  //   New: col A = label, col B = value
  // Auto-detected by col B row-2 header text.
  // New format uses fuzzy (normalised) label matching.
  // ─────────────────────────────────────────────
  function parseParams(wb) {
    const sheet = wb.Sheets['Parameters'];
    if (!sheet) throw new Error('No "Parameters" sheet found.');

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const maxRow = range.e.r;

    // Read header row (row index 1 = sheet row 2) col B to detect format
    const headerBCell = sheet[XLSX.utils.encode_cell({ r: 1, c: 1 })];
    const headerB = headerBCell ? String(headerBCell.v || '') : '';
    const isOldFormat = headerB.toLowerCase().includes('key');

    const params = {};

    for (let r = 2; r <= maxRow; r++) {
      const cellA = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
      const cellB = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
      const cellC = sheet[XLSX.utils.encode_cell({ r, c: 2 })];

      const valB = cellB ? cellB.v : null;
      const valC = cellC ? cellC.v : null;

      if (isOldFormat) {
        const key = String(valB || '').trim();
        if (!key) continue;
        params[key] = (valC !== null && valC !== undefined) ? valC : '';
      } else {
        const valA = cellA ? cellA.v : null;
        const label = String(valA || '').trim();
        if (!label) continue;
        // Fuzzy match: normalise the cell label before lookup
        const elementId = NORMALISED_PARAM_MAP[normaliseLabel(label)];
        if (!elementId) continue;
        params[elementId] = (valB !== null && valB !== undefined) ? valB : '';
      }
    }

    return params;
  }

  // ─────────────────────────────────────────────
  // VALIDATE
  // ─────────────────────────────────────────────
  function validate(accounts, params) {
    const errors = [];
    const validOwners = new Set(['p1', 'p2']);

    accounts.forEach((a, i) => {
      const r = i + 3;
      const label = `Row ${r} "${a.name}"`;

      if (!VALID_WRAPPERS.has(a.wrapper)) {
        const raw = a._rawWrapper || a.wrapper;
        errors.push(
          `Accounts ${label}: wrapper "${raw}" not recognised — use ISA, SIPP, SIPP/WP (workplace pension), GIA, or Cash`
        );
      }

      if (!validOwners.has(a.owner)) {
        errors.push(
          `Accounts ${label}: owner "${a.owner}" not recognised — use p1 or p2`
        );
      }

      const { equities, bonds, cashlike, cash } = a.alloc;
      const allocTotal = equities + bonds + cashlike + cash;
      if (Math.abs(allocTotal - 100) > 1) {
        errors.push(
          `Accounts ${label}: allocation adds to ${allocTotal.toFixed(1)}% ` +
          `(equities ${equities} + bonds ${bonds} + cash-like ${cashlike} + cash ${cash}) — must total 100%`
        );
      }
    });

    REQUIRED_IDS.forEach(id => {
      if (params[id] === undefined || params[id] === '') {
        const humanLabel = ID_TO_LABEL[id] || id;
        errors.push(`Parameters: "${humanLabel}" is required but missing`);
      }
    });

    return errors;
  }

  // ─────────────────────────────────────────────
  // TEMPLATE DOWNLOAD
  // Uses xlsx-js-style (drop-in SheetJS CE fork)
  // for full cell-level formatting support.
  // ─────────────────────────────────────────────
  function downloadTemplate() {

    // ── Reusable style objects ───────────────────
    const FONT  = { name: 'Arial' };
    const THIN  = { style: 'thin', color: { rgb: 'BFBFBF' } };
    const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

    const ST = {
      title: {
        font:      { name: 'Arial', bold: true, color: { rgb: 'FFFFFF' }, sz: 13 },
        fill:      { fgColor: { rgb: '1F3864' } },
        alignment: { horizontal: 'left', vertical: 'center' },
      },
      header: {
        font:      { name: 'Arial', bold: true, color: { rgb: 'FFFFFF' }, sz: 9 },
        fill:      { fgColor: { rgb: '2E75B6' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border:    BORDER,
      },
      section: {
        font:      { name: 'Arial', bold: true, color: { rgb: '1F3864' }, sz: 9 },
        fill:      { fgColor: { rgb: 'D6E4F0' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border:    BORDER,
      },
      input: {
        font:      { name: 'Arial', sz: 9 },
        fill:      { fgColor: { rgb: 'FFF2CC' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border:    BORDER,
      },
      inputLeft: {
        font:      { name: 'Arial', sz: 9 },
        fill:      { fgColor: { rgb: 'FFF2CC' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border:    BORDER,
      },
      body: {
        font:      { name: 'Arial', sz: 9 },
        fill:      { fgColor: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border:    BORDER,
      },
      note: {
        font:      { name: 'Arial', italic: true, color: { rgb: '595959' }, sz: 8 },
        fill:      { fgColor: { rgb: 'FAFAFA' } },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border:    BORDER,
      },
      legend: {
        font:      { name: 'Arial', italic: true, color: { rgb: '595959' }, sz: 8 },
        fill:      { fgColor: { rgb: 'F2F2F2' } },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border:    BORDER,
      },
    };

    // ── Cell factory ─────────────────────────────
    function cell(v, style, numFmt) {
      const t = (v === null || v === undefined || v === '') ? 'z' : (typeof v === 'number' ? 'n' : 's');
      const c = { v: v === '' ? undefined : v, t, s: style };
      if (numFmt) c.z = numFmt;
      return c;
    }

    // ── Sheet builder ─────────────────────────────
    // Takes a 2-D array of cell objects and builds a sheet with !ref and !cols
    function buildSheet(rows, colWidths) {
      const ws = {};
      let maxC = 0;
      rows.forEach((row, r) => {
        row.forEach((c, col) => {
          if (!c) return;
          const addr = XLSX.utils.encode_cell({ r, c: col });
          ws[addr] = c;
          if (col > maxC) maxC = col;
        });
      });
      ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: maxC } });
      ws['!cols'] = colWidths.map(w => ({ wch: w }));
      return ws;
    }

    // ════════════════════════════════════════════
    // ACCOUNTS SHEET
    // ════════════════════════════════════════════
    const acHeaders = [
      'Account name', 'Wrapper', 'Owner', 'Value (£)',
      'Equities %', 'Bonds %', 'Cash-like %', 'Cash %',
      'Interest rate %', 'Monthly draw (£)', 'Notes',
    ];

    const acLegend =
      'Wrapper: ISA  |  SIPP (self-invested personal pension)  |  ' +
      'SIPP/WP (workplace pension — same tax treatment)  |  GIA  |  Cash     ' +
      'Owner: p1 or p2     ' +
      'Allocation % columns must total 100 — leave ALL four blank for defaults ' +
      '(100% equities for ISA / SIPP / GIA; 100% cash for Cash)';

    // 10 blank input rows
    const blankInputRows = Array.from({ length: 10 }, () => [
      cell('', ST.inputLeft),       // name
      cell('', ST.input),           // wrapper
      cell('', ST.input),           // owner
      cell('', ST.input, '#,##0'),  // value
      cell('', ST.input),           // equities %
      cell('', ST.input),           // bonds %
      cell('', ST.input),           // cashlike %
      cell('', ST.input),           // cash %
      cell('', ST.input),           // rate %
      cell('', ST.input, '#,##0'),  // monthly draw
      cell('', ST.body),            // notes
    ]);

    const acRows = [
      // Row 1: title (spans all 11 cols visually — first cell carries style, rest blank same style)
      [cell('Accounts — UK Retirement Tax Planner', ST.title),
        ...Array(10).fill(cell('', ST.title))],
      // Row 2: headers
      acHeaders.map(h => cell(h, ST.header)),
      // 10 blank input rows
      ...blankInputRows,
      // Legend row
      [cell(acLegend, ST.legend), ...Array(10).fill(cell('', ST.legend))],
    ];

    const acSheet = buildSheet(acRows, [28, 11, 7, 14, 10, 8, 11, 8, 14, 15, 72]);

    // Row heights
    acSheet['!rows'] = [
      { hpt: 24 },  // title
      { hpt: 30 },  // headers
      ...Array(10).fill({ hpt: 18 }),
      { hpt: 36 },  // legend
    ];

    // Freeze header rows
    acSheet['!freeze'] = { xSplit: 0, ySplit: 2 };

    // ════════════════════════════════════════════
    // PARAMETERS SHEET
    // ════════════════════════════════════════════
    function secRow(label) {
      return [cell(label, ST.section), cell('', ST.section), cell('', ST.section)];
    }
    function paramRow(label, note, required) {
      return [
        cell(required ? label + ' *' : label, ST.body),
        cell('', ST.input),
        cell(note, ST.note),
      ];
    }

    const paRows = [
      [cell('Parameters — UK Retirement Tax Planner', ST.title), cell('', ST.title), cell('', ST.title)],
      [cell('Parameter', ST.header), cell('Value', ST.header), cell('Notes', ST.header)],

      secRow('People'),
      paramRow('Person 1 name',                              'First name or any label, e.g. Woody',                               false),
      paramRow('Person 2 name',                              'First name or any label, e.g. Heidi',                               false),
      paramRow('Person 1 \u2013 birth year',                 'Required. Four-digit year, e.g. 1,967',                             true),
      paramRow('Person 2 \u2013 birth year',                 'Required. Four-digit year, e.g. 1,966',                             true),

      secRow('Projection dates'),
      paramRow('Start year',                                 'Required. First year of projection, e.g. 2,025',                   true),
      paramRow('End year',                                   'Required. Final year of projection, e.g. 2,055',                   true),

      secRow('Spending'),
      paramRow('Annual household spending (\u00a3)',         'Required. Total net spending per year, e.g. 45,000',               true),
      paramRow('Step-down at age 75 (%)',                    'Optional. % reduction in spending from age 75, e.g. 20',           false),

      secRow('Salary'),
      paramRow('Person 1 \u2013 gross annual salary (\u00a3)', 'Optional. Leave blank if not working',                           false),
      paramRow('Person 1 \u2013 salary stop age',            'Optional. Age at which Person 1 salary stops, e.g. 60',            false),
      paramRow('Gross annual salary (\u00a3)',               'Optional. Person 2 gross salary, e.g. 15,000',                     false),
      paramRow('Stop age',                                   'Optional. Age at which Person 2 salary stops, e.g. 63',            false),

      secRow('State Pension'),
      paramRow('Person 1 \u2013 start age',                  'State Pension start age for Person 1, e.g. 67',                    false),
      paramRow('Person 1 \u2013 annual amount (\u00a3)',      'Full new State Pension 2025/26 is \u00a311,502',                   false),
      paramRow('Person 2 \u2013 start age',                  'State Pension start age for Person 2, e.g. 67',                    false),
      paramRow('Person 2 \u2013 annual amount (\u00a3)',      'Full new State Pension 2025/26 is \u00a311,502',                   false),

      secRow('Growth & inflation'),
      paramRow('Portfolio growth (%/yr)',                    'Nominal annual portfolio growth rate, e.g. 5',                     false),
      paramRow('Inflation (%/yr)',                           'Annual inflation assumption, e.g. 2.5',                            false),
      paramRow('Threshold uprating mode',                    'How tax thresholds uprate: frozen, cpi, or wages',                 false),
      paramRow('Uprate from year',                           'Year from which uprating applies, e.g. 2,028',                    false),

      secRow('Bed and ISA'),
      paramRow('Enable bed-and-ISA',                        'yes or no \u2014 model annual GIA\u2192ISA transfers',             false),
      paramRow('Person 1 GIA\u2192ISA per year (\u00a3)',   'Annual GIA to ISA transfer for Person 1, e.g. 20,000',            false),
      paramRow('Person 2 GIA\u2192ISA per year (\u00a3)',   'Annual GIA to ISA transfer for Person 2, e.g. 20,000',            false),
    ];

    const paSheet = buildSheet(paRows, [40, 18, 65]);

    paSheet['!rows'] = [
      { hpt: 24 },  // title
      { hpt: 22 },  // headers
      ...Array(paRows.length - 2).fill({ hpt: 18 }),
    ];

    paSheet['!freeze'] = { xSplit: 0, ySplit: 2 };

    // ── Assemble and write ───────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, acSheet, 'Accounts');
    XLSX.utils.book_append_sheet(wb, paSheet, 'Parameters');
    XLSX.writeFile(wb, 'retirement-planner-template.xlsx');
  }

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  function parseNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  window.RetireExcelLoader = { openFilePicker, downloadTemplate };
})();
