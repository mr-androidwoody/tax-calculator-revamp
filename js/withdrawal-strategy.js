(function () {
  const C = window.RetireCalc;
  const L = window.RetireLedger;

  // ─────────────────────────────────────────────────────────────────────────
  // withdrawalStrategy
  //
  // Strategy intents:
  //   balanced  — draw SIPP up to min(basicRateCap, shortfall); GIA/ISA fill
  //               remainder dynamically. Paces pension draw to spending need.
  //   isaFirst  — preserve pension; draw ISA unconditionally first, GIA fallback,
  //               SIPP only to fill any remaining PA headroom.
  //   sippFirst — aggressively deplete pension; draw SIPP to full basic-rate
  //               ceiling even if it exceeds spending need, recycling surplus
  //               into ISA. GIA fills any residual gap.
  // ─────────────────────────────────────────────────────────────────────────

  const SIPP_TAXABLE_RATIO = C.SIPP_TAXABLE_RATIO; // 0.75

  function zero() {
    return { GIA: 0, SIPP: 0, ISA: 0, Cash: 0, sippTaxable: 0 };
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  function sippBasicRateCap(ledger, sippBal) {
    const paRoom      = ledger.paRemaining;
    const bandRoom    = ledger.basicBandRemaining;
    const sippForPA   = paRoom   > 0 ? paRoom   / SIPP_TAXABLE_RATIO : 0;
    const sippForBand = bandRoom > 0 ? bandRoom / SIPP_TAXABLE_RATIO : 0;
    return Math.min(sippForPA + sippForBand, sippBal || 0);
  }

  function sippPACap(ledger, sippBal) {
    const paRoom = ledger.paRemaining;
    if (paRoom <= 0) return 0;
    return Math.min(paRoom / SIPP_TAXABLE_RATIO, sippBal || 0);
  }

  function mergeDraw(target, source) {
    target.GIA         += source.GIA         || 0;
    target.SIPP        += source.SIPP        || 0;
    target.ISA         += source.ISA         || 0;
    target.sippTaxable += source.sippTaxable || 0;
  }

  function drawnTotal(d) {
    return (d.GIA || 0) + (d.SIPP || 0) + (d.ISA || 0);
  }

  // ISA-first draw: unconditionally prefers ISA, falls back to GIA.
  // No tax-efficiency check — ISA is always the first choice.
  function drawISAorGIA(bal, amount) {
    if (amount <= 0) return zero();
    const drawn   = zero();
    const fromISA = Math.min(bal.ISA || 0, amount);
    drawn.ISA = fromISA;
    bal.ISA  -= fromISA;
    const rem = amount - fromISA;
    if (rem > 0 && (bal.GIA || 0) > 0) {
      const fromGIA = Math.min(bal.GIA, rem);
      drawn.GIA = fromGIA;
      bal.GIA  -= fromGIA;
    }
    return drawn;
  }

  // GIA-first draw: prefers GIA within basic/0% CGT, falls back to ISA.
  // Used by balanced and sippFirst.
  function drawGIAorISA(bal, amount, ledger, gainRatio) {
    if (amount <= 0) return zero();
    const drawn        = zero();
    const rate         = L.marginalGIARate(ledger, gainRatio);
    const giaEfficient = rate < ledger._TAX.cgtRates.higher;

    if (giaEfficient && (bal.GIA || 0) > 0) {
      const fromGIA = Math.min(bal.GIA, amount);
      drawn.GIA = fromGIA;
      bal.GIA  -= fromGIA;
      const rem = amount - fromGIA;
      if (rem > 0 && (bal.ISA || 0) > 0) {
        const fromISA = Math.min(bal.ISA, rem);
        drawn.ISA = fromISA;
        bal.ISA  -= fromISA;
      }
    } else {
      const fromISA = Math.min(bal.ISA || 0, amount);
      drawn.ISA = fromISA;
      bal.ISA  -= fromISA;
      const rem = amount - fromISA;
      if (rem > 0 && (bal.GIA || 0) > 0) {
        const fromGIA = Math.min(bal.GIA, rem);
        drawn.GIA = fromGIA;
        bal.GIA  -= fromGIA;
      }
    }
    return drawn;
  }

  // ── Fallback ──────────────────────────────────────────────────────────────

  function applyFallback(
    shortfall, p1Drawn, p2Drawn,
    p1Bal, p2Bal,
    p1WrapperOrder, p2WrapperOrder,
    p1SIPPLocked, p2SIPPLocked,
    p1Target, p2Target,
  ) {
    const p1Unmet = Math.max(0, p1Target - drawnTotal(p1Drawn));
    const p2Unmet = Math.max(0, p2Target - drawnTotal(p2Drawn));

    if (p1Unmet > 0) mergeDraw(p2Drawn, C.withdraw(p2Bal, p2WrapperOrder, p1Unmet));
    if (p2Unmet > 0) mergeDraw(p1Drawn, C.withdraw(p1Bal, p1WrapperOrder, p2Unmet));

    const stillUnmet = Math.max(0, shortfall - drawnTotal(p1Drawn) - drawnTotal(p2Drawn));
    if (stillUnmet > 0) {
      const half    = stillUnmet / 2;
      const p1Extra = !p1SIPPLocked ? C.withdraw(p1Bal, ['SIPP'], half) : { SIPP: 0, sippTaxable: 0 };
      const p1Got   = p1Extra.SIPP || 0;
      const p2Share = half + Math.max(0, half - p1Got);
      const p2Extra = !p2SIPPLocked ? C.withdraw(p2Bal, ['SIPP'], p2Share) : { SIPP: 0, sippTaxable: 0 };
      mergeDraw(p1Drawn, p1Extra);
      mergeDraw(p2Drawn, p2Extra);
      const p2Still = Math.max(0, half - (p2Extra.SIPP || 0));
      if (p2Still > 0 && !p1SIPPLocked) mergeDraw(p1Drawn, C.withdraw(p1Bal, ['SIPP'], p2Still));
    }
  }

  // ── Strategy: balanced ────────────────────────────────────────────────────

  function strategyBalanced({
    shortfall, p1Bal, p2Bal,
    p1WrapperOrder, p2WrapperOrder,
    p1SIPPLocked, p2SIPPLocked,
    p1Ledger, p2Ledger,
    p1GainRatio, p2GainRatio,
  }) {
    if (shortfall <= 0) return { p1Drawn: zero(), p2Drawn: zero() };

    // SIPP capped at BOTH the basic-rate ceiling AND half the shortfall.
    // This prevents SIPP from over-drawing and leaving no room for GIA/ISA
    // to differ between strategies.
    const half         = shortfall / 2;
    const p1SippTarget = !p1SIPPLocked ? Math.min(sippBasicRateCap(p1Ledger, p1Bal.SIPP), half) : 0;
    const p2SippTarget = !p2SIPPLocked ? Math.min(sippBasicRateCap(p2Ledger, p2Bal.SIPP), half) : 0;

    const p1Drawn = C.withdraw(p1Bal, ['SIPP'], p1SippTarget);
    const p2Drawn = C.withdraw(p2Bal, ['SIPP'], p2SippTarget);
    L.consumeNonSavings(p1Ledger, p1Drawn.sippTaxable);
    L.consumeNonSavings(p2Ledger, p2Drawn.sippTaxable);

    const remShortfall  = Math.max(0, shortfall - (p1Drawn.SIPP || 0) - (p2Drawn.SIPP || 0));
    const p1BandRoom    = p1Ledger.basicBandRemaining;
    const p2BandRoom    = p2Ledger.basicBandRemaining;
    const totalBandRoom = p1BandRoom + p2BandRoom;
    const p1Weight      = totalBandRoom > 0 ? p1BandRoom / totalBandRoom : 0.5;
    const p1Target      = remShortfall * p1Weight;
    const p2Target      = remShortfall * (1 - p1Weight);

    mergeDraw(p1Drawn, drawGIAorISA(p1Bal, p1Target, p1Ledger, p1GainRatio));
    mergeDraw(p2Drawn, drawGIAorISA(p2Bal, p2Target, p2Ledger, p2GainRatio));

    applyFallback(
      shortfall, p1Drawn, p2Drawn, p1Bal, p2Bal,
      p1WrapperOrder, p2WrapperOrder, p1SIPPLocked, p2SIPPLocked,
      p1Target, p2Target,
    );

    return { p1Drawn, p2Drawn };
  }

  // ── Strategy: isaFirst ────────────────────────────────────────────────────

  function strategyISAFirst({
    shortfall, p1Bal, p2Bal,
    p1WrapperOrder, p2WrapperOrder,
    p1SIPPLocked, p2SIPPLocked,
    p1Ledger, p2Ledger,
    p1GainRatio, p2GainRatio,
  }) {
    if (shortfall <= 0) return { p1Drawn: zero(), p2Drawn: zero() };

    // SIPP only to fill remaining PA headroom (often 0 once SP/salary consumed it)
    const p1SippTarget = !p1SIPPLocked ? sippPACap(p1Ledger, p1Bal.SIPP) : 0;
    const p2SippTarget = !p2SIPPLocked ? sippPACap(p2Ledger, p2Bal.SIPP) : 0;

    const p1Drawn = C.withdraw(p1Bal, ['SIPP'], p1SippTarget);
    const p2Drawn = C.withdraw(p2Bal, ['SIPP'], p2SippTarget);
    L.consumeNonSavings(p1Ledger, p1Drawn.sippTaxable);
    L.consumeNonSavings(p2Ledger, p2Drawn.sippTaxable);

    const remShortfall = Math.max(0, shortfall - (p1Drawn.SIPP || 0) - (p2Drawn.SIPP || 0));

    // Split by ISA balance; fall back to GIA balance if ISAs empty; 50/50 if all empty
    const p1ISA = p1Bal.ISA || 0;
    const p2ISA = p2Bal.ISA || 0;
    const p1GIA = p1Bal.GIA || 0;
    const p2GIA = p2Bal.GIA || 0;
    const totalISA = p1ISA + p2ISA;
    const totalGIA = p1GIA + p2GIA;
    const p1Liquid = totalISA > 0 ? p1ISA : (totalGIA > 0 ? p1GIA : 1);
    const total    = totalISA > 0 ? totalISA : (totalGIA > 0 ? totalGIA : 2);
    const p1Weight = p1Liquid / total;

    const p1Target = remShortfall * p1Weight;
    const p2Target = remShortfall * (1 - p1Weight);

    // Unconditionally ISA-first — no tax-efficiency gate
    mergeDraw(p1Drawn, drawISAorGIA(p1Bal, p1Target));
    mergeDraw(p2Drawn, drawISAorGIA(p2Bal, p2Target));

    applyFallback(
      shortfall, p1Drawn, p2Drawn, p1Bal, p2Bal,
      p1WrapperOrder, p2WrapperOrder, p1SIPPLocked, p2SIPPLocked,
      p1Target, p2Target,
    );

    return { p1Drawn, p2Drawn };
  }

  // ── Strategy: sippFirst ───────────────────────────────────────────────────

  function strategySIPPFirst({
    shortfall, p1Bal, p2Bal,
    p1WrapperOrder, p2WrapperOrder,
    p1SIPPLocked, p2SIPPLocked,
    p1Ledger, p2Ledger,
    p1GainRatio, p2GainRatio,
  }) {
    if (shortfall <= 0) return { p1Drawn: zero(), p2Drawn: zero() };

    // SIPP to full basic-rate ceiling — NOT capped by shortfall.
    // Any surplus above spending need is recycled into ISA (net of 20% tax).
    const p1SippTarget = !p1SIPPLocked ? sippBasicRateCap(p1Ledger, p1Bal.SIPP) : 0;
    const p2SippTarget = !p2SIPPLocked ? sippBasicRateCap(p2Ledger, p2Bal.SIPP) : 0;

    const p1Drawn = C.withdraw(p1Bal, ['SIPP'], p1SippTarget);
    const p2Drawn = C.withdraw(p2Bal, ['SIPP'], p2SippTarget);
    L.consumeNonSavings(p1Ledger, p1Drawn.sippTaxable);
    L.consumeNonSavings(p2Ledger, p2Drawn.sippTaxable);

    const sippTotal = (p1Drawn.SIPP || 0) + (p2Drawn.SIPP || 0);
    const surplus   = sippTotal - shortfall;

    if (surplus > 0) {
      // Recycle surplus into ISA — net of 20% tax on the 75% taxable portion
      const netFactor    = 1 - (SIPP_TAXABLE_RATIO * 0.20);
      const p1SurpFrac   = sippTotal > 0 ? (p1Drawn.SIPP || 0) / sippTotal : 0.5;
      p1Bal.ISA = (p1Bal.ISA || 0) + surplus * p1SurpFrac   * netFactor;
      p2Bal.ISA = (p2Bal.ISA || 0) + surplus * (1 - p1SurpFrac) * netFactor;
      return { p1Drawn, p2Drawn };
    }

    // SIPP draw fell short — fill remainder from GIA then ISA
    const remShortfall  = shortfall - sippTotal;
    const p1BandRoom    = p1Ledger.basicBandRemaining;
    const p2BandRoom    = p2Ledger.basicBandRemaining;
    const totalBandRoom = p1BandRoom + p2BandRoom;
    const p1Weight      = totalBandRoom > 0 ? p1BandRoom / totalBandRoom : 0.5;
    const p1Target      = remShortfall * p1Weight;
    const p2Target      = remShortfall * (1 - p1Weight);

    mergeDraw(p1Drawn, drawGIAorISA(p1Bal, p1Target, p1Ledger, p1GainRatio));
    mergeDraw(p2Drawn, drawGIAorISA(p2Bal, p2Target, p2Ledger, p2GainRatio));

    applyFallback(
      shortfall, p1Drawn, p2Drawn, p1Bal, p2Bal,
      p1WrapperOrder, p2WrapperOrder, p1SIPPLocked, p2SIPPLocked,
      p1Target, p2Target,
    );

    return { p1Drawn, p2Drawn };
  }

  // ── Strategy: taxMin ──────────────────────────────────────────────────────
  //
  // Draws from whichever wrapper produces the lowest marginal tax on each
  // pound, consulting the ledger in real time. Steps in priority order:
  //
  //   1. SIPP to remaining PA headroom          — 0% effective (25% TFLS covers)
  //   2. GIA/Cash interest to SRS + PSA          — already consumed by engine;
  //                                                nothing discretionary here
  //   3. GIA capital to remaining CGT allowance  — 0% CGT
  //   4. ISA for remaining shortfall             — always 0% (exact need only)
  //   5. Taxable SIPP into basic-rate band       — 20% income tax
  //   6. GIA at basic-rate CGT                   — 18% CGT
  //   7. Fallback                                — applyFallback (higher-rate)
  //
  // Two-person split: proportional by each person's headroom for that step.
  // Scotland is a known gap — band rates scoped to England only.

  function strategyTaxMin({
    shortfall, p1Bal, p2Bal,
    p1WrapperOrder, p2WrapperOrder,
    p1SIPPLocked, p2SIPPLocked,
    p1Ledger, p2Ledger,
    p1GainRatio, p2GainRatio,
  }) {
    if (shortfall <= 0) return { p1Drawn: zero(), p2Drawn: zero() };

    const p1Drawn = zero();
    const p2Drawn = zero();
    let rem = shortfall;   // running remaining shortfall

    // ── Step 1: SIPP to PA headroom (tax-free effective rate) ──────────────
    {
      const p1Cap = !p1SIPPLocked ? sippPACap(p1Ledger, p1Bal.SIPP) : 0;
      const p2Cap = !p2SIPPLocked ? sippPACap(p2Ledger, p2Bal.SIPP) : 0;
      const total = p1Cap + p2Cap;
      const draw  = Math.min(total, rem);

      if (draw > 0 && total > 0) {
        const p1Share = draw * (p1Cap / total);
        const p2Share = draw * (p2Cap / total);

        const d1 = C.withdraw(p1Bal, ['SIPP'], p1Share);
        const d2 = C.withdraw(p2Bal, ['SIPP'], p2Share);
        L.consumeNonSavings(p1Ledger, d1.sippTaxable);
        L.consumeNonSavings(p2Ledger, d2.sippTaxable);
        mergeDraw(p1Drawn, d1);
        mergeDraw(p2Drawn, d2);
        rem -= (d1.SIPP || 0) + (d2.SIPP || 0);
      }
    }

    // ── Step 2: GIA/Cash interest within SRS + PSA ────────────────────────
    // Interest accrual is non-discretionary — already consumed by the engine
    // before withdrawalStrategy runs. The ledger's srsRemaining / psaRemaining
    // already reflect any interest. Nothing to draw here.

    // ── Step 3: GIA capital within CGT allowance (0% CGT) ─────────────────
    if (rem > 0) {
      const p1Exempt = p1Ledger.cgtAllowRemaining;
      const p2Exempt = p2Ledger.cgtAllowRemaining;
      const totalEx  = p1Exempt + p2Exempt;

      if (totalEx > 0) {
        // Max GIA we can draw per person without exceeding their CGT exemption.
        // If gainRatio is 0 (pure return of capital) the full draw is tax-free;
        // guard against division by zero with a cap at the GIA balance.
        const p1MaxGIA = p1GainRatio > 0
          ? Math.min(p1Exempt / p1GainRatio, p1Bal.GIA || 0)
          : (p1Bal.GIA || 0);
        const p2MaxGIA = p2GainRatio > 0
          ? Math.min(p2Exempt / p2GainRatio, p2Bal.GIA || 0)
          : (p2Bal.GIA || 0);

        const available = p1MaxGIA + p2MaxGIA;
        const draw      = Math.min(available, rem);

        if (draw > 0 && available > 0) {
          const p1Share = draw * (p1MaxGIA / available);
          const p2Share = draw * (p2MaxGIA / available);

          const p1GIADraw = Math.min(p1Share, p1Bal.GIA || 0);
          const p2GIADraw = Math.min(p2Share, p2Bal.GIA || 0);

          p1Bal.GIA -= p1GIADraw;
          p2Bal.GIA -= p2GIADraw;
          p1Drawn.GIA += p1GIADraw;
          p2Drawn.GIA += p2GIADraw;

          L.consumeGains(p1Ledger, p1GIADraw * p1GainRatio);
          L.consumeGains(p2Ledger, p2GIADraw * p2GainRatio);

          rem -= p1GIADraw + p2GIADraw;
        }
      }
    }

    // ── Step 4: ISA for remaining shortfall (exact, no surplus) ───────────
    if (rem > 0) {
      const p1ISA = p1Bal.ISA || 0;
      const p2ISA = p2Bal.ISA || 0;
      const totalISA = p1ISA + p2ISA;
      const draw     = Math.min(totalISA, rem);

      if (draw > 0 && totalISA > 0) {
        const p1Share = draw * (p1ISA / totalISA);
        const p2Share = draw * (p2ISA / totalISA);

        const d1 = C.withdraw(p1Bal, ['ISA'], p1Share);
        const d2 = C.withdraw(p2Bal, ['ISA'], p2Share);
        mergeDraw(p1Drawn, d1);
        mergeDraw(p2Drawn, d2);
        rem -= (d1.ISA || 0) + (d2.ISA || 0);
      }
    }

    // ── Step 5: Taxable SIPP into basic-rate band only (20% IT) ───────────
    // Only as much as covers the remaining shortfall — not topped to ceiling.
    if (rem > 0) {
      const p1Cap = !p1SIPPLocked ? Math.min(sippBasicRateCap(p1Ledger, p1Bal.SIPP), rem / 2) : 0;
      const p2Cap = !p2SIPPLocked ? Math.min(sippBasicRateCap(p2Ledger, p2Bal.SIPP), rem / 2) : 0;

      // Split by band room, not cap, so the person with more band absorbs more
      const p1Band = p1Ledger.basicBandRemaining;
      const p2Band = p2Ledger.basicBandRemaining;
      const totalBand = p1Band + p2Band;
      const draw      = Math.min((p1Cap + p2Cap), rem);

      if (draw > 0 && totalBand > 0) {
        const p1Share = Math.min(draw * (p1Band / totalBand), p1Cap);
        const p2Share = Math.min(draw * (p2Band / totalBand), p2Cap);

        const d1 = !p1SIPPLocked ? C.withdraw(p1Bal, ['SIPP'], p1Share) : zero();
        const d2 = !p2SIPPLocked ? C.withdraw(p2Bal, ['SIPP'], p2Share) : zero();
        L.consumeNonSavings(p1Ledger, d1.sippTaxable);
        L.consumeNonSavings(p2Ledger, d2.sippTaxable);
        mergeDraw(p1Drawn, d1);
        mergeDraw(p2Drawn, d2);
        rem -= (d1.SIPP || 0) + (d2.SIPP || 0);
      }
    }

    // ── Step 6: GIA at basic-rate CGT (18%) ───────────────────────────────
    if (rem > 0) {
      const p1Band = p1Ledger.basicBandRemaining;
      const p2Band = p2Ledger.basicBandRemaining;
      const totalBand = p1Band + p2Band;

      const p1GIA = p1Bal.GIA || 0;
      const p2GIA = p2Bal.GIA || 0;
      const totalGIA = p1GIA + p2GIA;
      const draw     = Math.min(totalGIA, rem);

      if (draw > 0 && totalGIA > 0) {
        // Weight by band room where available, fall back to GIA balance weight
        const p1Weight = totalBand > 0 ? (p1Band / totalBand) : (p1GIA / totalGIA);
        const p2Weight = totalBand > 0 ? (p2Band / totalBand) : (p2GIA / totalGIA);
        const p1Share  = Math.min(draw * p1Weight, p1GIA);
        const p2Share  = Math.min(draw * p2Weight, p2GIA);

        p1Bal.GIA -= p1Share;
        p2Bal.GIA -= p2Share;
        p1Drawn.GIA += p1Share;
        p2Drawn.GIA += p2Share;

        L.consumeGains(p1Ledger, p1Share * p1GainRatio);
        L.consumeGains(p2Ledger, p2Share * p2GainRatio);

        rem -= p1Share + p2Share;
      }
    }

    // ── Step 7: Fallback (higher-rate band / whatever remains) ────────────
    if (rem > 0) {
      const p1Target = rem / 2;
      const p2Target = rem / 2;
      applyFallback(
        shortfall, p1Drawn, p2Drawn, p1Bal, p2Bal,
        p1WrapperOrder, p2WrapperOrder, p1SIPPLocked, p2SIPPLocked,
        p1Target, p2Target,
      );
    }

    return { p1Drawn, p2Drawn };
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  function withdrawalStrategy(params) {
    switch (params.strategy) {
      case 'isaFirst':  return strategyISAFirst(params);
      case 'sippFirst': return strategySIPPFirst(params);
      case 'taxMin':    return strategyTaxMin(params);
      case 'balanced':
      default:          return strategyBalanced(params);
    }
  }

  window.RetireWithdrawalStrategy = { withdrawalStrategy };
})();
