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

    // Update sim count in subtitle
    const simCountEl = document.getElementById('mc-sim-count');
    if (simCountEl) simCountEl.textContent = r.simCount.toLocaleString('en-GB');

    // ── Spending context ──────────────────────────────────────────────────
    const sc = _spendingContext || {};
    const currentSpending     = sc.currentSpending     ?? 0;
    const sustainableSpending = sc.sustainableSpending ?? null;
    const sustainableIsFloor  = !!sc.sustainableIsFloor;
    const targetConfidence    = sc.targetConfidence    ?? 0.90;
    const delayPerturbations  = sc.delayPerturbations  || [];
    const confPct             = Math.round(targetConfidence * 100);

    // ── Verdict band ──────────────────────────────────────────────────────
    const rate = r.successRate;
    const verdictWord =
      rate >= 0.95 ? 'Strong'    :
      rate >= 0.90 ? 'Good'      :
      rate >= 0.80 ? 'Borderline': 'At risk';
    const verdictDotColour =
      rate >= 0.95 ? 'var(--mc-dot-strong,#3B6D11)' :
      rate >= 0.90 ? 'var(--mc-dot-good,  #185FA5)' :
      rate >= 0.80 ? 'var(--mc-dot-warn,  #BA7517)' :
                     'var(--mc-dot-risk,  #A32D2D)';
    const verdictWordColour =
      rate >= 0.95 ? 'color:var(--mc-dot-strong,#3B6D11)' :
      rate >= 0.90 ? 'color:var(--mc-dot-good,  #185FA5)' :
      rate >= 0.80 ? 'color:var(--mc-dot-warn,  #BA7517)' :
                     'color:var(--mc-dot-risk,  #A32D2D)';
    const verdictSentence =
      rate >= 0.95 ? 'Your plan is on track to support your lifestyle throughout retirement, with room to absorb a sustained run of poor returns.' :
      rate >= 0.90 ? 'Your plan looks well-founded — it succeeds in the large majority of scenarios, with only modest vulnerability at the edges.' :
      rate >= 0.80 ? 'Your plan needs a modest adjustment — it succeeds in most scenarios but is exposed to a meaningful minority of poor outcomes.' :
                     'Your plan requires attention — a significant share of simulated paths end in depletion before the end of retirement.';

    // ── Headroom / gap ────────────────────────────────────────────────────
    let headroomHTML = '';
    let headroom     = null;
    if (sustainableSpending !== null) {
      headroom = sustainableSpending - currentSpending;
      if (sustainableIsFloor) {
        headroomHTML = `
          <div class="mc-stat-cell">
            <div class="mc-stat-label">Spending headroom</div>
            <div class="mc-stat-value" style="color:var(--mc-dot-strong,#3B6D11);font-size:13px;padding-top:3px">
              Substantial — sustainable at all tested levels
            </div>
          </div>`;
      } else if (headroom >= 0) {
        const hr = roundToNearest(headroom, 500);
        headroomHTML = `
          <div class="mc-stat-cell">
            <div class="mc-stat-label">Annual headroom</div>
            <div class="mc-stat-value" style="color:var(--mc-dot-strong,#3B6D11)">+${fmt(hr)} / yr</div>
          </div>`;
      } else {
        const gap = roundToNearest(Math.abs(headroom), 500);
        const gapColour = Math.abs(headroom) / currentSpending <= 0.15
          ? 'var(--mc-dot-warn,#BA7517)'
          : 'var(--mc-dot-risk,#A32D2D)';
        headroomHTML = `
          <div class="mc-stat-cell">
            <div class="mc-stat-label">Annual gap</div>
            <div class="mc-stat-value" style="color:${gapColour}">−${fmt(gap)} / yr</div>
          </div>`;
      }
    }

    // ── Section 1: RETIREMENT OUTLOOK ─────────────────────────────────────
    const s1 = `
      <section class="mc-section mc-outlook-card">
        <div class="mc-section-label">Retirement outlook</div>
        <div class="mc-verdict-row">
          <span class="mc-outlook-dot" style="background:${verdictDotColour}"></span>
          <span class="mc-outlook-verdict" style="${verdictWordColour}">${verdictWord}</span>
        </div>
        <p class="mc-outlook-sentence">${verdictSentence}</p>
        <div class="mc-stat-row">
          <div class="mc-stat-cell">
            <div class="mc-stat-label">Success rate</div>
            <div class="mc-stat-value" style="${verdictWordColour}">${fmtPct(rate)}</div>
          </div>
          ${headroomHTML}
        </div>
      </section>`;

    // ── Section 2: WHEN PRESSURE OCCURS ───────────────────────────────────
    const p1StartAge = r.p1StartAge ?? null;

    function decadeAgeLabel(decadeYear) {
      if (p1StartAge !== null) {
        return `Age ${p1StartAge + (decadeYear - firstYear)}`;
      }
      return String(decadeYear);
    }

    // Scan raw (pre-deflate) p10 — we only need to know if it hits zero.
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
      pressureSentence = `In a poor sequence of returns, funds would begin to deplete in ${lifeStage} — meaning you may need to reduce spending or draw on reserves at a point when flexibility is limited.`;
    } else {
      pressureSentence = `Even in a poor sequence of returns, the portfolio survives through the end of the projection in 9 out of 10 simulated paths — no critical pressure point emerges.`;
    }

    let decadeRowsHTML = '';
    if (r.survivalByYear && r.years) {
      const decadeYrs = [2030, 2040, 2050, 2060, 2070].filter(
        y => y >= firstYear && y <= lastYear
      );
      decadeRowsHTML = decadeYrs.map(dy => {
        const yi = r.years.indexOf(dy);
        if (yi === -1) return '';
        const survRate  = r.survivalByYear[yi] / r.simCount;
        const barColour =
          survRate >= 0.95 ? 'var(--mc-dot-strong,#3B6D11)' :
          survRate >= 0.80 ? 'var(--mc-dot-warn,  #BA7517)' :
                             'var(--mc-dot-risk,  #A32D2D)';
        return `
          <div class="mc-decade-row">
            <span class="mc-decade-row__year">${decadeAgeLabel(dy)}</span>
            <span class="mc-decade-row__bar-wrap">
              <span class="mc-decade-row__bar" style="width:${(survRate * 100).toFixed(1)}%;background:${barColour}"></span>
            </span>
            <span class="mc-decade-row__pct" style="color:${barColour}">${fmtPct(survRate)}</span>
          </div>`;
      }).join('');
    }

    const s2 = `
      <section class="mc-section">
        <div class="mc-section-label">When pressure occurs</div>
        <p class="mc-outlook-sentence" style="margin-bottom:14px">${pressureSentence}</p>
        ${decadeRowsHTML ? `<div class="mc-decade-chart">${decadeRowsHTML}</div>` : ''}
      </section>`;

    // ── Section 3: WHAT IF YOU CHANGE SOMETHING? ──────────────────────────

    // Lever 1 — Spend less
    let l1Pill, l1PillClass, l1Outcome;
    if (sustainableSpending === null) {
      l1Pill      = 'No data';
      l1PillClass = 'mc-lever-pill--neutral';
      l1Outcome   = 'Spending analysis was not available for this run.';
    } else if (sustainableIsFloor) {
      l1Pill      = 'No cut needed';
      l1PillClass = 'mc-lever-pill--safe';
      l1Outcome   = `Your plan remains sustainable well above your current spending — no reduction is required.`;
    } else if (headroom >= 0) {
      const hr = roundToNearest(headroom, 500);
      l1Pill      = 'No cut needed';
      l1PillClass = 'mc-lever-pill--safe';
      l1Outcome   = `You have around ${fmt(hr)} per year of headroom — you're already within the ${confPct}% confidence band.`;
    } else {
      const gap       = roundToNearest(Math.abs(headroom), 500);
      const newTarget = roundToNearest(currentSpending - gap, 500);
      const isSmall   = Math.abs(headroom) / currentSpending <= 0.15;
      l1Pill      = isSmall ? 'Modest cut' : 'Cut needed';
      l1PillClass = isSmall ? 'mc-lever-pill--warn' : 'mc-lever-pill--risk';
      l1Outcome   = `Reducing spending by around ${fmt(gap)} per year — to ${fmt(newTarget)} — would bring your plan to the ${confPct}% confidence threshold.`;
    }

    // Lever 2 — Delay withdrawals (dynamic from perturbations)
    let l2Pill, l2PillClass, l2Outcome;
    if (delayPerturbations.length === 0) {
      l2Pill      = 'Not modelled';
      l2PillClass = 'mc-lever-pill--neutral';
      l2Outcome   = 'Delay perturbations were not computed for this run.';
    } else {
      const effective = delayPerturbations.filter(p => p.successRate >= targetConfidence);
      if (rate >= targetConfidence && effective.length > 0) {
        const d     = effective[0];
        l2Pill      = 'Reinforces';
        l2PillClass = 'mc-lever-pill--safe';
        l2Outcome   = `Your plan is already sustainable. Delaying by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} would push your success rate to ${fmtPct(d.successRate)}.`;
      } else if (effective.length > 0) {
        const d     = effective[0];
        l2Pill      = `+${d.yearsDelay} yr fixes it`;
        l2PillClass = 'mc-lever-pill--safe';
        l2Outcome   = `Delaying withdrawals by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} makes the plan sustainable at ${fmtPct(d.successRate)} success.`;
      } else {
        const best  = delayPerturbations.reduce((a, b) => b.successRate > a.successRate ? b : a);
        l2Pill      = 'Helps but not enough';
        l2PillClass = 'mc-lever-pill--warn';
        l2Outcome   = `Even delaying by 3 years does not fully remove shortfall risk — the best result is ${fmtPct(best.successRate)} success, still below the ${confPct}% threshold.`;
      }
    }

    // Lever 3 — Flexible spending
    const iqrWide = (p75[lastIdx] - p25[lastIdx]) / Math.max(p50[lastIdx], 1) > 1.5;
    let l3Pill, l3PillClass, l3Outcome;
    if (iqrWide) {
      l3Pill      = 'Material gain';
      l3PillClass = 'mc-lever-pill--safe';
      l3Outcome   = 'Your outcomes are widely dispersed. Cutting spending by 10–15% in years with negative real returns would meaningfully improve the downside position.';
    } else {
      l3Pill      = 'Small gain';
      l3PillClass = 'mc-lever-pill--warn';
      l3Outcome   = 'Flexible spending in down years would be a modest incremental improvement — your plan does not depend on it.';
    }

    function leverRow(name, pill, pillClass, outcome) {
      return `
        <div class="mc-lever-row">
          <span class="mc-lever-name">${name}</span>
          <span class="mc-lever-pill ${pillClass}">${pill}</span>
          <span class="mc-lever-outcome">${outcome}</span>
        </div>`;
    }

    const s3 = `
      <section class="mc-section">
        <div class="mc-section-label">What if you change something?</div>
        <div class="mc-lever-table">
          ${leverRow('Spend less',        l1Pill, l1PillClass, l1Outcome)}
          ${leverRow('Delay withdrawals', l2Pill, l2PillClass, l2Outcome)}
          ${leverRow('Flexible spending', l3Pill, l3PillClass, l3Outcome)}
        </div>
      </section>`;

    // ── Section 4: PRIMARY ACTION ──────────────────────────────────────────
    // Priority order: spending gap → delay → flexibility → all clear.
    let actionText, actionBorderColour;

    const hasGap         = sustainableSpending !== null && !sustainableIsFloor && headroom < 0;
    const delayMin       = delayPerturbations.find(p => p.successRate >= targetConfidence);
    const delayEffective = !!delayMin;

    if (hasGap) {
      const gap       = roundToNearest(Math.abs(headroom), 500);
      const newTarget = roundToNearest(currentSpending - gap, 500);
      actionText         = `Reduce annual spending by around ${fmt(gap)} to ${fmt(newTarget)} — this single change brings your plan to the ${confPct}% confidence threshold and is the highest-impact move available.`;
      actionBorderColour = Math.abs(headroom) / currentSpending <= 0.15
        ? 'var(--mc-dot-warn,#BA7517)'
        : 'var(--mc-dot-risk,#A32D2D)';
    } else if (rate < targetConfidence && delayEffective) {
      actionText         = `Delay drawing from your portfolio by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''} — this allows the portfolio to compound without draws and lifts your success rate to ${fmtPct(delayMin.successRate)}.`;
      actionBorderColour = 'var(--mc-dot-warn,#BA7517)';
    } else if (rate < targetConfidence && iqrWide) {
      actionText         = `Adopt a flexible spending rule — reduce withdrawals by 10–15% in years when your portfolio has fallen in real terms. This is the most practical lever available given your current spending level.`;
      actionBorderColour = 'var(--mc-dot-warn,#BA7517)';
    } else {
      actionText         = `No changes needed — your plan is resilient across all tested scenarios. Review again if your spending target changes materially or markets deliver a sustained poor sequence early in retirement.`;
      actionBorderColour = 'var(--mc-dot-strong,#3B6D11)';
    }

    const s4 = `
      <section class="mc-primary-action" style="border-left-color:${actionBorderColour}">
        <div class="mc-section-label" style="margin-bottom:6px">Primary action</div>
        <p class="mc-outlook-sentence" style="margin:0">${actionText}</p>
      </section>`;

    el.innerHTML = s1 + s2 + s3 + s4;
  }
  window.RetireMCRender = { setResults, render, setReal };

})();
