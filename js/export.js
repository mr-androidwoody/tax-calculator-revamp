/**
 * export.js
 *
 * Assembles a self-contained plan snapshot JSON from live engine state and
 * triggers a browser download. Registers window.RetireExport.
 *
 * Depends on (all must be loaded before this file):
 *   window.RetireMCRender        — via getSnapshot() added to its public API
 *   window.RetireMCAssumptions   — for blended return/vol detail
 *   window.RetireCalc            — for summarisePortfolio()
 *
 * Called by app.js via:
 *   window.RetireExport.exportJSON(state.lastInputs, state.lastResult, state.portfolioAccounts)
 *
 * The export function deliberately does NOT re-run any engine logic. Every
 * value in the output is either read from already-computed state or derived
 * from it with simple arithmetic. The JSON must be reconstructable into the
 * PDF without any engine access.
 *
 * Schema version: 1.1.0
 * — Bump patch for additive fields, minor for structural changes, major for
 *   breaking changes that would prevent an older reader from parsing the file.
 */

(function () {
  'use strict';

  const SCHEMA_VERSION = '1.1.0';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _uuid() {
    // Compact 8-char hex ID — sufficient for report identity, not a true UUID.
    return 'rpt_' + Math.random().toString(16).slice(2, 10);
  }

  function _isoNow() {
    return new Date().toISOString();
  }

  /**
   * Compute decade-by-decade survival rates from the MC result's survivalByYear
   * array. Returns one entry per calendar decade boundary that falls within the
   * simulation range.
   *
   * @param {object} mcResult  — baseline MC result object from mc-worker.js
   * @param {number} p1StartAge — p1's age at simulation start year
   * @returns {Array<{ age_p1_end: number, survival_rate: number }>}
   */
  function _decadeSurvival(mcResult, p1StartAge) {
    if (!mcResult || !mcResult.survivalByYear || !mcResult.years) return [];

    const { survivalByYear, years, simCount } = mcResult;
    const firstYear = years[0];
    const lastYear  = years[years.length - 1];

    // Decade boundaries: next multiple of 10 above firstYear, then every 10y.
    const decadeYears = [];
    const firstDecade = Math.ceil(firstYear / 10) * 10;
    for (let y = firstDecade; y <= lastYear; y += 10) decadeYears.push(y);

    return decadeYears.map(dy => {
      const yi = years.indexOf(dy);
      if (yi === -1) return null;
      const survivalRate = simCount > 0 ? survivalByYear[yi] / simCount : 0;
      const ageP1End = p1StartAge != null ? p1StartAge + (dy - firstYear) : null;
      return { age_p1_end: ageP1End, year: dy, survival_rate: +survivalRate.toFixed(4) };
    }).filter(Boolean);
  }

  /**
   * Compute the terminal portfolio percentiles (last year of simulation).
   *
   * @param {object} mcResult
   * @returns {{ p10, p25, p50, p75, p90 }}
   */
  function _terminalPortfolio(mcResult) {
    if (!mcResult) return { p10: null, p25: null, p50: null, p75: null, p90: null };
    const last = mcResult.years.length - 1;
    return {
      p10: Math.round(mcResult.p10Portfolio[last]),
      p25: Math.round(mcResult.p25Portfolio[last]),
      p50: Math.round(mcResult.p50Portfolio[last]),
      p75: Math.round(mcResult.p75Portfolio[last]),
      p90: Math.round(mcResult.p90Portfolio[last]),
    };
  }

  /**
   * Build the stress_tests block. Each stress scenario has the same MC result
   * shape as baseline. We compute the delta against baseline here.
   *
   * impact_level thresholds (success rate drop):
   *   low      < 5pp
   *   moderate 5–15pp
   *   high     > 15pp
   *
   * @param {object} mcSnapshot — from RetireMCRender.getSnapshot()
   * @returns {object}
   */
  function _buildStressTests(mcSnapshot) {
    const baseline = mcSnapshot.baseline;

    const STRESS_META = {
      sorr: {
        label:       'Sequence risk',
        description: 'Markets fall sharply in the first few years of retirement, before the portfolio has had time to recover.',
      },
      inflation: {
        label:       'High inflation',
        description: 'A prolonged period of high inflation in the early years of retirement, squeezing the real value of withdrawals.',
      },
      lostDecade: {
        label:       'Lost decade',
        description: 'Near-zero real growth for a decade at some point during retirement, limiting the portfolio\'s ability to compound.',
      },
    };

    const STRESS_INTERPRETATIONS = {
      sorr: {
        low:      'This scenario has little effect on the overall outlook. The plan is resilient to an early market fall at current spending.',
        moderate: 'An early market fall reduces portfolio value materially. In most scenarios the plan still holds, but the buffer is thinner and spending flexibility matters more.',
        high:     'An early market fall is this plan\'s most significant vulnerability. A poor start to retirement meaningfully increases the risk of running short.',
      },
      inflation: {
        low:      'Higher inflation has a modest effect here. State Pension indexing from age 67 provides meaningful protection.',
        moderate: 'Higher inflation erodes purchasing power steadily. State Pension indexing provides partial protection from age 67, but the earlier years are more exposed.',
        high:     'Sustained high inflation is a serious risk for this plan. The real value of withdrawals is squeezed throughout retirement.',
      },
      lostDecade: {
        low:      'A decade of low growth has limited impact. The portfolio still compounds enough to support the plan through the period.',
        moderate: 'Sustained low growth is a testing scenario. Spending flexibility would provide meaningful protection if this environment persisted.',
        high:     'Sustained low growth is the most challenging scenario for this plan. The portfolio\'s ability to compound is significantly reduced.',
      },
    };

    const out = {};

    ['sorr', 'inflation', 'lostDecade'].forEach(id => {
      const r = mcSnapshot[id];
      const meta = STRESS_META[id];
      const interps = STRESS_INTERPRETATIONS[id];

      if (!r) {
        // Scenario was not run — record as null so the PDF can show "not tested".
        out[id] = {
          id,
          label:       meta.label,
          description: meta.description,
          run:         false,
          success_rate:       null,
          success_rate_delta: null,
          terminal_portfolio_p10: null,
          terminal_portfolio_p50: null,
          earliest_depletion_year: null,
          impact_level:   null,
          interpretation: null,
        };
        return;
      }

      const baselineRate = baseline ? baseline.successRate : null;
      const delta = baselineRate !== null ? r.successRate - baselineRate : null;
      const absDelta = delta !== null ? Math.abs(delta) : null;

      const impactLevel =
        absDelta === null  ? null      :
        absDelta < 0.05    ? 'low'     :
        absDelta < 0.15    ? 'moderate': 'high';

      const term = _terminalPortfolio(r);

      out[id] = {
        id,
        label:       meta.label,
        description: meta.description,
        run:         true,
        success_rate:            +r.successRate.toFixed(4),
        success_rate_delta:      delta !== null ? +delta.toFixed(4) : null,
        terminal_portfolio_p10:  term.p10,
        terminal_portfolio_p50:  term.p50,
        earliest_depletion_year: r.earliestDepletion || null,
        impact_level:            impactLevel,
        interpretation:          impactLevel ? interps[impactLevel] : null,
      };
    });

    return out;
  }

  /**
   * Build the assumptions block from mc-assumptions.js detail and inputs.
   *
   * @param {object} inputs            — from gatherInputs()
   * @param {object} portfolioAccounts — state.portfolioAccounts
   * @param {object} mcDetail          — from RetireMCAssumptions.getMCAssumptionsDetail()
   * @returns {object}
   */
  function _buildAssumptions(inputs, portfolioAccounts, mcDetail) {
    const alloc = window.RetireCalc
      ? window.RetireCalc.summarisePortfolio(portfolioAccounts).overallAllocation
      : { equities: 0, bonds: 0, cashlike: 0, cash: 0 };

    return {
      headline: 'Long-term moderate investment growth, steady inflation, and broadly unchanged UK tax rules.',

      key: [
        {
          id:            'returns',
          label:         'Investment returns',
          value_display: '6.5% equities, 4.0% bonds, 2.5% cashlike (nominal, gross of fees)',
          source:        'Vanguard Capital Markets Model 2024, BlackRock CMA 2024',
          why_it_matters: 'Returns drive portfolio growth. Lower returns reduce available headroom throughout retirement.',
        },
        {
          id:            'fees',
          label:         'Annual platform and fund costs',
          value_display: ((mcDetail?.annualFee ?? 0.0022) * 100).toFixed(2) + '% blended',
          source:        'Vanguard SIPP/ISA and Trading 212 blended estimate',
          why_it_matters: 'Fees are deducted from returns every year. A small difference compounds significantly over a long retirement.',
        },
        {
          id:            'inflation',
          label:         'Inflation',
          value_display: ((inputs.inflation ?? 0.025) * 100).toFixed(1) + '% per year',
          why_it_matters: 'Inflation erodes the real value of fixed income sources and raises the cost of your target spending over time.',
        },
        {
          id:            'inflation_vol',
          label:         'Inflation variability',
          value_display: '1.5% standard deviation',
          why_it_matters: 'Inflation does not move in a straight line. This captures the risk of sustained higher inflation periods.',
        },
        {
          id:            'portfolio_vol',
          label:         'Portfolio volatility',
          value_display: mcDetail ? (mcDetail.vol * 100).toFixed(1) + '% blended annualised' : 'Blended from asset class weights and correlations',
          why_it_matters: 'Market returns vary year to year. Higher volatility increases the range of outcomes, especially in early retirement.',
        },
        {
          id:            'spending',
          label:         'Spending pattern',
          value_display: 'Constant real terms' + (inputs.stepDownPct > 0 ? ', stepping down ' + inputs.stepDownPct + '% at age 75' : ''),
          why_it_matters: 'Spending is held flat in real terms then reduced, reflecting typical later-retirement patterns. A different profile would change outcomes.',
        },
        {
          id:            'tax',
          label:         'UK tax rules',
          value_display: '2025/26 legislation, thresholds ' + (inputs.thresholdMode === 'frozen' ? 'frozen' : 'uprated from ' + (inputs.thresholdFromYear || '')),
          why_it_matters: 'Income tax, CGT, and allowances are modelled on current rules. Any future changes are not captured.',
        },
        {
          id:            'simulation_method',
          label:         'Simulation method',
          value_display: 'Monte Carlo, 10,000 paths, i.i.d. log-normal returns',
          why_it_matters: 'Each path draws returns independently each year. This is the standard approach for personal retirement planning but does not capture mean reversion or structural regime shifts.',
        },
        {
          id:            'withdrawal_mode',
          label:         'MC withdrawal approximation',
          value_display: 'Tax-aware (simplified from full four-strategy deterministic engine)',
          why_it_matters: 'The Monte Carlo engine uses a simplified two-mode withdrawal system. All four deterministic strategies map to the tax-aware mode. Results are comparable but not identical to the deterministic projection.',
        },
      ],

      detail: {
        asset_class_returns_nominal_gross: {
          global_equities: 0.065,
          global_bonds:    0.040,
          cashlike:        0.025,
          cash:            0.000,
        },
        asset_class_volatility: {
          global_equities: 0.160,
          global_bonds:    0.070,
          cashlike:        0.015,
          cash:            0.000,
        },
        correlations: {
          equities_bonds:    0.00,
          equities_cashlike: 0.00,
          bonds_cashlike:    0.20,
        },
        annual_fee:         mcDetail?.annualFee    ?? 0.0022,
        inflation_vol:      0.015,
        sim_count:          10000,
        blended_gross_return: mcDetail ? +mcDetail.grossReturn.toFixed(4) : null,
        blended_net_return:   mcDetail ? +mcDetail.netReturn.toFixed(4)   : null,
        blended_vol:          mcDetail ? +mcDetail.vol.toFixed(4)         : null,
        geometric_mean:       mcDetail ? +mcDetail.geometricMean.toFixed(4): null,
        portfolio_allocation: {
          equity_pct:   Math.round(alloc.equities  || 0),
          bond_pct:     Math.round(alloc.bonds     || 0),
          cashlike_pct: Math.round(alloc.cashlike  || 0),
          cash_pct:     Math.round(alloc.cash      || 0),
        },
      },
    };
  }

  /**
   * Build the plan block from inputs and portfolioAccounts.
   * Mirrors gatherInputs() output shape, with display-friendly field names.
   *
   * @param {object} inputs
   * @param {Array}  portfolioAccounts
   * @returns {object}
   */
  function _buildPlan(inputs, portfolioAccounts) {
    const intAccts = (portfolioAccounts || [])
      .filter(a => a.rate != null || a.monthlyDraw != null)
      .map(a => ({
        name:         a.name || '(unnamed)',
        owner:        a.owner,
        wrapper:      a.wrapper,
        balance:      a.value || 0,
        rate:         a.rate  || 0,
        monthly_draw: a.monthlyDraw || 0,
      }));

    const strategyLabels = {
      balanced:  'Tax Band Optimiser',
      isaFirst:  'Pension Preservation',
      sippFirst: 'Pension Front-Loading',
      taxMin:    'Allowance Maximiser',
    };

    return {
      start_year: inputs.startYear,
      end_year:   inputs.endYear,
      spending_target_net:     inputs.spending,
      step_down_pct:           inputs.stepDownPct,
      inflation_rate:          inputs.inflation,
      growth_rate_deterministic: inputs.growth,
      mgmt_fee:                0.0022,
      strategy:                inputs.strategy,
      strategy_label:          strategyLabels[inputs.strategy] || inputs.strategy,
      threshold_mode:          inputs.thresholdMode,
      threshold_from_year:     inputs.thresholdFromYear || null,
      dividend_yield:          inputs.dividendYield,
      dividend_mode:           inputs.dividendMode,

      p1: {
        name:       inputs.p1name,
        dob_year:   inputs.p1DOB,
        sp_age:     inputs.p1SPAge,
        sp_annual_gross: inputs.p1SPAmt,
        salary:          inputs.p1Salary,
        salary_stop_age: inputs.p1SalaryStop || null,
        sweep_surplus:   inputs.p1SweepSurplus,
        starting_balances: {
          Cash:    inputs.p1Bal.Cash    || 0,
          GIAeq:   inputs.p1Bal.GIAeq  || 0,
          GIAcash: inputs.p1Bal.GIAcash || 0,
          SIPP:    inputs.p1Bal.SIPP   || 0,
          ISA:     inputs.p1Bal.ISA    || 0,
        },
      },

      p2: inputs.p2enabled ? {
        name:       inputs.p2name,
        dob_year:   inputs.p2DOB,
        sp_age:     inputs.p2SPAge,
        sp_annual_gross: inputs.p2SPAmt,
        salary:          inputs.p2Salary,
        salary_stop_age: inputs.p2SalaryStop || null,
        sweep_surplus:   inputs.p2SweepSurplus,
        starting_balances: {
          Cash:    inputs.p2Bal.Cash    || 0,
          GIAeq:   inputs.p2Bal.GIAeq  || 0,
          GIAcash: inputs.p2Bal.GIAcash || 0,
          SIPP:    inputs.p2Bal.SIPP   || 0,
          ISA:     inputs.p2Bal.ISA    || 0,
        },
      } : null,

      p2_enabled: inputs.p2enabled,

      bed_and_isa: {
        enabled:     inputs.bniEnabled,
        p1_gia_annual: inputs.bniP1GIA  || 0,
        p1_years:      inputs.bniP1Years || 0,
        p2_gia_annual: inputs.bniP2GIA  || 0,
        p2_years:      inputs.bniP2Years || 0,
      },

      interest_accounts: intAccts,
    };
  }

  /**
   * Build the results block from the deterministic engine output and MC baseline.
   *
   * @param {object} inputs
   * @param {object} engineResult  — { rows, depletions, annotations }
   * @param {object} mcSnapshot    — from RetireMCRender.getSnapshot()
   * @returns {object}
   */
  function _buildResults(inputs, engineResult, mcSnapshot) {
    const { rows, depletions, annotations } = engineResult;
    const mc = mcSnapshot.baseline;
    const sc = mcSnapshot.spendingContext || {};

    // ── Verdict from MC success rate ────────────────────────────────────────
    const rate = mc ? mc.successRate : null;
    const verdict =
      rate === null  ? null         :
      rate >= 0.95   ? 'On track'   :
      rate >= 0.90   ? 'On track, but tight' :
      rate >= 0.80   ? 'Borderline' : 'At risk';

    const verdictSummary = rate === null ? null
      : `Your plan has a ${Math.round(rate * 100)}% likelihood of holding up throughout retirement under tested scenarios.`;

    // ── Terminal portfolio percentiles ──────────────────────────────────────
    const terminalPortfolio = _terminalPortfolio(mc);

    // ── Sustainable spending ────────────────────────────────────────────────
    const sustainableSpending = sc.sustainableSpending != null
      ? { amount: Math.round(sc.sustainableSpending), is_floor: !!sc.sustainableIsFloor }
      : null;

    // ── Headroom ────────────────────────────────────────────────────────────
    const headroom = (sustainableSpending && sc.currentSpending)
      ? Math.round(sustainableSpending.amount - sc.currentSpending)
      : null;

    // ── Sensitivity (simple heuristic from headroom ratio) ──────────────────
    let sensitivity = null;
    if (headroom !== null && sc.currentSpending > 0) {
      const ratio = headroom / sc.currentSpending;
      sensitivity = ratio < 0.08 ? 'high' : ratio < 0.20 ? 'moderate' : 'low';
    }

    // ── Survival by decade ──────────────────────────────────────────────────
    const p1StartAge = mc && mc.p1StartAge != null ? mc.p1StartAge
      : (inputs.p1DOB && inputs.startYear ? inputs.startYear - inputs.p1DOB : null);
    const survivalByDecade = mc ? _decadeSurvival(mc, p1StartAge) : [];

    // ── Annual rows from deterministic engine ───────────────────────────────
    // Join MC percentile arrays by year index for chart reconstruction.
    const mcYears = mc ? mc.years : [];
    const annualRows = rows.map(row => {
      const mcYi = mcYears.indexOf(row.year);
      return {
        year:    row.year,
        p1_age:  row.p1Age,
        p2_age:  row.p2Age,
        target:  row.target,

        // Income sources
        p1_sp:      row.p1SP,
        p2_sp:      row.p2SP,
        p1_salary:  row.p1SalInc,
        p2_salary:  row.p2SalInc,
        p1_int_draw: row.p1IntDraw,
        p2_int_draw: row.p2IntDraw,
        p1_divs:    row.p1DivsUsed,
        p2_divs:    row.p2DivsUsed,

        // Drawn from wrappers
        p1_drawn: {
          GIA:          row.p1Drawn?.GIA          || 0,
          SIPP:         row.p1Drawn?.SIPP         || 0,
          ISA:          row.p1Drawn?.ISA          || 0,
          Cash:         row.p1Drawn?.Cash         || 0,
          sipp_taxable: row.p1Drawn?.sippTaxable  || 0,
        },
        p2_drawn: {
          GIA:          row.p2Drawn?.GIA          || 0,
          SIPP:         row.p2Drawn?.SIPP         || 0,
          ISA:          row.p2Drawn?.ISA          || 0,
          Cash:         row.p2Drawn?.Cash         || 0,
          sipp_taxable: row.p2Drawn?.sippTaxable  || 0,
        },

        // Tax
        p1_income_tax: row.p1IncomeTax || 0,
        p2_income_tax: row.p2IncomeTax || 0,
        p1_cgt:        row.p1CGT       || 0,
        p2_cgt:        row.p2CGT       || 0,
        p1_ni:         row.p1NI        || 0,
        p2_ni:         row.p2NI        || 0,

        // Household totals
        household_gross_income:  row.householdGrossIncome,
        household_tax:           row.householdTax,
        household_net_cashflow:  row.householdNetCashflow,
        cashflow_shortfall:      row.cashflowShortfall,
        cashflow_surplus:        row.cashflowSurplus,

        // Portfolio
        total_portfolio: row.totalPortfolio,
        cum_infl:        +row.cumInfl.toFixed(6),
        real_deflator:   +row.realDeflator.toFixed(6),

        // Wrapper balances (end of year)
        snap: {
          p1_cash:    row.snap.p1Cash    || 0,
          p1_int_bal: row.snap.p1IntBal  || 0,
          p1_gia:     row.snap.p1GIA     || 0,
          p1_sipp:    row.snap.p1SIPP    || 0,
          p1_isa:     row.snap.p1ISA     || 0,
          p2_cash:    row.snap.p2Cash    || 0,
          p2_int_bal: row.snap.p2IntBal  || 0,
          p2_gia:     row.snap.p2GIA     || 0,
          p2_sipp:    row.snap.p2SIPP    || 0,
          p2_isa:     row.snap.p2ISA     || 0,
        },

        // MC percentile overlay (null if MC not run or year not in MC range)
        mc_p10: mcYi !== -1 ? Math.round(mc.p10Portfolio[mcYi]) : null,
        mc_p25: mcYi !== -1 ? Math.round(mc.p25Portfolio[mcYi]) : null,
        mc_p50: mcYi !== -1 ? Math.round(mc.p50Portfolio[mcYi]) : null,
        mc_p75: mcYi !== -1 ? Math.round(mc.p75Portfolio[mcYi]) : null,
        mc_p90: mcYi !== -1 ? Math.round(mc.p90Portfolio[mcYi]) : null,
      };
    });

    return {
      verdict,
      verdict_summary:     verdictSummary,
      success_rate:        rate !== null ? +rate.toFixed(4) : null,
      sim_count:           mc ? mc.simCount : null,
      plan_years:          rows.length,
      earliest_depletion_year: mc ? mc.earliestDepletion : null,
      terminal_portfolio:  terminalPortfolio,
      sustainable_spending: sustainableSpending,
      headroom,
      sensitivity,
      delay_perturbations: sc.delayPerturbations || [],
      survival_by_decade:  survivalByDecade,
      annual_rows:         annualRows,
    };
  }

  /**
   * Build the narrative block from the snapshot stashed by mc-render.js.
   * If getSnapshot() returns no narrativeSnapshot, all fields are null.
   *
   * @param {object} mcSnapshot — from RetireMCRender.getSnapshot()
   * @returns {object}
   */
  function _buildNarrative(mcSnapshot) {
    const n = mcSnapshot.narrativeSnapshot || {};
    return {
      verdict_state:         n.verdictWord         || null,
      verdict_sentence:      n.verdictSentence     || null,
      pressure_sentence:     n.pressureSentence    || null,
      survival_note:         n.survivalNote        || null,
      lever_spending_pill:   n.l1Pill              || null,
      lever_spending_outcome: n.l1Outcome          || null,
      lever_delay_pill:      n.l2Pill              || null,
      lever_delay_outcome:   n.l2Outcome           || null,
      lever_flex_pill:       n.l3Pill              || null,
      lever_flex_outcome:    n.l3Outcome           || null,
      action_line:           n.actionLine          || null,
      action_impact:         n.actionImpact        || null,
      bullet_items:          n.bulletItems         || [],
    };
  }

  // ── Main export function ───────────────────────────────────────────────────

  /**
   * Assemble the plan snapshot and generate a PDF download.
   *
   * @param {object} inputs            — state.lastInputs from app.js
   * @param {object} engineResult      — state.lastResult from app.js
   * @param {Array}  portfolioAccounts — state.portfolioAccounts from app.js
   */
  async function exportJSON(inputs, engineResult, portfolioAccounts) {
    if (!inputs || !engineResult) {
      console.warn('RetireExport: no projection result available');
      return;
    }

    // ── Button loading state ───────────────────────────────────────────────
    const exportBtn = document.getElementById('btn-export-plan');
    const originalLabel = exportBtn ? exportBtn.textContent.trim() : 'Export plan ↓';
    if (exportBtn) {
      exportBtn.textContent = 'Generating PDF…';
      exportBtn.disabled = true;
    }

    function resetBtn() {
      if (!exportBtn) return;
      exportBtn.textContent = originalLabel;
      exportBtn.disabled = false;
    }

    try {
      // ── MC snapshot ──────────────────────────────────────────────────────
      const MCR = window.RetireMCRender;
      const mcSnapshot = MCR && MCR.getSnapshot ? MCR.getSnapshot() : {
        baseline: null, sorr: null, inflation: null, lostDecade: null,
        spendingContext: null, meanInflation: 0.025, narrativeSnapshot: null,
      };

      // ── MC assumptions detail ────────────────────────────────────────────
      const MCASSUME = window.RetireMCAssumptions;
      const alloc = window.RetireCalc
        ? window.RetireCalc.summarisePortfolio(portfolioAccounts).overallAllocation
        : { equities: 0, bonds: 0, cashlike: 0, cash: 0 };
      const mcDetail = MCASSUME
        ? MCASSUME.getMCAssumptionsDetail(
            alloc.equities  || 0,
            alloc.bonds     || 0,
            alloc.cashlike  || 0,
            alloc.cash      || 0,
          )
        : null;

      // ── Assemble snapshot ────────────────────────────────────────────────
      const snapshot = {
        schema_version: SCHEMA_VERSION,
        generated_at:   _isoNow(),
        report_id:      _uuid(),

        meta: {
          report_title: 'Retirement Plan Report',
          persons: [
            { ref: 'p1', name: inputs.p1name, dob_year: inputs.p1DOB },
            ...(inputs.p2enabled ? [{ ref: 'p2', name: inputs.p2name, dob_year: inputs.p2DOB }] : []),
          ],
          plan_start_year:    inputs.startYear,
          plan_end_year:      inputs.endYear,
          currency:           'GBP',
          real_or_nominal:    'nominal',
          withdrawal_strategy: inputs.strategy,
          mc_run:             !!mcSnapshot.baseline,
          stress_runs: {
            sorr:       !!mcSnapshot.sorr,
            inflation:  !!mcSnapshot.inflation,
            lostDecade: !!mcSnapshot.lostDecade,
          },
        },

        assumptions: _buildAssumptions(inputs, portfolioAccounts, mcDetail),
        plan:        _buildPlan(inputs, portfolioAccounts),
        results:     _buildResults(inputs, engineResult, mcSnapshot),
        stress_tests: mcSnapshot.baseline ? _buildStressTests(mcSnapshot) : null,
        narrative:   _buildNarrative(mcSnapshot),
        depletions:  engineResult.depletions  || {},
        annotations: engineResult.annotations || [],
      };

      // ── Capture live chart canvases ──────────────────────────────────────
      // Wealth chart (portfolio fan) → page 3
      // Income chart (withdrawal sources) → page 4
      const chartCanvases = {
        wealth: document.getElementById('wealthChart') || null,
        income: document.getElementById('incomeChart') || null,
      };

      // ── Generate PDF ─────────────────────────────────────────────────────
      await window.RetirePDFRender.generate(snapshot, chartCanvases);

    } catch (err) {
      console.error('RetireExport PDF error:', err);
    } finally {
      resetBtn();
    }
  }

  /**
   * Hidden debug export — downloads the raw plan snapshot as JSON.
   * Triggered by Ctrl+J in app.js. Works even if MC has not been run.
   */
  function exportRawJSON(inputs, engineResult, portfolioAccounts) {
    if (!inputs || !engineResult) {
      console.warn('RetireExport: no projection result available');
      return;
    }

    const MCR = window.RetireMCRender;
    const mcSnapshot = MCR && MCR.getSnapshot ? MCR.getSnapshot() : {
      baseline: null, sorr: null, inflation: null, lostDecade: null,
      spendingContext: null, meanInflation: 0.025, narrativeSnapshot: null,
    };

    const MCASSUME = window.RetireMCAssumptions;
    const alloc = window.RetireCalc
      ? window.RetireCalc.summarisePortfolio(portfolioAccounts).overallAllocation
      : { equities: 0, bonds: 0, cashlike: 0, cash: 0 };
    const mcDetail = MCASSUME
      ? MCASSUME.getMCAssumptionsDetail(
          alloc.equities  || 0,
          alloc.bonds     || 0,
          alloc.cashlike  || 0,
          alloc.cash      || 0,
        )
      : null;

    const snapshot = {
      schema_version: SCHEMA_VERSION,
      generated_at:   _isoNow(),
      report_id:      _uuid(),
      meta: {
        report_title: 'Retirement Plan Report',
        persons: [
          { ref: 'p1', name: inputs.p1name, dob_year: inputs.p1DOB },
          ...(inputs.p2enabled ? [{ ref: 'p2', name: inputs.p2name, dob_year: inputs.p2DOB }] : []),
        ],
        plan_start_year:     inputs.startYear,
        plan_end_year:       inputs.endYear,
        currency:            'GBP',
        real_or_nominal:     'nominal',
        withdrawal_strategy: inputs.strategy,
        mc_run:              !!mcSnapshot.baseline,
        stress_runs: {
          sorr:       !!mcSnapshot.sorr,
          inflation:  !!mcSnapshot.inflation,
          lostDecade: !!mcSnapshot.lostDecade,
        },
      },
      assumptions:  _buildAssumptions(inputs, portfolioAccounts, mcDetail),
      plan:         _buildPlan(inputs, portfolioAccounts),
      results:      _buildResults(inputs, engineResult, mcSnapshot),
      stress_tests: mcSnapshot.baseline ? _buildStressTests(mcSnapshot) : null,
      narrative:    _buildNarrative(mcSnapshot),
      depletions:   engineResult.depletions  || {},
      annotations:  engineResult.annotations || [],
    };

    const date  = new Date().toISOString().slice(0, 10);
    const names = [inputs.p1name, inputs.p2enabled ? inputs.p2name : null]
      .filter(Boolean).map(n => n.replace(/\s+/g, '-')).join('-');
    const filename = `incomeflow-snapshot-${names}-${date}.json`;

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.info('RetireExport: snapshot downloaded as', filename);
  }

  window.RetireExport = { exportJSON, exportRawJSON };

})();