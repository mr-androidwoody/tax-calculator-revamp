/**
 * mc-engine.js
 *
 * Main-thread coordinator for Monte Carlo simulation.
 * Registers window.RetireMCEngine.
 *
 * Responsibilities:
 *   - Spawn mc-worker.js in a Web Worker
 *   - Post { inputs, simCount, equityVol, inflationVol } to it
 *   - Forward progress messages to an optional onProgress callback
 *   - Resolve the returned Promise with the finished result object
 *   - Enforce a single active run (abort any in-flight run before starting a new one)
 *
 * Usage (called from app.js runProjection):
 *
 *   const result = await window.RetireMCEngine.run({
 *     inputs,           // gatherInputs() output — passed straight through to worker
 *     simCount,         // default 10 000
 *     equityVol,        // annualised equity return std-dev, e.g. 0.12
 *     inflationVol,     // annualised inflation std-dev, e.g. 0.015
 *     onProgress,       // optional (pct: number) => void — called ~every 500 paths
 *   });
 *   // result: { mode, simCount, years, p10Portfolio, p25Portfolio, p50Portfolio,
 *   //           p75Portfolio, p90Portfolio, successRate, medianTotalTax }
 *
 * The worker file is resolved relative to this script's own URL so the path
 * works regardless of subdirectory depth on GitHub Pages.
 */

(function () {
  'use strict';

  // ── Resolve worker path relative to this script ──────────────────────────
  // document.currentScript is available during synchronous IIFE execution.
  // We strip the filename and append mc-worker.js so the path is always correct
  // regardless of how the app is served (root, /subdir/, etc.).
  const _scriptSrc = (document.currentScript || {}).src || '';
  const WORKER_URL  = _scriptSrc
    ? _scriptSrc.replace(/\/[^/]+$/, '/mc-worker.js')
    : 'js/mc-worker.js'; // fallback for environments where currentScript is null

  const DEFAULT_SIM_COUNT = 10_000;
  const STRESS_SIM_COUNT  = 2_500;

  // Track the currently active workers so we can terminate on demand.
  // Baseline and stress runs use separate slots so neither aborts the other.
  let _activeWorker       = null;
  let _activeStressWorker = null;

  /**
   * Run a Monte Carlo simulation.
   *
   * @param {object} opts
   * @param {object}   opts.inputs       — gatherInputs() output
   * @param {number}  [opts.simCount]    — number of paths (default 10 000)
   * @param {number}   opts.equityVol    — annualised equity vol as decimal
   * @param {number}   opts.inflationVol — annualised inflation vol as decimal
   * @param {function} [opts.onProgress] — (pct: number) => void
   * @returns {Promise<object>} — resolves with the result from mc-worker.js
   */
  function run({ inputs, simCount, equityVol, inflationVol, mcGrowth, onProgress }) {
    // Abort any previous in-flight run immediately.
    if (_activeWorker) {
      _activeWorker.terminate();
      _activeWorker = null;
    }

    const count = simCount ?? DEFAULT_SIM_COUNT;

    return new Promise((resolve, reject) => {
      let worker;

      try {
        worker = new Worker(WORKER_URL);
      } catch (err) {
        reject(new Error(
          'Failed to start Monte Carlo worker. ' +
          'Check that mc-worker.js is deployed alongside mc-engine.js. ' +
          '(' + err.message + ')'
        ));
        return;
      }

      _activeWorker = worker;

      worker.onmessage = function (e) {
        const msg = e.data;

        if (msg.type === 'progress') {
          if (typeof onProgress === 'function') {
            try { onProgress(msg.pct); } catch (_) { /* never let UI errors kill the run */ }
          }
          return;
        }

        if (msg.type === 'done') {
          _activeWorker = null;
          worker.terminate();
          resolve(msg.result);
          return;
        }

        // Unknown message type — ignore; do not reject (worker may post diagnostics later).
      };

      worker.onerror = function (e) {
        _activeWorker = null;
        worker.terminate();
        reject(new Error(
          'Monte Carlo worker error: ' + (e.message || 'unknown error') +
          (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')
        ));
      };

      // Fire the simulation.
      worker.postMessage({ inputs, simCount: count, equityVol, inflationVol, mcGrowth });
    });
  }

  /**
   * Cancel any in-flight Monte Carlo run immediately.
   * Safe to call even when no run is active.
   */
  function cancel() {
    if (_activeWorker) {
      _activeWorker.terminate();
      _activeWorker = null;
    }
  }

  /**
   * Run a named stress-test Monte Carlo simulation.
   *
   * Stress tests share the same worker code as the baseline but alter the
   * sampling distribution for a defined window of years. Each stress run
   * uses a separate worker slot so it cannot abort an in-flight baseline run.
   *
   * @param {string} stressId — 'sorr' | 'inflation' | 'lostDecade'
   * @param {object} opts     — same shape as run() opts (inputs, equityVol, inflationVol, mcGrowth, onProgress)
   * @returns {Promise<object>} — same result shape as run(), plus stressMode field
   */
  function runStress({ stressId, inputs, equityVol, inflationVol, mcGrowth, onProgress }) {
    // Abort any previous in-flight stress run.
    if (_activeStressWorker) {
      _activeStressWorker.terminate();
      _activeStressWorker = null;
    }

    // Lost decade: fix the shock window once per run on the main thread so
    // all 2,500 paths share the same decade window (consistent presentation).
    const numYears = inputs.endYear - inputs.startYear + 1;
    let stressParams = null;
    if (stressId === 'lostDecade') {
      // Window can start any year from 0 up to numYears-10 (inclusive).
      const maxStart = Math.max(0, numYears - 10);
      stressParams = { lostDecadeStart: Math.floor(Math.random() * (maxStart + 1)) };
    }

    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(WORKER_URL);
      } catch (err) {
        reject(new Error(
          'Failed to start stress-test worker. ' +
          'Check that mc-worker.js is deployed alongside mc-engine.js. ' +
          '(' + err.message + ')'
        ));
        return;
      }

      _activeStressWorker = worker;

      worker.onmessage = function (e) {
        const msg = e.data;
        if (msg.type === 'progress') {
          if (typeof onProgress === 'function') {
            try { onProgress(msg.pct); } catch (_) { /* never let UI errors kill the run */ }
          }
          return;
        }
        if (msg.type === 'done') {
          _activeStressWorker = null;
          worker.terminate();
          resolve(msg.result);
          return;
        }
      };

      worker.onerror = function (e) {
        _activeStressWorker = null;
        worker.terminate();
        reject(new Error(
          'Stress-test worker error: ' + (e.message || 'unknown error') +
          (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')
        ));
      };

      worker.postMessage({
        inputs,
        simCount:    STRESS_SIM_COUNT,
        equityVol,
        inflationVol,
        mcGrowth,
        stressMode:  stressId,
        stressParams,
      });
    });
  }

  /**
   * Cancel any in-flight stress-test run immediately.
   * Safe to call even when no run is active.
   */
  function cancelStress() {
    if (_activeStressWorker) {
      _activeStressWorker.terminate();
      _activeStressWorker = null;
    }
  }

  window.RetireMCEngine = { run, cancel, runStress, cancelStress };
})();
