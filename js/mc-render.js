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
    sorr:       'First 5 years: equity returns shifted 2\u03c3 below mean. Models an adverse early-retirement return sequence.',
    inflation:  'Years 1\u201310: inflation drawn from N(5%, 2%). Models a 1970s-style sustained inflation regime.',
    lostDecade: 'A fixed 10-year window of near-zero growth at an unpredictable point in the projection.',
  };

  let _results       = { baseline: null, sorr: null, inflation: null, lostDecade: null };
  let _staleStates   = { baseline: false, sorr: false, inflation: false, lostDecade: false };
  let _activeState   = 'baseline';

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
  let _loaderInterval   = null;  // setInterval handle for progress bar
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
    const msgTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % LOADER_MESSAGES.length;
      showMessage(msgIdx);
    }, msgDelay);

    // No progress bar — squares animation handles visual progress.

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
        _narrativeRevealed = true;
        _syncToggleButtons();
        _syncStressControls();
        _renderNarrative();
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
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function setResults(result, meanInflation, spendingContext) {
    _results.baseline = result;
    _meanInflation   = (typeof meanInflation === 'number' && !isNaN(meanInflation))
      ? meanInflation : 0.025;
    _spendingContext = spendingContext || null;
    _resultReady     = true;

    // When a new baseline arrives, all stress results that were computed from
    // the previous inputs are now stale.
    STATE_IDS.forEach(id => { if (id !== 'baseline') _staleStates[id] = _results[id] !== null; });

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
  }

  function render() {
    if (!_result || !_narrativeRevealed) return;
    _syncToggleButtons();
    _syncStressControls();
    _renderNarrative();
  }

  function _syncToggleButtons() {
    document.querySelectorAll('[data-action="mc-real-on"],[data-action="mc-real-off"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${_useReal ? 'mc-real-on' : 'mc-real-off'}"]`)
      .forEach(b => b.classList.add('is-active'));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STRESS CONTROLS
  // Renders the four scenario toggle buttons into #mc-stress-controls.
  // This container is a static sibling of #mc-narrative and is never replaced
  // by narrative renders — only this function touches it.
  // ─────────────────────────────────────────────────────────────────────────
  function _syncStressControls() {
    const container = document.getElementById('mc-stress-controls');
    if (!container) return;

    // Only show the controls once baseline has been run.
    if (!_results.baseline) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';

    const btns = STATE_IDS.map(id => {
      const hasResult  = !!_results[id];
      const isActive   = id === _activeState;
      const isStale    = hasResult && _staleStates[id];
      const label      = STATE_LABELS[id];

      // Pills: active gets solid fill; computed-but-inactive gets outlined; unrun gets muted outline.
      let cls = 'mc-sc-btn';
      if (isActive)         cls += ' mc-sc-btn--active';
      else if (hasResult)   cls += ' mc-sc-btn--done';
      else                  cls += ' mc-sc-btn--idle';

      const staleIndicator = isStale
        ? '<span class="mc-sc-stale-dot" title="Re-run to update"></span>'
        : '';

      // data-stress-state drives the click handler bound below.
      return `<button class="${cls}" data-stress-state="${id}" type="button">${label}${staleIndicator}</button>`;
    }).join('');

    // Active scenario description (shown when a stress state is active).
    const desc = (_activeState !== 'baseline' && STATE_DESCRIPTIONS[_activeState])
      ? `<p class="mc-sc-desc">${STATE_DESCRIPTIONS[_activeState]}</p>`
      : '';

    container.innerHTML = `
      <div class="mc-sc-row">
        <div class="mc-sc-btns">${btns}</div>
      </div>
      ${desc}`;

    // Bind click handlers on the freshly injected buttons.
    container.querySelectorAll('[data-stress-state]').forEach(btn => {
      btn.addEventListener('click', function () {
        const stateId = this.dataset.stressState;
        if (stateId === _activeState) return; // already active — no-op

        if (_results[stateId]) {
          // Already computed — instant switch.
          switchState(stateId);
        } else {
          // Not yet run — fire the stress run via app.js coordinator.
          // We dispatch a custom event so mc-render.js doesn't need a direct
          // reference to app.js. app.js listens for this and calls runStress.
          document.dispatchEvent(new CustomEvent('mc-run-stress', { detail: { stressId: stateId } }));
        }
      });
    });
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

    // ══════════════════ TEMPORARY DIAGNOSTIC ══════════════════
    // Remove once nominal-vs-real question is resolved.
    console.log('[MC DIAG]', {
      useReal:        _useReal,
      meanInflation:  _meanInflation,
      firstYear,
      lastYear,
      lastIdx,
      deflator:       Math.pow(1 + _meanInflation, lastIdx),
      p10_nominal_end: r.p10Portfolio[lastIdx],
      p10_real_end:    _deflate(r.p10Portfolio[lastIdx], lastIdx),
      p50_nominal_end: r.p50Portfolio[lastIdx],
      p50_real_end:    _deflate(r.p50Portfolio[lastIdx], lastIdx),
      p90_nominal_end: r.p90Portfolio[lastIdx],
      p90_real_end:    _deflate(r.p90Portfolio[lastIdx], lastIdx),
      p50_nominal_start: r.p50Portfolio[0],
      p50_real_start:    _deflate(r.p50Portfolio[0], 0),
    });
    // ══════════════════════════════════════════════════════════

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

    // ── Early margin classification (needed by verdictSentence below) ─
    const _earlyHeadroom     = sustainableSpending !== null ? sustainableSpending - currentSpending : null;
    const _earlyMarginRatio  = (_earlyHeadroom !== null && currentSpending > 0) ? _earlyHeadroom / currentSpending : null;
    const _earlyMarginTight    = _earlyMarginRatio !== null && _earlyMarginRatio >= 0 && _earlyMarginRatio < 0.08;
    const _earlyMarginModerate = _earlyMarginRatio !== null && _earlyMarginRatio >= 0.08 && _earlyMarginRatio < 0.20;

    // Verdict sentence: focuses on resilience claim and timeline only.
    // Specific £ figures are owned by the hero stat; success rate is in the big number.
    const verdictSentence =
      rate >= 0.95 && _p10DepletesAtYiEarly === null
        ? 'Your plan is resilient across all tested scenarios, including sustained poor returns.' :
      rate >= 0.95 && _lateRisk
        ? `Your plan is secure through the early years, with limited pressure emerging in ${_depStage} in weaker scenarios.` :
      rate >= 0.95
        ? 'Your plan holds well in the large majority of scenarios, with only limited vulnerability at the edges.' :
      rate >= 0.90 && _p10DepletesAtYiEarly === null && _earlyMarginTight
        ? 'Your plan passes, but with limited room to spare. A poor sequence early in retirement would bring it close to its limit.' :
      rate >= 0.90 && _p10DepletesAtYiEarly === null && _earlyMarginModerate
        ? 'Your plan is well-founded and survives intact in 9 out of 10 paths, with modest room above the threshold.' :
      rate >= 0.90 && _p10DepletesAtYiEarly === null
        ? 'Your plan is well-founded and survives intact in 9 out of 10 paths.' :
      rate >= 0.90 && _lateRisk && _earlyMarginTight
        ? `Your plan is solid through the early years with a narrow margin. Risk concentrates in ${_depStage} in weaker scenarios.` :
      rate >= 0.90 && _lateRisk
        ? `Your plan is solid through the early and middle years, with risk concentrated in ${_depStage} in weaker scenarios.` :
      rate >= 0.90
        ? 'Your plan holds in most scenarios, with some vulnerability at the edges.' :
      rate >= 0.80 && _lateRisk
        ? `Your plan works in most scenarios, but a meaningful share of poor sequences lead to depletion in ${_depStage}.` :
      rate >= 0.80
        ? 'Your plan holds in most scenarios but carries real risk in a meaningful share of poor sequences.' :
      _earlyRisk
        ? `Your plan needs attention. Depletion occurs in ${_depStage} across a significant share of simulated paths.` :
        'Your plan needs attention. A significant share of simulated paths end in depletion before retirement ends.';

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
            <div class="mc-vstat-label">Spending headroom</div>
            <div class="mc-vstat-value">Substantial</div>
          </div>`;
      } else if (headroom >= 0) {
        const hr        = roundToNearest(headroom, 500);
        const statLabel = marginTight ? 'Narrow headroom' : 'Typical headroom';
        const statValue = marginTight ? `${warnIcon}+${fmt(hr)} / yr` : `+${fmt(hr)} / yr`;
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
            <div class="mc-vstat-label">Typical shortfall</div>
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
          <div class="mc-verdict-eyebrow">Market-adjusted outlook</div>
          <div class="mc-verdict-eyebrow mc-verdict-eyebrow--right">Success rate</div>
          <div class="mc-verdict-word">${verdictWord}</div>
          <div class="mc-verdict-bignum">${Math.round(rate * 100)}%</div>
        </div>
        <div class="mc-verdict-lower">
          <div class="mc-verdict-lower__left">
            <p class="mc-verdict-sentence">${verdictSentence}</p>
            <div class="mc-verdict-meta">Based on ${r.simCount.toLocaleString('en-GB')} simulations · ${firstYear} – ${lastYear}${_activeState !== 'baseline' ? ' · ' + STATE_LABELS[_activeState] + ' scenario' : ''}</div>
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
      pressureSentence = `In a poor sequence of returns, funds would begin to deplete in ${lifeStage}, when flexibility to adjust is limited.`;
    } else {
      pressureSentence = `No tested sequence of returns depletes the portfolio before the end of the projection.`;
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
        minSurv >= 0.95 ? 'Risk remains low throughout the projection.' :
        minSurv >= 0.80 ? 'No meaningful risk early on. Pressure builds later as withdrawals compound against a smaller asset base.' :
                          'Risk builds significantly. Later years carry real pressure as the portfolio base declines.';
    }

    const s2Left = `
      <div class="mc-evidence-pane mc-evidence-pane--left">
        <div class="mc-section-label">Stress test</div>
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
      l1Outcome = 'Your plan remains sustainable well above current spending.';
    } else if (headroom >= 0) {
      const hr = roundToNearest(headroom, 500);
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = hr >= 500
        ? `Current spending sits inside the ${confPct}% confidence band.`
        : `Your plan is right at the ${confPct}% confidence threshold, with negligible room above.`;
    } else if (roundedGap >= 500) {
      const isSmall = roundedGap / currentSpending <= 0.15;
      l1Pill = isSmall ? 'Modest cut' : 'Cut needed';
      l1PillClass = isSmall ? 'mc-lever-pill--warn' : 'mc-lever-pill--risk';
      l1Outcome = `A reduction brings the plan back inside the ${confPct}% confidence band.`;
    } else {
      // Gap rounds to zero, treat as at threshold
      l1Pill = 'No cut needed'; l1PillClass = 'mc-lever-pill--safe';
      l1Outcome = `Your plan is right at the ${confPct}% confidence threshold, with negligible room above.`;
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
        l2Outcome = `Your plan is already sustainable. Delaying by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} would push success to ${fmtPctB(d.successRate)}.`;
      } else if (effective.length) {
        const d = effective[0];
        l2Pill = `+${d.yearsDelay} yr fixes it`; l2PillClass = 'mc-lever-pill--safe';
        l2Outcome = `Delaying withdrawals by ${d.yearsDelay} year${d.yearsDelay > 1 ? 's' : ''} makes the plan sustainable at ${fmtPctB(d.successRate)} success.`;
      } else {
        const best = delayPerturbations.reduce((a, b) => b.successRate > a.successRate ? b : a);
        l2Pill = 'Helps but not enough'; l2PillClass = 'mc-lever-pill--warn';
        l2Outcome = `Even delaying by 3 years does not fully remove shortfall risk. Best result is ${fmtPctB(best.successRate)}, still below ${confPct}%.`;
      }
    }

    // Lever 3 — Flexible spending
    const iqrWide = p50[lastIdx] > 0
      ? (p75[lastIdx] - p25[lastIdx]) / p50[lastIdx] > 1.5
      : false;
    let l3Pill, l3PillClass, l3Outcome;
    if (iqrWide) {
      l3Pill = 'Material gain'; l3PillClass = 'mc-lever-pill--safe';
      l3Outcome = 'Cutting 10–15% in weak years would meaningfully improve the downside position.';
    } else {
      l3Pill = 'Small gain'; l3PillClass = 'mc-lever-pill--neutral';
      l3Outcome = 'Flexible spending in down years adds a modest incremental improvement.';
    }

    // Is the plan already strong (no action needed)?
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
    let s2Right;
    if (planIsStrong) {
      const items = [];

      // Item 1: Spending — always present, anchors on threshold relationship
      if (sustainableSpending !== null) {
        if (sustainableIsFloor) {
          items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: 'Current spending sits well inside the sustainable range.' });
        } else if (marginTight) {
          items.push({ name: 'Spending', pill: 'Narrow margin', pillClass: 'mc-lever-pill--warn',
            outcome: `Current spending sits just inside the ${confPct}% confidence band.` });
        } else if (marginModerate) {
          items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: `Current spending sits inside the ${confPct}% confidence band, with modest room above.` });
        } else {
          items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
            outcome: `Current spending sits comfortably inside the ${confPct}% confidence band.` });
        }
      } else {
        items.push({ name: 'Spending', pill: 'No cut needed', pillClass: 'mc-lever-pill--safe',
          outcome: 'Current spending passes the confidence test over the full projection.' });
      }

      // Item 2: Consider spending more / Maintain discipline — owns the ceiling £
      const hr = roundToNearest(headroom, 500);
      if (hr > 0) {
        if (marginTight) {
          items.push({ name: 'Consider spending more', pill: 'Not recommended', pillClass: 'mc-lever-pill--warn',
            outcome: 'The buffer is too thin to support an increase without pushing the plan below the threshold.' });
        } else if (marginModerate) {
          const higherSpend = roundToNearest(currentSpending + hr, 500);
          items.push({ name: 'Consider spending more', pill: 'Use with caution', pillClass: 'mc-lever-pill--neutral',
            outcome: `A sustainable ceiling of around ${fmtB(higherSpend)}/yr holds up, but the buffer is moderate. Any increase should be modest and kept under review.` });
        } else {
          const higherSpend = roundToNearest(currentSpending + hr, 500);
          items.push({ name: 'Consider spending more', pill: 'Headroom available', pillClass: 'mc-lever-pill--safe',
            outcome: `A sustainable ceiling of around ${fmtB(higherSpend)}/yr holds up across tested scenarios.` });
        }
      } else if (sustainableIsFloor) {
        items.push({ name: 'Consider spending more', pill: 'Headroom available', pillClass: 'mc-lever-pill--safe',
          outcome: 'The sustainable ceiling sits well above current spending, leaving meaningful room to increase.' });
      } else {
        items.push({ name: 'Consider spending more', pill: 'Not recommended', pillClass: 'mc-lever-pill--neutral',
          outcome: 'Current spending sits at or near the sustainable ceiling.' });
      }

      // Item 3: Flexible spending — owns the flex-rule angle
      items.push({ name: 'Flexible spending', pill: iqrWide ? 'Material gain' : 'Small gain',
        pillClass: iqrWide ? 'mc-lever-pill--safe' : 'mc-lever-pill--neutral',
        outcome: iqrWide
          ? 'Cutting 10 to 15% in weak years would meaningfully improve the downside position.'
          : 'Cutting 10 to 15% in weak years would add incremental cushion.' });

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
            ${leverBlock('Spending',          l1Pill, l1PillClass, l1Outcome, _primary === 0, false)}
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

    const delayMin       = delayPerturbations.find(p => p.successRate >= targetConfidence);
    const delayEffective = !!delayMin;

    if (hasGap) {
      const gap = roundedGap;
      const newTarget = roundToNearest(currentSpending - gap, 500);
      actionLine   = `Reduce annual spending by ${fmtB(gap)} to ${fmtB(newTarget)}.`;
      actionImpact = `This closes the sustainability gap and removes most of the risk in weaker market scenarios.`;
    } else if (rate < targetConfidence && delayEffective) {
      actionLine   = `Delay drawing from your portfolio by ${delayMin.yearsDelay} year${delayMin.yearsDelay > 1 ? 's' : ''}.`;
      actionImpact = `This allows the portfolio to compound without draws and lifts your success rate to ${fmtPctB(delayMin.successRate)}.`;
    } else if (rate < targetConfidence && iqrWide) {
      actionLine   = `Adopt a flexible spending rule.`;
      actionImpact = `Reducing withdrawals by 10 to 15% in down years is the most practical lever available.`;
    } else {
      const hrForAction = sustainableSpending !== null && !sustainableIsFloor && headroom > 0
        ? roundToNearest(headroom, 500) : null;
      if (marginTight && hrForAction) {
        actionLine   = `No changes needed, but headroom is limited at ${fmtB(hrForAction)} per year.`;
        actionImpact = `Maintain your current spending and keep this under annual review. A poor sequence in the early years would consume this margin quickly.`;
      } else if (marginModerate && hrForAction) {
        actionLine   = `No changes needed. You have ${fmtB(hrForAction)} per year of room, though the margin is not wide.`;
        actionImpact = `Any spending increase should be modest and kept under review as market conditions evolve.`;
      } else {
        actionLine   = hrForAction
          ? `No changes needed. You could increase spending by up to ${fmtB(hrForAction)} per year.`
          : `No changes needed.`;
        actionImpact = `Any increase still leaves meaningful margin above the confidence threshold.`;
      }
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

    // Expose nominal median end value for the deterministic metrics badge.
    // Always nominal (no deflation) so calc-render.js can compare apples-to-apples
    // against the raw nominal totalPortfolio from the engine rows.
    window.RetireMCResults = { medianEndPortfolioNominal: r.p50Portfolio[lastIdx] };

    // Helpers for this block
    const roundKend = v => roundToNearest(v, 10000);
    const fmtKendB  = v => fmtB(roundKend(Math.max(0, v)));

    let bulletItems = [];

    if (rate >= 0.95) {
      // Strong: p10 / p50 / p90 end values.
      // These own the tail / typical / upside angle; no repeat of headroom, ceiling, or threshold.
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 outcomes, funds run low around age ${p10DepletesAge}.`);
      } else {
        bulletItems.push(`In the worst 1 in 10 outcomes, the portfolio ends at around ${fmtKendB(p10End)}.`);
      }
      bulletItems.push(`In a typical market, it ends at ${fmtKendB(p50End)}.`);
      bulletItems.push(`Upside scenarios finish at ${fmtKendB(p90End)} or higher.`);
    } else if (rate >= 0.90) {
      // Good: tail behaviour, typical end, sensitivity note.
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 outcomes, funds run low around age ${p10DepletesAge}.`);
      } else {
        bulletItems.push(`In the worst 1 in 10 outcomes, the portfolio ends at around ${fmtKendB(p10End)}.`);
      }
      bulletItems.push(`In a typical market, it ends at ${fmtKendB(p50End)}.`);
      if (_earlyMarginTight || marginTight) {
        bulletItems.push(`A poor early-returns period is the main sensitivity to watch.`);
      } else if (_lateRisk) {
        bulletItems.push(`Risk concentrates in the later years, where flexibility to adjust is more limited.`);
      } else {
        bulletItems.push(`A flexible spending rule would further widen the margin above the threshold.`);
      }
    } else if (rate >= 0.80) {
      // Borderline: consequence of inaction, tail age, typical end.
      bulletItems.push(`Making no change leaves around a 1 in ${Math.max(2, Math.round(1 / Math.max(0.01, 1 - rate)))} chance of serious shortfall by the later years.`);
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 paths, funds run low around age ${p10DepletesAge}.`);
      } else {
        bulletItems.push(`In the worst 1 in 10 paths, the portfolio ends at around ${fmtKendB(p10End)}.`);
      }
      bulletItems.push(`In a typical market, the portfolio reaches ${fmtKendB(p50End)}. The plan works in most scenarios, but not with margin.`);
    } else {
      // At risk: tail age, fix magnitude, combined fix outcome.
      if (p10DepletesAge !== null) {
        bulletItems.push(`In the worst 1 in 10 paths, funds are exhausted by age ${p10DepletesAge}.`);
      } else {
        bulletItems.push(`A significant share of paths end in depletion before retirement ends.`);
      }
      if (hasGap) {
        const newTarget = roundToNearest(currentSpending - roundedGap, 500);
        bulletItems.push(`Cutting to ${fmtB(newTarget)} alone brings success closer to the ${confPct}% threshold.`);
      } else if (p50End > 0) {
        bulletItems.push(`In a typical market, the portfolio reaches ${fmtKendB(p50End)}, but depletion is a likely outcome.`);
      } else {
        bulletItems.push(`A typical market still sees the portfolio depleted before the end of the projection.`);
      }
      if (hasGap && delayEffective) {
        bulletItems.push(`Combining this cut with a ${delayMin.yearsDelay}-year delay lifts success to ${fmtPctB(delayMin.successRate)}.`);
      } else if (delayEffective) {
        bulletItems.push(`A ${delayMin.yearsDelay}-year delay in drawing from the portfolio lifts success to ${fmtPctB(delayMin.successRate)}.`);
      } else {
        bulletItems.push(`A flexible spending rule of 10 to 15% cuts in weak years is the strongest remaining lever.`);
      }
    }

    // Always produce exactly 3 bullets. Slice in case any state pushed more.
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
      <p class="mc-bridge-note">The Plan summary tab shows your inputs and planning assumptions. These simulations test those assumptions across thousands of market scenarios with realistic return variability, showing how your plan holds up when markets don't behave as expected.</p>
      <p class="mc-bridge-note">Use the tabs above to explore charts and tables showing how your plan unfolds year by year under your planning assumptions.</p>`;

    const inflationPct = (_meanInflation * 100).toFixed(1);
    const basisNote = `<p class="mc-basis-note">All £ figures on this tab are in today's money, adjusted for ${inflationPct}% annual inflation.</p>`;

    const staleScenario = _activeState !== 'baseline' ? ` (${STATE_LABELS[_activeState]})` : '';
    const staleBanner = _stale
      ? `<div class="mc-stale-banner">⚠ Based on previous inputs${staleScenario}. Re-run to update.</div>`
      : '';
    el.innerHTML = staleBanner + s1 + basisNote + s23 + s4;

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

    // A re-projection also invalidates all stress results since their inputs
    // have changed. Mark each computed stress state stale too.
    if (stale) {
      STATE_IDS.forEach(id => {
        if (id !== 'baseline' && _results[id]) _staleStates[id] = true;
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

  window.RetireMCRender = { setResults, setStressResult, switchState, render, setReal, showLoader, setStale };

})();
