/**
 * mc-render.js
 *
 * Renders Monte Carlo results into the Risk Outcomes sub-tab.
 * Registers window.RetireMCRender.
 *
 * Depends on:
 *   window.RetireData  – for D.formatMoney
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

  function roundToNearest(n, nearest) {
    return Math.round(n / nearest) * nearest;
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
    const firstYear = r.years[0];
    const lastYear  = r.years[lastIdx];

    const p25 = _deflateArr(r.p25Portfolio);
    const p50 = _deflateArr(r.p50Portfolio);
    const p75 = _deflateArr(r.p75Portfolio);

    const simCountEl = document.getElementById('mc-sim-count');
    if (simCountEl) simCountEl.textContent = r.simCount.toLocaleString('en-GB');

    // ── Spending context ──────────────────────────────────────────────
    const sc                  = _spendingContext || {};
    const currentSpending     = sc.currentSpending     ?? 0;
    const sustainableSpending = sc.sustainableSpending ?? null;
    const sustainableIsFloor  = !!sc.sustainableIsFloor;
    const targetConfidence    = sc.targetConfidence    ?? 0.90;
    const delayPerturbations  = sc.delayPerturbations  || [];
    const confPct             = Math.round(targetConfidence * 100);

    // ── Verdict ───────────────────────────────────────────────────────
    const rate = r.successRate;
    const verdictWord =
      rate >= 0.95 ? 'Strong'     :
      rate >= 0.90 ? 'Good'       :
      rate >= 0.80 ? 'Borderline' : 'At risk';

    const verdictColour =
      rate >= 0.95 ? { main:'#3B6D11', bg:'rgba(59,109,17,0.06)',  border:'#3B6D11', statBorder:'rgba(59,109,17,0.25)',  statDiv:'rgba(59,109,17,0.2)',  eyebrow:'#27500A', text:'#173404' } :
      rate >= 0.90 ? { main:'#185FA5', bg:'rgba(24,95,165,0.06)',  border:'#185FA5', statBorder:'rgba(24,95,165,0.25)',  statDiv:'rgba(24,95,165,0.2)',  eyebrow:'#0C447C', text:'#042C53' } :
      rate >= 0.80 ? { main:'#BA7517', bg:'rgba(186,117,23,0.06)', border:'#BA7517', statBorder:'rgba(186,117,23,0.25)', statDiv:'rgba(186,117,23,0.2)', eyebrow:'#854F0B', text:'#412402' } :
                     { main:'#A32D2D', bg:'rgba(163,45,45,0.06)',  border:'#A32D2D', statBorder:'rgba(163,45,45,0.25)',  statDiv:'rgba(163,45,45,0.2)',  eyebrow:'#791F1F', text:'#501313' };

    const verdictSentence =
      rate >= 0.95 ? 'Your plan is on track throughout retirement, with room to absorb a sustained run of poor returns.' :
      rate >= 0.90 ? 'Your plan is well-founded — it holds in the large majority of scenarios, with only modest vulnerability at the edges.' :
      rate >= 0.80 ? 'Your plan holds in most scenarios but carries real risk in a meaningful share of poor sequences — a small adjustment removes most of that risk.' :
                     'Your plan needs attention — a significant share of simulated paths end in depletion before retirement ends.';

    // ── Headroom / gap ────────────────────────────────────────────────
    let headroom = null;
    let shortfallHTML = '';
    if (sustainableSpending !== null) {
      headroom = sustainableSpending - currentSpending;
      if (sustainableIsFloor) {
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Spending headroom</div>
            <div class="mc-vstat-secondary">Substantial</div>
          </div>`;
      } else if (headroom >= 0) {
        const hr = roundToNearest(headroom, 500);
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Typical headroom</div>
            <div class="mc-vstat-secondary">+${fmt(hr)} / yr</div>
          </div>`;
      } else {
        const gap = roundToNearest(Math.abs(headroom), 500);
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Typical shortfall</div>
            <div class="mc-vstat-secondary">−${fmt(gap)} / yr</div>
          </div>`;
      }
    }

    // ── Section 1: VERDICT HEADER ─────────────────────────────────────
    const s1 = `
      <div class="mc-verdict-header" style="border-left-color:${verdictColour.border};background:${verdictColour.bg}">
        <div class="mc-verdict-eyebrow" style="color:${verdictColour.eyebrow}">Your retirement outlook</div>
        <div class="mc-verdict-main">
          <span class="mc-verdict-word" style="color:${verdictColour.main}">${verdictWord}</span>
          <span class="mc-verdict-rate" style="color:${verdictColour.main}">${fmtPct(rate)}</span>
        </div>
        <p class="mc-verdict-sentence">${verdictSentence}</p>
        <div class="mc-verdict-stats" style="border-color:${verdictColour.statBorder}">
          <div class="mc-vstat">
            <div class="mc-vstat-label">Success rate</div>
            <div class="mc-vstat-primary" style="color:${verdictColour.main}">${fmtPct(rate)}</div>
          </div>
          ${shortfallHTML ? `<div style="border-left:1px solid ${verdictColour.statDiv};display:contents"></div>${shortfallHTML}` : ''}
        </div>
        <div class="mc-verdict-meta">Based on ${r.simCount.toLocaleString('en-GB')} simulations · ${firstYear} → ${lastYear}</div>
      </div>`;

    // ── Section 2: WHEN PRESSURE OCCURS ──────────────────────────────
    const p1StartAge = r.p1StartAge ?? null;

    function decadeAgeLabel(dy) {
      return p1StartAge !== null ? `Age ${p1StartAge + (dy - firstYear)}` : String(dy);
    }

    let p10DepletesAtYi = null;
    for (let i = 0; i < r.p10Portfolio.length; i++) {
      if (r.p10Portfolio[i] <= 0) { p10DepletesAtYi = i; break; }
    }

    let pressureSentence;
    if (p10DepletesAtYi !== null) {
      const depAge = p1StartAge !== null ? p1StartAge + p10DepletesAtYi : null;
      const lifeStage =
        depAge === null ? 'later in retirement' :
        depAge < 70    ? 'your late 60s'        :
        depAge < 80    ? 'your 70s'             :
        depAge < 90    ? 'your 80s'             : 'your 90s';
      pressureSentence = `In a poor sequence of returns, funds would begin to deplete in ${lifeStage} — at a point when flexibility to adjust is limited.`;
    } else {
      pressureSentence = `Even in a poor sequence of returns, the portfolio survives through the end of the projection in 9 out of 10 simulated paths.`;
    }

    let decadeRowsHTML = '';
    let survivalNote   = '';
    if (r.survivalByYear && r.years) {
      const decadeYrs = [2030, 2040, 2050, 2060, 2070].filter(y => y >= firstYear && y <= lastYear);
      let risingMarked = false;
      let minSurv = 1;

      decadeRowsHTML = decadeYrs.map(dy => {
        const yi = r.years.indexOf(dy);
        if (yi === -1) return '';
        const survRate  = r.survivalByYear[yi] / r.simCount;
        if (survRate < minSurv) minSurv = survRate;
        const barColour = survRate >= 0.95 ? '#3B6D11' : survRate >= 0.80 ? '#BA7517' : '#A32D2D';
        const isRising  = !risingMarked && survRate < 0.95;
        if (isRising) risingMarked = true;
        const rowClass  = isRising ? 'mc-decade-row mc-decade-row--rising' : 'mc-decade-row';
        return `
          <div class="${rowClass}">
            <span class="mc-decade-row__year">${decadeAgeLabel(dy)}</span>
            <span class="mc-decade-row__bar-wrap">
              <span class="mc-decade-row__bar" style="width:${(survRate*100).toFixed(1)}%;background:${barColour}"></span>
            </span>
            <span class="mc-decade-row__pct" style="color:${barColour}">${fmtPct(survRate)}</span>
          </div>`;
      }).join('');

      survivalNote =
        minSurv >= 0.95 ? 'Risk remains low throughout.' :
        minSurv >= 0.80 ? 'Risk is low early in retirement but rises in later years.' :
                          'Risk builds significantly — later years carry real pressure.';
    }

    const s2 = `
      <section class="mc-section">
        <div class="mc-section-label">When pressure occurs</div>
        <p class="mc-outlook-sentence">${pressureSentence}</p>
        ${decadeRowsHTML ? `<div class="mc-decade-chart">${decadeRowsHTML}</div>` : ''}
        ${survivalNote   ? `<p class="mc-survival-note">${survivalNote}</p>` : ''}
      </section>`;

    // ── Section 3: LEVERS ─────────────────────────────────────────────

    // Lever 1 — Spend less
    let l1Pill, l1PillClass, l1Outcome;
    if (sustainableSpending === null) {
      l1Pill = 'No data'; l1PillClass = 'mc-lever-pill--neutral';
      l1Outcome = 'Spending analysis was not available for this run.';
    } else if (sustainableIsFloor) {
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = 'Your plan remains sustainable well above your current spending.';
    } else if (headroom >= 0) {
      const hr = roundToNearest(headroom, 500);
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = `You have around ${fmt(hr)} per year of headroom — already within the ${confPct}% confidence band.`;
    } else {
      const gap = roundToNearest(Math.abs(headroom), 500);
      const newTarget = roundToNearest(currentSpending - gap, 500);
      const isSmall = Math.abs(headroom) / currentSpending <= 0.15;
      l1Pill = isSmall ? 'Modest cut' : 'Cut needed';
      l1PillClass = isSmall ? 'mc-lever-pill--warn' : 'mc-lever-pill--risk';
      l1Outcome = `Reducing spending by around ${fmt(gap)} per year — to ${fmt(newTarget)} — would bring your plan to the ${confPct}% confidence threshold.`;
    }

    // Lever 2 — Delay withdrawals
    let l2Pill, l2PillClass, l2Outcome;
    if (!delayPerturbations.length) {
      l2Pill = 'Not modelled'; l2PillClass = 'mc-lever-pill--neutral';
      l2Outcome = 'Delay perturbations were not computed for this run.';
    } else {
      const effective = delayPerturbations.filter(p => p.successRate >= targetConfidence);
      if (rate >= targetConfidence && effective.length) {
        const d = effective[0];
        l2Pill = 'Reinforces'; l2PillClass = 'mc-lever-pill--safe';
        l2Outcome = `Your plan is already sustainable. Delaying by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} would push success to ${fmtPct(d.successRate)}.`;
      } else if (effective.length) {
        const d = effective[0];
        l2Pill = `+${d.yearsDelay} yr fixes it`; l2PillClass = 'mc-lever-pill--safe';
        l2Outcome = `Delaying withdrawals by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} makes the plan sustainable at ${fmtPct(d.successRate)} success.`;
      } else {
        const best = delayPerturbations.reduce((a, b) => b.successRate > a.successRate ? b : a);
        l2Pill = 'Helps but not enough'; l2PillClass = 'mc-lever-pill--warn';
        l2Outcome = `Even delaying by 3 years does not fully remove shortfall risk — best result is ${fmtPct(best.successRate)}, still below ${confPct}%.`;
      }
    }

    // Lever 3 — Flexible spending
    const iqrWide = (p75[lastIdx] - p25[lastIdx]) / Math.max(p50[lastIdx], 1) > 1.5;
    let l3Pill, l3PillClass, l3Outcome;
    if (iqrWide) {
      l3Pill = 'Material gain'; l3PillClass = 'mc-lever-pill--safe';
      l3Outcome = 'Cutting 10–15% in weak years would meaningfully improve the downside position.';
    } else {
      l3Pill = 'Small gain'; l3PillClass = 'mc-lever-pill--neutral';
      l3Outcome = 'Flexible spending in down years adds a modest incremental improvement.';
    }

    // Primary lever index
    const _primary =
      (sustainableSpending !== null && !sustainableIsFloor && headroom < 0) ? 0 :
      (rate < targetConfidence && delayPerturbations.some(p => p.successRate >= targetConfidence)) ? 1 :
      (rate < targetConfidence && iqrWide) ? 2 : 0;

    function leverRow(name, pill, pillClass, outcome, isPrimary) {
      const cls = isPrimary ? 'mc-lever-row mc-lever-row--primary' : 'mc-lever-row mc-lever-row--secondary';
      return `
        <div class="${cls}">
          <span class="mc-lever-name">${name}</span>
          <span class="mc-lever-pill ${pillClass}">${pill}</span>
          <span class="mc-lever-outcome">${outcome}</span>
        </div>`;
    }

    const s3 = `
      <section class="mc-section">
        <div class="mc-section-label">What if you change something?</div>
        <div class="mc-lever-table">
          ${leverRow('Spend less',        l1Pill, l1PillClass, l1Outcome, _primary === 0)}
          ${leverRow('Delay withdrawals', l2Pill, l2PillClass, l2Outcome, _primary === 1)}
          ${leverRow('Flexible spending', l3Pill, l3PillClass, l3Outcome, _primary === 2)}
        </div>
      </section>`;

    // ── Section 4: PRIMARY ACTION ─────────────────────────────────────
    let actionLine, actionImpact, actionBorderColour, actionBg, actionLabelColour, actionTextColour, actionImpactColour;

    const hasGap         = sustainableSpending !== null && !sustainableIsFloor && headroom < 0;
    const delayMin       = delayPerturbations.find(p => p.successRate >= targetConfidence);
    const delayEffective = !!delayMin;

    if (hasGap) {
      const gap = roundToNearest(Math.abs(headroom), 500);
      const newTarget = roundToNearest(currentSpending - gap, 500);
      actionLine   = `Reduce annual spending by around ${fmt(gap)} to ${fmt(newTarget)}.`;
      actionImpact = `This single change brings your plan to the ${confPct}% confidence threshold.`;
      const isSmall = Math.abs(headroom) / currentSpending <= 0.15;
      actionBorderColour = isSmall ? '#BA7517' : '#A32D2D';
      actionBg           = isSmall ? 'rgba(186,117,23,0.08)' : 'rgba(163,45,45,0.08)';
      actionLabelColour  = isSmall ? '#854F0B' : '#791F1F';
      actionTextColour   = isSmall ? '#412402' : '#501313';
      actionImpactColour = isSmall ? '#633806' : '#791F1F';
    } else if (rate < targetConfidence && delayEffective) {
      actionLine   = `Delay drawing from your portfolio by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''}.`;
      actionImpact = `This allows the portfolio to compound without draws and lifts your success rate to ${fmtPct(delayMin.successRate)}.`;
      actionBorderColour = '#BA7517'; actionBg = 'rgba(186,117,23,0.08)';
      actionLabelColour = '#854F0B'; actionTextColour = '#412402'; actionImpactColour = '#633806';
    } else if (rate < targetConfidence && iqrWide) {
      actionLine   = `Adopt a flexible spending rule.`;
      actionImpact = `Reducing withdrawals by 10–15% in down years is the most practical lever available.`;
      actionBorderColour = '#BA7517'; actionBg = 'rgba(186,117,23,0.08)';
      actionLabelColour = '#854F0B'; actionTextColour = '#412402'; actionImpactColour = '#633806';
    } else {
      actionLine   = `No changes needed.`;
      actionImpact = `Your plan is resilient across all tested scenarios.`;
      actionBorderColour = '#3B6D11'; actionBg = 'rgba(59,109,17,0.08)';
      actionLabelColour = '#27500A'; actionTextColour = '#173404'; actionImpactColour = '#3B6D11';
    }

    const s4 = `
      <div class="mc-primary-action" style="border-left-color:${actionBorderColour};background:${actionBg}">
        <div class="mc-primary-action__label" style="color:${actionLabelColour}">Recommended action</div>
        <p class="mc-primary-action__text" style="color:${actionTextColour}">${actionLine}</p>
        <p class="mc-primary-action__impact" style="color:${actionImpactColour}">${actionImpact}</p>
      </div>
      <p class="mc-bridge-note">The charts below show your expected baseline plan. Actual outcomes may vary as modelled above.</p>`;

    el.innerHTML = s1 + s2 + s3 + s4;
  }
  window.RetireMCRender = { setResults, render, setReal };

})();
