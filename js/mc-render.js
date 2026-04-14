/**
 * mc-render.js
 *
 * Renders Monte Carlo results into the Risk Outcomes sub-tab.
 * Registers window.RetireMCRender.
 *
 * Depends on:
 *   window.RetireData  — for D.formatMoney
 *
 * Public API:
 *   RetireMCRender.setResults(result, meanInflation)
 *   RetireMCRender.render()
 *   RetireMCRender.setReal(bool)
 */

(function () {
  'use strict';

  const D = window.RetireData;

  function fmt(n) {
    if (D && D.formatMoney) return D.formatMoney(n);
    return '£' + Math.round(n).toLocaleString('en-GB');
  }

  function fmtPct(ratio) {
    return (ratio * 100).toFixed(1) + '%';
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let _result          = null;
  let _meanInflation   = 0.025;
  let _useReal         = true;
  let _spendingContext = null; // { currentSpending, sustainableSpending, targetConfidence, openingPortfolio }

  // ── Deflation ─────────────────────────────────────────────────────────────
  function _deflate(v, i) {
    return _useReal ? v / Math.pow(1 + _meanInflation, i) : v;
  }
  function _deflateArr(arr) { return arr.map((v, i) => _deflate(v, i)); }

  // ── Public API ────────────────────────────────────────────────────────────
  function setResults(result, meanInflation, spendingContext) {
    _result          = result;
    _meanInflation   = (typeof meanInflation === 'number' && !isNaN(meanInflation))
      ? meanInflation : 0.025;
    _spendingContext = spendingContext || null;
  }

  function setReal(useReal) {
    _useReal = useReal;
    render();
  }

  function render() {
    if (!_result) return;
    _syncToggleButtons();
    _renderNarrative();
  }

  function _syncToggleButtons() {
    document.querySelectorAll('[data-action="mc-real-on"],[data-action="mc-real-off"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${_useReal ? 'mc-real-on' : 'mc-real-off'}"]`)
      .forEach(b => b.classList.add('is-active'));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NARRATIVE
  // ─────────────────────────────────────────────────────────────────────────
  function _renderNarrative() {
    const el = document.getElementById('mc-narrative');
    if (!el) return;

    const r         = _result;
    const lastIdx   = r.years.length - 1;
    const lastYear  = r.years[lastIdx];
    const modeLabel = _useReal ? 'real' : 'nominal';

    const p10 = _deflateArr(r.p10Portfolio);
    const p25 = _deflateArr(r.p25Portfolio);
    const p50 = _deflateArr(r.p50Portfolio);
    const p75 = _deflateArr(r.p75Portfolio);
    const p90 = _deflateArr(r.p90Portfolio);

    // Update sim count in subtitle
    const simCountEl = document.getElementById('mc-sim-count');
    if (simCountEl) simCountEl.textContent = r.simCount.toLocaleString('en-GB');

    // ── Helpers ───────────────────────────────────────────────────────────
    function depletionYear(arr) {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] <= 0) return r.years[i];
      }
      return null;
    }

    function peak(arr) {
      let maxVal = -Infinity, maxIdx = 0;
      arr.forEach((v, i) => { if (v > maxVal) { maxVal = v; maxIdx = i; } });
      return { value: maxVal, year: r.years[maxIdx] };
    }

    // ── INTRO ─────────────────────────────────────────────────────────────
    const introHTML = `
      <section class="mc-section mc-section--intro">
        <p>Your retirement plan has been stress-tested across 10,000 simulated
        futures, each with randomly varying investment returns and inflation.
        Unlike the single-path projection, this analysis shows the range of
        outcomes your plan could face — from favourable markets to sustained
        downturns. Use it to understand how resilient your plan is, where the
        risks concentrate, and whether you have enough buffer to weather a poor
        sequence of returns early in retirement.</p>
      </section>`;

    // ── 1. VERDICT ────────────────────────────────────────────────────────
    const successPaths = Math.round(r.successRate * r.simCount);
    const verdictClass =
      r.successRate >= 0.90 ? 'mc-verdict--strong' :
      r.successRate >= 0.75 ? 'mc-verdict--moderate' :
                              'mc-verdict--weak';
    const verdictLabel =
      r.successRate >= 0.90 ? 'This is a strong result.' :
      r.successRate >= 0.75 ? 'This is a moderate result — some vulnerability to poor sequences.' :
                              'This result warrants attention — a significant proportion of paths fail.';

    const verdictHTML = `
      <section class="mc-section mc-verdict ${verdictClass}">
        <h4 class="mc-section-heading">Verdict</h4>
        <p>Your plan succeeds in ${successPaths.toLocaleString('en-GB')} of
        ${r.simCount.toLocaleString('en-GB')} simulations
        (${fmtPct(r.successRate)}). ${verdictLabel}</p>
      </section>`;

    // ── 2. SUSTAINABLE SPENDING ───────────────────────────────────────────
    let sustainHTML = '';
    if (_spendingContext && _spendingContext.sustainableSpending != null) {
      const { currentSpending, sustainableSpending, sustainableIsFloor, targetConfidence, openingPortfolio } = _spendingContext;
      const headroom    = sustainableSpending - currentSpending;
      const isAbove     = headroom >= 0;
      const absDiff     = Math.abs(Math.round(headroom));
      const pctOfPort   = openingPortfolio > 0
        ? ((sustainableSpending / openingPortfolio) * 100).toFixed(1)
        : null;
      const confPct     = (targetConfidence * 100).toFixed(0);

      const overBy  = isAbove ? 0 : Math.abs(headroom) / currentSpending;
      const sClass  = isAbove        ? 'mc-sustain--safe' :
                      overBy <= 0.15 ? 'mc-sustain--warn' :
                                       'mc-sustain--danger';

      const portClause = pctOfPort ? ` (${pctOfPort}% of your opening portfolio)` : '';
      const floorPrefix = sustainableIsFloor ? 'at least ' : '';

      let sustainBody;
      if (sustainableIsFloor) {
        // All three runs at or above 95% — plan is very strong
        sustainBody = `Your plan succeeds in ${confPct}% or more of simulations even at
          ${fmt(sustainableSpending)}/year — ${fmt(absDiff)}/year above your current target.
          Your plan is highly resilient; the true sustainable spending level is
          likely higher still.`;
      } else if (isAbove) {
        sustainBody = `Your current spending target of ${fmt(currentSpending)}/year is within
          the ${confPct}% confidence threshold. The estimated sustainable spending level is
          ${floorPrefix}${fmt(sustainableSpending)}/year${portClause} —
          giving you headroom of approximately ${fmt(absDiff)}/year above your current target.`;
      } else {
        sustainBody = `To achieve ${confPct}% confidence of never running out, the estimated
          sustainable spending level is ${fmt(sustainableSpending)}/year${portClause} —
          approximately ${fmt(absDiff)}/year below your current target of ${fmt(currentSpending)}/year.
          Consider reducing discretionary spending or building a larger portfolio before retiring.`;
      }

      sustainHTML = `
        <section class="mc-section mc-sustain ${sClass}">
          <h4 class="mc-section-heading">Sustainable spending estimate</h4>
          <p>${sustainBody}</p>
          <p class="mc-sustain__note">Estimated via interpolation across three simulation runs. Accuracy ±5%.</p>
        </section>`;
    }

    // ── 3. MEDIAN OUTCOME ─────────────────────────────────────────────────
    const p50Peak     = peak(p50);
    const p50Depletes = depletionYear(p50);
    let medianBody;
    if (p50Depletes) {
      const yearsEarly = lastYear - p50Depletes;
      medianBody = `In the median scenario, the portfolio is exhausted by
        ${p50Depletes} — ${yearsEarly} year${yearsEarly !== 1 ? 's' : ''} before
        the end of the projection.`;
    } else {
      medianBody = `In the median scenario, your portfolio peaks at
        ${fmt(p50Peak.value)} around ${p50Peak.year} and finishes at
        ${fmt(p50[lastIdx])} in ${lastYear} (${modeLabel} terms).`;
    }

    const medianHTML = `
      <section class="mc-section">
        <h4 class="mc-section-heading">Median outcome</h4>
        <p>${medianBody}</p>
      </section>`;

    // ── 4. STRESS CASE (10th percentile) ──────────────────────────────────
    const p10Depletes = depletionYear(p10);
    let stressBody;
    if (p10Depletes) {
      const yearsEarly = lastYear - p10Depletes;
      stressBody = `In the bottom 10% of outcomes, the portfolio runs out by
        ${p10Depletes} — ${yearsEarly} year${yearsEarly !== 1 ? 's' : ''} before
        the end of the projection. This scenario typically reflects a combination
        of poor early returns and elevated inflation.`;
    } else {
      stressBody = `In a poor returns environment (10th percentile), your portfolio
        retains ${fmt(p10[lastIdx])} by ${lastYear} (${modeLabel} terms). While
        significantly below the median, the plan remains solvent throughout the
        projection under this stress scenario.`;
    }

    const stressHTML = `
      <section class="mc-section">
        <h4 class="mc-section-heading">10th percentile — stress case</h4>
        <p>${stressBody}</p>
      </section>`;

    // ── 4. OPTIMISTIC CASE (90th percentile) ──────────────────────────────
    const p90Final   = p90[lastIdx];
    const legacyNote = p90Final > 500_000
      ? ' This would leave meaningful wealth to pass on or deploy in later life.'
      : '';

    const optimisticHTML = `
      <section class="mc-section">
        <h4 class="mc-section-heading">90th percentile — optimistic case</h4>
        <p>In a favourable environment (90th percentile), your portfolio reaches
        ${fmt(p90Final)} by ${lastYear} (${modeLabel} terms).${legacyNote}</p>
      </section>`;

    // ── 5. INTERQUARTILE RANGE ────────────────────────────────────────────
    const p25Final = p25[lastIdx];
    const p75Final = p75[lastIdx];
    const iqrHTML = `
      <section class="mc-section">
        <h4 class="mc-section-heading">Middle 50% of outcomes</h4>
        <p>In the central half of all simulated paths, your portfolio finishes
        between ${fmt(p25Final)} (25th percentile) and ${fmt(p75Final)}
        (75th percentile) by ${lastYear} (${modeLabel} terms). A tight range
        indicates lower dispersion risk; a wide range reflects sensitivity to
        return sequence.${
          (p75Final - p25Final) / Math.max(p50[lastIdx], 1) > 1.5
            ? ' The spread here is wide — your outcome is highly sensitive to which sequence of returns materialises early in retirement.'
            : ''
        }</p>
      </section>`;

    // ── 6. EARLIEST DEPLETION ─────────────────────────────────────────────
    let earliestHTML = '';
    if (r.earliestDepletion) {
      const yearsIn = r.earliestDepletion - r.years[0];
      earliestHTML = `
        <section class="mc-section">
          <h4 class="mc-section-heading">Earliest depletion</h4>
          <p>In the worst-case paths, funds could be exhausted as early as
          ${r.earliestDepletion} — just ${yearsIn} year${yearsIn !== 1 ? 's' : ''}
          into the projection. This typically occurs when a severe market downturn
          coincides with high spending in the early years of retirement.</p>
        </section>`;
    }

    // ── 7. RUIN PROBABILITY BY DECADE ────────────────────────────────────
    let decadeRows = '';
    if (r.survivalByYear && r.years) {
      // Pick one year per decade that falls within the projection
      const decades = [2030, 2040, 2050, 2060, 2070].filter(
        y => y >= r.years[0] && y <= lastYear
      );
      decadeRows = decades.map(decadeYear => {
        const yi = r.years.indexOf(decadeYear);
        if (yi === -1) return '';
        const survivalRate = r.survivalByYear[yi] / r.simCount;
        const colour =
          survivalRate >= 0.95 ? 'var(--color-success, #16a34a)' :
          survivalRate >= 0.80 ? 'var(--color-warn,    #d97706)' :
                                 'var(--color-danger,  #dc2626)';
        return `<div class="mc-decade-row">
          <span class="mc-decade-row__year">${decadeYear}</span>
          <span class="mc-decade-row__bar-wrap">
            <span class="mc-decade-row__bar" style="width:${(survivalRate * 100).toFixed(1)}%;background:${colour}"></span>
          </span>
          <span class="mc-decade-row__pct" style="color:${colour}">${fmtPct(survivalRate)}</span>
        </div>`;
      }).join('');
    }

    const ruinHTML = decadeRows ? `
      <section class="mc-section">
        <h4 class="mc-section-heading">Portfolio survival by year</h4>
        <p style="margin-bottom:12px">Percentage of the ${r.simCount.toLocaleString('en-GB')} simulated paths
        where the portfolio remains above zero at each point in time.</p>
        <div class="mc-decade-chart">${decadeRows}</div>
      </section>` : '';

    // ── 8. ASSUMPTIONS NOTE ───────────────────────────────────────────────
    const eVolRaw  = r.equityVol    != null ? r.equityVol    : 0.16;
    const iVolRaw  = r.inflationVol != null ? r.inflationVol : 0.015;
    const eVol     = (eVolRaw * 100).toFixed(0);
    const iVol     = (iVolRaw * 100).toFixed(1);
    const volLabel =
      eVolRaw >= 0.18 ? 'an aggressive set of assumptions reflecting very high uncertainty' :
      eVolRaw >= 0.14 ? 'a cautious set of assumptions reflecting elevated uncertainty in both markets and inflation' :
                        'a moderate set of assumptions broadly consistent with long-run historical ranges';

    const assumHTML = `
      <section class="mc-section mc-section--muted">
        <h4 class="mc-section-heading">Assumptions</h4>
        <p>This stress test uses ${eVol}% equity volatility and ${iVol}% inflation
        volatility — ${volLabel}. Each of the
        ${r.simCount.toLocaleString('en-GB')} paths independently samples annual
        returns and inflation, compounding uncertainty across the full
        ${r.years.length}-year projection.
        All values shown in ${modeLabel} terms.</p>
      </section>`;

    el.innerHTML = introHTML + verdictHTML + sustainHTML + medianHTML + stressHTML +
                   optimisticHTML + iqrHTML + earliestHTML + ruinHTML + assumHTML;
  }

  window.RetireMCRender = { setResults, render, setReal };

})();
