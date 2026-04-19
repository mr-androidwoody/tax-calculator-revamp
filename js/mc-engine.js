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

  // Track the currently active worker so we can terminate it if a new run is
  // requested before the previous one finishes.
  let _activeWorker = null;

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

  window.RetireMCEngine = { run, cancel };
})();
