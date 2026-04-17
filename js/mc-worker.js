/**
 * mc-worker.js
 *
 * Web Worker for Monte Carlo retirement simulation.
 * Runs entirely off the main thread — no DOM, no window.* globals.
 *
 * Receives one postMessage from mc-engine.js:
 *   { inputs, simCount, equityVol, inflationVol }
 *
 * Posts back:
 *   { type: 'progress', pct }          — every 500 paths
 *   { type: 'done', result }           — when complete
 *
 * where result = {
 *   years, p10Portfolio, p25Portfolio, p50Portfolio, p75Portfolio, p90Portfolio,
 *   successRate, medianTotalTax
 * }
 *
 * ─── Simplifications vs deterministic engine ────────────────────────────────
 * • No interest-bearing accounts (fixed monthly draws don't compose sensibly
 *   with stochastic growth; their balances are small relative to total portfolio).
 * • No Bed-and-ISA transfers (no CGT tracking needed at this level).
 * • No annotations or depletion records.
 * • Approximate income tax only (no CGT, no NI). Tax is used solely to compute
 *   net cashflow draw and the medianTotalTax output; CGT is second-order for
 *   portfolio trajectory across 10,000 paths.
 * • Tax thresholds are FROZEN (not uprated). This matches the most common real
 *   user setting and avoids needing the full threshold-uprating logic.
 * • Dividend mode: always 'payout' (conservative — dividends leave the GIA
 *   rather than compounding inside it, consistent with taxable-on-arising HMRC
 *   treatment and with the most common deterministic setting).
 *
 * NOTE — return sampling: growth and inflation are drawn independently each year
 * (i.i.d. log-normal via Box-Muller). Mean reversion is empirically more
 * realistic over long horizons but requires calibrating a reversion-speed
 * parameter users cannot verify. i.i.d. is the standard textbook assumption for
 * personal retirement Monte Carlo and is documented here as a known, deliberate
 * simplification for a future parameter if needed.
 *
 * ─── Withdrawal logic ───────────────────────────────────────────────────────
 * Uses the same two modes ('50/50', 'tax-aware') and the same p1Order/p2Order
 * the user configured. This ensures MC and deterministic modes are measuring
 * the same strategy; using a different order would produce different tax drag
 * and make the two modes incomparable.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SIPP_TAXABLE_RATIO = 0.75; // 25% SIPP lump sum is tax-free

// UK income tax bands 2024/25 — frozen (not uprated in MC paths).
// Non-savings income only (SP + salary + SIPP taxable portion).
const TAX_BANDS = [
  { limit: 12570,  rate: 0 },
  { limit: 50270,  rate: 0.20 },
  { limit: 125140, rate: 0.40 },
  { limit: Infinity, rate: 0.45 },
];

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVE MATH — equivalents of RetireCalc methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grow all wrapper balances by (1 + rate). Mutates bal in place.
 * Equivalent to C.growBalances in calculator.js.
 */
function growBalances(bal, equityRate, inflationRate) {
  bal.Cash    = (bal.Cash    || 0) * (1 + equityRate);   // Cash grows at equity rate (small, swept to GIA)
  bal.GIAeq   = (bal.GIAeq   || 0) * (1 + equityRate);  // Equity portion of GIA
  bal.GIAcash = (bal.GIAcash || 0) * (1 + inflationRate); // Cashlike portion — inflation rate, no vol
  bal.ISA     = (bal.ISA     || 0) * (1 + equityRate);
  bal.SIPP    = (bal.SIPP    || 0) * (1 + equityRate);
}

/**
 * Sum all wrapper balances.
 * Equivalent to C.totalBal in calculator.js.
 */
function totalBal(bal) {
  return (bal.Cash || 0) + (bal.GIAeq || 0) + (bal.GIAcash || 0) + (bal.ISA || 0) + (bal.SIPP || 0);
}

/**
 * Draw `amount` from wrappers in the given order. Mutates bal in place.
 * SIPP draws: 75% is taxable income (sippTaxable). Cash is never in order here
 * (cash handled upstream, exactly as in engine.js).
 * Returns { GIA, SIPP, ISA, Cash, sippTaxable }.
 * Equivalent to C.withdraw in calculator.js.
 */
function withdraw(bal, order, amount) {
  const drawn = { GIA: 0, SIPP: 0, ISA: 0, Cash: 0, sippTaxable: 0 };
  let remaining = amount;

  for (const wrapper of order) {
    if (remaining <= 0) break;
    if (wrapper === 'GIA') {
      // Draw from cashlike GIA first (capital preservation), then equity GIA.
      for (const sub of ['GIAcash', 'GIAeq']) {
        if (remaining <= 0) break;
        const available = bal[sub] || 0;
        if (available <= 0) continue;
        const take = Math.min(remaining, available);
        bal[sub]  -= take;
        drawn.GIA += take;
        remaining -= take;
      }
    } else {
      const available = bal[wrapper] || 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      bal[wrapper] -= take;
      drawn[wrapper] += take;
      remaining -= take;
      if (wrapper === 'SIPP') {
        drawn.sippTaxable += take * SIPP_TAXABLE_RATIO;
      }
    }
  }

  return drawn;
}

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL STRATEGY
// Faithfully reproduced from withdrawal-strategy.js with C.withdraw /
// C.SIPP_TAXABLE_RATIO replaced by local equivalents above.
// ─────────────────────────────────────────────────────────────────────────────

function withdrawalStrategy({
  mode,
  shortfall,
  p1Bal, p2Bal,
  p1WrapperOrder, p2WrapperOrder,
  p1SIPPLocked, p2SIPPLocked,
  p1PAHeadroom, p2PAHeadroom,
}) {
  const zero = () => ({ GIA: 0, SIPP: 0, ISA: 0, Cash: 0, sippTaxable: 0 });

  // ── 50/50 mode ──────────────────────────────────────────────────────────
  if (mode === '50/50') {
    const p1Half  = shortfall / 2;
    const p1Drawn = withdraw(p1Bal, p1WrapperOrder, p1Half);
    const p1Unmet = Math.max(0, p1Half - p1Drawn.GIA - p1Drawn.SIPP - p1Drawn.ISA);

    const p2Drawn = withdraw(p2Bal, p2WrapperOrder, shortfall / 2 + p1Unmet);
    const p2Unmet = Math.max(
      0,
      (shortfall / 2 + p1Unmet) - p2Drawn.GIA - p2Drawn.SIPP - p2Drawn.ISA
    );

    if (p2Unmet > 0) {
      const extra = withdraw(p1Bal, p1WrapperOrder, p2Unmet);
      p1Drawn.GIA         += extra.GIA;
      p1Drawn.SIPP        += extra.SIPP;
      p1Drawn.ISA         += extra.ISA;
      p1Drawn.sippTaxable += extra.sippTaxable;
    }

    return { p1Drawn, p2Drawn };
  }

  // ── Tax-aware mode ───────────────────────────────────────────────────────
  if (shortfall <= 0) {
    return { p1Drawn: zero(), p2Drawn: zero() };
  }

  // Step 1: fill each person's PA headroom from SIPP (if accessible).
  const p1SippTarget = (!p1SIPPLocked && p1PAHeadroom > 0)
    ? Math.min(p1PAHeadroom / SIPP_TAXABLE_RATIO, p1Bal.SIPP || 0)
    : 0;
  const p2SippTarget = (!p2SIPPLocked && p2PAHeadroom > 0)
    ? Math.min(p2PAHeadroom / SIPP_TAXABLE_RATIO, p2Bal.SIPP || 0)
    : 0;

  const p1Drawn = withdraw(p1Bal, ['SIPP'], p1SippTarget);
  const p2Drawn = withdraw(p2Bal, ['SIPP'], p2SippTarget);

  // Step 2: remaining shortfall split proportionally by residual PA headroom.
  const p1SippTaxable = p1Drawn.sippTaxable;
  const p2SippTaxable = p2Drawn.sippTaxable;
  const p1RemHeadroom = Math.max(0, p1PAHeadroom - p1SippTaxable);
  const p2RemHeadroom = Math.max(0, p2PAHeadroom - p2SippTaxable);
  const sippDrawTotal = p1Drawn.SIPP + p2Drawn.SIPP;
  const remShortfall  = Math.max(0, shortfall - sippDrawTotal);

  const totalHeadroom = p1RemHeadroom + p2RemHeadroom;
  const p1Weight      = totalHeadroom > 0 ? p1RemHeadroom / totalHeadroom : 0.5;
  const p2Weight      = 1 - p1Weight;

  const p1NonSippOrder = p1WrapperOrder.filter(w => w !== 'SIPP' && w !== 'Cash');
  const p2NonSippOrder = p2WrapperOrder.filter(w => w !== 'SIPP' && w !== 'Cash');

  const p1RemDrawn = withdraw(p1Bal, p1NonSippOrder, remShortfall * p1Weight);
  const p2RemDrawn = withdraw(p2Bal, p2NonSippOrder, remShortfall * p2Weight);

  p1Drawn.GIA += p1RemDrawn.GIA;
  p1Drawn.ISA += p1RemDrawn.ISA;
  p2Drawn.GIA += p2RemDrawn.GIA;
  p2Drawn.ISA += p2RemDrawn.ISA;

  // Step 3: fallback — unmet demand goes to the other person.
  const p1Unmet = Math.max(
    0,
    remShortfall * p1Weight - p1RemDrawn.GIA - p1RemDrawn.ISA - p1RemDrawn.SIPP
  );
  const p2Unmet = Math.max(
    0,
    remShortfall * p2Weight - p2RemDrawn.GIA - p2RemDrawn.ISA - p2RemDrawn.SIPP
  );

  if (p1Unmet > 0) {
    const extra = withdraw(p2Bal, p2WrapperOrder, p1Unmet);
    p2Drawn.GIA         += extra.GIA;
    p2Drawn.ISA         += extra.ISA;
    p2Drawn.SIPP        += extra.SIPP;
    p2Drawn.sippTaxable += extra.sippTaxable;
  }
  if (p2Unmet > 0) {
    const extra = withdraw(p1Bal, p1WrapperOrder, p2Unmet);
    p1Drawn.GIA         += extra.GIA;
    p1Drawn.ISA         += extra.ISA;
    p1Drawn.SIPP        += extra.SIPP;
    p1Drawn.sippTaxable += extra.sippTaxable;
  }

  // Step 4: final catch-all — draw more SIPP as last resort.
  const totalDrawn =
    p1Drawn.GIA + p1Drawn.SIPP + p1Drawn.ISA +
    p2Drawn.GIA + p2Drawn.SIPP + p2Drawn.ISA;
  const stillUnmet = Math.max(0, shortfall - totalDrawn);

  if (stillUnmet > 0) {
    const p1Extra = !p1SIPPLocked
      ? withdraw(p1Bal, ['SIPP'], stillUnmet / 2)
      : { SIPP: 0, sippTaxable: 0 };
    const p2Share = stillUnmet / 2 + Math.max(0, stillUnmet / 2 - p1Extra.SIPP);
    const p2Extra = !p2SIPPLocked
      ? withdraw(p2Bal, ['SIPP'], p2Share)
      : { SIPP: 0, sippTaxable: 0 };

    p1Drawn.SIPP        += p1Extra.SIPP;
    p1Drawn.sippTaxable += p1Extra.sippTaxable;
    p2Drawn.SIPP        += p2Extra.SIPP;
    p2Drawn.sippTaxable += p2Extra.sippTaxable;

    const p2StillUnmet = Math.max(0, stillUnmet / 2 - p2Extra.SIPP);
    if (p2StillUnmet > 0 && !p1SIPPLocked) {
      const p1Last = withdraw(p1Bal, ['SIPP'], p2StillUnmet);
      p1Drawn.SIPP        += p1Last.SIPP;
      p1Drawn.sippTaxable += p1Last.sippTaxable;
    }
  }

  return { p1Drawn, p2Drawn };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROXIMATE INCOME TAX
// Non-savings income only (SP + salary + SIPP taxable portion).
// No CGT, no NI, no savings/dividend bands — appropriate for portfolio
// trajectory modelling where we need tax drag, not a full SA302.
// Personal Allowance tapered above £100k.
// ─────────────────────────────────────────────────────────────────────────────

function approxIncomeTax(nonSavingsIncome) {
  // Taper PA for incomes above £100k: PA reduces by £1 for every £2 over £100k.
  let pa = 12570;
  if (nonSavingsIncome > 100000) {
    pa = Math.max(0, pa - Math.floor((nonSavingsIncome - 100000) / 2));
  }

  let tax = 0;
  let remaining = Math.max(0, nonSavingsIncome);
  let prevLimit = 0;

  for (const band of TAX_BANDS) {
    // Shift band limits down by PA so the free allowance is honoured.
    const bandLow  = prevLimit === 0 ? 0 : prevLimit;
    const bandHigh = band.limit;
    const adjLow   = Math.max(0, bandLow  - pa);
    const adjHigh  = Math.max(0, bandHigh - pa);
    const taxable  = Math.min(remaining, adjHigh - adjLow);
    if (taxable > 0) tax += taxable * band.rate;
    prevLimit = band.limit;
    if (remaining <= adjHigh) break;
  }

  return Math.max(0, tax);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX-MULLER TRANSFORM
// Returns a standard normal variate (mean=0, sd=1).
// ─────────────────────────────────────────────────────────────────────────────

function boxMuller() {
  // Two independent uniform samples → one normal variate.
  // We discard the second to keep the call site simple (no state needed).
  let u, v;
  do { u = Math.random(); } while (u === 0); // guard against log(0)
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Sample an annual rate from N(mean, vol), clamped to [floor, ceiling].
 * mean and vol are decimals (e.g. 0.05 for 5%).
 */
function sampleRate(mean, vol, floor = -0.5, ceiling = 2.0) {
  const sample = mean + vol * boxMuller();
  return Math.min(ceiling, Math.max(floor, sample));
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-PATH SIMULATION
// Runs one deterministic path with the supplied per-year growth/inflation arrays
// (or samples them inline when not pre-supplied — we sample inline for clarity).
// Returns { portfolioByYear, taxByYear, survived }
//   portfolioByYear — Float64Array of end-of-year total portfolio, one per year
//   taxByYear       — Float64Array of total household tax, one per year
//   survived        — true if portfolio never hit zero across all years
// ─────────────────────────────────────────────────────────────────────────────

function runPath(inputs, equityVol, inflationVol) {
  const {
    startYear, endYear,
    p1DOB, p2DOB,
    p1SPAge, p1SPAmt,
    p2SPAge, p2SPAmt,
    p1Salary, p1SalaryStop,
    p2Salary, p2SalaryStop,
    spending, stepDownPct,
    growth, inflation,
    withdrawalMode,
    p1Order, p2Order,
    dividendYield,
    p2enabled,
    deferYears,
  } = inputs;

  const numYears = endYear - startYear + 1;

  // Deep-copy balances — each path starts from the same opening position.
  const p1Bal = { ...inputs.p1Bal };
  const p2Bal = { ...inputs.p2Bal };

  // Frozen tax thresholds (see file-level note).
  const PA = 12570;

  let cumInfl  = 1;
  let survived = true;

  const portfolioByYear = new Float64Array(numYears);
  const taxByYear       = new Float64Array(numYears);

  for (let yi = 0; yi < numYears; yi++) {
    const year  = startYear + yi;
    const p1Age = year - p1DOB;
    const p2Age = year - p2DOB;

    // ── Sample this year's rates ───────────────────────────────────────────
    const growthY    = sampleRate(growth,    equityVol,    -0.5, 2.0);
    const inflationY = sampleRate(inflation, inflationVol, -0.1, 0.5);

    // ── Guaranteed income (nominal) ────────────────────────────────────────
    const p1SP     = p1Age >= p1SPAge ? p1SPAmt * cumInfl : 0;
    const p2SP     = (p2enabled && p2Age >= p2SPAge) ? p2SPAmt * cumInfl : 0;
    const p1SalInc = (p1SalaryStop && p1Age <= p1SalaryStop) ? p1Salary * cumInfl : 0;
    const p2SalInc = (p2enabled && p2SalaryStop && p2Age <= p2SalaryStop)
      ? p2Salary * cumInfl : 0;

    // ── GIA dividends (payout mode — equity GIA only; cashlike GIA is income-generating
    //    but modelled via low-vol growth rather than dividend yield) ──────────────────
    const p1Divs = (p1Bal.GIAeq || 0) * dividendYield;
    const p2Divs = p2enabled ? (p2Bal.GIAeq || 0) * dividendYield : 0;
    // Deduct from GIAeq pre-growth (ex-dividend balance grows)
    p1Bal.GIAeq = Math.max(0, (p1Bal.GIAeq || 0) - p1Divs);
    if (p2enabled) p2Bal.GIAeq = Math.max(0, (p2Bal.GIAeq || 0) - p2Divs);

    // ── Spending target (nominal, with step-down) ──────────────────────────
    const target = spending * cumInfl * (
      stepDownPct > 0 && p1Age >= 75 ? (1 - stepDownPct / 100) : 1
    );

    // ── SIPP lock ──────────────────────────────────────────────────────────
    const minPensionAge = year >= 2028 ? 57 : 55;
    const p1SIPPLocked  = p1Age < minPensionAge;
    const p2SIPPLocked  = !p2enabled || p2Age < minPensionAge;

    // ── Guaranteed income total before portfolio draws ─────────────────────
    const guaranteed = p1SP + p2SP + p1SalInc + p2SalInc + p1Divs + p2Divs;
    const surplus    = Math.max(0, guaranteed - target);
    if (surplus > 0) p1Bal.Cash = (p1Bal.Cash || 0) + surplus;

    let shortfall = Math.max(0, target - guaranteed);

    // ── Deferral: suppress all portfolio draws during delay period ────────
    if (deferYears && yi < deferYears) shortfall = 0;

    // ── Priority 1: cash ───────────────────────────────────────────────────
    if (shortfall > 0) {
      const totalCash = (p1Bal.Cash || 0) + (p2Bal.Cash || 0);
      const cashDrawn = Math.min(shortfall, totalCash);
      const fromP1    = Math.min(cashDrawn, p1Bal.Cash || 0);
      const fromP2    = Math.max(0, cashDrawn - fromP1);
      p1Bal.Cash  = Math.max(0, (p1Bal.Cash || 0) - fromP1);
      p2Bal.Cash  = Math.max(0, (p2Bal.Cash || 0) - fromP2);
      shortfall  -= cashDrawn;
    }

    // ── Priority 2: wrapper draws via configured strategy ─────────────────
    const p1WrapperOrder = p1Order.filter(
      w => w !== 'Cash' && !(w === 'SIPP' && p1SIPPLocked)
    );
    const p2WrapperOrder = (p2enabled ? p2Order : []).filter(
      w => w !== 'Cash' && !(w === 'SIPP' && p2SIPPLocked)
    );

    // PA headroom for tax-aware mode (non-savings guaranteed income only;
    // interest accounts omitted per simplification note above).
    const p1PAHeadroom = Math.max(0, PA - p1SP - p1SalInc - p1Divs);
    const p2PAHeadroom = p2enabled ? Math.max(0, PA - p2SP - p2SalInc - p2Divs) : 0;

    const { p1Drawn, p2Drawn } = withdrawalStrategy({
      mode: withdrawalMode,
      shortfall,
      p1Bal, p2Bal,
      p1WrapperOrder, p2WrapperOrder,
      p1SIPPLocked, p2SIPPLocked,
      p1PAHeadroom, p2PAHeadroom,
    });

    // ── Growth ────────────────────────────────────────────────────────────
    growBalances(p1Bal, growthY, inflationY);
    if (p2enabled) growBalances(p2Bal, growthY, inflationY);

    // ── Approximate tax ────────────────────────────────────────────────────
    const p1NonSavings = p1SP + p1SalInc + p1Drawn.sippTaxable;
    const p2NonSavings = p2enabled ? (p2SP + p2SalInc + p2Drawn.sippTaxable) : 0;
    const p1Tax = approxIncomeTax(p1NonSavings);
    const p2Tax = p2enabled ? approxIncomeTax(p2NonSavings) : 0;
    const totalTax = p1Tax + p2Tax;

    // Deduct tax from cash (best effort — same as engine.js for CGT; here for income tax).
    const taxToPay = totalTax;
    const p1TaxPaid = Math.min(taxToPay / 2, p1Bal.Cash || 0);
    p1Bal.Cash = Math.max(0, (p1Bal.Cash || 0) - p1TaxPaid);
    const p2TaxPaid = Math.min(taxToPay - p1TaxPaid, p2Bal.Cash || 0);
    if (p2enabled) p2Bal.Cash = Math.max(0, (p2Bal.Cash || 0) - p2TaxPaid);

    // ── Record end-of-year values ──────────────────────────────────────────
    const portfolio = totalBal(p1Bal) + (p2enabled ? totalBal(p2Bal) : 0);
    portfolioByYear[yi] = portfolio;
    taxByYear[yi]       = totalTax;

    if (portfolio <= 0) survived = false;

    // ── Advance inflation for next year ────────────────────────────────────
    cumInfl *= (1 + inflationY);
  }

  return { portfolioByYear, taxByYear, survived };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERCENTILE HELPER
// Operates on a pre-sorted array — caller must sort before calling.
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sortedArr, p) {
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const { inputs, simCount, equityVol, inflationVol } = e.data;

  const numYears = inputs.endYear - inputs.startYear + 1;

  // Accumulate per-year arrays across all paths.
  // portfolioMatrix[yi] = array of end-of-year portfolio values across paths.
  // taxMatrix[yi]       = array of total tax values across paths.
  const portfolioMatrix = Array.from({ length: numYears }, () => new Float64Array(simCount));
  const taxMatrix       = Array.from({ length: numYears }, () => new Float64Array(simCount));

  let successCount = 0;
  const PROGRESS_INTERVAL = 500;

  for (let sim = 0; sim < simCount; sim++) {
    const { portfolioByYear, taxByYear, survived } = runPath(inputs, equityVol, inflationVol);

    for (let yi = 0; yi < numYears; yi++) {
      portfolioMatrix[yi][sim] = portfolioByYear[yi];
      taxMatrix[yi][sim]       = taxByYear[yi];
    }

    if (survived) successCount++;

    // Progress heartbeat every 500 paths.
    if ((sim + 1) % PROGRESS_INTERVAL === 0) {
      self.postMessage({ type: 'progress', pct: Math.round(((sim + 1) / simCount) * 100) });
    }
  }

  // ── Compute percentiles per year ─────────────────────────────────────────
  // Sort each year's column in place (Float64Array.sort is in-place).
  const p10 = new Float64Array(numYears);
  const p25 = new Float64Array(numYears);
  const p50 = new Float64Array(numYears);
  const p75 = new Float64Array(numYears);
  const p90 = new Float64Array(numYears);
  const medTax = new Float64Array(numYears);

  const years = [];
  for (let yi = 0; yi < numYears; yi++) {
    years.push(inputs.startYear + yi);

    const pCol = portfolioMatrix[yi];
    pCol.sort();
    p10[yi] = percentile(pCol, 10);
    p25[yi] = percentile(pCol, 25);
    p50[yi] = percentile(pCol, 50);
    p75[yi] = percentile(pCol, 75);
    p90[yi] = percentile(pCol, 90);

    const tCol = taxMatrix[yi];
    tCol.sort();
    medTax[yi] = percentile(tCol, 50);
  }

  // ── Per-year survival counts (portfolio > 0) ─────────────────────────────
  // survivalByYear[yi] = number of paths still solvent at end of year yi.
  // Used to compute decade-by-decade survival rates in mc-render.js.
  const survivalByYear = new Int32Array(numYears);
  for (let yi = 0; yi < numYears; yi++) {
    // portfolioMatrix[yi] is already sorted ascending after percentile pass.
    const col = portfolioMatrix[yi];
    let solvent = 0;
    for (let s = 0; s < simCount; s++) {
      if (col[s] > 0) solvent++;
    }
    survivalByYear[yi] = solvent;
  }

  // ── Earliest depletion year across all paths ──────────────────────────────
  // The first year where any path hits zero — i.e. the worst-case onset.
  let earliestDepletion = null;
  for (let yi = 0; yi < numYears; yi++) {
    if (survivalByYear[yi] < simCount) {
      earliestDepletion = inputs.startYear + yi;
      break;
    }
  }

  const result = {
    mode:             'montecarlo',
    simCount,
    years,
    p10Portfolio:     Array.from(p10),
    p25Portfolio:     Array.from(p25),
    p50Portfolio:     Array.from(p50),
    p75Portfolio:     Array.from(p75),
    p90Portfolio:     Array.from(p90),
    successRate:      successCount / simCount,
    medianTotalTax:   Array.from(medTax),
    survivalByYear:   Array.from(survivalByYear),
    earliestDepletion,
    equityVol,
    inflationVol,
  };

  self.postMessage({ type: 'done', result });
};
