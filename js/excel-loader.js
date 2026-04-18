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
      .replace(/\*+$/, '')        // strip trailing asterisk (required field marker)
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

  // ─────────────────────────────────────────────
  // OWNER NORMALISATION
  // Accept 'Person 1' / 'Person 2' as synonyms
  // for 'p1' / 'p2'.
  // ─────────────────────────────────────────────
  function normaliseOwner(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'p1' || s === 'person 1' || s === 'person1') return 'p1';
    if (s === 'p2' || s === 'person 2' || s === 'person2') return 'p2';
    return String(raw || '').trim();
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
      // Skip rows with no name, or where wrapper is blank (catches legend/footer rows)
      const rawWrapper = String(row[1] || '').trim();
      if (!name || !rawWrapper) return;
      // If name is present but wrapper is unrecognisable, push so validate() can report it
      if (!VALID_WRAPPERS.has(wrapper)) {
        accounts.push({ name, wrapper, owner: normaliseOwner(row[2] || 'p1'),
          value: parseNum(row[3]),
          alloc: { equities: 0, bonds: 0, cashlike: 0, cash: 0 },
          rate: null, monthlyDraw: null, _rawWrapper: rawWrapper });
        return;
      }

      const owner       = normaliseOwner(row[2] || 'p1');
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
    const sheet = wb.Sheets['Personal details'] || wb.Sheets['Parameters'];
    if (!sheet) throw new Error('No "Personal details" or "Parameters" sheet found.');

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
  // Uses xlsx-js-style for full cell formatting.
  // Pre-populated with Harry/Sally example data.
  // Dropdown validation on Wrapper and Owner cols.
  // ─────────────────────────────────────────────
  function downloadTemplate() {

    // ── Reusable style objects ───────────────────
    const THIN   = { style: 'thin', color: { rgb: 'BFBFBF' } };
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
      // Yellow editable cell — left-aligned (name column)
      inputLeft: {
        font:      { name: 'Arial', sz: 9 },
        fill:      { fgColor: { rgb: 'FFF2CC' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border:    BORDER,
      },
      // Yellow editable cell — centre-aligned (numeric/dropdown columns)
      input: {
        font:      { name: 'Arial', sz: 9 },
        fill:      { fgColor: { rgb: 'FFF2CC' } },
        alignment: { horizontal: 'center', vertical: 'center' },
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
      const isEmpty = (v === null || v === undefined || v === '');
      const t = isEmpty ? 'z' : (typeof v === 'number' ? 'n' : 's');
      const c = { v: isEmpty ? undefined : v, t, s: style };
      if (numFmt) c.z = numFmt;
      return c;
    }

    // ── Sheet builder ─────────────────────────────
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
      'SIPP/WP (workplace pension \u2014 same tax treatment as SIPP)  |  GIA (general investment account)  |  Cash     ' +
      'Owner: Person 1 or Person 2     ' +
      'Allocation % columns must total 100 \u2014 leave ALL four blank to apply defaults ' +
      '(100% equities for ISA / SIPP / GIA; 100% cashlike for Cash with a rate, 100% cash for Cash without)     ' +
      'Yellow rows = cells to fill in';

    // Example rows matching the screenshots
    // Interest rate stored as plain number (3.8), displayed with literal % via format '0.0"%"'
    const exampleAccounts = [
      ['Fidelity SIPP',  'SIPP/WP', 'Person 1', 300000,  55,  45,   0,   0, null, null, ''],
      ['Fidelity SIPP',  'SIPP/WP', 'Person 2', 120000,  55,  45,   0,   0, null, null, 'SIPP/WP = Workplace Pension'],
      ['Fidelity ISA',   'ISA',     'Person 1', 100000, 100,   0,   0,   0, null, null, ''],
      ['Fidelity ISA',   'ISA',     'Person 2',  80000, 100,   0,   0,   0, null, null, ''],
      ['Invest Engine',  'GIA',     'Person 1',  60000,   0,   0, 100,   0,  3.8, 1000, 'Set interest rate for cashlike accounts'],
      ['HSBC',           'Cash',    'Person 1',  40000,   0,   0,   0, 100, null, null, ''],
    ];

    const acExampleRows = exampleAccounts.map(r => [
      cell(r[0],  ST.inputLeft),
      cell(r[1],  ST.input),
      cell(r[2],  ST.input),
      cell(r[3],  ST.input, '#,##0'),
      cell(r[4],  ST.input),
      cell(r[5],  ST.input),
      cell(r[6],  ST.input),
      cell(r[7],  ST.input),
      r[8]  !== null ? cell(r[8],  ST.input, '0.0"%"') : cell('', ST.input),
      r[9]  !== null ? cell(r[9],  ST.input, '#,##0') : cell('', ST.input),
      cell(r[10], ST.note),
    ]);

    // 6 blank input rows below examples
    const acBlankRows = Array.from({ length: 6 }, () => [
      cell('', ST.inputLeft),
      cell('', ST.input),
      cell('', ST.input),
      cell('', ST.input, '#,##0'),
      cell('', ST.input),
      cell('', ST.input),
      cell('', ST.input),
      cell('', ST.input),
      cell('', ST.input, '0.0"%"'),
      cell('', ST.input, '#,##0'),
      cell('', ST.body),
    ]);

    const acRows = [
      [cell('Accounts \u2014 UK Retirement Tax Planner', ST.title), ...Array(10).fill(cell('', ST.title))],
      acHeaders.map(h => cell(h, ST.header)),
      ...acExampleRows,
      ...acBlankRows,
      [cell(acLegend, ST.legend), ...Array(10).fill(cell('', ST.legend))],
    ];

    const acSheet = buildSheet(acRows, [24, 11, 12, 14, 10, 8, 11, 8, 14, 15, 52]);

    // Merge title row across all 11 cols (A1:K1)
    // Merge legend/footer row across all 11 cols
    const acLastDataRow = 2 + exampleAccounts.length + 6; // 0-indexed: title(1) + header(1) + examples + blanks
    acSheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },              // title
      { s: { r: acLastDataRow, c: 0 }, e: { r: acLastDataRow, c: 10 } }, // legend
    ];

    acSheet['!rows'] = [
      { hpt: 24 },
      { hpt: 30 },
      ...Array(exampleAccounts.length + 6).fill({ hpt: 18 }),
      { hpt: 42 },
    ];

    acSheet['!freeze'] = { xSplit: 0, ySplit: 2 };

    // Dropdown validation: Wrapper (col B=1) and Owner (col C=2) on all data rows
    const acDataRows = exampleAccounts.length + 6;
    const acValidations = [];
    for (let r = 2; r < 2 + acDataRows; r++) {
      acValidations.push({
        type: 'list', operator: 'between', showDropDown: false,
        sqref: XLSX.utils.encode_cell({ r, c: 1 }),
        formula1: '"ISA,SIPP,SIPP/WP,GIA,Cash"',
      });
      acValidations.push({
        type: 'list', operator: 'between', showDropDown: false,
        sqref: XLSX.utils.encode_cell({ r, c: 2 }),
        formula1: '"Person 1,Person 2"',
      });
    }
    acSheet['!dataValidation'] = acValidations;

    // ════════════════════════════════════════════
    // PARAMETERS SHEET
    // ════════════════════════════════════════════
    function secRow(label) {
      return [cell(label, ST.section), cell('', ST.section), cell('', ST.section)];
    }
    function paramRow(label, value, note, required, numFmt) {
      const c = numFmt
        ? cell(value, ST.input, numFmt)
        : cell(value, ST.input);
      return [
        cell(required ? label + ' *' : label, ST.body),
        c,
        cell(note, ST.note),
      ];
    }

    const paRows = [
      [cell('Personal details \u2014 UK Retirement Tax Planner', ST.title), cell('', ST.title), cell('', ST.title)],
      [cell('Parameter', ST.header), cell('Value', ST.header), cell('Notes', ST.header)],

      secRow('People'),
      paramRow('Person 1 name',                                'Harry',   'First name or any label',                                                    false),
      paramRow('Person 2 name',                                'Sally',   'First name or any label',                                                    false),
      paramRow('Person 1 \u2013 birth year',                   1970,      'Required. Four-digit year',                                                  true,  '0'),
      paramRow('Person 2 \u2013 birth year',                   1970,      'Required. Four-digit year',                                                  true,  '0'),

      secRow('Projection dates'),
      paramRow('Start year',                                   2026,      'Required. First year of projection',                                         true,  '0'),
      paramRow('End year',                                     2060,      'Required. Final year of projection',                                         true,  '0'),

      secRow('Spending'),
      paramRow('Annual household spending (\u00a3)',           45000,     'Required. Total net household spending target per year',                     true,  '#,##0'),
      paramRow('Step-down at age 75 (%)',                      20,        'Optional. % reduction in spending from age 75',                              false, '0'),

      secRow('Salary'),
      paramRow('Person 1 \u2013 gross annual salary (\u00a3)', '',        'Optional. Leave blank if not working',                                       false, '#,##0'),
      paramRow('Person 1 \u2013 salary stop age',              '',        'Optional. Age at which Person 1 salary stops',                               false),
      paramRow('Gross annual salary (\u00a3)',                 15000,     'Optional. Person 2 gross salary',                                            false, '#,##0'),
      paramRow('Stop age',                                     63,        'Optional. Age at which Person 2 salary stops',                               false),

      secRow('State Pension'),
      paramRow('Person 1 \u2013 start age',                    67,        'State Pension start age for Person 1',                                       false),
      paramRow('Person 1 \u2013 annual amount (\u00a3)',        12547,     'Full new State Pension 2025/26 is \u00a311,502',                             false, '#,##0'),
      paramRow('Person 2 \u2013 start age',                    67,        'State Pension start age for Person 2',                                       false),
      paramRow('Person 2 \u2013 annual amount (\u00a3)',        12547,     'Full new State Pension 2025/26 is \u00a311,502',                             false, '#,##0'),

      secRow('Growth & inflation'),
      paramRow('Portfolio growth (%/yr)',                      4,         'Nominal annual portfolio growth rate',                                       false, '0.0'),
      paramRow('Inflation (%/yr)',                             2.5,       'Annual inflation assumption',                                                false, '0.0'),
      paramRow('Threshold uprating mode',                      'frozen',  'How tax thresholds uprate: frozen, cpi, or wages',                          false),
      paramRow('Uprate from year',                             2031,      'Year from which uprating applies',                                           false, '0'),

      secRow('Bed and ISA'),
      paramRow('Enable bed-and-ISA',                          'no',      'yes or no \u2014 model annual GIA\u2192ISA transfers',                       false),
      paramRow('Person 1 GIA\u2192ISA per year (\u00a3)',     20000,     'Annual GIA to ISA transfer for Person 1',                                    false, '#,##0'),
      paramRow('Person 2 GIA\u2192ISA per year (\u00a3)',     10000,     'Annual GIA to ISA transfer for Person 2',                                    false, '#,##0'),
    ];

    const paSheet = buildSheet(paRows, [40, 18, 65]);

    // Merge title row across all 3 cols (A1:C1)
    paSheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    ];

    paSheet['!rows'] = [
      { hpt: 24 },
      { hpt: 22 },
      ...Array(paRows.length - 2).fill({ hpt: 18 }),
    ];

    paSheet['!freeze'] = { xSplit: 0, ySplit: 2 };

    // ── Assemble: Personal details first, Accounts second ───────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, paSheet, 'Personal details');
    XLSX.utils.book_append_sheet(wb, acSheet, 'Accounts');
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
