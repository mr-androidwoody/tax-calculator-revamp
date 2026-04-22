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

  function fmtB(n)      { return '<strong>' + fmt(n) + '</strong>'; }
  function fmtPctB(r)   { return '<strong>' + fmtPct(r) + '</strong>'; }

  // Plan-strength display percentage — applies the 99%+ cap rule.
  // Never show 100% for a user-facing likelihood of holding up figure.
  // Use this for the hero bignum and any copy that quotes plan strength directly.
  // Do NOT use for model-internal figures (decade bars, delay perturbation rates, etc.).
  function fmtRatePct(r) {
    if (r >= 0.995) return '99%+';
    return Math.round(r * 100) + '%';
  }

  function roundToNearest(n, nearest) {
    return Math.round(n / nearest) * nearest;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  // _results holds one result object per scenario state.
  // _activeState is which one is currently displayed.
  // _staleStates tracks stale flag per state independently.
  // _spendingContext and _meanInflation are shared (from baseline run).
  const STATE_IDS = ['baseline', 'sorr', 'inflation', 'lostDecade'];
  const STATE_LABELS = {
    baseline:    'Baseline',
    sorr:        'Sequence risk',
    inflation:   'High inflation',
    lostDecade:  'Lost decade',
  };
  const STATE_DESCRIPTIONS = {
    baseline:   null,
    sorr:       'Tests what happens if markets fall sharply in the first few years of retirement, before the portfolio has had time to recover.',
    inflation:  'Tests a prolonged period of high inflation in the early years of retirement, squeezing the real value of withdrawals.',
    lostDecade: 'Tests a sustained period of near-zero real growth at some point during retirement, limiting the portfolio\'s ability to compound.',
  };

  let _results       = { baseline: null, sorr: null, inflation: null, lostDecade: null };
  let _staleStates   = { baseline: false, sorr: false, inflation: false, lostDecade: false };
  let _activeState   = 'baseline';
  let _narrativeSnapshot = null; // stashed by _renderNarrative for export.js

  // Legacy aliases — used by existing code that references _result / _stale directly.
  // These are kept as getters so existing call sites work unchanged.
  function _getResult() { return _results[_activeState]; }
  function _getStale()  { return _staleStates[_activeState]; }

  // Keep _result and _stale as writable vars that are synced on state switch.
  let _result          = null;
  let _stale           = false;

  let _meanInflation   = 0.025;
  let _useReal         = true;
  let _spendingContext = null;

  // ── Loader state ──────────────────────────────────────────────────────────
  const LOADER_DURATION_MS = 4000;
  const LOADER_MESSAGES = [
    'Testing your plan against thousands of market scenarios…',
    'Stress-testing against poor sequence returns…',
    'Calculating sustainable spending…',
    'Preparing your outlook…',
  ];
  let _loaderTimer      = null;  // setTimeout handle for the 4s reveal
  let _loaderInterval   = null;  // setInterval handle for message cycling (cleared by next showLoader() call)
  let _resultReady      = false; // true once worker has posted its result
  let _loaderActive     = false; // true while loader is showing
  let _narrativeRevealed = false; // true once narrative has been rendered at least once after a run

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
    _resultReady       = false;
    _loaderActive      = true;
    _narrativeRevealed = false;
    clearTimeout(_loaderTimer);
    clearInterval(_loaderInterval);

    // Clear the shared results object so the deterministic badge hides during the run
    window.RetireMCResults = null;

    // Building squares grid — 3x3, animate in sequentially, last square green
    const squareColours = [
      '#b8c8e8', '#8aaad4', '#5c87bf',
      '#8aaad4', '#3460e8', '#5c87bf',
      '#5c87bf', '#3460e8', '#16a34a',
    ];
    const squaresHTML = squareColours.map((colour, i) => `
      <div class="mc-sq" style="
        width:18px;height:18px;border-radius:3px;
        background:${colour};
        opacity:0;transform:scale(0.4);
        animation:mc-sq-in 0.35s ease forwards;
        animation-delay:${i * 0.18}s;
      "></div>`).join('');

    el.innerHTML = `
      <style>
        @keyframes mc-sq-in { to { opacity:1; transform:scale(1); } }
        .mc-loader-wrap {
          display:flex;flex-direction:column;
          align-items:center;justify-content:center;
          min-height:260px;gap:20px;
        }
        .mc-sq-grid { display:grid;grid-template-columns:repeat(3,18px);gap:6px; }
        .mc-loader-msg {
          font-size:0.85rem;color:#64748b;text-align:center;
          opacity:0;transition:opacity 0.3s;max-width:280px;line-height:1.5;
        }
        .mc-loader-msg--visible { opacity:1; }
      </style>
      <div class="mc-loader-wrap">
        <div class="mc-sq-grid">${squaresHTML}</div>
        <p class="mc-loader-msg"></p>
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
    // Store in _loaderInterval so a re-triggered showLoader() clears it correctly.
    _loaderInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADER_MESSAGES.length;
      showMessage(msgIdx);
    }, msgDelay);

    // No progress bar — squares animation handles visual progress.

    // 4s reveal timer
    _loaderTimer = setTimeout(() => {
      clearInterval(_loaderInterval);
      _loaderInterval = null;
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
        _narrativeRevealed = true;
        _syncToggleButtons();
        _syncStressControls();
        _renderNarrative();
        _bindStressBtns();
        // Fade narrative in
        el.classList.add('mc-narrative--fade-in');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => el.classList.add('mc-narrative--visible'));
        });
      }, 300);
    } else {
      _narrativeRevealed = true;
      _syncToggleButtons();
      _syncStressControls();
      _renderNarrative();
      _bindStressBtns();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function setResults(result, meanInflation, spendingContext) {
    _results.baseline = result;
    _meanInflation   = (typeof meanInflation === 'number' && !isNaN(meanInflation))
      ? meanInflation : 0.025;
    _spendingContext = spendingContext || null;
    _resultReady     = true;

    // When a new baseline arrives, clear all stress results — inputs may have
    // changed so old stress runs are no longer valid. Buttons revert to idle.
    STATE_IDS.forEach(id => {
      if (id !== 'baseline') {
        _results[id]     = null;
        _staleStates[id] = false;
      }
    });

    // Switch active view to baseline on a new baseline run.
    _activeState = 'baseline';
    _result      = _results.baseline;
    _stale       = _staleStates.baseline;

    _syncStressControls();

    // Write the nominal median end value immediately — before the loader delay —
    // so calc-render.js renderMetrics() can read it as soon as app.js triggers a refresh.
    if (result && result.p50Portfolio && result.p50Portfolio.length) {
      window.RetireMCResults = {
        medianEndPortfolioNominal: result.p50Portfolio[result.p50Portfolio.length - 1],
      };
    }

    // If loader has already finished its 4s, reveal immediately
    if (!_loaderActive) {
      _revealNarrative();
    }
    // else: the _loaderTimer callback will call _revealNarrative
  }

  function setReal(useReal) {
    _useReal = useReal;
    if (_narrativeRevealed) render();
  }

  /**
   * Store a completed stress-test result and switch the active view to it.
   * Called by app.js once a runStress() promise resolves.
   *
   * @param {string} stressId — 'sorr' | 'inflation' | 'lostDecade'
   * @param {object} result   — same shape as baseline result
   */
  function setStressResult(stressId, result) {
    if (!STATE_IDS.includes(stressId)) return;
    _results[stressId]     = result;
    _staleStates[stressId] = false;

    // Switch to the newly arrived stress view.
    _activeState = stressId;
    _result      = result;
    _stale       = false;

    _syncStressControls();

    // Expose median end for the metrics badge (same as baseline path).
    if (result && result.p50Portfolio && result.p50Portfolio.length) {
      window.RetireMCResults = {
        medianEndPortfolioNominal: result.p50Portfolio[result.p50Portfolio.length - 1],
      };
    }

    // Stress results arrive after the loader has already been shown by app.js;
    // by the time we get here the loader timer has finished, so reveal directly.
    _revealNarrative();
  }

  /**
   * Switch the active view to a different computed state.
   * Called when the user clicks a toggle button for an already-computed state.
   *
   * @param {string} stateId — 'baseline' | 'sorr' | 'inflation' | 'lostDecade'
   */
  function switchState(stateId) {
    if (!STATE_IDS.includes(stateId)) return;
    if (!_results[stateId]) return; // not yet computed — caller should fire a run instead
    _activeState = stateId;
    _result      = _results[stateId];
    _stale       = _staleStates[stateId];
    _syncStressControls();
    _renderNarrative();
    _bindStressBtns();
  }

  function render() {
    if (!_result || !_narrativeRevealed) return;
    _syncToggleButtons();
    _syncStressControls();
    _renderNarrative();
    _bindStressBtns();
  }

  function _syncToggleButtons() {
    document.querySelectorAll('[data-action="mc-real-on"],[data-action="mc-real-off"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${_useReal ? 'mc-real-on' : 'mc-real-off'}"]`)
      .forEach(b => b.classList.add('is-active'));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STRESS CONTROLS
  // Buttons are rendered inline inside the hero band by _renderNarrative via
  // _buildStressBtnsHTML(). Click handlers are bound by _bindStressBtns()
  // after each narrative render. _syncStressControls keeps the legacy external
  // container hidden (it still exists in the HTML as a no-op anchor).
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO CARDS
  // Four cards (Baseline + 3 stress scenarios) replace the old button strip.
  // Baseline is always pre-active. Stress cards show idle/done/active states.
  // Click handlers bound by _bindStressBtns() — data-stress-state preserved.
  // ─────────────────────────────────────────────────────────────────────────

  const CARD_META = {
    baseline:   {
      eyebrow: 'Your plan',
      desc:    'Your projected retirement outcomes under normal market assumptions.',
    },
    sorr:       {
      eyebrow: 'Stress scenario',
      desc:    'Markets fall sharply in the first few years of retirement, before the portfolio has had time to recover.',
    },
    inflation:  {
      eyebrow: 'Stress scenario',
      desc:    'A prolonged period of high inflation in the early years of retirement, squeezing the real value of withdrawals.',
    },
    lostDecade: {
      eyebrow: 'Stress scenario',
      desc:    'Near-zero real growth for a decade at some point during retirement, limiting the portfolio\'s ability to compound.',
    },
  };

  function _buildStressBtnsHTML() {
    if (!_results.baseline) return '';

    const cards = STATE_IDS.map(id => {
      const hasResult = !!_results[id];
      const isActive  = id === _activeState;
      const isStale   = hasResult && _staleStates[id];
      const meta      = CARD_META[id];

      let cardCls = 'mc-sc-card';
      if (isActive)             cardCls += ' mc-sc-card--active';
      else if (hasResult)       cardCls += ' mc-sc-card--done';
      else if (id !== 'baseline') cardCls += ' mc-sc-card--idle';

      let ctaLabel, ctaCls;
      if (isActive) {
        ctaLabel = 'Viewing results';
        ctaCls   = 'mc-sc-card__cta mc-sc-card__cta--viewing';
      } else if (hasResult || id === 'baseline') {
        ctaLabel = 'View results';
        ctaCls   = 'mc-sc-card__cta mc-sc-card__cta--done';
      } else {
        ctaLabel = 'Test this scenario \u203a';
        ctaCls   = 'mc-sc-card__cta mc-sc-card__cta--idle';
      }

      const staleDot = isStale
        ? '<span class="mc-sc-stale-dot" title="Projection has changed — re-run to update"></span>'
        : '';

      return `
        <button class="${cardCls}" data-stress-state="${id}" type="button">
          <div class="mc-sc-card__eyebrow">${meta.eyebrow}${staleDot}</div>
          <div class="mc-sc-card__label">${STATE_LABELS[id]}</div>
          <p class="mc-sc-card__desc">${meta.desc}</p>
          <span class="${ctaCls}">${ctaLabel}</span>
        </button>`;
    }).join('');

    return `<div class="mc-sc-cards">${cards}</div>`;
  }

  function _bindStressBtns() {
    const narrative = document.getElementById('mc-narrative');
    if (!narrative) return;
    narrative.querySelectorAll('[data-stress-state]').forEach(btn => {
      btn.addEventListener('click', function () {
        const stateId = this.dataset.stressState;
        if (stateId === _activeState) return;
        if (_results[stateId]) {
          switchState(stateId);
        } else {
          document.dispatchEvent(new CustomEvent('mc-run-stress', { detail: { stressId: stateId } }));
        }
      });
    });
  }

  function _syncStressControls() {
    // External container is kept in HTML but hidden — buttons now live inside the hero band.
    const container = document.getElementById('mc-stress-controls');
    if (container) container.style.display = 'none';
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
    // spendingContext is only valid for the baseline run. Stress scenarios
    // do not run bisection or delay perturbations, so those fields must be
    // suppressed to avoid showing baseline-calibrated advice on a stress view.
    const isStressView = _activeState !== 'baseline';
    const sc                  = (!isStressView && _spendingContext) ? _spendingContext : {};
    const currentSpending     = sc.currentSpending     ?? 0;
    const sustainableSpending = sc.sustainableSpending ?? null;
    const sustainableIsFloor  = !!sc.sustainableIsFloor;
    const targetConfidence    = sc.targetConfidence    ?? 0.90;
    const delayPerturbations  = isStressView ? [] : (sc.delayPerturbations || []);
    const confPct             = Math.round(targetConfidence * 100);

    // ── Verdict ───────────────────────────────────────────────────────
    const rate = r.successRate;
    const verdictWord =
      rate >= 0.95 ? 'On track'           :
      rate >= 0.90 ? 'On track, but tight' :
      rate >= 0.80 ? 'Borderline'          : 'At risk';

    // verdictWordClass: CSS modifier to shrink font for longer labels
    const verdictWordClass =
      rate >= 0.90 && rate < 0.95 ? ' mc-verdict-word--long' : '';

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

    // p10DepletesAtYi not yet computed here — derive it early for the verdict sentence
    let _p10DepletesAtYiEarly = null;
    for (let i = 0; i < r.p10Portfolio.length; i++) {
      if (r.p10Portfolio[i] <= 0) { _p10DepletesAtYiEarly = i; break; }
    }
    const _lateRisk = _p10DepletesAtYiEarly !== null && _p10DepletesAtYiEarly > lastIdx * 0.6;
    const _earlyRisk = _p10DepletesAtYiEarly !== null && !_lateRisk;
    const _p10DepAge = (_p10DepletesAtYiEarly !== null && r.p1StartAge != null)
      ? r.p1StartAge + _p10DepletesAtYiEarly : null;
    const _depStage =
      _p10DepAge === null ? 'later in retirement' :
      _p10DepAge < 70    ? 'your late 60s'        :
      _p10DepAge < 80    ? 'your 70s'             :
      _p10DepAge < 90    ? 'your 80s'             : 'your 90s';

    // ── Early delta computation — used by verdictSentence and later blocks ──
    // Baseline rate for comparison; null when viewing baseline itself.
    const _baselineRateForSentence = (!isStressView || !_results.baseline)
      ? null : _results.baseline.successRate;
    const _verdictBandOf = r => r >= 0.95 ? 3 : r >= 0.90 ? 2 : r >= 0.80 ? 1 : 0;
    const _bandDrop = _baselineRateForSentence !== null
      ? _verdictBandOf(_baselineRateForSentence) - _verdictBandOf(rate) : 0;
    const _ppDrop   = _baselineRateForSentence !== null
      ? Math.round((_baselineRateForSentence - rate) * 100) : 0;
    // Severity tiers for stress sentence framing
    const _stressMarginal     = isStressView && _bandDrop <= 0 && _ppDrop <= 5;
    const _stressModerate     = isStressView && !_stressMarginal && _bandDrop <= 1 && _ppDrop <= 20;
    const _stressSignificant  = isStressView && !_stressMarginal && !_stressModerate;

    // ── Early margin classification (needed by verdictSentence below) ─
    const _earlyHeadroom     = sustainableSpending !== null ? sustainableSpending - currentSpending : null;
    const _earlyMarginRatio  = (_earlyHeadroom !== null && currentSpending > 0) ? _earlyHeadroom / currentSpending : null;
    const _earlyMarginTight    = _earlyMarginRatio !== null && _earlyMarginRatio >= 0 && _earlyMarginRatio < 0.08;
    const _earlyMarginModerate = _earlyMarginRatio !== null && _earlyMarginRatio >= 0.08 && _earlyMarginRatio < 0.20;

    // Verdict sentence: focuses on resilience claim and timeline only.
    // Specific £ figures are owned by the hero stat; success rate is in the big number.
    // For stress views, the sentence contextualises the result against the baseline plan.
    let verdictSentence;
    if (isStressView) {
      // Derive the baseline verdict label from the actual baseline rate —
      // never assume it is "on track".
      const _blRate = _baselineRateForSentence;
      const _blLabel =
        _blRate === null    ? 'your baseline plan'        :
        _blRate >= 0.95     ? 'Your baseline plan is on track' :
        _blRate >= 0.90     ? 'Your baseline plan is on track, but tight' :
        _blRate >= 0.80     ? 'Your baseline plan is borderline' :
                              'Your baseline plan is already at risk';
      // Short form for mid-sentence references
      const _blShort =
        _blRate === null ? 'The baseline plan'          :
        _blRate >= 0.95  ? 'The baseline plan is on track' :
        _blRate >= 0.90  ? 'The baseline plan is on track but has limited buffer' :
        _blRate >= 0.80  ? 'The baseline plan is borderline'  :
                           'The baseline plan is already at risk';

      if (rate >= 0.95) {
        verdictSentence = _stressMarginal
          ? `${_blLabel}, and this scenario makes little difference. It holds up well even if retirement starts badly.`
          : `${_blLabel}. This scenario does not change that. A difficult start to retirement would not be enough to knock it off course.`;
      } else if (rate >= 0.90) {
        verdictSentence = _stressMarginal
          ? `${_blLabel}. This scenario adds a little pressure, but the plan still holds. There is slightly less room for error, not enough to act on.`
          : _stressSignificant
          ? `${_blLabel}, but this scenario tightens the margin considerably. It still works, but with noticeably less room to absorb a bad run of returns.`
          : `${_blLabel}, but this scenario is more demanding. The plan still works, though the buffer is reduced.`;
      } else if (rate >= 0.80) {
        verdictSentence = _stressMarginal
          ? `${_blLabel}, but this scenario is not as resilient. Under these conditions, the plan becomes borderline.`
          : _stressSignificant
          ? `${_blLabel}, but this scenario puts it significantly under pressure. The plan becomes borderline here.`
          : `${_blLabel}, but this scenario reveals a real weakness. The plan becomes borderline under these conditions.`;
      } else {
        verdictSentence = _stressMarginal
          ? `${_blShort}, and this scenario makes it worse. Under these conditions, the plan is at risk.`
          : _stressSignificant
          ? `${_blLabel}, but this scenario puts it under serious pressure. A start like this would leave the plan with very little room to recover.`
          : `${_blLabel}, but this scenario puts it at risk. Under these conditions, the plan does not have enough in reserve to absorb a difficult start.`;
      }
    } else {
      // Baseline verdict sentence — unchanged logic, "baseline plan" label added
      verdictSentence =
        // A1 — On track, no depletion seen
        rate >= 0.95 && _p10DepletesAtYiEarly === null
          ? 'Your baseline plan is on track. At your current spending level, it is likely to hold up even if markets are weaker than expected.' :
        // A2 — On track, but late-life pressure only
        rate >= 0.95 && _lateRisk
          ? `Your baseline plan is on track. Most of the risk sits much later in retirement, not in the early years.` :
        // A1 fallback — on track, minor edge pressure
        rate >= 0.95
          ? 'Your baseline plan is on track and has a meaningful buffer above the level needed to stay sustainable.' :
        // B1 — On track but tight, no depletion, early sensitivity
        rate >= 0.90 && _p10DepletesAtYiEarly === null && _earlyMarginTight
          ? 'Your baseline plan is on track, but the buffer is thin. A bad run of returns early in retirement could put it under pressure.' :
        // B1 moderate margin
        rate >= 0.90 && _p10DepletesAtYiEarly === null && _earlyMarginModerate
          ? 'Your baseline plan is on track, but not by a wide margin. It works in most scenarios, though the room above the threshold is modest.' :
        // B1 — on track, no depletion seen, no particular margin flag
        rate >= 0.90 && _p10DepletesAtYiEarly === null
          ? 'Your baseline plan is on track. It works in most scenarios, though the margin is not large.' :
        // B2 — on track but tight, late risk, tight margin
        rate >= 0.90 && _lateRisk && _earlyMarginTight
          ? `Your baseline plan is on track, but not by a wide margin. Some risk is pushed into later retirement, where there is less room to recover.` :
        // B2 — on track but tight, late risk
        rate >= 0.90 && _lateRisk
          ? `Your baseline plan is on track, but some of the risk sits later in retirement, where there is less room to recover.` :
        // B1 fallback
        rate >= 0.90
          ? 'Your baseline plan is on track, though it does not have a large margin for error.' :
        // C2 — Borderline, later-life failure risk
        rate >= 0.80 && _lateRisk
          ? `Your baseline plan is borderline. It may work, but too much of the risk is pushed into later retirement, where there is less room to recover.` :
        // C1 — Borderline, meaningful downside risk, earlier trouble
        rate >= 0.80
          ? 'Your baseline plan is borderline. It may work, but it is not comfortably safe. In weaker markets, it starts to run into trouble in ' + _depStage + '.' :
        // D2 / D1 — At risk
          'Your baseline plan is at risk. As things stand, there is too high a chance of running short before the end of retirement.';
    }

    // ── Headroom / gap ────────────────────────────────────────────────
    let headroom = null;
    if (sustainableSpending !== null) {
      headroom = sustainableSpending - currentSpending;
    }

    // ── Gap / rounded gap ─────────────────────────────────────────────
    // Computed early so both the levers block and action block can use roundedGap.
    // hasGap requires the rounded gap to be >= 500 to avoid spurious £0 messages.
    const roundedGap = sustainableSpending !== null && !sustainableIsFloor && headroom < 0
      ? roundToNearest(Math.abs(headroom), 500) : 0;
    const hasGap     = roundedGap >= 500;

        // ── Margin of safety classification ──────────────────────────────
    // marginRatio: headroom as a fraction of current spending.
    // tight       < 8%  — plan passes but buffer is very thin (~£3,200 on £40k spend)
    // moderate    < 20% — plan passes with some room but not genuinely comfortable
    // comfortable ≥ 20% — meaningfully above threshold
    const marginRatio       = (headroom !== null && currentSpending > 0)
      ? headroom / currentSpending : null;
    const marginTight       = marginRatio !== null && marginRatio >= 0 && marginRatio < 0.08;
    const marginModerate    = marginRatio !== null && marginRatio >= 0.08 && marginRatio < 0.20;
    const marginComfortable = marginRatio !== null && marginRatio >= 0.20;

    // Warning icon SVG — white stroke on transparent fill, reads on coloured hero background.
    const warnIcon = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:4px;margin-bottom:2px" aria-label="Narrow margin warning"><path d="M8 2L14.5 13.5H1.5L8 2Z" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linejoin="round"/><line x1="8" y1="6.5" x2="8" y2="9.5" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="rgba(255,255,255,0.85)"/></svg>`;

    // ── Headroom stat HTML ────────────────────────────────────────────
    let shortfallHTML = '';
    if (sustainableSpending !== null) {
      if (sustainableIsFloor) {
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Estimated annual buffer</div>
            <div class="mc-vstat-value">Substantial</div>
          </div>`;
      } else if (headroom >= 0) {
        const hr        = roundToNearest(headroom, 500);
        const statLabel = 'Estimated annual buffer';
        const statValue = marginTight ? `${warnIcon}${fmt(hr)} / yr` : `${fmt(hr)} / yr`;
        shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">${statLabel}</div>
            <div class="mc-vstat-value">${statValue}</div>
          </div>`;
      } else {
        const gap = roundToNearest(Math.abs(headroom), 500);
        if (gap >= 500) {
          shortfallHTML = `
          <div class="mc-vstat">
            <div class="mc-vstat-label">Estimated annual gap</div>
            <div class="mc-vstat-value">${fmt(gap)} / yr</div>
          </div>`;
        }
        // gap < 500 rounds to zero — suppress stat entirely
      }
    // shortfallHTML is empty string if no spending context — right column shows only success rate
    }

    // ── Section 1: VERDICT HEADER ─────────────────────────────────────
    const s1 = `
      <div class="mc-verdict-header" style="background:${verdictColour.heroBg}">
        <div class="mc-verdict-grid">
          <div class="mc-verdict-eyebrow">Your retirement outlook</div>
          <div class="mc-verdict-eyebrow mc-verdict-eyebrow--right">Likelihood of holding up</div>
          <div class="mc-verdict-word${verdictWordClass}">${verdictWord}</div>
          <div class="mc-verdict-bignum">${fmtRatePct(rate)}</div>
        </div>
        <div class="mc-verdict-lower">
          <div class="mc-verdict-lower__left">
            <p class="mc-verdict-sentence">${verdictSentence}</p>
            <div class="mc-verdict-meta">Based on ${r.simCount.toLocaleString('en-GB')} simulations · ${firstYear} – ${lastYear}</div>
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
      pressureSentence = depAge !== null
        ? `In weaker market conditions, the plan starts coming under real pressure around age ${depAge}, when it is harder to make big adjustments.`
        : `In weaker market conditions, the plan starts coming under real pressure in ${lifeStage}, when it is harder to make big adjustments.`;
    } else {
      pressureSentence = `Pressure stays low throughout retirement. Even in weaker outcomes, the plan holds up from start to finish.`;
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
        const barColour  = survRate >= 0.95 ? '#3B6D11' : survRate >= 0.80 ? '#BA7517' : '#A32D2D';
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
        minSurv >= 0.95 ? 'Risk remains low throughout retirement.' :
        minSurv >= 0.80 ? 'There is little pressure early on. Risk builds in the later years as withdrawals compound against a smaller portfolio.' :
                          'Risk builds significantly. The later years carry real pressure as the portfolio base declines.';
    }

    const s2Left = `
      <div class="mc-evidence-pane mc-evidence-pane--left">
        <div class="mc-section-label">Where pressure shows up</div>
        <p class="mc-outlook-sentence">${pressureSentence}</p>
        ${decadeRowsHTML ? `<div class="mc-decade-chart">${decadeRowsHTML}</div>` : ''}
        ${survivalNote   ? `<p class="mc-survival-note">${survivalNote}</p>` : ''}
      </div>`;

    // ── Section 3: LEVERS ─────────────────────────────────────────────

    // Lever 1 — Spending
    let l1Pill, l1PillClass, l1Outcome;
    if (sustainableSpending === null) {
      l1Pill = 'No data'; l1PillClass = 'mc-lever-pill--neutral';
      l1Outcome = 'Spending analysis was not available for this run.';
    } else if (sustainableIsFloor) {
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = 'Current spending is comfortably affordable under this plan.';
    } else if (headroom >= 0) {
      const hr = roundToNearest(headroom, 500);
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = hr >= 500
        ? marginTight
          ? 'Current spending is workable, though the margin above a safer level is modest.'
          : 'Current spending is comfortably affordable under this plan.'
        : 'Current spending is right at the sustainable level, with negligible room above.';
    } else if (roundedGap >= 500) {
      const isSmall = roundedGap / currentSpending <= 0.15;
      l1Pill = isSmall ? 'Modest cut' : 'Cut needed';
      l1PillClass = isSmall ? 'mc-lever-pill--warn' : 'mc-lever-pill--risk';
      l1Outcome = 'A spending cut is the most direct way to move this plan back into a safer range.';
    } else {
      // Gap rounds to zero, treat as at threshold
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = 'Current spending is right at the sustainable level, with negligible room above.';
    }

    // Lever 2 — Delay withdrawals
    let l2Pill, l2PillClass, l2Outcome;
    if (!delayPerturbations.length) {
      l2Pill = 'Not available'; l2PillClass = 'mc-lever-pill--neutral';
      l2Outcome = 'Delay analysis was not run for this projection.';
    } else {
      const effective = delayPerturbations.filter(p => p.successRate >= targetConfidence);
      if (rate >= targetConfidence && effective.length) {
        const d = effective[0];
        l2Pill = 'Reinforces'; l2PillClass = 'mc-lever-pill--safe';
        l2Outcome = `Your plan is already on track. Delaying by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} would strengthen it further, but it is not essential.`;
      } else if (effective.length) {
        const d = effective[0];
        l2Pill = `+${d.yearsDelay} yr fixes it`; l2PillClass = 'mc-lever-pill--safe';
        l2Outcome = `Delaying withdrawals by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} is enough to move the plan into a meaningfully safer position.`;
      } else {
        const best = delayPerturbations.reduce((a, b) => b.successRate > a.successRate ? b : a);
        l2Pill = 'Helps but not enough'; l2PillClass = 'mc-lever-pill--warn';
        l2Outcome = `Delay improves the plan, but it is not enough by itself. Even a 3-year delay does not fully remove the shortfall risk.`;
      }
    }

    // Lever 3 — Flexible spending
    const iqrWide = p50[lastIdx] > 0
      ? (p75[lastIdx] - p25[lastIdx]) / p50[lastIdx] > 1.5
      : false;
    let l3Pill, l3PillClass, l3Outcome;
    if (iqrWide) {
      l3Pill = 'Material gain'; l3PillClass = 'mc-lever-pill--safe';
      l3Outcome = 'Being willing to trim spending in bad market years would make an already-strong plan even more resilient.';
    } else {
      l3Pill = 'Small gain'; l3PillClass = 'mc-lever-pill--neutral';
      l3Outcome = 'Flexible spending in down years adds a modest incremental improvement, but it is not the main fix.';
    }

    let s2Right;
    if (isStressView) {
      // Stress scenarios don't run bisection or delay perturbations.
      // Show what the scenario means and what to do, using the same lever-block
      // visual language as the baseline panel for consistency.
      const baselineRate = _results.baseline ? _results.baseline.successRate : null;
      const delta        = baselineRate !== null ? Math.round((rate - baselineRate) * 100) : null;

      // Natural-language delta — used in b3 block
      const absDelta = delta !== null ? Math.abs(delta) : null;

      // Block 1 — outcome
      const b1Pill =
        rate >= 0.95 ? 'Still on track'  :
        rate >= 0.90 ? 'Reduced margin'  :
        rate >= 0.80 ? 'Borderline'      : 'At risk';
      const b1PillClass =
        rate >= 0.95 ? 'mc-lever-pill--safe'    :
        rate >= 0.90 ? 'mc-lever-pill--neutral' :
        rate >= 0.80 ? 'mc-lever-pill--warn'    : 'mc-lever-pill--risk';
      const b1Outcome =
        rate >= 0.95
          ? `This scenario makes little difference to the overall outlook. The plan still looks robust.`
          : rate >= 0.90
          ? `Your plan still holds under this scenario, but the cushion is thinner. It stays above the level needed to remain reliable, but with less room.`
          : rate >= 0.80
          ? `In this scenario the plan becomes borderline. This exposes a weakness that the baseline view may not fully show.`
          : `Under these conditions, the plan comes under real strain. Running short before the end of retirement becomes a genuine possibility.`;

      // Block 2 — best next move
      const b2Pill =
        rate >= 0.95 ? 'No immediate change needed' :
        rate >= 0.90 ? 'Watch baseline buffer'      :
        rate >= 0.80 ? 'Review baseline actions'    : 'Use your baseline actions';
      const b2PillClass =
        rate >= 0.95 ? 'mc-lever-pill--safe'    :
        rate >= 0.90 ? 'mc-lever-pill--neutral' :
        rate >= 0.80 ? 'mc-lever-pill--warn'    : 'mc-lever-pill--risk';
      const b2Outcome =
        rate >= 0.95
          ? `No immediate change is needed on the strength of this scenario. Use the Baseline view for your main spending guidance and overall plan decisions.`
          : rate >= 0.90
          ? `No immediate change needed, but check that your baseline buffer is large enough to absorb a start like this.`
          : rate >= 0.80
          ? `Your baseline actions are worth prioritising. This is a realistic scenario, and it shows the plan does not have much room to spare.`
          : `Your baseline actions become more important here, not less. This scenario shows how much your current buffer actually needs to do.`;

      // Block 3 — vs baseline (delta context)
      const b3Pill =
        absDelta === null || absDelta === 0 ? 'No change'         :
        absDelta <= 5                       ? 'Marginal difference' :
        absDelta <= 20                      ? 'Meaningful drop'   : 'Large drop';
      const b3PillClass =
        absDelta === null || absDelta === 0 ? 'mc-lever-pill--neutral' :
        absDelta <= 5                       ? 'mc-lever-pill--neutral' :
        absDelta <= 20                      ? 'mc-lever-pill--warn'    : 'mc-lever-pill--risk';
      const b3Outcome =
        absDelta === null || absDelta === 0
          ? `This scenario produces results very close to your baseline plan.`
          : absDelta <= 5
          ? `The likelihood of holding up is ${absDelta} percentage point${absDelta === 1 ? '' : 's'} lower than your baseline, a small difference that does not materially change the picture.`
          : absDelta <= 20
          ? `The likelihood of holding up is ${absDelta} percentage points lower than your baseline. This is a meaningful reduction worth factoring into your planning.`
          : `The likelihood of holding up is ${absDelta} percentage points lower than your baseline, a large drop that highlights a real sensitivity in the plan.`;

      // Inline lever-block helper (mirrors baseline leverBlock, scoped to stress branch)
      function stressLeverBlock(name, pill, pillClass, outcome, isPrimary) {
        const cls = 'mc-lever' + (isPrimary ? ' mc-lever--primary' : ' mc-lever--secondary');
        return `
          <div class="${cls}">
            <div class="mc-lever-top">
              <span class="mc-lever-name">${name}</span>
              <span class="mc-lever-pill ${pillClass}">${pill}</span>
            </div>
            <p class="mc-lever-outcome">${outcome}</p>
          </div>`;
      }

      s2Right = `
        <div class="mc-evidence-pane">
          <div class="mc-section-label">What this means</div>
          <div class="mc-lever-table">
            ${stressLeverBlock('Outcome',            b1Pill, b1PillClass, b1Outcome, true)}
            ${stressLeverBlock('Compared with baseline', b3Pill, b3PillClass, b3Outcome, false)}
            ${stressLeverBlock('Best next move',     b2Pill, b2PillClass, b2Outcome, false)}
          </div>
        </div>`;
    } else {
    // ── Baseline: full lever analysis ────────────────────────────────
    const effectiveHeadroom = headroom !== null ? roundToNearest(headroom, 500) : null;
    const planIsStrong = rate >= targetConfidence &&
      (sustainableSpending === null || sustainableIsFloor || (headroom !== null && headroom >= 0 && effectiveHeadroom >= 0));

    // Primary lever index (-1 = strong plan, no primary)
    const _primary = planIsStrong ? -1 :
      hasGap ? 0 :
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

    // Strong plan: reassurance items rendered as lever-style blocks with safe pills.
    // Slot allocation:
    //   Item 1 (Spending)       → threshold relationship only, no £ figure
    //   Item 2 (Consider more)  → owns the ceiling £ (or discipline note in tight margin)
    //   Item 3 (Flexible)       → owns the flex-rule angle
    if (planIsStrong) {
      const items = [];

      // Item 1: Spending — always present, anchors on threshold relationship
      if (sustainableSpending !== null) {
        if (sustainableIsFloor) {
          items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: 'Current spending is comfortably affordable under this plan.' });
        } else if (marginTight) {
          items.push({ name: 'Spending', pill: 'Narrow margin', pillClass: 'mc-lever-pill--warn',
            outcome: 'Current spending is workable, though the margin above a safer level is modest.' });
        } else if (marginModerate) {
          items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: 'Current spending is affordable, with modest room above the sustainable level.' });
        } else {
          items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: 'Current spending sits comfortably within a safe range.' });
        }
      } else {
        items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
          outcome: 'Current spending passes the sustainability test over the full projection.' });
      }

      // Item 2: Consider spending more / Maintain discipline — owns the ceiling £
      const hr = roundToNearest(headroom, 500);
      if (hr > 0) {
        if (marginTight) {
          items.push({ name: 'Consider spending more', pill: 'Not recommended', pillClass: 'mc-lever-pill--warn',
            outcome: 'The buffer is thin. Any increase should be small and kept under close review.' });
        } else if (marginModerate) {
          const higherSpend = roundToNearest(currentSpending + hr, 500);
          items.push({ name: 'Consider spending more', pill: 'Use with caution', pillClass: 'mc-lever-pill--neutral',
            outcome: `You could spend somewhat more, up to around ${fmtB(higherSpend)}/yr, and still keep the plan on track, though any increase should be deliberate.` });
        } else {
          const higherSpend = roundToNearest(currentSpending + hr, 500);
          items.push({ name: 'Consider spending more', pill: 'Headroom available', pillClass: 'mc-lever-pill--safe',
            outcome: `There is room to spend up to around ${fmtB(higherSpend)}/yr and still keep the plan on track, though treat that as an option, not a target.` });
        }
      } else if (sustainableIsFloor) {
        items.push({ name: 'Consider spending more', pill: 'Headroom available', pillClass: 'mc-lever-pill--safe',
          outcome: 'There is room to spend more and still keep the plan on track.' });
      } else {
        items.push({ name: 'Consider spending more', pill: 'Not recommended', pillClass: 'mc-lever-pill--neutral',
          outcome: 'Current spending is at or near the sustainable ceiling.' });
      }

      // Item 3: Flexible spending — owns the flex-rule angle
      items.push({ name: 'Flexible spending', pill: iqrWide ? 'Material gain' : 'Small gain',
        pillClass: iqrWide ? 'mc-lever-pill--safe' : 'mc-lever-pill--neutral',
        outcome: iqrWide
          ? 'Being willing to trim spending in bad market years would make an already-strong plan even more resilient.'
          : 'Flexible spending in down years adds a modest incremental improvement, but it is not essential here.' });

      s2Right = `
        <div class="mc-evidence-pane">
          <div class="mc-section-label">What would improve this</div>
          <div class="mc-lever-table">
            ${items.map((it, idx) => leverBlock(it.name, it.pill, it.pillClass, it.outcome, idx === 0, true)).join('')}
          </div>
        </div>`;
    } else {
      s2Right = `
        <div class="mc-evidence-pane">
          <div class="mc-section-label">What would improve this</div>
          <div class="mc-lever-table">
            ${leverBlock('Spending',          l1Pill, l1PillClass, l1Outcome, _primary === 0, false)}
            ${leverBlock('Delay withdrawals', l2Pill, l2PillClass, l2Outcome, _primary === 1, false)}
            ${leverBlock('Flexible spending', l3Pill, l3PillClass, l3Outcome, _primary === 2, false)}
          </div>
        </div>`;
    } // end planIsStrong/lever branch
    } // end baseline s2Right block

    const s23 = `
      <div class="mc-evidence-card">
        ${s2Left}
        ${s2Right}
      </div>`;

    // ── Section 4: PRIMARY ACTION ─────────────────────────────────────
    // For stress views, show a scenario-level takeaway rather than
    // baseline-calibrated spending/delay recommendations.
    const inflationPct = (_meanInflation * 100).toFixed(1);
    const basisNote = `<p class="mc-basis-note">All £ figures on this tab are in today's money, adjusted for ${inflationPct}% annual inflation.</p>`;

    let s4;
    if (isStressView) {
      const baselineRate  = _results.baseline ? _results.baseline.successRate : null;
      const absDeltaS4    = baselineRate !== null ? Math.abs(Math.round((baselineRate - rate) * 100)) : null;
      const deltaPhS4     = absDeltaS4 !== null && absDeltaS4 > 0
        ? `${absDeltaS4} percentage point${absDeltaS4 === 1 ? '' : 's'} lower`
        : null;

      // Consequence-led headline — names the outcome, not the scenario
      let stressTakeaway;
      if (rate >= 0.95) {
        stressTakeaway = `This scenario does not change your position.`;
      } else if (rate >= 0.90) {
        stressTakeaway = `The plan still holds, but your buffer matters more under these conditions.`;
      } else if (rate >= 0.80) {
        stressTakeaway = `A rough start to retirement puts this plan on the edge.`;
      } else {
        stressTakeaway = `A rough start to retirement puts this plan under serious strain.`;
      }

      // Detail — consequence-led, delta in natural language, Baseline as explicit action
      let stressDetail;
      if (rate >= 0.95) {
        stressDetail = `Even under these conditions, the plan holds up well${deltaPhS4 ? `, with the likelihood of holding up only ${deltaPhS4} compared with your baseline` : ''}. You do not need to change anything on the strength of this result.`;
      } else if (rate >= 0.90) {
        stressDetail = `The plan stays workable, but the cushion is thinner${deltaPhS4 ? `, with the likelihood of holding up ${deltaPhS4} compared with your baseline` : ''}. It is worth checking that your baseline buffer is big enough to absorb a start like this, if it happens.`;
      } else if (rate >= 0.80) {
        stressDetail = `This reveals a vulnerability the baseline does not fully capture${deltaPhS4 ? `. Compared with your baseline, the likelihood of holding up is ${deltaPhS4}, which suggests your current buffer may not cope with a difficult start to retirement` : ''}. That makes your baseline spending and delay changes more important to act on.`;
      } else {
        stressDetail = `Your current buffer may not be large enough to withstand a start like this.${deltaPhS4 ? ` Compared with your baseline, the plan is much weaker here, with its likelihood of holding up ${deltaPhS4}.` : ''} Acting on your baseline spending and delay targets becomes more important, not optional.`;
      }

      // Stress bullets — consequence-led, collapse duplicate £0 figures
      const p50End    = _deflate(r.p50Portfolio[lastIdx], lastIdx);
      const p10End    = _deflate(r.p10Portfolio[lastIdx], lastIdx);
      const roundKend = v => roundToNearest(v, 10000);
      const fmtKendB  = v => fmtB(roundKend(Math.max(0, v)));

      let p10DepletesAge = null;
      if (r.p1StartAge != null) {
        for (let i = 0; i < r.p10Portfolio.length; i++) {
          if (r.p10Portfolio[i] <= 0) { p10DepletesAge = r.p1StartAge + i; break; }
        }
      }

      const p10NearZero = roundKend(Math.max(0, p10End)) <= 0;
      const p50NearZero = roundKend(Math.max(0, p50End)) <= 0;

      const stressBullets = [];

      // Bullet 1 — weaker outcomes
      if (p10DepletesAge !== null) {
        stressBullets.push(`In weaker outcomes, funds run low around age ${p10DepletesAge}.`);
      } else if (p10NearZero) {
        stressBullets.push(`In weaker outcomes, there is effectively no margin left.`);
      } else {
        stressBullets.push(`In weaker outcomes, the plan tends to finish with about ${fmtKendB(p10End)} left.`);
      }

      // Bullet 2 — typical outcome (only show if meaningfully distinct from bullet 1)
      if (p50NearZero && p10NearZero) {
        stressBullets.push(`Even a typical outcome leaves little or no cushion.`);
      } else if (!p50NearZero) {
        stressBullets.push(`In a typical outcome, the plan finishes with around ${fmtKendB(p50End)}.`);
      }
      // If p50 is non-zero but p10 was near-zero, the contrast is already clear — both show.

      // Bullet 3 — Baseline redirect as explicit action
      stressBullets.push(`Use the Baseline view for spending guidance and your main recommended actions.`);

      const stressBulletsHTML = stressBullets.map(b => `<li class="mc-action-bullet">${b}</li>`).join('');

      s4 = `
        <div class="mc-primary-action" style="border-top-color:${verdictColour.actionBorder};background:${verdictColour.actionBg}">
          <div class="mc-primary-action__body">
            <div class="mc-primary-action__left">
              <div class="mc-primary-action__label" style="color:${verdictColour.actionLabel}">What this means</div>
              <p class="mc-primary-action__text mc-primary-action__text--stress" style="color:${verdictColour.actionText}">${stressTakeaway}</p>
              <p class="mc-primary-action__impact" style="color:${verdictColour.actionImpact}">${stressDetail}</p>
            </div>
            <div class="mc-primary-action__right">
              <ul class="mc-action-bullets" style="--bullet-colour:${verdictColour.actionBorder}">
                ${stressBulletsHTML}
              </ul>
            </div>
          </div>
        </div>
        <p class="mc-bridge-note">This scenario shows what happens to your plan under a specific adverse condition. Use the Baseline view for your main spending guidance and recommended actions.</p>
        ${basisNote}`;

    } else {
      // ── Baseline: full action block ───────────────────────────────
      let actionLine, actionImpact;

      const delayMin       = delayPerturbations.find(p => p.successRate >= targetConfidence);
      const delayEffective = !!delayMin;

      if (hasGap) {
        const gap = roundedGap;
        const newTarget = roundToNearest(currentSpending - gap, 500);
        actionLine   = `Reduce annual spending by ${fmtB(gap)}, to roughly ${fmtB(newTarget)}.`;
        actionImpact = `That is the clearest way to make the plan more dependable in weaker markets.`;
      } else if (rate < targetConfidence && delayEffective) {
        actionLine   = `Delay drawing from your portfolio by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''}.`;
        actionImpact = `This allows the portfolio to compound without draws and is the strongest non-spending fix available.`;
      } else if (rate < targetConfidence && iqrWide) {
        actionLine   = `Adopt a flexible spending rule.`;
        actionImpact = `Being willing to trim spending by 10 to 15% in down years is the most practical lever available.`;
      } else {
        const hrForAction = sustainableSpending !== null && !sustainableIsFloor && headroom > 0
          ? roundToNearest(headroom, 500) : null;
        if (marginTight && hrForAction) {
          actionLine   = `No immediate change is needed, but keep this under annual review.`;
          actionImpact = `The buffer is thin at about ${fmtB(hrForAction)} per year. A poor run of returns early in retirement could use it up quickly.`;
        } else if (marginModerate && hrForAction) {
          actionLine   = `No immediate change is needed.`;
          actionImpact = `There is room to spend a little more if you choose to, but treat that as an option rather than a target, and keep the plan under review.`;
        } else {
          actionLine   = hrForAction
            ? `No immediate change is needed. You could spend around ${fmtB(hrForAction)} more each year and still keep the plan on track.`
            : `No immediate change is needed.`;
          actionImpact = `Any increase should be deliberate. Even with it, there is still a meaningful buffer above the level needed to stay sustainable.`;
        }
      }

      // ── Contextual bullets ────────────────────────────────────────
      let p10DepletesAge = null;
      if (r.p1StartAge != null) {
        for (let i = 0; i < r.p10Portfolio.length; i++) {
          if (r.p10Portfolio[i] <= 0) { p10DepletesAge = r.p1StartAge + i; break; }
        }
      }

      const p50End = _deflate(r.p50Portfolio[lastIdx], lastIdx);
      const p90End = _deflate(r.p90Portfolio[lastIdx], lastIdx);
      const p10End = _deflate(r.p10Portfolio[lastIdx], lastIdx);

      window.RetireMCResults = { medianEndPortfolioNominal: r.p50Portfolio[lastIdx] };

      const roundKend = v => roundToNearest(v, 10000);
      const fmtKendB  = v => fmtB(roundKend(Math.max(0, v)));

      let bulletItems = [];

      if (rate >= 0.95) {
        if (p10DepletesAge !== null) {
          bulletItems.push(`Even in weaker outcomes, funds only start to come under pressure around age ${p10DepletesAge}, after many years of withdrawals.`);
        } else {
          bulletItems.push(`In weaker outcomes, the plan still tends to finish with about ${fmtKendB(p10End)} left.`);
        }
        bulletItems.push(`In a typical outcome, the plan finishes with around ${fmtKendB(p50End)} remaining.`);
        bulletItems.push(`In stronger outcomes, the surplus is substantially higher.`);
      } else if (rate >= 0.90) {
        if (p10DepletesAge !== null) {
          bulletItems.push(`In weaker outcomes, the money starts to come under pressure around age ${p10DepletesAge}.`);
        } else {
          bulletItems.push(`In weaker outcomes, the plan still tends to finish with about ${fmtKendB(p10End)} left.`);
        }
        bulletItems.push(`In a typical outcome, the plan finishes with around ${fmtKendB(p50End)} remaining.`);
        if (_earlyMarginTight || marginTight) {
          bulletItems.push(`A bad run of returns early in retirement is the main risk to watch.`);
        } else if (_lateRisk) {
          bulletItems.push(`Most of the risk sits later in retirement, when course correction is harder.`);
        } else {
          bulletItems.push(`Being willing to trim spending in bad market years would add a little extra protection.`);
        }
      } else if (rate >= 0.80) {
        bulletItems.push(`If nothing changes, the risk of a later-life shortfall is too high to ignore.`);
        if (p10DepletesAge !== null) {
          bulletItems.push(`In weaker outcomes, the money starts running short around age ${p10DepletesAge}.`);
        } else {
          bulletItems.push(`In weaker outcomes, the money starts running short later in retirement.`);
        }
        bulletItems.push(`In a typical outcome, the plan can still work, but there is not enough buffer to rely on that comfortably.`);
      } else {
        if (p10DepletesAge !== null) {
          bulletItems.push(`In weaker outcomes, the money runs out around age ${p10DepletesAge}.`);
        } else {
          bulletItems.push(`Too many outcomes end with the plan running short before the end of retirement.`);
        }
        if (hasGap) {
          const newTarget = roundToNearest(currentSpending - roundedGap, 500);
          bulletItems.push(`Reducing spending to roughly ${fmtB(newTarget)} would move the plan much closer to a workable level.`);
        } else if (p50End > 0) {
          bulletItems.push(`Even a typical outcome still leaves this plan under pressure.`);
        } else {
          bulletItems.push(`A typical outcome still sees the portfolio depleted before the end of retirement.`);
        }
        if (hasGap && delayEffective) {
          bulletItems.push(`Combining that cut with a ${delayMin.yearsDelay}-year delay would strengthen the plan further.`);
        } else if (delayEffective) {
          bulletItems.push(`Delaying withdrawals by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''} improves the plan, but may still need to be paired with lower spending.`);
        } else {
          bulletItems.push(`Being willing to trim spending by 10 to 15% in weak years is the strongest remaining lever.`);
        }
      }

      bulletItems = bulletItems.slice(0, 3);
      const bulletsHTML = bulletItems.map(b => `<li class="mc-action-bullet">${b}</li>`).join('');

      s4 = `
        <div class="mc-primary-action" style="border-top-color:${verdictColour.actionBorder};background:${verdictColour.actionBg}">
          <div class="mc-primary-action__body">
            <div class="mc-primary-action__left">
              <div class="mc-primary-action__label" style="color:${verdictColour.actionLabel}">Best next move</div>
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
        <p class="mc-bridge-note">This view tests your plan against weaker and stronger market conditions, so you can see whether it still holds up when reality is less tidy than a straight-line forecast. Use the tabs above to explore how your plan unfolds year by year.</p>
        ${basisNote}`;
    }

    // Always expose the nominal median end value for the deterministic metrics badge.
    window.RetireMCResults = { medianEndPortfolioNominal: r.p50Portfolio[lastIdx] };

    const staleScenario = _activeState !== 'baseline' ? ` (${STATE_LABELS[_activeState]})` : '';
    const staleBanner = _stale
      ? `<div class="mc-stale-banner">⚠ Based on previous inputs${staleScenario}. Re-run to update.</div>`
      : '';
    const stressRow = `
      <div class="mc-below-hero">
        ${_buildStressBtnsHTML()}
      </div>`;

    // Stash key computed strings for export.js snapshot.
    // Only captured for baseline view — stress views are contextual commentary
    // on the baseline, not primary action guidance.
    if (!isStressView) {
      _narrativeSnapshot = {
        verdictWord,
        verdictSentence,
        pressureSentence,
        survivalNote,
        l1Pill,
        l1Outcome,
        l2Pill,
        l2Outcome,
        l3Pill,
        l3Outcome,
        actionLine,
        actionImpact,
        bulletItems: Array.isArray(bulletItems) ? bulletItems.slice() : [],
      };
    }

    el.innerHTML = staleBanner + s1 + stressRow + s23 + s4;

    // Push verdict colour onto the outlook tab button
    const outlookBtn = document.querySelector('.results-tab--outlook');
    if (outlookBtn) {
      outlookBtn.style.setProperty('--tab-verdict-colour', verdictColour.heroBg);
      outlookBtn.classList.add('results-tab--risk-ready');
    }
  }
  function setStale(stale) {
    // Mark the baseline stale.
    _staleStates.baseline = !!stale;

    // A re-projection also clears all stress results since inputs may have changed.
    // Buttons revert to idle so the user must re-run each stress scenario.
    if (stale) {
      STATE_IDS.forEach(id => {
        if (id !== 'baseline') {
          _results[id]     = null;
          _staleStates[id] = false;
        }
      });
    }

    // Sync the active _stale var used by _renderNarrative.
    _stale = _staleStates[_activeState];

    // Toggle stale dot on the Plan outlook tab button (reflects baseline staleness).
    const outlookTab = document.getElementById('tab-btn-outlook');
    if (outlookTab) outlookTab.classList.toggle('results-tab--stale', !!stale);
    // Toggle amber tint on the Test my plan CTA button.
    const ctaBtn = document.getElementById('btn-test-plan');
    if (ctaBtn) ctaBtn.classList.toggle('btn-test-plan--stale', !!stale);

    _syncStressControls();
    // Only re-render if the narrative is already visible — avoids double-render
    // during the initial reveal sequence when setStale is called before the
    // 4s loader has finished.
    if (_result && _narrativeRevealed) render();
  }

  window.RetireMCRender = {
    setResults, setStressResult, switchState, render, setReal, showLoader, setStale,
    getSnapshot() {
      return {
        baseline:          _results.baseline   || null,
        sorr:              _results.sorr        || null,
        inflation:         _results.inflation   || null,
        lostDecade:        _results.lostDecade  || null,
        spendingContext:   _spendingContext,
        meanInflation:     _meanInflation,
        narrativeSnapshot: _narrativeSnapshot,
      };
    },
  };

})();
