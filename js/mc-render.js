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
  let _stale           = false; // true when projection has been re-run since last MC run

  // ── Loader state ──────────────────────────────────────────────────────────
  const LOADER_DURATION_MS = 4000;
  const LOADER_MESSAGES = [
    'Simulating 10,000 retirement paths…',
    'Stress-testing against poor sequence returns…',
    'Calculating sustainable spending…',
    'Preparing your outlook…',
  ];
  let _loaderTimer      = null;  // setTimeout handle for the 4s reveal
  let _loaderInterval   = null;  // setInterval handle for progress bar
  let _resultReady      = false; // true once worker has posted its result
  let _loaderActive     = false; // true while loader is showing

  // ── Deflation ─────────────────────────────────────────────────────────────
  function _deflate(v, i) {
    return _useReal ? v / Math.pow(1 + _meanInflation, i) : v;
  }
  function _deflateArr(arr) { return arr.map((v, i) => _deflate(v, i)); }

  // ── Loader ────────────────────────────────────────────────────────────────
  function showLoader() {
    const el = document.getElementById('mc-narrative');
    if (!el) return;

    // Reset state
    _resultReady  = false;
    _loaderActive = true;
    clearTimeout(_loaderTimer);
    clearInterval(_loaderInterval);

    // Wave SVG — a sine path that animates via stroke-dashoffset
    const waveSVG = `
      <svg class="mc-loader-wave" viewBox="0 0 400 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path class="mc-loader-wave__path"
          d="M0 30 C33 10, 67 10, 100 30 S167 50, 200 30 S267 10, 300 30 S367 50, 400 30 S467 10, 500 30 S567 50, 600 30"
          fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
      </svg>`;

    el.innerHTML = `
      <div class="mc-loader-wrap">
        ${waveSVG}
        <p class="mc-loader-msg"></p>
        <div class="mc-loader-bar-wrap">
          <div class="mc-loader-bar-fill" id="mc-loader-bar"></div>
        </div>
      </div>`;

    // Message cycling — cross-fade every (LOADER_DURATION_MS / messages.length) ms
    const msgEl      = el.querySelector('.mc-loader-msg');
    const msgDelay   = LOADER_DURATION_MS / LOADER_MESSAGES.length;
    let   msgIdx     = 0;

    function showMessage(idx) {
      if (!msgEl) return;
      msgEl.classList.remove('mc-loader-msg--visible');
      // Short gap lets opacity reach 0 before text swaps
      setTimeout(() => {
        msgEl.textContent = LOADER_MESSAGES[idx] || '';
        msgEl.classList.add('mc-loader-msg--visible');
      }, 150);
    }
    showMessage(0);
    const msgTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADER_MESSAGES.length;
      showMessage(msgIdx);
    }, msgDelay);

    // Progress bar — fills linearly over LOADER_DURATION_MS
    const barEl     = document.getElementById('mc-loader-bar');
    const tickMs    = 50;
    const ticks     = LOADER_DURATION_MS / tickMs;
    let   tickCount = 0;
    _loaderInterval = setInterval(() => {
      tickCount++;
      const pct = Math.min((tickCount / ticks) * 100, 100);
      if (barEl) barEl.style.width = pct + '%';
      if (tickCount >= ticks) clearInterval(_loaderInterval);
    }, tickMs);

    // 4s reveal timer
    _loaderTimer = setTimeout(() => {
      clearInterval(msgTimer);
      clearInterval(_loaderInterval);
      _loaderActive = false;
      if (_resultReady) {
        _revealNarrative(el);
      }
      // else: setResults will call _revealNarrative when it arrives
    }, LOADER_DURATION_MS);
  }

  function _revealNarrative(el) {
    if (!el) el = document.getElementById('mc-narrative');
    if (!el) return;

    // Fade the loader wrap out, then render
    const wrap = el.querySelector('.mc-loader-wrap');
    if (wrap) {
      wrap.classList.add('mc-loader-wrap--fade-out');
      setTimeout(() => {
        _syncToggleButtons();
        _renderNarrative();
        // Fade narrative in
        el.classList.add('mc-narrative--fade-in');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => el.classList.add('mc-narrative--visible'));
        });
      }, 300);
    } else {
      _syncToggleButtons();
      _renderNarrative();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function setResults(result, meanInflation, spendingContext) {
    _result          = result;
    _meanInflation   = (typeof meanInflation === 'number' && !isNaN(meanInflation))
      ? meanInflation : 0.025;
    _spendingContext = spendingContext || null;
    _resultReady     = true;

    // If loader has already finished its 4s, reveal immediately
    if (!_loaderActive) {
      _revealNarrative();
    }
    // else: the _loaderTimer callback will call _revealNarrative
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

    // heroBg: solid 600-stop fill for the full-bleed hero band
    // actionBg / actionBorder / actionLabel / actionText / actionImpact: terminal block colours
    const verdictColour =
      rate >= 0.95 ? {
        heroBg: '#3B6D11',
        actionBg: '#EAF3DE', actionBorder: '#3B6D11',
        actionLabel: '#27500A', actionText: '#173404', actionImpact: '#3B6D11'
      } :
      rate >= 0.90 ? {
        heroBg: '#185FA5',
        actionBg: '#E6F1FB', actionBorder: '#185FA5',
        actionLabel: '#0C447C', actionText: '#042C53', actionImpact: '#185FA5'
      } :
      rate >= 0.80 ? {
        heroBg: '#BA7517',
        actionBg: '#FAEEDA', actionBorder: '#BA7517',
        actionLabel: '#854F0B', actionText: '#412402', actionImpact: '#633806'
      } : {
        heroBg: '#A32D2D',
        actionBg: '#FCEBEB', actionBorder: '#A32D2D',
        actionLabel: '#791F1F', actionText: '#501313', actionImpact: '#A32D2D'
      };

    const verdictSentence =
      rate >= 0.95 ? 'Your plan is on track throughout retirement, with room to absorb a sustained run of poor returns.' :
      rate >= 0.90 ? 'Your plan is well-founded. It holds in the large majority of scenarios, with only modest vulnerability at the edges.' :
      rate >= 0.80 ? 'Your plan holds in most scenarios but carries real risk across a meaningful share of poor sequences. A small adjustment removes most of that risk.' :
                     'Your plan needs attention. A significant share of simulated paths end in depletion before retirement ends.';

    // ── Headroom / gap ────────────────────────────────────────────────
    let headroom = null;
    let shortfallHTML = '';
    if (sustainableSpending !== null) {
      headroom = sustainableSpending - currentSpending;
      if (sustainableIsFloor) {
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Spending headroom</div>
            <div class="mc-vstat-value">Substantial</div>
          </div>`;
      } else if (headroom >= 0) {
        const hr = roundToNearest(headroom, 500);
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Typical headroom</div>
            <div class="mc-vstat-value">+${fmt(hr)} / yr</div>
          </div>`;
      } else {
        const gap = roundToNearest(Math.abs(headroom), 500);
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Typical shortfall</div>
            <div class="mc-vstat-value">${fmt(gap)} / yr</div>
          </div>`;
      }
    // shortfallHTML is empty string if no spending context — right column shows only success rate
    }

    // ── Section 1: VERDICT HEADER ─────────────────────────────────────
    const s1 = `
      <div class="mc-verdict-header" style="background:${verdictColour.heroBg}">
        <div class="mc-verdict-grid">
          <div class="mc-verdict-eyebrow">Your retirement outlook</div>
          <div class="mc-verdict-eyebrow mc-verdict-eyebrow--right">Success rate</div>
          <div class="mc-verdict-word">${verdictWord}</div>
          <div class="mc-verdict-bignum">${Math.round(rate * 100)}%</div>
        </div>
        <div class="mc-verdict-lower">
          <div class="mc-verdict-lower__left">
            <p class="mc-verdict-sentence">${verdictSentence}</p>
            <div class="mc-verdict-meta">Based on ${r.simCount.toLocaleString('en-GB')} simulations · ${firstYear} → ${lastYear}</div>
          </div>
          <div class="mc-verdict-lower__right">
            ${shortfallHTML}
          </div>
        </div>
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
      pressureSentence = `In a poor sequence of returns, funds would begin to deplete in ${lifeStage}, at a point when flexibility to adjust is limited.`;
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
                          'Risk builds significantly. Later years carry real pressure.';
    }

    const s2Left = `
      <div class="mc-evidence-pane mc-evidence-pane--left">
        <div class="mc-section-label">Stress test</div>
        <p class="mc-outlook-sentence">${pressureSentence}</p>
        ${decadeRowsHTML ? `<div class="mc-decade-chart">${decadeRowsHTML}</div>` : ''}
        ${survivalNote   ? `<p class="mc-survival-note">${survivalNote}</p>` : ''}
      </div>`;

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
      l1Outcome = `You have around ${fmt(hr)} per year of headroom, already within the ${confPct}% confidence band.`;
    } else {
      const gap = roundToNearest(Math.abs(headroom), 500);
      const newTarget = roundToNearest(currentSpending - gap, 500);
      const isSmall = Math.abs(headroom) / currentSpending <= 0.15;
      l1Pill = isSmall ? 'Modest cut' : 'Cut needed';
      l1PillClass = isSmall ? 'mc-lever-pill--warn' : 'mc-lever-pill--risk';
      l1Outcome = `Reducing spending by around ${fmt(gap)} per year to ${fmt(newTarget)} would bring your plan to the ${confPct}% confidence threshold.`;
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
        l2Outcome = `Even delaying by 3 years does not fully remove shortfall risk. Best result is ${fmtPct(best.successRate)}, still below ${confPct}%.`;
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

    // Is the plan already strong (no action needed)?
    const planIsStrong = rate >= targetConfidence &&
      (sustainableSpending === null || sustainableIsFloor || headroom >= 0);

    // Primary lever index (-1 = strong plan, no primary)
    const _primary = planIsStrong ? -1 :
      (sustainableSpending !== null && !sustainableIsFloor && headroom < 0) ? 0 :
      (rate < targetConfidence && delayPerturbations.some(p => p.successRate >= targetConfidence)) ? 1 :
      (rate < targetConfidence && iqrWide) ? 2 : 0;

    function leverBlock(name, pill, pillClass, outcome, isPrimary, isStrongPlan) {
      let cls = 'mc-lever';
      if (isPrimary)          cls += ' mc-lever--primary';
      else if (!isStrongPlan) cls += ' mc-lever--secondary';
      return `
        <div class="${cls}">
          <div class="mc-lever-top">
            <span class="mc-lever-name">${name}</span>
            <span class="mc-lever-pill ${pillClass}">${pill}</span>
          </div>
          <p class="mc-lever-outcome">${outcome}</p>
        </div>`;
    }

    // Strong plan: reassurance items rendered as lever-style blocks with safe pills
    let s2Right;
    if (planIsStrong) {
      const items = [];
      if (sustainableSpending !== null) {
        if (sustainableIsFloor) {
          items.push({ name: 'Spend less', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: 'Your plan remains sustainable well above your current spending.' });
        } else {
          const hr = roundToNearest(headroom, 500);
          items.push({ name: 'Spend less', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: `You have around ${fmt(hr)} per year of headroom before reaching the ${confPct}% confidence threshold.` });
        }
      }
      const hr = roundToNearest(headroom, 500);
      if (hr > 0) {
        const higherSpend = roundToNearest(currentSpending + hr, 500);
        items.push({ name: 'Consider spending more', pill: 'Headroom available', pillClass: 'mc-lever-pill--safe',
          outcome: `Your plan stays above the ${confPct}% threshold even with around ${fmt(hr)} more per year — you could spend up to ${fmt(higherSpend)}/yr and remain resilient.` });
      }
      items.push({ name: 'Flexible spending', pill: iqrWide ? 'Material gain' : 'Small gain',
        pillClass: iqrWide ? 'mc-lever-pill--safe' : 'mc-lever-pill--neutral',
        outcome: iqrWide
          ? 'Flexible spending in weak years would further improve your downside position.'
          : 'Flexible spending in weak years adds a modest incremental margin.' });

      s2Right = `
        <div class="mc-evidence-pane">
          <div class="mc-section-label">What changes this</div>
          <div class="mc-lever-table">
            ${items.map((it, idx) => leverBlock(it.name, it.pill, it.pillClass, it.outcome, idx === 0, true)).join('')}
          </div>
        </div>`;
    } else {
      s2Right = `
        <div class="mc-evidence-pane">
          <div class="mc-section-label">What changes this</div>
          <div class="mc-lever-table">
            ${leverBlock('Spend less',        l1Pill, l1PillClass, l1Outcome, _primary === 0, false)}
            ${leverBlock('Delay withdrawals', l2Pill, l2PillClass, l2Outcome, _primary === 1, false)}
            ${leverBlock('Flexible spending', l3Pill, l3PillClass, l3Outcome, _primary === 2, false)}
          </div>
        </div>`;
    }

    const s23 = `
      <div class="mc-evidence-card">
        ${s2Left}
        ${s2Right}
      </div>`;

    // ── Section 4: PRIMARY ACTION ─────────────────────────────────────
    let actionLine, actionImpact;

    const hasGap         = sustainableSpending !== null && !sustainableIsFloor && headroom < 0;
    const delayMin       = delayPerturbations.find(p => p.successRate >= targetConfidence);
    const delayEffective = !!delayMin;

    if (hasGap) {
      const gap = roundToNearest(Math.abs(headroom), 500);
      const newTarget = roundToNearest(currentSpending - gap, 500);
      actionLine   = `Reduce annual spending by around ${fmt(gap)} to ${fmt(newTarget)}.`;
      actionImpact = `This single change brings your plan to the ${confPct}% confidence threshold.`;
    } else if (rate < targetConfidence && delayEffective) {
      actionLine   = `Delay drawing from your portfolio by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''}.`;
      actionImpact = `This allows the portfolio to compound without draws and lifts your success rate to ${fmtPct(delayMin.successRate)}.`;
    } else if (rate < targetConfidence && iqrWide) {
      actionLine   = `Adopt a flexible spending rule.`;
      actionImpact = `Reducing withdrawals by 10 to 15% in down years is the most practical lever available.`;
    } else {
      actionLine   = `No changes needed.`;
      actionImpact = `Your plan is resilient across all tested scenarios.`;
    }

    // ── Contextual bullets (right half of action block) ───────────────
    // Worst-case depletion age from p10 portfolio
    let p10DepletesAge = null;
    if (r.p1StartAge != null) {
      for (let i = 0; i < r.p10Portfolio.length; i++) {
        if (r.p10Portfolio[i] <= 0) { p10DepletesAge = r.p1StartAge + i; break; }
      }
    }

    // Median and p90 end-of-projection values (deflated)
    const p50End = _deflate(r.p50Portfolio[lastIdx], lastIdx);
    const p90End = _deflate(r.p90Portfolio[lastIdx], lastIdx);
    const p10End = _deflate(r.p10Portfolio[lastIdx], lastIdx);

    // Midpoint age (roughly age 80 equivalent index)
    const midIdx = p1StartAge !== null
      ? Math.min(r.years.indexOf(r.years.find(y => y >= firstYear + (80 - p1StartAge)) ?? lastYear), lastIdx)
      : Math.floor(lastIdx / 2);
    const p50Mid = _deflate(r.p50Portfolio[Math.max(midIdx, 0)], Math.max(midIdx, 0));

    const age80label = p1StartAge !== null ? `age ${Math.min(80, p1StartAge + lastIdx)}` : 'mid-retirement';

    let bulletItems = [];

    if (rate >= 0.95) {
      // Strong
      if (sustainableSpending !== null && !sustainableIsFloor && headroom !== null && headroom >= 0) {
        const ceil = roundToNearest(sustainableSpending, 500);
        bulletItems.push(`Your plan supports up to ${fmt(ceil)} / yr at ${confPct}% confidence — ${fmt(roundToNearest(headroom, 500))} above your current spending.`);
      }
      if (p50Mid > 0) {
        bulletItems.push(`In a typical market, your portfolio is around ${fmt(roundToNearest(p50Mid, 10000))} at ${age80label}.`);
      }
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 paths, funds run low around age ${p10DepletesAge}.`);
      } else {
        bulletItems.push(`Even in the worst 1 in 10 paths, your portfolio remains intact throughout the projection.`);
      }
    } else if (rate >= 0.90) {
      // Good
      if (sustainableSpending !== null && !sustainableIsFloor && headroom !== null && headroom >= 0) {
        const ceil = roundToNearest(sustainableSpending, 500);
        bulletItems.push(`Sustainable spending ceiling is ${fmt(ceil)} — ${fmt(roundToNearest(headroom, 500))} above where you are now.`);
      }
      if (p50End > 0) {
        bulletItems.push(`Median portfolio at end of projection: ${fmt(roundToNearest(p50End, 10000))}.`);
      }
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 paths, funds run low around age ${p10DepletesAge} — late enough that adjustments remain possible.`);
      } else {
        bulletItems.push(`Even in the worst 1 in 10 paths, the portfolio survives the full projection.`);
      }
    } else if (rate >= 0.80) {
      // Borderline
      if (hasGap) {
        const gap = roundToNearest(Math.abs(headroom), 500);
        bulletItems.push(`A ${fmt(gap)} / yr reduction fully closes the gap to the ${confPct}% threshold.`);
      }
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 paths, funds run out around age ${p10DepletesAge} — while spending flexibility still exists.`);
      }
      if (p50End > 0) {
        bulletItems.push(`Median portfolio at end of projection: ${fmt(roundToNearest(p50End, 10000))} — the plan works in most scenarios.`);
      }
    } else {
      // At risk
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 paths, funds are exhausted by age ${p10DepletesAge}.`);
      }
      if (p50End > 0) {
        bulletItems.push(`Median portfolio at end of projection: ${fmt(roundToNearest(p50End, 10000))} — depletion is a likely outcome, not just a tail risk.`);
      }
      if (hasGap && delayEffective) {
        const gap = roundToNearest(Math.abs(headroom), 500);
        const newTarget = roundToNearest(currentSpending - gap, 500);
        bulletItems.push(`Cutting spending to ${fmt(newTarget)} and delaying by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''} together lift success to ${fmtPct(delayMin.successRate)}.`);
      } else if (hasGap) {
        const gap = roundToNearest(Math.abs(headroom), 500);
        bulletItems.push(`Reducing spending by ${fmt(gap)} / yr would bring your plan to the ${confPct}% confidence threshold.`);
      }
    }

    // Cap at 3 bullets
    bulletItems = bulletItems.slice(0, 3);
    const bulletsHTML = bulletItems.map(b => `<li class="mc-action-bullet">${b}</li>`).join('');

    const s4 = `
      <div class="mc-primary-action" style="border-top-color:${verdictColour.actionBorder};background:${verdictColour.actionBg}">
        <div class="mc-primary-action__body">
          <div class="mc-primary-action__left">
            <div class="mc-primary-action__label" style="color:${verdictColour.actionLabel}">Recommended action</div>
            <p class="mc-primary-action__text" style="color:${verdictColour.actionText}">${actionLine}</p>
            <p class="mc-primary-action__impact" style="color:${verdictColour.actionImpact}">${actionImpact}</p>
          </div>
          ${bulletsHTML ? `
          <div class="mc-primary-action__right">
            <ul class="mc-action-bullets" style="--bullet-colour:${verdictColour.actionBorder}">
              ${bulletsHTML}
            </ul>
          </div>` : ''}
        </div>
      </div>
      <p class="mc-bridge-note">Use the tabs above to explore charts and tables showing how your plan unfolds year by year under fixed assumptions.</p>`;

    const staleBanner = _stale
      ? `<div class="mc-stale-banner">⚠ Based on previous inputs — re-run to update</div>`
      : '';
    el.innerHTML = staleBanner + s1 + s23 + s4;

    // Push verdict colour onto the outlook tab button
    const outlookBtn = document.querySelector('.results-tab--outlook');
    if (outlookBtn) {
      outlookBtn.style.setProperty('--tab-verdict-colour', verdictColour.heroBg);
      outlookBtn.classList.add('results-tab--risk-ready');
    }
  }
  function setStale(stale) {
    _stale = !!stale;
    // Toggle stale dot on the Plan outlook tab button
    const outlookTab = document.getElementById('tab-btn-outlook');
    if (outlookTab) outlookTab.classList.toggle('results-tab--stale', _stale);
    // Toggle amber tint on the Test my plan CTA button
    const ctaBtn = document.getElementById('btn-test-plan');
    if (ctaBtn) ctaBtn.classList.toggle('btn-test-plan--stale', _stale);
    // If results are already rendered, update the banner in place
    if (_result) render();
  }

  window.RetireMCRender = { setResults, render, setReal, showLoader, setStale };

})();
