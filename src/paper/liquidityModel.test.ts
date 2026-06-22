import assert from "node:assert/strict";
import test from "node:test";

import { buildPaperLiquidityDecision } from "./liquidityModel.js";

test("paper liquidity model preserves legacy fill when volume is unavailable", () => {
  const decision = buildPaperLiquidityDecision({
    requestedNotionalKrw: 700_000,
    sourcePriceKrw: 70_000,
    policy: {
      maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1,
      rejectStaleLiquidity: true
    }
  });

  assert.equal(decision.fillStatus, "filled");
  assert.equal(decision.liquidityStatus, "not_modeled");
  assert.equal(decision.fillableNotionalKrw, 700_000);
  assert.equal(decision.participationRate, undefined);
});

test("paper liquidity model caps fills by volume participation", () => {
  const decision = buildPaperLiquidityDecision({
    requestedNotionalKrw: 700_000,
    sourcePriceKrw: 70_000,
    volume: 100,
    averageVolume: 10,
    policy: {
      maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1,
      rejectStaleLiquidity: true
    }
  });

  assert.equal(decision.fillStatus, "partial");
  assert.equal(decision.liquidityStatus, "partial");
  assert.equal(decision.fillableNotionalKrw, 70_000);
  assert.equal(decision.participationRate, 0.1);
});

test("paper liquidity model rejects stale or insufficient liquidity", () => {
  const stale = buildPaperLiquidityDecision({
    requestedNotionalKrw: 700_000,
    sourcePriceKrw: 70_000,
    volume: 10,
    averageVolume: 10,
    liquidityStale: true,
    policy: {
      maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1,
      rejectStaleLiquidity: true
    }
  });
  const insufficient = buildPaperLiquidityDecision({
    requestedNotionalKrw: 700_000,
    sourcePriceKrw: 70_000,
    volume: 1,
    averageVolume: 1,
    policy: {
      maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1,
      rejectStaleLiquidity: true
    }
  });

  assert.equal(stale.fillStatus, "rejected");
  assert.equal(stale.rejectReason, "stale_liquidity");
  assert.equal(insufficient.fillStatus, "rejected");
  assert.equal(insufficient.rejectReason, "insufficient_liquidity");
});
