/**
 * pdf-render.js
 *
 * Generates a multi-page A4 landscape PDF retirement plan report.
 * Registers window.RetirePDFRender.
 *
 * Depends on (loaded via CDN before this file):
 *   window.jspdf.jsPDF   — jsPDF 2.x
 *   window.html2canvas   — html2canvas 1.x
 *
 * Public API:
 *   RetirePDFRender.generate(snapshot)
 *
 *   snapshot      — assembled by export.js
 *
 * Architecture:
 *   1. Build each page as a styled HTML div (A4 landscape: 1123×794px at 96dpi).
 *   2. Inject all pages into a hidden off-screen container using opacity:0.
 *   3. html2canvas renders each page at 2× scale.
 *   4. jsPDF receives each canvas as a full-page JPEG.
 *   5. File is downloaded immediately.
 */

(function () {
  'use strict';

  // ── Page dimensions (A4 landscape at 96dpi) ───────────────────────────────
  const PAGE_W = 1123;
  const PAGE_H = 794;

  // ── CSS for page rendering ────────────────────────────────────────────────
  // Injected into the off-screen container so html2canvas picks up all styles.
  const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --blue:       #2d55e8;
  --blue-dark:  #1a3ab5;
  --blue-deep:  #0f1c2e;
  --green:      #3B6D11;
  --amber:      #BA7517;
  --red:        #A32D2D;
  --ink:        #0f1c2e;
  --ink-mid:    #3d5068;
  --ink-light:  #7a90a8;
  --rule:       #dde4ed;
  --bg:         #f4f6fa;
  --bg-mid:     #edf0f6;
  --white:      #ffffff;
  --page-w:     1123px;
  --page-h:     794px;
  --margin:     52px;
  --amber-light: #faeeda;
  --blue-light:  #eaeffd;
  --sans:       'Helvetica Neue', Helvetica, Arial, sans-serif;
  --serif:      Georgia, 'Times New Roman', serif;
}

/* ── A4 landscape page ── */
.page {
  width: var(--page-w); height: var(--page-h);
  background: var(--white); position: relative; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 6px 32px rgba(0,0,0,.38); border-radius: 2px;
  font-family: var(--sans); color: var(--ink); font-size: 11px;
}

/* ── Shared ── */
.page-footer {
  height: 26px; border-top: 1px solid var(--rule); flex-shrink: 0;
  display: flex; justify-content: space-between; align-items: center;
  padding: 0 var(--margin); font-size: 7.5px; color: var(--ink-light);
}
.page-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.section-label {
  font-size: 7.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .12em; color: var(--ink-light); margin-bottom: 8px;
}
.divider { height: 1px; background: var(--rule); margin: 14px 0; }
.divider-blue { height: 1px; background: var(--blue); margin: 14px 0; opacity: 0.3; }
.rule-heavy { height: 2px; background: var(--ink); margin: 4px 0; }

/* ── Table system ── */
table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
thead th {
  font-size: 9px; font-weight: 700; color: var(--ink-mid);
  border-bottom: 1px solid var(--ink); padding: 6px 10px;
  text-align: right; white-space: nowrap;
}
thead th:first-child { text-align: left; }
tbody tr td { padding: 5.5px 10px; border-bottom: 1px solid var(--rule); }
tbody tr td:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr.group-header td {
  font-size: 8.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .08em; color: var(--ink-light);
  background: var(--bg); border-bottom: none; padding: 8px 10px 4px;
}
tbody tr.subtotal td { font-weight: 700; color: var(--ink); background: var(--bg-mid); border-bottom: 1px solid var(--rule); }
tbody tr.total-row td { font-weight: 800; font-size: 11.5px; color: var(--ink); border-top: 2px solid var(--ink); border-bottom: none; padding: 7px 10px; }
tbody tr:last-child td { border-bottom: none; }
.rate-badge {
  display: inline-block; padding: 1px 7px; border-radius: 999px;
  background: var(--bg-mid); color: var(--ink-mid);
  font-size: 8px; font-weight: 600; margin-left: 6px;
}

/* ══════════════════════════════════════════════════════
   PAGE 1 — TITLE
══════════════════════════════════════════════════════ */
.p1-brand-strip {
  background: var(--bg); border-bottom: 1px solid var(--rule);
  padding: 16px var(--margin); display: flex; align-items: center; gap: 14px;
  flex-shrink: 0;
}
.p1-brand-strip svg { flex-shrink: 0; }
.p1-brand-name { font-size: 20px; font-weight: 800; color: var(--ink); letter-spacing: -.02em; line-height: 1; }
.p1-brand-tag { font-size: 9.5px; color: var(--ink-mid); margin-top: 3px; }

.p1-content {
  flex: 1; display: flex; flex-direction: column;
  justify-content: center; padding: var(--margin) calc(var(--margin) * 1.6);
  gap: 0;
}
.p1-eyebrow { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--ink-light); margin-bottom: 14px; }
.p1-title { font-size: 42px; font-weight: 800; color: var(--ink); line-height: 1.05; letter-spacing: -.03em; margin-bottom: 24px; }
.p1-statement {
  font-size: 13.5px; color: var(--ink-mid); line-height: 1.7;
  max-width: 640px; border-left: 3px solid var(--blue);
  padding-left: 18px; margin-bottom: 36px;
}
.p1-meta { display: flex; flex-direction: column; gap: 6px; }
.p1-meta-row { display: flex; align-items: baseline; gap: 10px; font-size: 10.5px; }
.p1-meta-label { color: var(--ink-light); width: 110px; flex-shrink: 0; }
.p1-meta-value { color: var(--ink); font-weight: 600; }

.p1-decoration {
  position: absolute; right: 0; top: 0; bottom: 0; width: 340px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.p1-deco-grid {
  display: grid; grid-template-columns: repeat(3, 60px); gap: 8px;
  opacity: .06; transform: rotate(10deg) scale(1.4);
}
.p1-deco-cell { height: 60px; border-radius: 10px; background: var(--blue); }
.p1-deco-cell.g { background: var(--green); }

/* ══════════════════════════════════════════════════════
   PAGE 2 — PLAN SUMMARY
══════════════════════════════════════════════════════ */
.p2-header {
  background: var(--blue-dark); padding: 14px var(--margin); flex-shrink: 0;
  display: flex; align-items: baseline; justify-content: space-between;
}
.p2-header-title { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -.02em; }
.p2-header-sub { font-size: 9px; color: rgba(255,255,255,.5); }

.p2-body { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
.p2-col { padding: var(--margin) 36px; overflow: hidden; display: flex; flex-direction: column; }
.p2-col + .p2-col { border-left: 1px solid var(--rule); }

/* ══════════════════════════════════════════════════════
   PAGE 3 — ASSUMPTIONS
══════════════════════════════════════════════════════ */
.p3-header { background: #1a3ab5; padding: 14px var(--margin); flex-shrink: 0; }
.p3-header-title { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -.02em; }
.p3-header-sub { font-size: 9px; color: rgba(255,255,255,.45); margin-top: 2px; }

.p3-body { flex: 1; display: grid; grid-template-columns: 1fr 1fr 1fr; min-height: 0; gap: 0; }
.p3-col { padding: var(--margin) 32px; overflow: hidden; display: flex; flex-direction: column; }
.p3-col + .p3-col { border-left: 1px solid var(--rule); }

.assump-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--rule); font-size: 10.5px; }
.assump-label { color: var(--ink-mid); }
.assump-value { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }

/* ══════════════════════════════════════════════════════
   PAGE 4 — BALANCE SHEET
══════════════════════════════════════════════════════ */
.p4-header { background: #1a3ab5; padding: 14px var(--margin); flex-shrink: 0; display: flex; align-items: baseline; justify-content: space-between; }
.p4-header-title { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -.02em; }
.p4-header-sub { font-size: 9px; color: rgba(255,255,255,.4); }
.p4-body { flex: 1; padding: var(--margin); overflow: hidden; display: flex; flex-direction: column; }
`;

  function injectStyles(container) {
    const style = document.createElement('style');
    style.textContent = PAGE_CSS;
    container.appendChild(style);
  }

// ── Helpers ──────────────────────────────────────────────────────────────
const fmt    = n => n == null ? '—' : '£' + Math.round(n).toLocaleString('en-GB');
const fmtPct = r => r == null ? '—' : (r * 100).toFixed(1) + '%';
const fmtPctN = r => r == null ? '—' : (r >= 0.995 ? '99%+' : Math.round(r*100)+'%');
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '';
const strip  = s => s ? s.replace(/<[^>]+>/g,'') : '';

const LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0"  y="0"  width="16" height="16" rx="3.5" fill="#adbdda"/>
  <rect x="19" y="0"  width="16" height="16" rx="3.5" fill="#8faacc"/>
  <rect x="38" y="0"  width="16" height="16" rx="3.5" fill="#6b8fbf"/>
  <rect x="0"  y="19" width="16" height="16" rx="3.5" fill="#7ea3cc"/>
  <rect x="19" y="19" width="16" height="16" rx="3.5" fill="#2e6fd4"/>
  <rect x="38" y="19" width="16" height="16" rx="3.5" fill="#1a5ec4"/>
  <rect x="0"  y="38" width="16" height="16" rx="3.5" fill="#1a55be"/>
  <rect x="19" y="38" width="16" height="16" rx="3.5" fill="#1746a8"/>
  <rect x="38" y="38" width="16" height="16" rx="3.5" fill="#1a9e4a"/>
</svg>`;

function footer(n, total) {
  const d = document.createElement('div');
  d.className = 'page-footer';
  d.innerHTML = `<span>IncomeFlow – Confidential</span><span>Page ${n} of ${total}</span>`;
  return d;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

// ══════════════════════════════════════════════════════
// PAGE 1 — TITLE
// ══════════════════════════════════════════════════════
function page1(s) {
  const page = el('div','page');
  const plan = s.plan;
  const names = s.meta.persons.map(p => p.name).join(' & ');

  // Brand strip
  const brand = el('div','p1-brand-strip');
  brand.innerHTML = `
    ${LOGO_SVG}
    <div>
      <div class="p1-brand-name">IncomeFlow</div>
      <div class="p1-brand-tag">Model and optimise how money flows from pensions, ISAs, and investments to fund your retirement.</div>
    </div>`;

  // Decorative background grid (CSS-only)
  const deco = el('div','p1-decoration');
  let cells = '';
  for (let i = 0; i < 9; i++) cells += `<div class="p1-deco-cell${i===8?' g':''}"></div>`;
  deco.innerHTML = `<div class="p1-deco-grid">${cells}</div>`;

  // Main content
  const content = el('div','p1-content');
  content.innerHTML = `
    <div class="p1-eyebrow">Personal retirement plan</div>
    <div class="p1-title">Financial Plan for<br>${names}</div>
    <div class="p1-statement">
      This report summarises your current financial position and gives you a view of how your finances could change throughout retirement. It is produced by IncomeFlow and is for illustrative purposes only.
    </div>
    <div class="p1-meta">
      <div class="p1-meta-row">
        <span class="p1-meta-label">Prepared on</span>
        <span class="p1-meta-value">${fmtDate(s.generated_at)}</span>
      </div>
      <div class="p1-meta-row">
        <span class="p1-meta-label">Plan period</span>
        <span class="p1-meta-value">${plan.start_year} – ${plan.end_year} (${plan.end_year - plan.start_year} years)</span>
      </div>
      <div class="p1-meta-row">
        <span class="p1-meta-label">People</span>
        <span class="p1-meta-value">${s.meta.persons.map(p => `${p.name} (born ${p.dob_year})`).join(' · ')}</span>
      </div>
      <div class="p1-meta-row">
        <span class="p1-meta-label">Withdrawal strategy</span>
        <span class="p1-meta-value">${plan.strategy_label || plan.strategy}</span>
      </div>
    </div>`;

  page.appendChild(brand);
  page.appendChild(content);
  page.appendChild(deco);
  page.appendChild(footer(1, 9));
  return page;
}

// ══════════════════════════════════════════════════════
// PAGE 2 — PLAN SUMMARY: Savings & Income
// ══════════════════════════════════════════════════════
function page2(s) {
  const page = el('div','page');
  const plan = s.plan;
  const p1 = plan.p1, p2 = plan.p2;
  const d = s.assumptions.detail;
  const returns = d.asset_class_returns_nominal_gross;

  // Header
  const hdr = el('div','p2-header');
  hdr.innerHTML = `<div class="p2-header-title">Plan Summary</div><div class="p2-header-sub">Savings, investments &amp; income at plan start (${plan.start_year})</div>`;
  page.appendChild(hdr);

  const body = el('div','p2-body');

  // ── LEFT: Savings & Investments table ──────────────────────────────
  const leftCol = el('div','p2-col');
  leftCol.appendChild(el('div','section-label','Savings &amp; Investments'));

  const p1b = p1.starting_balances;
  const p2b = p2 ? p2.starting_balances : {};
  const combined = (a, b) => (a||0) + (b||0);

  const siRows = [
    {
      group: 'Pensions',
      rows: [
        { label: `${p1.name} SIPP`, p1: p1b.SIPP, p2: null, rate: returns.global_equities },
        ...(p2 ? [{ label: `${p2.name} SIPP`, p1: null, p2: p2b.SIPP, rate: returns.global_equities }] : []),
      ],
      subtotalLabel: 'Total Pensions',
    },
    {
      group: 'ISAs',
      rows: [
        { label: `${p1.name} ISA`, p1: p1b.ISA, p2: null, rate: returns.global_equities },
        ...(p2 ? [{ label: `${p2.name} ISA`, p1: null, p2: p2b.ISA, rate: returns.global_equities }] : []),
      ],
      subtotalLabel: 'Total ISAs',
    },
    {
      group: 'General Investment Accounts',
      rows: [
        { label: `${p1.name} GIA — Equities`, p1: p1b.GIAeq, p2: null, rate: returns.global_equities },
        { label: `${p1.name} GIA — Cashlike`,  p1: p1b.GIAcash, p2: null, rate: returns.cashlike },
        ...(p2 && (p2b.GIAeq||p2b.GIAcash) ? [
          { label: `${p2.name} GIA — Equities`, p1: null, p2: p2b.GIAeq,   rate: returns.global_equities },
          { label: `${p2.name} GIA — Cashlike`,  p1: null, p2: p2b.GIAcash, rate: returns.cashlike },
        ] : []),
      ],
      subtotalLabel: 'Total GIAs',
    },
    {
      group: 'Cash',
      rows: [
        { label: `${p1.name} Cash`, p1: p1b.Cash, p2: null, rate: 0 },
        ...(p2 && p2b.Cash ? [{ label: `${p2.name} Cash`, p1: null, p2: p2b.Cash, rate: 0 }] : []),
      ],
      subtotalLabel: 'Total Cash',
    },
  ];

  // Note: interest_accounts balances are already included in GIAcash above — do not add again.

  // Build table
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr><th></th><th>${p1.name}</th>${p2?`<th>${p2.name}</th>`:''}${p2?`<th>Combined</th>`:''}<th>Growth rate</th></tr></thead>`;
  const tbody = document.createElement('tbody');

  let grandP1 = 0, grandP2 = 0;

  siRows.forEach(section => {
    const gr = document.createElement('tr'); gr.className = 'group-header';
    gr.innerHTML = `<td colspan="${p2?5:3}">${section.group}</td>`;
    tbody.appendChild(gr);

    let secP1 = 0, secP2 = 0;
    section.rows.forEach(row => {
      const rp1 = row.p1||0, rp2 = row.p2||0;
      if (!rp1 && !rp2) return;
      secP1 += rp1; secP2 += rp2;
      const tr = document.createElement('tr');
      const rateLabel = row.rate > 0
        ? `<span class="rate-badge">${(row.rate*100).toFixed(1)}% p.a.</span>` : '—';
      tr.innerHTML = `<td>${row.label}</td><td>${rp1 ? fmt(rp1) : '—'}</td>${p2?`<td>${rp2 ? fmt(rp2) : '—'}</td>`:''} ${p2?`<td>${fmt(rp1+rp2)}</td>`:''}<td>${rateLabel}</td>`;
      tbody.appendChild(tr);
    });

    const st = document.createElement('tr'); st.className = 'subtotal';
    st.innerHTML = `<td>${section.subtotalLabel}</td><td>${fmt(secP1)}</td>${p2?`<td>${fmt(secP2)}</td>`:''} ${p2?`<td>${fmt(secP1+secP2)}</td>`:''}<td></td>`;
    tbody.appendChild(st);
    grandP1 += secP1; grandP2 += secP2;
  });

  const tot = document.createElement('tr'); tot.className = 'total-row';
  tot.innerHTML = `<td>Total Portfolio</td><td>${fmt(grandP1)}</td>${p2?`<td>${fmt(grandP2)}</td>`:''} ${p2?`<td>${fmt(grandP1+grandP2)}</td>`:''}<td></td>`;
  tbody.appendChild(tot);
  table.appendChild(tbody);
  leftCol.appendChild(table);

  // ── RIGHT: Income table ─────────────────────────────────────────────
  const rightCol = el('div','p2-col');
  rightCol.appendChild(el('div','section-label','Income sources'));

  const incTable = document.createElement('table');
  incTable.innerHTML = `<thead><tr><th></th><th>${p1.name}</th>${p2?`<th>${p2.name}</th>`:''}<th>Notes</th></tr></thead>`;
  const incBody = document.createElement('tbody');

  // State pension
  const spGr = document.createElement('tr'); spGr.className = 'group-header';
  spGr.innerHTML = `<td colspan="${p2?4:3}">State Pension</td>`;
  incBody.appendChild(spGr);

  [p1, p2].filter(Boolean).forEach((p, i) => {
    if (!p.sp_annual_gross) return;
    const tr = document.createElement('tr');
    const cells = i === 0
      ? `<td>${fmt(p.sp_annual_gross)}</td>${p2?`<td>—</td>`:''}`
      : `<td>—</td><td>${fmt(p.sp_annual_gross)}</td>`;
    tr.innerHTML = `<td>${p.name} State Pension</td>${cells}<td style="font-size:9px;color:var(--ink-light);">From age ${p.sp_age} · inflation-linked</td>`;
    incBody.appendChild(tr);
  });

  // Salary
  const salGr = document.createElement('tr'); salGr.className = 'group-header';
  salGr.innerHTML = `<td colspan="${p2?4:3}">Employment Income</td>`;
  incBody.appendChild(salGr);

  [p1, p2].filter(Boolean).forEach((p, i) => {
    const tr = document.createElement('tr');
    const salVal = p.salary > 0 ? fmt(p.salary) : '—';
    const note = p.salary > 0 ? `Until age ${p.salary_stop_age}` : 'None';
    const cells = i === 0
      ? `<td>${salVal}</td>${p2?`<td>—</td>`:''}`
      : `<td>—</td><td>${salVal}</td>`;
    tr.innerHTML = `<td>${p.name} Salary</td>${cells}<td style="font-size:9px;color:var(--ink-light);">${note}</td>`;
    incBody.appendChild(tr);
  });

  // Interest accounts
  if ((plan.interest_accounts||[]).length) {
    const iaGr = document.createElement('tr'); iaGr.className = 'group-header';
    iaGr.innerHTML = `<td colspan="${p2?4:3}">Interest / Draw-down Accounts</td>`;
    incBody.appendChild(iaGr);
    plan.interest_accounts.forEach(a => {
      const annual = Math.round((a.monthly_draw||0) * 12);
      const tr = document.createElement('tr');
      const isP1 = a.owner === 'p1';
      const cells = isP1
        ? `<td>${annual > 0 ? fmt(annual) + '/yr' : '—'}</td>${p2?`<td>—</td>`:''}`
        : `<td>—</td><td>${annual > 0 ? fmt(annual) + '/yr' : '—'}</td>`;
      tr.innerHTML = `<td>${a.name}</td>${cells}<td style="font-size:9px;color:var(--ink-light);">${a.rate}% rate · ${fmt(a.balance)} balance</td>`;
      incBody.appendChild(tr);
    });
  }

  // Target spending
  const divTr = document.createElement('tr'); divTr.className = 'group-header';
  divTr.innerHTML = `<td colspan="${p2?4:3}">Target Retirement Income</td>`;
  incBody.appendChild(divTr);
  const targetTr = document.createElement('tr'); targetTr.className = 'total-row';
  targetTr.innerHTML = `<td>Annual net target</td><td colspan="${p2?3:2}">${fmt(plan.spending_target_net)} / year</td>`;
  incBody.appendChild(targetTr);

  incTable.appendChild(incBody);
  rightCol.appendChild(incTable);

  body.appendChild(leftCol);
  body.appendChild(rightCol);
  page.appendChild(body);
  page.appendChild(footer(2, 9));
  return page;
}

// ══════════════════════════════════════════════════════
// PAGE 3 — ASSUMPTIONS
// ══════════════════════════════════════════════════════
function page3(s) {
  const page = el('div','page');
  const plan = s.plan;
  const asmp = s.assumptions;
  const d = asmp.detail;
  const returns = d.asset_class_returns_nominal_gross;
  const vols    = d.asset_class_volatility;

  const hdr = el('div','p3-header');
  hdr.innerHTML = `<div class="p3-header-title">Default Assumptions</div><div class="p3-header-sub">Calculation settings used in this projection</div>`;
  page.appendChild(hdr);

  const body = el('div','p3-body');

  function assumpRow(label, value) {
    const d = document.createElement('div'); d.className = 'assump-row';
    d.innerHTML = `<span class="assump-label">${label}</span><span class="assump-value">${value}</span>`;
    return d;
  }

  // ── COL 1: Growth rates ─────────────────────────────────────────────
  const col1 = el('div','p3-col');
  col1.appendChild(el('div','section-label','Investment return assumptions'));
  [
    ['Global equities (gross)',  fmtPct(returns.global_equities)],
    ['Global bonds (gross)',     fmtPct(returns.global_bonds)],
    ['Cashlike / money market',  fmtPct(returns.cashlike)],
    ['Cash (uninvested)',        fmtPct(returns.cash)],
    ['Annual platform / fund fee', fmtPct(d.annual_fee)],
    ['Blended net return',       fmtPct(d.blended_net_return)],
  ].forEach(([l,v]) => col1.appendChild(assumpRow(l,v)));

  col1.appendChild(el('div','divider-blue'));
  col1.appendChild(el('div','section-label','Volatility assumptions'));
  [
    ['Equity volatility (annualised)', fmtPct(vols.global_equities)],
    ['Bond volatility',               fmtPct(vols.global_bonds)],
    ['Cashlike volatility',           fmtPct(vols.cashlike)],
    ['Blended portfolio vol',         fmtPct(d.blended_vol)],
  ].forEach(([l,v]) => col1.appendChild(assumpRow(l,v)));

  col1.appendChild(el('div','divider-blue'));
  col1.appendChild(el('div','section-label','Correlation assumptions'));
  const corr = d.correlations;
  [
    ['Equities / Bonds',    corr.equities_bonds.toFixed(2)],
    ['Equities / Cashlike', corr.equities_cashlike.toFixed(2)],
    ['Bonds / Cashlike',    corr.bonds_cashlike.toFixed(2)],
  ].forEach(([l,v]) => col1.appendChild(assumpRow(l,v)));

  // ── COL 2: Economic & plan settings ────────────────────────────────
  const col2 = el('div','p3-col');
  col2.appendChild(el('div','section-label','Economic assumptions'));
  [
    ['Inflation rate',          fmtPct(plan.inflation_rate)],
    ['Inflation volatility',    fmtPct(d.inflation_vol)],
    ['Deterministic growth rate', fmtPct(plan.growth_rate_deterministic)],
  ].forEach(([l,v]) => col2.appendChild(assumpRow(l,v)));

  col2.appendChild(el('div','divider-blue'));
  col2.appendChild(el('div','section-label','Plan settings'));
  [
    ['Target net income',     `£${Math.round(plan.spending_target_net).toLocaleString('en-GB')} / yr`],
    ['Spending step-down',    plan.step_down_pct > 0 ? `${plan.step_down_pct}% at age 75` : 'None'],
    ['Withdrawal strategy',   plan.strategy_label || plan.strategy],
    ['Tax thresholds',        plan.threshold_mode === 'frozen' ? 'Frozen at 2025/26 levels' : `Uprated from ${plan.threshold_from_year}`],
    ['Dividend yield',        fmtPct(plan.dividend_yield)],
    ['Dividend mode',         plan.dividend_mode === 'payout' ? 'Payout (taxed annually)' : 'Accumulating'],
  ].forEach(([l,v]) => col2.appendChild(assumpRow(l,v)));

  col2.appendChild(el('div','divider-blue'));
  col2.appendChild(el('div','section-label','Bed-and-ISA transfers'));
  [
    ['Enabled',               plan.bed_and_isa?.enabled ? 'Yes' : 'No'],
    ...(plan.bed_and_isa?.enabled ? [
      [`${plan.p1.name} annual transfer`, `£${Math.round(plan.bed_and_isa.p1_gia_annual||0).toLocaleString('en-GB')}`],
      [`${plan.p1.name} transfer years`,  `${plan.bed_and_isa.p1_years} years`],
      [`${plan.p2?.name||'p2'} annual transfer`, `£${Math.round(plan.bed_and_isa.p2_gia_annual||0).toLocaleString('en-GB')}`],
    ] : []),
  ].forEach(([l,v]) => col2.appendChild(assumpRow(l,v)));

  // ── COL 3: Portfolio allocation, data sources, MC technical detail ──
  const col3 = el('div','p3-col');

  // Portfolio allocation — first
  col3.appendChild(el('div','section-label','Portfolio allocation'));
  const alloc = d.portfolio_allocation;
  [
    ['Equities',  `${alloc.equity_pct}%`],
    ['Bonds',     `${alloc.bond_pct}%`],
    ['Cashlike',  `${alloc.cashlike_pct}%`],
    ['Cash',      `${alloc.cash_pct}%`],
  ].forEach(([l,v]) => col3.appendChild(assumpRow(l,v)));

  col3.appendChild(el('div','divider-blue'));
  col3.appendChild(el('div','section-label','Data sources'));
  const src = el('div','');
  src.style.cssText = 'font-size:9.5px;color:var(--ink-light);line-height:1.8;margin-bottom:14px;';
  src.innerHTML = `
    Return assumptions: Vanguard Capital Markets Model 2024 &amp; BlackRock CMA 2024.<br>
    Inflation: 2.5% base rate, 1.5% std dev.<br>
    UK tax: 2025/26 legislation, thresholds frozen.<br>
    All projections are illustrative. Past performance does not guarantee future results.`;
  col3.appendChild(src);

  // MC technical detail — demoted
  col3.appendChild(el('div','divider-blue'));
  const techLabel = el('div','section-label','Technical detail: scenario simulation');
  techLabel.style.color = 'var(--ink-light)';
  col3.appendChild(techLabel);
  [
    ['Simulation paths',       (d.sim_count||10000).toLocaleString('en-GB')],
    ['Method',                 'i.i.d. log-normal returns'],
    ['Sampling',               'Box-Muller transform'],
    ['Correlation model',      'Cholesky decomposition'],
    ['Success criterion',      'Portfolio > 0 AND target met every year'],
    ['Blended vol',            fmtPct(d.blended_vol)],
    ['Geometric mean',         fmtPct(d.geometric_mean)],
  ].forEach(([l,v]) => {
    const row = el('div','assump-row');
    row.style.cssText = 'border-bottom-color:var(--bg-mid);';
    row.innerHTML = `<span class="assump-label" style="font-size:9px;color:var(--ink-light);">${l}</span><span class="assump-value" style="font-size:9px;color:var(--ink-mid);">${v}</span>`;
    col3.appendChild(row);
  });

  body.appendChild(col1);
  body.appendChild(col2);
  body.appendChild(col3);
  page.appendChild(body);
  page.appendChild(footer(3, 9));
  return page;
}

// ══════════════════════════════════════════════════════
// PAGE 4 — BALANCE SHEET
// ══════════════════════════════════════════════════════
function page4(s) {
  const page = el('div','page');
  const plan = s.plan;
  const p1 = plan.p1, p2 = plan.p2;
  const p1b = p1.starting_balances;
  const p2b = p2 ? p2.starting_balances : {};
  const C = (a,b) => (a||0)+(b||0);

  const hdr = el('div','p4-header');
  hdr.innerHTML = `<div class="p4-header-title">Balance Sheet</div><div class="p4-header-sub">Financial position at plan start (${plan.start_year})</div>`;
  page.appendChild(hdr);

  const body = el('div','p4-body');
  body.appendChild(el('div','section-label','All values as at plan start date. Figures are illustrative estimates based on inputs provided.'));

  const table = document.createElement('table');
  const colHeaders = p2
    ? `<th>${p1.name}</th><th>${p2.name}</th><th>Combined</th>`
    : `<th>${p1.name}</th>`;
  table.innerHTML = `<thead><tr><th></th>${colHeaders}</tr></thead>`;
  const tbody = document.createElement('tbody');

  function row(label, v1, v2, opts={}) {
    const tr = document.createElement('tr');
    if (opts.groupHeader) { tr.className='group-header'; tr.innerHTML=`<td colspan="${p2?4:2}">${label}</td>`; return tr; }
    if (opts.subtotal)    tr.className='subtotal';
    if (opts.total)       tr.className='total-row';
    const fv1 = v1 != null ? fmt(v1) : '—';
    const fv2 = v2 != null ? fmt(v2) : '—';
    const fComb = (v1!=null||v2!=null) ? fmt((v1||0)+(v2||0)) : '—';
    const cells = p2 ? `<td>${fv1}</td><td>${fv2}</td><td>${fComb}</td>` : `<td>${fv1}</td>`;
    tr.innerHTML = `<td style="${opts.indent?'padding-left:20px;color:var(--ink-mid);':''}">${label}</td>${cells}`;
    return tr;
  }

  // ASSETS
  tbody.appendChild(row('ASSETS', null, null, {groupHeader:true}));

  // Pensions
  tbody.appendChild(row('Pensions', null, null, {groupHeader:true}));
  tbody.appendChild(row(`${p1.name} — SIPP / Pension`, p1b.SIPP, null, {indent:true}));
  if (p2 && p2b.SIPP) tbody.appendChild(row(`${p2.name} — SIPP / Pension`, null, p2b.SIPP, {indent:true}));
  tbody.appendChild(row('Total Pensions', p1b.SIPP||0, p2?p2b.SIPP||0:null, {subtotal:true}));

  // Investments
  tbody.appendChild(row('Investments', null, null, {groupHeader:true}));
  if (p1b.ISA)    tbody.appendChild(row(`${p1.name} — ISA`, p1b.ISA, null, {indent:true}));
  if (p1b.GIAeq)  tbody.appendChild(row(`${p1.name} — GIA (Equities)`, p1b.GIAeq, null, {indent:true}));
  if (p1b.GIAcash)tbody.appendChild(row(`${p1.name} — GIA (Cashlike)`, p1b.GIAcash, null, {indent:true}));
  if (p2) {
    if (p2b.ISA)    tbody.appendChild(row(`${p2.name} — ISA`, null, p2b.ISA, {indent:true}));
    if (p2b.GIAeq)  tbody.appendChild(row(`${p2.name} — GIA (Equities)`, null, p2b.GIAeq, {indent:true}));
    if (p2b.GIAcash)tbody.appendChild(row(`${p2.name} — GIA (Cashlike)`, null, p2b.GIAcash, {indent:true}));
  }
  const p1Inv = (p1b.ISA||0)+(p1b.GIAeq||0)+(p1b.GIAcash||0);
  const p2Inv = p2 ? (p2b.ISA||0)+(p2b.GIAeq||0)+(p2b.GIAcash||0) : null;
  tbody.appendChild(row('Total Investments', p1Inv, p2Inv, {subtotal:true}));

  // Interest accounts — balances already captured in GIAcash, so show as info only (no totals)
  if ((plan.interest_accounts||[]).length) {
    tbody.appendChild(row('Interest-bearing Accounts (within GIA Cashlike)', null, null, {groupHeader:true}));
    plan.interest_accounts.forEach(a => {
      const isP1 = a.owner==='p1';
      const annual = Math.round((a.monthly_draw||0)*12);
      const note = `${a.rate}% rate · £${annual.toLocaleString('en-GB')}/yr draw · included in GIA cashlike above`;
      const tr = document.createElement('tr');
      const fv = `${fmt(a.balance)} ⓘ`;
      const cells = p2
        ? (isP1 ? `<td>${fv}</td><td>—</td><td>${fv}</td>` : `<td>—</td><td>${fv}</td><td>${fv}</td>`)
        : `<td>${fv}</td>`;
      tr.innerHTML = `<td style="padding-left:20px;color:var(--ink-mid);">${a.name}</td>${cells}`;
      tr.title = note;
      tbody.appendChild(tr);
    });
  }

  // Cash
  tbody.appendChild(row('Cash', null, null, {groupHeader:true}));
  if (p1b.Cash) tbody.appendChild(row(`${p1.name} — Cash`, p1b.Cash, null, {indent:true}));
  if (p2 && p2b.Cash) tbody.appendChild(row(`${p2.name} — Cash`, null, p2b.Cash, {indent:true}));
  tbody.appendChild(row('Total Cash', p1b.Cash||0, p2?p2b.Cash||0:null, {subtotal:true}));

  // Total assets
  const totalP1 = (p1b.SIPP||0)+p1Inv+(p1b.Cash||0);
  const totalP2 = p2 ? ((p2b.SIPP||0)+p2Inv+(p2b.Cash||0)) : null;

  // Add interest accounts to totals
  // Total assets — GIAcash already includes interest account balances
  // Total assets — GIAcash already includes interest account balances, so no separate IA addition
  tbody.appendChild(row('Total Assets', totalP1, p2?totalP2:null, {total:true}));

  // LIABILITIES
  tbody.appendChild(row('LIABILITIES', null, null, {groupHeader:true}));
  tbody.appendChild(row('Total Liabilities', 0, p2?0:null, {subtotal:true}));

  // NET WORTH
  tbody.appendChild(row('Net Worth', totalP1, p2?totalP2:null, {total:true}));

  table.appendChild(tbody);
  body.appendChild(table);

  // Note
  const note = el('p','');
  note.style.cssText = 'font-size:8.5px;color:var(--ink-light);margin-top:14px;line-height:1.6;';
  note.textContent = 'Figures represent investable assets only. Property, liabilities, and non-financial assets are not included in this model. Values are as entered and have not been independently verified.';
  body.appendChild(note);

  page.appendChild(body);
  page.appendChild(footer(4, 9));
  return page;
}

// ══════════════════════════════════════════════════════
// PAGE 5 — ASSET PROJECTION TABLE
// ══════════════════════════════════════════════════════
function page5(s) {
  const page = el('div','page');
  const allRows = s.results.annual_rows;
  const plan = s.plan;
  const TOTAL = 9;

  // Every other year: 2026, 2028, 2030 ... 2060
  const rows = allRows.filter(r => (r.year - s.meta.plan_start_year) % 2 === 0);

  const hdr = el('div','p2-header');
  hdr.style.background = '#1a3ab5';
  hdr.innerHTML = `<div class="p2-header-title">Asset Projection</div><div class="p2-header-sub">Real terms (today's money, ${s.meta.plan_start_year} prices) · every other year · deterministic projection</div>`;
  page.appendChild(hdr);

  const body = el('div','page-body');
  body.style.cssText = 'padding:20px 32px 16px;display:flex;flex-direction:column;overflow:hidden;';

  // ── Table ──────────────────────────────────────────────────────────
  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed;';

  // Column widths: first col wider (label), rest equal
  const colCount = rows.length + 1;
  const labelW = 90;
  const dataW = Math.floor((1123 - 64 - labelW) / rows.length); // 1123 page - 64 padding - label

  let colgroupHtml = `<col style="width:${labelW}px;">`;
  rows.forEach(() => { colgroupHtml += `<col style="width:${dataW}px;">`; });
  tbl.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;

  // ── Header rows ────────────────────────────────────────────────────
  const thead = document.createElement('thead');

  // Year row
  const yearRow = document.createElement('tr');
  yearRow.innerHTML = `<th style="text-align:left;padding:5px 6px;border-bottom:2px solid var(--ink);font-size:8px;color:var(--ink-light);font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Year</th>`;
  rows.forEach(r => {
    yearRow.innerHTML += `<th style="text-align:right;padding:5px 4px;border-bottom:2px solid var(--ink);font-size:8.5px;font-weight:700;color:var(--ink);">${r.year}</th>`;
  });
  thead.appendChild(yearRow);

  // Age row
  const ageRow = document.createElement('tr');
  ageRow.innerHTML = `<td style="padding:3px 6px 6px;font-size:7.5px;color:var(--ink-light);">Age ${plan.p1.name} | ${plan.p2?.name||''}</td>`;
  rows.forEach(r => {
    ageRow.innerHTML += `<td style="text-align:right;padding:3px 4px 6px;font-size:7.5px;color:var(--ink-light);">${r.p1_age}|${r.p2_age}</td>`;
  });
  thead.appendChild(ageRow);
  tbl.appendChild(thead);

  // ── Body rows ──────────────────────────────────────────────────────
  const tbody = document.createElement('tbody');

  function dataRow(label, values, opts={}) {
    const tr = document.createElement('tr');
    if (opts.groupHeader) {
      tr.innerHTML = `<td colspan="${colCount}" style="padding:8px 6px 3px;font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-light);background:var(--bg);border-top:1px solid var(--rule);">${label}</td>`;
      return tr;
    }
    const isTotal   = opts.total;
    const isSubtot  = opts.subtotal;
    const bgStyle   = isTotal   ? 'background:#e8eef8;' : isSubtot ? 'background:var(--bg-mid);' : '';
    const fwStyle   = isTotal   ? 'font-weight:800;' : isSubtot ? 'font-weight:700;' : '';
    const borderTop = isTotal   ? 'border-top:2px solid var(--ink);' : '';
    const labelStyle = `padding:5px 6px;color:${isTotal?'var(--ink)':'var(--ink-mid)'};${fwStyle}${bgStyle}${borderTop}`;

    tr.innerHTML = `<td style="${labelStyle}">${label}</td>`;
    values.forEach((v, i) => {
      const even = i % 2 === 0;
      const cellBg = isTotal ? '#e8eef8' : isSubtot ? 'var(--bg-mid)' : even ? 'var(--white)' : '#fafbfd';
      const color  = opts.color || (isTotal ? 'var(--ink)' : 'var(--ink-mid)');
      tr.innerHTML += `<td style="text-align:right;padding:5px 4px;${fwStyle}background:${cellBg};color:${color};${borderTop}">${v != null && v > 0.5 ? fmtK(v) : '—'}</td>`;
    });
    return tr;
  }

  // Format as £k or £M
  function fmtK(n) {
    if (n == null) return '—';
    if (n >= 1000000) return '£' + (n/1000000).toFixed(2) + 'M';
    if (n >= 1000)    return '£' + Math.round(n/1000) + 'k';
    return '£' + Math.round(n);
  }

  // ── Real terms conversion ──────────────────────────────────────────
  // Multiply nominal values by real_deflator to get today's money.
  // MC values use the deterministic deflator as an approximation.
  const def = r => r.real_deflator || 1;
  const real = (r, v) => v * def(r);

  // ── PENSIONS ───────────────────────────────────────────────────────
  tbody.appendChild(dataRow('Pensions', [], {groupHeader:true}));
  tbody.appendChild(dataRow(`${plan.p1.name} SIPP`, rows.map(r => real(r, r.snap.p1_sipp))));
  if (plan.p2) tbody.appendChild(dataRow(`${plan.p2.name} SIPP`, rows.map(r => real(r, r.snap.p2_sipp))));
  tbody.appendChild(dataRow('Total Pensions', rows.map(r => real(r, (r.snap.p1_sipp||0)+(r.snap.p2_sipp||0))), {subtotal:true}));

  // ── ISAs ───────────────────────────────────────────────────────────
  tbody.appendChild(dataRow('ISAs', [], {groupHeader:true}));
  tbody.appendChild(dataRow(`${plan.p1.name} ISA`, rows.map(r => real(r, r.snap.p1_isa))));
  if (plan.p2) tbody.appendChild(dataRow(`${plan.p2.name} ISA`, rows.map(r => real(r, r.snap.p2_isa))));
  tbody.appendChild(dataRow('Total ISAs', rows.map(r => real(r, (r.snap.p1_isa||0)+(r.snap.p2_isa||0))), {subtotal:true}));

  // ── GIA / Investments ──────────────────────────────────────────────
  tbody.appendChild(dataRow('Investments (GIA)', [], {groupHeader:true}));
  tbody.appendChild(dataRow(`${plan.p1.name} GIA`, rows.map(r => real(r, (r.snap.p1_gia||0)+(r.snap.p1_int_bal||0)))));
  if (plan.p2) tbody.appendChild(dataRow(`${plan.p2.name} GIA`, rows.map(r => real(r, (r.snap.p2_gia||0)+(r.snap.p2_int_bal||0)))));
  tbody.appendChild(dataRow('Total GIA', rows.map(r => real(r, (r.snap.p1_gia||0)+(r.snap.p1_int_bal||0)+(r.snap.p2_gia||0)+(r.snap.p2_int_bal||0))), {subtotal:true}));

  // ── Cash ───────────────────────────────────────────────────────────
  tbody.appendChild(dataRow('Cash', [], {groupHeader:true}));
  tbody.appendChild(dataRow(`${plan.p1.name} Cash`, rows.map(r => real(r, r.snap.p1_cash))));
  if (plan.p2 && rows.some(r => r.snap.p2_cash > 0)) {
    tbody.appendChild(dataRow(`${plan.p2.name} Cash`, rows.map(r => real(r, r.snap.p2_cash))));
  }
  tbody.appendChild(dataRow('Total Cash', rows.map(r => real(r, (r.snap.p1_cash||0)+(r.snap.p2_cash||0))), {subtotal:true}));

  // ── Total ──────────────────────────────────────────────────────────
  tbody.appendChild(dataRow('Projected total (today\'s money)', rows.map(r => real(r, r.total_portfolio)), {total:true}));

  // ── Simulated returns ──────────────────────────────────────────────
  tbody.appendChild(dataRow('Simulated returns: median outcome', rows.map(r => real(r, r.mc_p50)), {color:'var(--blue)'}));
  tbody.appendChild(dataRow('Simulated returns: weaker (1-in-10)', rows.map(r => real(r, r.mc_p10)), {color:'var(--amber)'}));

  tbl.appendChild(tbody);
  body.appendChild(tbl);

  // ── Events mini-table ──────────────────────────────────────────────
  const p1Name = plan.p1.name;
  const p2Name = plan.p2?.name || '';

  // Collect all events, classify by person
  const allEvents = [
    ...(s.annotations||[])
      .filter(a => a.event !== 'depletion')
      .map(a => ({ year: a.year, label: a.message, person: a.person, type: 'life' })),
    ...Object.entries(s.depletions||{})
      .map(([key, d]) => ({
        year: d.year,
        label: key + ' depleted',
        person: key.startsWith(p1Name) ? 'p1' : 'p2',
        type: 'depletion',
      })),
  ].sort((a, b) => a.year - b.year || a.label.localeCompare(b.label));

  function shortLabel(label) {
    return label
      .replace(p1Name + "'s ", '').replace(p1Name + ' ', '')
      .replace(p2Name + "'s ", '').replace(p2Name + ' ', '')
      .replace(/\s*\(£[\d,]+\/yr\)/, '')
      .replace(' begins', ' begins')
      .replace(' stops', ' stops')
      .replace(' depleted', ' depleted');
  }

  function eventEntry(e) {
    const col = e.type === 'depletion' ? '#BA7517' : '#2d55e8';
    return `<span style="margin-right:18px;white-space:nowrap;">
      <span style="font-weight:700;color:${col};">${e.year}</span>
      <span style="color:${e.type==='depletion'?'#BA7517':'var(--ink-mid)'}"> ${shortLabel(e.label)}</span>
    </span>`;
  }

  const p1Events = allEvents.filter(e => e.person === 'p1');
  const p2Events = allEvents.filter(e => e.person === 'p2');

  const eventsTable = el('div','');
  eventsTable.style.cssText = 'margin-top:10px;border:1px solid var(--rule);border-radius:6px;overflow:hidden;';

  function eventRow(name, events, isLast) {
    const d = el('div','');
    d.style.cssText = `display:flex;align-items:baseline;gap:0;padding:6px 12px;${isLast?'':'border-bottom:1px solid var(--rule);'}`;
    const nameEl = el('div','');
    nameEl.style.cssText = 'font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-light);width:52px;flex-shrink:0;padding-top:1px;';
    nameEl.textContent = name;
    const entriesEl = el('div','');
    entriesEl.style.cssText = 'font-size:8.5px;line-height:1.8;flex:1;';
    entriesEl.innerHTML = events.length
      ? events.map(eventEntry).join('')
      : `<span style="color:var(--ink-light);font-style:italic;">No events</span>`;
    d.appendChild(nameEl);
    d.appendChild(entriesEl);
    return d;
  }

  eventsTable.appendChild(eventRow(p1Name, p1Events, !p2Name));
  if (p2Name) eventsTable.appendChild(eventRow(p2Name, p2Events, true));

  body.appendChild(eventsTable);


  page.appendChild(body);
  page.appendChild(footer(5, TOTAL));
  return page;
}


// ══════════════════════════════════════════════════════
// PAGE 6 — TAX TABLE
// ══════════════════════════════════════════════════════
function page6(s) {
  const page = el('div','page');
  const allRows = s.results.annual_rows;
  const plan = s.plan;
  const TOTAL = 9;

  // Every other year matching asset projection
  const rows = allRows.filter(r => (r.year - s.meta.plan_start_year) % 2 === 0);

  const hdr = el('div','p2-header');
  hdr.style.background = '#1a3ab5';
  hdr.innerHTML = `<div class="p2-header-title">Tax</div><div class="p2-header-sub">Real terms (today's money, ${s.meta.plan_start_year} prices) · income tax, CGT and NI · every other year</div>`;
  page.appendChild(hdr);

  const body = el('div','page-body');
  body.style.cssText = 'padding:20px 32px 16px;display:flex;flex-direction:column;overflow:hidden;';

  // ── Summary stat cards ─────────────────────────────────────────────
  const totalTax    = allRows.reduce((sum, r) => sum + r.household_tax * (r.real_deflator||1), 0);
  const peakTax     = Math.max(...allRows.map(r => r.household_tax * (r.real_deflator||1)));
  const taxFreeYrs  = allRows.filter(r => r.household_tax < 1).length;
  const avgRate     = allRows.reduce((s,r) => s + (r.household_gross_income > 0 ? r.household_tax/r.household_gross_income : 0), 0) / allRows.length;

  const cards = el('div','');
  cards.style.cssText = 'display:flex;gap:10px;margin-bottom:14px;';
  [
    { l:'Total tax over plan (real)',  v: fmt(totalTax),                           s:'across all years' },
    { l:'Peak annual tax (real)',      v: fmt(peakTax),                            s:'highest single year' },
    { l:'Tax-free years',             v: `${taxFreeYrs} of ${allRows.length}`,    s:'years with no tax liability' },
    { l:'Average effective rate',     v: (avgRate*100).toFixed(1)+'%',            s:'tax as % of gross income' },
  ].forEach(c => {
    const card = el('div','');
    card.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--rule);border-radius:6px;padding:9px 11px;';
    card.innerHTML = `<div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-light);margin-bottom:3px;">${c.l}</div><div style="font-family:'Helvetica Neue',sans-serif;font-size:15px;font-weight:800;color:var(--ink);line-height:1;">${c.v}</div><div style="font-size:7.5px;color:var(--ink-light);margin-top:2px;">${c.s}</div>`;
    cards.appendChild(card);
  });
  body.appendChild(cards);

  // ── Table ──────────────────────────────────────────────────────────
  const labelW = 150;
  const colCount = rows.length + 1;
  const dataW = Math.floor((1123 - 64 - labelW) / rows.length);

  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed;';

  let colgroupHtml = `<col style="width:${labelW}px;">`;
  rows.forEach(() => { colgroupHtml += `<col style="width:${dataW}px;">`; });
  tbl.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;

  const thead = document.createElement('thead');

  // Year row
  const yearRow = document.createElement('tr');
  yearRow.innerHTML = `<th style="text-align:left;padding:5px 6px;border-bottom:2px solid var(--ink);font-size:8px;color:var(--ink-light);font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Year</th>`;
  rows.forEach(r => {
    yearRow.innerHTML += `<th style="text-align:right;padding:5px 4px;border-bottom:2px solid var(--ink);font-size:8.5px;font-weight:700;color:var(--ink);">${r.year}</th>`;
  });
  thead.appendChild(yearRow);

  // Age row
  const ageRow = document.createElement('tr');
  ageRow.innerHTML = `<td style="padding:3px 6px 6px;font-size:7.5px;color:var(--ink-light);">Age ${plan.p1.name} | ${plan.p2?.name||''}</td>`;
  rows.forEach(r => {
    ageRow.innerHTML += `<td style="text-align:right;padding:3px 4px 6px;font-size:7.5px;color:var(--ink-light);">${r.p1_age}|${r.p2_age}</td>`;
  });
  thead.appendChild(ageRow);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const def = r => r.real_deflator || 1;

  function taxRow(label, values, opts={}) {
    const tr = document.createElement('tr');
    if (opts.groupHeader) {
      tr.innerHTML = `<td colspan="${colCount}" style="padding:7px 6px 3px;font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-light);background:var(--bg);border-top:1px solid var(--rule);">${label}</td>`;
      return tr;
    }
    const isTotal  = opts.total;
    const isSub    = opts.subtotal;
    const bg       = isTotal ? 'background:#e8eef8;' : isSub ? 'background:var(--bg-mid);' : '';
    const fw       = isTotal || isSub ? 'font-weight:700;' : '';
    const bt       = isTotal ? 'border-top:2px solid var(--ink);' : '';
    const col      = opts.color || (isTotal ? 'var(--ink)' : 'var(--ink-mid)');
    tr.innerHTML   = `<td style="padding:5px 6px;${fw}${bg}${bt}color:${isTotal?'var(--ink)':'var(--ink-mid)'};">${label}</td>`;
    values.forEach((v, i) => {
      const cellBg = isTotal ? '#e8eef8' : isSub ? 'var(--bg-mid)' : i%2===0 ? 'var(--white)' : '#fafbfd';
      const disp = v > 0.5 ? fmt(v) : '—';
      tr.innerHTML += `<td style="text-align:right;padding:5px 4px;${fw}background:${cellBg};color:${col};${bt}">${disp}</td>`;
    });
    return tr;
  }

  // ── Person 1 ───────────────────────────────────────────────────────
  tbody.appendChild(taxRow(plan.p1.name, [], {groupHeader:true}));
  tbody.appendChild(taxRow('Income tax',  rows.map(r => r.p1_income_tax * def(r))));
  tbody.appendChild(taxRow('CGT',         rows.map(r => r.p1_cgt * def(r))));
  tbody.appendChild(taxRow('National Insurance', rows.map(r => r.p1_ni * def(r))));
  tbody.appendChild(taxRow(`${plan.p1.name} total`, rows.map(r => (r.p1_income_tax+r.p1_cgt+r.p1_ni)*def(r)), {subtotal:true}));

  // ── Person 2 ───────────────────────────────────────────────────────
  if (plan.p2) {
    tbody.appendChild(taxRow(plan.p2.name, [], {groupHeader:true}));
    tbody.appendChild(taxRow('Income tax',  rows.map(r => r.p2_income_tax * def(r))));
    tbody.appendChild(taxRow('CGT',         rows.map(r => r.p2_cgt * def(r))));
    tbody.appendChild(taxRow('National Insurance', rows.map(r => r.p2_ni * def(r))));
    tbody.appendChild(taxRow(`${plan.p2.name} total`, rows.map(r => (r.p2_income_tax+r.p2_cgt+r.p2_ni)*def(r)), {subtotal:true}));
  }

  // ── Household totals ───────────────────────────────────────────────
  tbody.appendChild(taxRow('Household total tax (today\'s money)', rows.map(r => r.household_tax * def(r)), {total:true}));

  // ── Effective rate row ─────────────────────────────────────────────
  tbody.appendChild(taxRow('Effective tax rate', rows.map(r => {
    if (r.household_gross_income < 1) return 0;
    return null; // handled below as special render
  }), {color:'var(--ink-mid)'}));

  // Replace last row with rate display
  const lastRow = tbody.lastElementChild;
  lastRow.querySelectorAll('td:not(:first-child)').forEach((td, i) => {
    const r = rows[i];
    const rate = r && r.household_gross_income > 0
      ? (r.household_tax / r.household_gross_income * 100).toFixed(1) + '%'
      : '—';
    td.textContent = rate;
    td.style.color = 'var(--ink-mid)';
    td.style.fontStyle = 'normal';
  });

  // ── Cumulative tax row ─────────────────────────────────────────────
  // Running total of real-terms tax up to and including each displayed year.
  // Uses allRows (every year) to accumulate, then samples at the every-other-year points.
  const cumulativeByYear = {};
  let runningTotal = 0;
  allRows.forEach(r => {
    runningTotal += r.household_tax * (r.real_deflator || 1);
    cumulativeByYear[r.year] = runningTotal;
  });
  tbody.appendChild(taxRow('Cumulative tax to date (today\'s money)', rows.map(r => cumulativeByYear[r.year] || 0), {color:'var(--ink)'}));
  // Style cumulative row distinctively — italic label, no border-top
  const cumRow = tbody.lastElementChild;
  const cumLabel = cumRow.querySelector('td:first-child');
  if (cumLabel) { cumLabel.style.fontStyle = 'italic'; cumLabel.style.color = 'var(--ink-mid)'; }

  tbl.appendChild(tbody);
  body.appendChild(tbl);

  // ── Tax efficiency note ────────────────────────────────────────────
  const note = el('div','');
  note.style.cssText = 'margin-top:12px;background:var(--blue-light,#eaeffd);border:1px solid rgba(45,85,232,.2);border-radius:6px;padding:10px 14px;';
  note.innerHTML = `<div class="section-label" style="color:var(--blue);margin-bottom:4px;">Tax efficiency note</div><p style="font-size:9px;color:var(--ink-mid);line-height:1.65;">The Allowance Maximiser strategy draws income up to each person's tax-free thresholds before using taxable sources, keeping tax minimal in the early years of retirement. Tax rises from the mid-2030s as State Pension and larger pension draws push taxable income above the Personal Allowance. CGT and NI are shown separately where applicable.</p>`;
  body.appendChild(note);

  page.appendChild(body);
  page.appendChild(footer(6, TOTAL));
  return page;
}


// ══════════════════════════════════════════════════════
// PAGE 7 — INCOME & FUNDING SOURCES
// ══════════════════════════════════════════════════════
function page7(s) {
  const page = el('div','page');
  const allRows = s.results.annual_rows;
  const plan = s.plan;
  const TOTAL = 9;

  // Every other year
  const rows = allRows.filter(r => (r.year - s.meta.plan_start_year) % 2 === 0);
  const def  = r => r.real_deflator || 1;

  const hdr = el('div','p2-header');
  hdr.style.background = '#1a3ab5';
  hdr.innerHTML = `<div class="p2-header-title">Income &amp; Funding Sources</div><div class="p2-header-sub">Real terms (today's money, ${s.meta.plan_start_year} prices) · how retirement income is funded year by year · every other year</div>`;
  page.appendChild(hdr);

  const body = el('div','page-body');
  body.style.cssText = 'padding:20px 32px 16px;display:flex;flex-direction:column;overflow:hidden;';

  // ── Summary stat cards ─────────────────────────────────────────────
  const totalTarget   = allRows.reduce((s,r) => s + r.target * def(r), 0);
  const totalTax      = allRows.reduce((s,r) => s + r.household_tax * def(r), 0);
  const taxFreeYrs    = allRows.filter(r => r.household_tax < 1).length;
  const spYears       = allRows.filter(r => (r.p1_sp + r.p2_sp) > 0).length;

  const cards = el('div','');
  cards.style.cssText = 'display:flex;gap:10px;margin-bottom:14px;';
  [
    { l:'Total target income (real)',  v: fmt(totalTarget),                       s:'across plan lifetime' },
    { l:'Total tax paid (real)',       v: fmt(totalTax),                          s:'income tax, CGT & NI' },
    { l:'Tax-efficient years',        v: `${taxFreeYrs} of ${allRows.length}`,   s:'years with minimal tax' },
    { l:'Years with State Pension',   v: `${spYears} of ${allRows.length}`,      s:'once both pensions start' },
  ].forEach(c => {
    const card = el('div','');
    card.style.cssText = 'flex:1;background:var(--bg);border:1px solid var(--rule);border-radius:6px;padding:9px 11px;';
    card.innerHTML = `<div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-light);margin-bottom:3px;">${c.l}</div><div style="font-family:'Helvetica Neue',sans-serif;font-size:15px;font-weight:800;color:var(--ink);line-height:1;">${c.v}</div><div style="font-size:7.5px;color:var(--ink-light);margin-top:2px;">${c.s}</div>`;
    cards.appendChild(card);
  });
  body.appendChild(cards);

  // ── Table ──────────────────────────────────────────────────────────
  const labelW  = 160;
  const colCount = rows.length + 1;
  const dataW   = Math.floor((1123 - 64 - labelW) / rows.length);

  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:8.5px;table-layout:fixed;';

  let cg = `<col style="width:${labelW}px;">`;
  rows.forEach(() => { cg += `<col style="width:${dataW}px;">`; });
  tbl.innerHTML = `<colgroup>${cg}</colgroup>`;

  const thead = document.createElement('thead');
  const yearRow = document.createElement('tr');
  yearRow.innerHTML = `<th style="text-align:left;padding:5px 6px;border-bottom:2px solid var(--ink);font-size:8px;color:var(--ink-light);font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Source</th>`;
  rows.forEach(r => {
    yearRow.innerHTML += `<th style="text-align:right;padding:5px 4px;border-bottom:2px solid var(--ink);font-size:8.5px;font-weight:700;color:var(--ink);">${r.year}</th>`;
  });
  thead.appendChild(yearRow);

  const ageRow = document.createElement('tr');
  ageRow.innerHTML = `<td style="padding:3px 6px 6px;font-size:7.5px;color:var(--ink-light);">Age ${plan.p1.name} | ${plan.p2?.name||''}</td>`;
  rows.forEach(r => {
    ageRow.innerHTML += `<td style="text-align:right;padding:3px 4px 6px;font-size:7.5px;color:var(--ink-light);">${r.p1_age}|${r.p2_age}</td>`;
  });
  thead.appendChild(ageRow);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');

  function cfRow(label, values, opts={}) {
    const tr = document.createElement('tr');
    if (opts.groupHeader) {
      tr.innerHTML = `<td colspan="${colCount}" style="padding:7px 6px 3px;font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-light);background:var(--bg);border-top:1px solid var(--rule);">${label}</td>`;
      return tr;
    }
    const isTotal = opts.total;
    const isSub   = opts.subtotal;
    const bg      = isTotal ? 'background:#e8eef8;' : isSub ? 'background:var(--bg-mid);' : '';
    const fw      = isTotal || isSub ? 'font-weight:700;' : '';
    const bt      = isTotal ? 'border-top:2px solid var(--ink);' : '';
    const col     = opts.color || (isTotal ? 'var(--ink)' : 'var(--ink-mid)');
    tr.innerHTML  = `<td style="padding:5px 6px;${fw}${bg}${bt}color:${isTotal?'var(--ink)':col};">${label}</td>`;
    values.forEach((v, i) => {
      const cellBg = isTotal ? '#e8eef8' : isSub ? 'var(--bg-mid)' : i%2===0 ? 'var(--white)' : '#fafbfd';
      const disp   = v > 0.5 ? fmt(v) : (opts.showZero ? '£0' : '—');
      tr.innerHTML += `<td style="text-align:right;padding:5px 4px;${fw}background:${cellBg};color:${col};${bt}">${disp}</td>`;
    });
    return tr;
  }

  // ── Guaranteed income ──────────────────────────────────────────────
  tbody.appendChild(cfRow('Guaranteed income', [], {groupHeader:true}));
  tbody.appendChild(cfRow('State Pension — ' + plan.p1.name,  rows.map(r => r.p1_sp * def(r))));
  if (plan.p2) tbody.appendChild(cfRow('State Pension — ' + plan.p2.name, rows.map(r => r.p2_sp * def(r))));
  tbody.appendChild(cfRow('Salary — ' + plan.p1.name, rows.map(r => r.p1_salary * def(r))));
  if (plan.p2) tbody.appendChild(cfRow('Salary — ' + plan.p2.name, rows.map(r => r.p2_salary * def(r))));
  tbody.appendChild(cfRow('Interest account draw', rows.map(r => (r.p1_int_draw + r.p2_int_draw) * def(r))));
  const totGuaranteed = r => (r.p1_sp + r.p2_sp + r.p1_salary + r.p2_salary + r.p1_int_draw + r.p2_int_draw) * def(r);
  tbody.appendChild(cfRow('Total guaranteed', rows.map(r => totGuaranteed(r)), {subtotal:true}));

  // ── Portfolio withdrawals ──────────────────────────────────────────
  tbody.appendChild(cfRow('Portfolio withdrawals', [], {groupHeader:true}));
  tbody.appendChild(cfRow('SIPP / Pension draws', rows.map(r => ((r.p1_drawn.SIPP||0) + (r.p2_drawn.SIPP||0)) * def(r))));
  tbody.appendChild(cfRow('ISA draws',            rows.map(r => ((r.p1_drawn.ISA||0)  + (r.p2_drawn.ISA||0))  * def(r))));
  tbody.appendChild(cfRow('GIA draws',            rows.map(r => ((r.p1_drawn.GIA||0)  + (r.p2_drawn.GIA||0))  * def(r))));
  tbody.appendChild(cfRow('Cash draws',           rows.map(r => ((r.p1_drawn.Cash||0) + (r.p2_drawn.Cash||0)) * def(r))));
  tbody.appendChild(cfRow('Dividends',            rows.map(r => ((r.p1_divs||0) + (r.p2_divs||0)) * def(r))));
  const totPortfolio = r => ((r.p1_drawn.SIPP||0)+(r.p2_drawn.SIPP||0)+(r.p1_drawn.ISA||0)+(r.p2_drawn.ISA||0)+(r.p1_drawn.GIA||0)+(r.p2_drawn.GIA||0)+(r.p1_drawn.Cash||0)+(r.p2_drawn.Cash||0)+(r.p1_divs||0)+(r.p2_divs||0)) * def(r);
  tbody.appendChild(cfRow('Total portfolio draws', rows.map(r => totPortfolio(r)), {subtotal:true}));

  // ── Summary ────────────────────────────────────────────────────────
  tbody.appendChild(cfRow('Gross income (today\'s money)', rows.map(r => r.household_gross_income * def(r)), {total:true}));
  tbody.appendChild(cfRow('Tax paid',                     rows.map(r => r.household_tax * def(r)), {color:'var(--amber)'}));
  tbody.appendChild(cfRow('Net income (today\'s money)',  rows.map(r => r.household_net_cashflow * def(r)), {total:true, color:'var(--green)'}));
  tbody.appendChild(cfRow('Target income',               rows.map(r => r.target * def(r)), {color:'var(--ink-mid)'}));

  tbl.appendChild(tbody);
  body.appendChild(tbl);

  // ── Note ───────────────────────────────────────────────────────────
  const note = el('div','');
  note.style.cssText = 'margin-top:10px;background:#eaf3de;border:1px solid rgba(59,109,17,.25);border-radius:6px;padding:9px 14px;';
  note.innerHTML = `<div class="section-label" style="color:#3B6D11;margin-bottom:3px;">How to read this table</div><p style="font-size:8.5px;color:var(--ink-mid);line-height:1.65;">The funding mix shifts significantly over time. Early retirement draws heavily on Cash, interest income, and Heidi's salary. From 2031 onwards, SIPP and ISA withdrawals take over. Both State Pensions start in 2034–35, reducing the portfolio draws required. Tax rises gradually as pension income pushes above the Personal Allowance. Net income matches the target in every year. Any shortfall shown elsewhere is the tax cost, not a funding gap.</p>`;
  body.appendChild(note);

  page.appendChild(body);
  page.appendChild(footer(7, TOTAL));
  return page;
}


// ══════════════════════════════════════════════════════
// PAGE 8 — PLAN SUMMARY (final page)
// ══════════════════════════════════════════════════════
function page8(s) {
  const page = el('div','page');
  const r = s.results, n = s.narrative, st = s.stress_tests || {};
  const plan = s.plan;
  const rate = r.success_rate;
  const TOTAL = 9;

  function vcol(rate) {
    if (rate == null) return { bg:'#2d55e8', ab:'#eaeffd', ac:'#2d55e8' };
    if (rate >= 0.95) return { bg:'#3B6D11', ab:'#eaf3de', ac:'#3B6D11' };
    if (rate >= 0.90) return { bg:'#2d55e8', ab:'#eaeffd', ac:'#2d55e8' };
    if (rate >= 0.80) return { bg:'#BA7517', ab:'#faeeda', ac:'#BA7517' };
    return                   { bg:'#A32D2D', ab:'#fcebeb', ac:'#A32D2D' };
  }
  // Colour by success rate band — matches app mc-render.js logic
  // safe: #C0DD97 bg / #27500A text  (≥95%)
  // neutral: #D3D1C7 bg / #5F5E5A text (≥90%)
  // warn: #FAC775 bg / #633806 text  (≥80%)
  // risk: #F7C1C1 bg / #791F1F text  (<80%)
  function scBg(rate)   { return rate>=.95?'#C0DD97':rate>=.90?'#D3D1C7':rate>=.80?'#FAC775':'#F7C1C1'; }
  function scText(rate) { return rate>=.95?'#27500A':rate>=.90?'#5F5E5A':rate>=.80?'#633806':'#791F1F'; }
  function scBorder(rate){ return rate>=.95?'#3B6D11':rate>=.90?'#7a90a8':rate>=.80?'#BA7517':'#A32D2D'; }
  function scLabel(rate) { return rate>=.95?'Still on track':rate>=.90?'Reduced margin':rate>=.80?'Borderline':'At risk'; }
  const v = vcol(rate);
  const fmtPctV = r => r == null ? '—' : (r >= 0.995 ? '99%+' : Math.round(r*100)+'%');

  // ── VERDICT HERO BAND ─────────────────────────────────────────────
  const hero = el('div','');
  hero.style.cssText = `background:${v.bg};padding:22px 48px;flex-shrink:0;`;
  hero.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:32px;">
      <div>
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.16em;color:rgba(255,255,255,.5);margin-bottom:6px;">Plan summary · ${s.meta.persons.map(p=>p.name).join(' & ')} · Prepared ${new Date(s.generated_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div>
        <div style="font-family:'Helvetica Neue',sans-serif;font-size:38px;font-weight:900;color:#fff;line-height:1;letter-spacing:-.03em;margin-bottom:10px;">${n.verdict_state || r.verdict || 'Plan assessed'}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.9);line-height:1.6;max-width:580px;">${strip(n.verdict_sentence||r.verdict_summary||'')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;border-left:1px solid rgba(255,255,255,.2);padding-left:32px;">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.5);margin-bottom:4px;">Likelihood of holding up</div>
        <div style="font-family:'Helvetica Neue',sans-serif;font-size:58px;font-weight:900;color:#fff;line-height:1;letter-spacing:-.04em;">${fmtPctV(rate)}</div>
        <div style="font-size:8px;color:rgba(255,255,255,.4);margin-top:5px;">Based on ${(r.sim_count||10000).toLocaleString('en-GB')} simulated scenarios · ${plan.start_year}–${plan.end_year}</div>
      </div>
    </div>`;
  page.appendChild(hero);

  // ── THREE COLUMN BODY ─────────────────────────────────────────────
  const body = el('div','page-body');
  body.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;flex:1;min-height:0;';

  // ══ LEFT: decade bars + pressure + action ════════════════════════
  const leftCol = el('div','');
  leftCol.style.cssText = 'padding:18px 28px;display:flex;flex-direction:column;border-right:1px solid var(--rule);overflow:hidden;';
  leftCol.appendChild(el('div','section-label','Likelihood of plan holding up – by decade'));

  (r.survival_by_decade||[]).forEach(d => {
    const pct = (d.survival_rate*100);
    const col = d.survival_rate>=.99?'#3B6D11':d.survival_rate>=.95?'#5A9E1A':d.survival_rate>=.90?'#8FA832':d.survival_rate>=.80?'#BA7517':d.survival_rate>=.70?'#C4513A':'#A32D2D';
    const row = el('div','');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;margin-bottom:8px;';
    row.innerHTML = `
      <div style="width:48px;text-align:right;font-size:9.5px;color:var(--ink-mid);flex-shrink:0;">${d.age_p1_end!=null?'Age '+d.age_p1_end:d.year}</div>
      <div style="flex:1;height:12px;background:var(--rule);border-radius:3px;overflow:hidden;"><div style="width:${pct.toFixed(1)}%;height:100%;background:${col};border-radius:3px;"></div></div>
      <div style="width:58px;font-family:'Helvetica Neue',sans-serif;font-size:8.5px;font-weight:700;color:${col};">${d.survival_rate>=.99?'Resilient':d.survival_rate>=.95?'Solid':d.survival_rate>=.90?'Adequate':d.survival_rate>=.80?'Thin':d.survival_rate>=.70?'Fragile':'Vulnerable'}</div>`;
    leftCol.appendChild(row);
  });

  if (n.survival_note) {
    const sn = el('p',''); sn.style.cssText='font-size:9.5px;color:var(--ink-mid);line-height:1.6;margin:8px 0 12px;'; sn.textContent=n.survival_note; leftCol.appendChild(sn);
  }

  leftCol.appendChild(el('div','divider-blue'));

  // Action hero — ties "no change needed" to the sequence risk reality
  const sorrSc = st && st['sorr'];
  const sorrIsHigh = sorrSc?.run && sorrSc?.impact_level === 'high';
  const actionLine = strip(n.action_line || '');
  const actionImpact = strip(n.action_impact || '');
  const sorrCaveat = sorrIsHigh
    ? `That said, your plan shows meaningful sensitivity to a sharp early market fall. The most important practical step is maintaining a cash buffer of 6–12 months' spending – not as a sign of weakness in the plan, but as the standard protection against this specific risk.`
    : '';

  const ah = el('div','');
  ah.style.cssText = `background:${v.ab};border-left:4px solid ${v.ac};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:12px;`;
  ah.innerHTML = `
    <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${v.ac};margin-bottom:6px;">Recommended action</div>
    <div style="font-family:'Helvetica Neue',sans-serif;font-size:13px;font-weight:800;color:var(--ink);margin-bottom:7px;line-height:1.3;">${actionLine}</div>
    <div style="font-size:9.5px;color:var(--ink-mid);line-height:1.6;">${actionImpact}${sorrCaveat ? ' ' + sorrCaveat : ''}</div>`;
  leftCol.appendChild(ah);

  // Key points
  if ((n.bullet_items||[]).length) {
    leftCol.appendChild(el('div','section-label','Key points'));
    (n.bullet_items||[]).forEach(b => {
      const row = el('div',''); row.style.cssText='display:flex;gap:9px;margin-bottom:7px;align-items:flex-start;';
      const dot = el('div',''); dot.style.cssText=`width:5px;height:5px;border-radius:50%;background:${v.ac};flex-shrink:0;margin-top:4px;`;
      const txt = el('div',''); txt.style.cssText='font-size:9.5px;color:var(--ink-mid);line-height:1.55;'; txt.textContent=strip(b);
      row.appendChild(dot); row.appendChild(txt); leftCol.appendChild(row);
    });
  }

  leftCol.appendChild(el('div','divider-blue'));

  // Good practice — in left column so it always shows
  leftCol.appendChild(el('div','section-label','Good practice'));
  [
    'Keep 6–12 months of spending in accessible cash. This is the single most practical defence against sequence risk – it means you can avoid selling investments when markets are down.',
    'Review this plan annually, or after any significant market movement or change in personal circumstances.',
    'A willingness to trim spending by 10–15% in weaker years materially improves long-term resilience.',
    'Both State Pensions are inflation-linked – they provide a rising guaranteed income floor from age 67.',
  ].forEach(b => {
    const row = el('div',''); row.style.cssText='display:flex;gap:9px;margin-bottom:7px;align-items:flex-start;';
    const dot = el('div',''); dot.style.cssText='width:5px;height:5px;border-radius:50%;background:var(--blue);flex-shrink:0;margin-top:4px;';
    const txt = el('div',''); txt.style.cssText='font-size:9px;color:var(--ink-mid);line-height:1.6;'; txt.textContent=b;
    row.appendChild(dot); row.appendChild(txt); leftCol.appendChild(row);
  });

  // ══ RIGHT: scenario testing + good practice ══════════════════════
  const rightCol = el('div','');
  rightCol.style.cssText = 'padding:18px 28px;display:flex;flex-direction:column;overflow:hidden;';
  rightCol.appendChild(el('div','section-label','We tested three things that could go wrong'));

  // Connecting sentence — bridges verdict to scenarios
  const allScenLow = st && ['sorr','inflation','lostDecade'].every(id => !st[id]?.run || st[id]?.impact_level === 'low');
  const hasHighImpact = st && ['sorr','inflation','lostDecade'].some(id => st[id]?.run && st[id]?.impact_level === 'high');
  const connectText = hasHighImpact
    ? `Your plan is on track under normal assumptions. The tests below show where it is resilient and where it is most sensitive. Understanding this helps you focus on the right levers if circumstances change.`
    : `Your plan holds up well under every scenario we tested. These results are not presented to alarm – they are here to give you confidence that the plan has been properly challenged.`;
  const connectEl = el('p','');
  connectEl.style.cssText = 'font-size:9px;color:var(--ink-mid);line-height:1.65;margin-bottom:12px;padding-left:10px;border-left:3px solid var(--rule);';
  connectEl.textContent = connectText;
  rightCol.appendChild(connectEl);

  // Adviser-quality scenario framing
  // fmtRate: avoids "100%" which implies infallibility — caps at "99%+"
  function fmtRate(r) {
    if (r == null) return '—';
    if (r >= 0.995) return '99%+';
    return Math.round(r * 100) + '%';
  }
  function deltaSmall(sc) { return Math.abs(sc.success_rate_delta || 0) < 0.005; }
  function deltaMinor(sc) { return Math.abs(sc.success_rate_delta || 0) < 0.05; }

  const scenarioMeta = {
    sorr: {
      title:   'Early market downturn',
      what:    'Markets fall sharply in the first few years of retirement, before your portfolio has had time to recover.',
      why:     'This is the most powerful adverse scenario for retirement plans. A poor sequence of returns in the early years permanently reduces the base from which your money compounds, and you are still drawing income throughout.',
      forYou: (sc, baseRate) => {
        const scen  = fmtRate(sc.success_rate);
        const dep   = sc.earliest_depletion_year;
        const p50   = sc.terminal_portfolio_p50;
        if (sc.impact_level === 'high') {
          const depStr = dep ? `, with the first depletion occurring around ${dep}` : '';
          const p50Str = p50 > 0 ? `finishes with ${fmt(p50)}` : `depletes before the end of the plan`;
          return `This is the scenario to watch most closely for your plan. Under these conditions, the likelihood falls to ${scen} – a meaningful reduction from the baseline. In a typical path under this stress, the portfolio ${p50Str}${depStr}. The most practical protection is a cash buffer of 6–12 months' spending, which lets you avoid selling investments at depressed prices in the early years.`;
        } else if (deltaMinor(sc)) {
          return `Your plan is well-placed against an early downturn. Under these conditions the likelihood stays high at ${scen}, barely changed from the baseline. This resilience comes partly from diversified income sources (interest accounts and ISA draws – which reduce reliance on investment returns in the critical early years).`;
        } else {
          return `Your plan shows good resilience to an early downturn. Under these conditions the likelihood remains at ${scen}, a modest step down from the baseline. Diversified income sources in early retirement reduce the impact of a poor sequence of returns.`;
        }
      },
    },
    inflation: {
      title:   'High inflation',
      what:    'A prolonged period of elevated inflation in the early years squeezes the real value of your withdrawals.',
      why:     'Inflation is a slow erosion rather than a shock. It reduces what your money buys over time. The key protection is income sources that rise with prices, principally the State Pension.',
      forYou: (sc, baseRate) => {
        const scen = fmtRate(sc.success_rate);
        const p50  = sc.terminal_portfolio_p50;
        const p50Str = p50 > 0 ? ` In a typical path, the plan finishes with ${fmt(p50)} in today's money.` : '';
        if (deltaSmall(sc)) {
          return `Your plan is well-protected against inflation. Under these conditions the likelihood stays very high at ${scen} – effectively unchanged. Both State Pensions are inflation-linked and begin from age 67, providing a rising guaranteed income floor just as portfolio draws typically increase.${p50Str}`;
        } else if (deltaMinor(sc)) {
          return `Your plan handles elevated inflation well. The likelihood remains high at ${scen}. State Pension indexing provides meaningful protection from the mid-2030s onwards, reducing the real-terms drag on the portfolio.${p50Str}`;
        } else {
          return `Inflation has a noticeable effect on this plan. The likelihood moves to ${scen}. The State Pension provides partial protection once it begins, but the early years carry more exposure. Keeping a meaningful cash buffer helps absorb the erosion before State Pension income starts.${p50Str}`;
        }
      },
    },
    lostDecade: {
      title:   'Sustained low growth',
      what:    'Near-zero real returns for a decade at some point during retirement, limiting the portfolio\'s ability to compound.',
      why:     'Prolonged low growth is most damaging when it occurs early and when the portfolio is being drawn heavily. Later in retirement, its impact is cushioned by State Pension income reducing portfolio dependency.',
      forYou: (sc, baseRate) => {
        const scen = fmtRate(sc.success_rate);
        const p50  = sc.terminal_portfolio_p50;
        const p50Str = p50 > 0 ? ` A typical path still finishes with ${fmt(p50)}.` : '';
        if (deltaSmall(sc)) {
          return `Your plan manages a low-growth decade comfortably. The likelihood stays very high at ${scen} – effectively unchanged. The combination of tax-efficient withdrawals and State Pension income from the mid-2030s means the portfolio is not solely reliant on growth to sustain income.${p50Str}`;
        } else if (deltaMinor(sc)) {
          return `Your plan holds up well through a period of low growth. The likelihood remains high at ${scen}. State Pension income from the mid-2030s reduces portfolio dependency at the point when sustained low returns are most damaging.${p50Str}`;
        } else {
          return `Sustained low growth puts meaningful pressure on this plan, reducing the likelihood to ${scen}. The most effective response is spending flexibility – being willing to trim withdrawals in weaker years prevents the portfolio base from eroding too quickly.${p50Str}`;
        }
      },
    },
  };

  ['sorr','inflation','lostDecade'].forEach(id => {
    const sc  = st[id];
    const meta = scenarioMeta[id];
    const card = el('div','');
    card.style.cssText = 'border:1px solid var(--rule);border-radius:8px;padding:11px 14px;margin-bottom:9px;';

    if (!sc || !sc.run) {
      card.innerHTML = `
        <div style="font-size:10.5px;font-weight:700;color:var(--ink);margin-bottom:3px;">${meta.title}</div>
        <p style="font-size:8.5px;color:var(--ink-light);font-style:italic;margin:0;">Not tested in this report</p>`;
    } else {
      const rate2  = sc.success_rate;
      const col    = scBorder(rate2);
      const scP    = fmtRate(rate2);
      const baseP  = fmtRate(r.success_rate);
      const absDelta = Math.abs(Math.round((sc.success_rate_delta||0) * 100));
      const deltaText = deltaSmall(sc)
        ? 'No meaningful change'
        : `Baseline ${baseP} – under stress ${scP}`;
      const impactLabel = scLabel(rate2);
      const borderCol = scBorder(rate2);

      card.style.borderColor = borderCol + '40';
      card.style.borderLeftColor = borderCol;
      card.style.borderLeftWidth = '3px';

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Helvetica Neue',sans-serif;font-size:11px;font-weight:800;color:var(--ink);margin-bottom:2px;">${meta.title}</div>
            <div style="font-size:8px;color:var(--ink-light);line-height:1.5;">${meta.what}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:14px;">
            <div style="font-family:'Helvetica Neue',sans-serif;font-size:22px;font-weight:900;color:${col};line-height:1;">${fmtPctV(sc.success_rate)}</div>
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:7.5px;font-weight:700;background:${scBg(rate2)};color:${scText(rate2)};margin-top:3px;">${impactLabel}</span>
          </div>
        </div>
        <p style="font-size:8.5px;color:var(--ink-light);font-style:italic;line-height:1.5;margin:0 0 5px;border-top:1px solid var(--rule);padding-top:5px;">${meta.why}</p>
        <p style="font-size:9px;color:var(--ink-mid);line-height:1.6;margin:0;"><b style="color:var(--ink);">For your plan:</b> ${meta.forYou(sc, r.success_rate)}</p>`;
    }
    rightCol.appendChild(card);
  });

  // Good practice moved to left column for guaranteed visibility

  body.appendChild(leftCol);
  body.appendChild(rightCol);
  page.appendChild(body);

  // ── BOTTOM STRIP — assumptions + disclaimer ────────────────────────
  const strip2 = el('div','');
  strip2.style.cssText = 'background:var(--bg);border-top:1px solid var(--rule);padding:8px 48px;flex-shrink:0;display:flex;gap:32px;align-items:baseline;';
  strip2.innerHTML = `
    <div style="font-size:8px;color:var(--ink-light);flex:1;line-height:1.6;"><b style="color:var(--ink-mid);">Assumptions:</b> ${s.assumptions.headline}</div>
    <div style="font-size:7.5px;color:var(--ink-light);flex:1.2;line-height:1.6;">This report is produced by IncomeFlow for illustrative purposes only. It does not constitute financial advice. Projections depend on assumptions that may not reflect future conditions. Consult a qualified financial adviser before making retirement decisions.</div>`;
  page.appendChild(strip2);

  page.appendChild(footer(8, TOTAL));
  return page;
}

// ══════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // PAGE 9 — HOW THE ANALYSIS WORKS
  // ══════════════════════════════════════════════════════
  function page9(s) {
    const page = el('div', 'page');
    const TOTAL = 9;

    const hdr = el('div', 'p3-header');
    hdr.innerHTML = `<div class="p3-header-title">How the Analysis Works</div><div class="p3-header-sub">Methodology, assumptions, and stress scenario design</div>`;
    page.appendChild(hdr);

    const body = el('div', 'page-body');
    body.style.cssText = 'padding:28px 48px;display:flex;flex-direction:column;gap:0;overflow:hidden;';

    function section(title, text) {
      const wrap = el('div', '');
      wrap.style.cssText = 'margin-bottom:18px;';
      const h = el('div', '');
      h.style.cssText = 'font-size:11px;font-weight:800;color:var(--ink);margin-bottom:6px;letter-spacing:-.01em;';
      h.textContent = title;
      const p = el('p', '');
      p.style.cssText = 'font-size:9.5px;color:var(--ink-mid);line-height:1.75;margin:0;';
      p.textContent = text;
      wrap.appendChild(h);
      wrap.appendChild(p);
      return wrap;
    }

    // Intro paragraph
    const intro = el('p', '');
    intro.style.cssText = 'font-size:10px;color:var(--ink-mid);line-height:1.75;margin:0 0 18px;border-left:3px solid var(--blue);padding-left:14px;';
    intro.textContent = 'This section sets out how the numbers in this report are produced. The projection and risk analysis use different approaches that serve different purposes: the projection gives you a clear, single-path view of your plan under your chosen assumptions, while the risk analysis tests that plan across thousands of possible futures. The stress scenarios then go further, deliberately applying adverse conditions to show where your plan is most resilient and where it carries most sensitivity. Understanding how each element works helps you interpret the results with the right level of confidence.';
    body.appendChild(intro);

    body.appendChild(section(
      'How the Projection Works',
      'The projection runs a single, year-by-year simulation of your retirement using fixed assumptions throughout: the growth rate, inflation rate, and spending target you have set. Unlike the risk analysis, which samples thousands of random paths, the projection follows one deterministic path and shows you exactly how your portfolio, income, and tax position evolve under those assumptions. Each year the engine calculates income from all sources (salary, State Pension, and portfolio withdrawals), applies your chosen withdrawal strategy to draw from the right wrappers in the most tax-efficient order, computes income tax, capital gains tax, and National Insurance for each person, and carries the resulting balances forward into the next year. The charts and tables in this report all flow from this single projection run. Because it uses fixed assumptions, the projection is best understood as your central planning case: a clear, auditable baseline that shows where your plan is headed if the future broadly resembles your expectations. The risk analysis then sits alongside it, stress-testing that baseline across thousands of alternative futures to give you a sense of how much margin your plan carries.'
    ));

    body.appendChild(el('div', 'divider-blue'));

    body.appendChild(section(
      'How the Risk Analysis Works',
      'The risk analysis runs 10,000 independent simulations of your retirement, each one a possible version of how markets and inflation might behave over your lifetime. In every simulation, annual returns and inflation are sampled randomly from realistic distributions based on your portfolio\'s actual asset allocation, using long-run assumptions drawn from Vanguard and BlackRock capital market estimates. Because each simulation is independent, the 10,000 paths collectively paint a picture of the range of outcomes your plan might face: some paths are kind, some are brutal, most fall somewhere in between. The plan strength figure shown is simply the proportion of those 10,000 simulations in which your portfolio survived to the end of the projection without running out of money. The stress scenarios below repeat this process under deliberately adverse conditions, so you can see how your plan holds up when markets behave at their worst.'
    ));

    body.appendChild(el('div', 'divider-blue'));

    const stressLabel = el('div', 'section-label');
    stressLabel.style.marginBottom = '10px';
    stressLabel.textContent = 'Stress Scenario Assumptions';
    body.appendChild(stressLabel);

    const stressIntro = el('p', '');
    stressIntro.style.cssText = 'font-size:9.5px;color:var(--ink-mid);line-height:1.75;margin:0 0 14px;';
    stressIntro.textContent = 'The three stress scenarios test your plan against adverse but historically plausible conditions. Each scenario alters the market assumptions for a defined period only; outside that window, normal baseline assumptions apply.';
    body.appendChild(stressIntro);

    const scenGrid = el('div', '');
    scenGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;';

    const scenarios = [
      {
        title: 'Sequence of Returns Risk',
        body:  'For the first five years of retirement, the expected equity return is shifted down by two standard deviations below the baseline. At typical volatility levels this implies average annual returns of around -25%, though individual simulated years will vary widely around that figure. This models the risk of a sharp market drawdown at the worst possible moment: early in retirement, before the portfolio has had time to recover and while withdrawals are already underway. Historical analogues include the oil crisis bear market of 1973-74, which saw UK equities fall over 70% in real terms, and the dot-com crash of 2000-02.',
      },
      {
        title: 'High Inflation',
        body:  'For the first ten years of retirement, the inflation rate is drawn from a distribution centred on 7.5% per year (standard deviation 2%), regardless of your planning assumption. This means individual years might range from roughly 3.5% to 11.5%. The practical effect is that your real spending target grows significantly faster than anticipated, eroding the purchasing power of each pound withdrawn. The scenario is broadly consistent with the UK inflationary experience of the late 1970s and mid-1980s, when CPI regularly exceeded 7-8% for sustained periods.',
      },
      {
        title: 'Lost Decade',
        body:  'For a randomly selected ten-year window somewhere within your retirement, the expected equity return is set to -0.5% per year nominal. Combined with a 2.5% inflation assumption, this implies real returns of approximately -3% annually throughout the window, a sustained period of gentle but compounding portfolio erosion while withdrawals continue. The timing is deliberately unpredictable: the window could fall early, mid, or late in retirement, reflecting the reality that prolonged growth droughts can strike at any point. Historical analogues include Japan following the 1990 asset bubble collapse and the US equity market across the 2000s, both of which delivered near-zero or negative real returns for a decade or more.',
      },
    ];

    scenarios.forEach(sc => {
      const card = el('div', '');
      card.style.cssText = 'background:var(--bg);border:1px solid var(--rule);border-radius:8px;padding:14px 16px;';
      const h = el('div', '');
      h.style.cssText = 'font-size:10px;font-weight:800;color:var(--ink);margin-bottom:7px;';
      h.textContent = sc.title;
      const p = el('p', '');
      p.style.cssText = 'font-size:8.5px;color:var(--ink-mid);line-height:1.7;margin:0;';
      p.textContent = sc.body;
      card.appendChild(h);
      card.appendChild(p);
      scenGrid.appendChild(card);
    });

    body.appendChild(scenGrid);
    page.appendChild(body);
    page.appendChild(footer(9, TOTAL));
    return page;
  }

  // ── Main generate function ────────────────────────────────────────────────
  async function generate(snapshot) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF)              throw new Error('jsPDF not loaded');
    if (!window.html2canvas) throw new Error('html2canvas not loaded');


    // ── Build all pages ────────────────────────────────────────────────────
    const pages = [
      page1(snapshot),
      page2(snapshot),
      page3(snapshot),
      page4(snapshot),
      page5(snapshot),
      page6(snapshot),
      page7(snapshot),
      page8(snapshot),
      page9(snapshot),
    ];

    // ── Off-screen container ───────────────────────────────────────────────
    // opacity:0 keeps the element in the layout tree so html2canvas can render it.
    // visibility:hidden or display:none would produce blank canvases.
    const container = document.createElement('div');
    container.style.cssText = `
      position:absolute;
      top:-${PAGE_H * 10}px;
      left:0;
      width:${PAGE_W}px;
      opacity:0;
      pointer-events:none;
      z-index:-1;
    `;
    injectStyles(container);
    pages.forEach(p => container.appendChild(p));
    document.body.appendChild(container);

    // ── Render each page to canvas and add to PDF ──────────────────────────
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit:        'pt',
      format:      'a4',
    });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();

    const pageEls = Array.from(container.children).filter(el => el.tagName === 'DIV');

    for (let i = 0; i < pageEls.length; i++) {
      const canvas = await window.html2canvas(pageEls[i], {
        scale:           2,
        useCORS:         true,
        allowTaint:      true,
        backgroundColor: '#ffffff',
        width:           PAGE_W,
        height:          PAGE_H,
        windowWidth:     PAGE_W,
        windowHeight:    PAGE_H,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
    }

    document.body.removeChild(container);

    // ── Download ───────────────────────────────────────────────────────────
    const date  = new Date().toISOString().slice(0, 10);
    const names = snapshot.meta.persons.map(p => p.name.replace(/\s+/g, '-')).join('-');
    pdf.save(`incomeflow-plan-${names}-${date}.pdf`);
  }

  window.RetirePDFRender = { generate };

})();
