import assert from "node:assert/strict";
import test from "node:test";
import { createPaperCostModel, PAPER_EXECUTION_MODEL_VERSION } from "./costModel.js";
import { buildPaperFill, type PaperFillInput } from "./executionModel.js";
import { buildVersionedPaperFill, WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION as V5 } from "./versionedExecutionModel.js";

const fixture = (): PaperFillInput => ({ action: "VIRTUAL_BUY", targetNotionalKrw: 100_000,
  sourcePriceKrw: 10_000, quantityOverride: 10, volume: 55,
  policy: { allowFractionalShares: false, maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1 } });

test("versioned execution keeps v4 default and historical fractional override output unchanged", () => {
  assert.equal(PAPER_EXECUTION_MODEL_VERSION, "execution_simulator.v4");
  assert.equal(createPaperCostModel().executionModelVersion, "execution_simulator.v4");
  for (const action of ["VIRTUAL_BUY", "VIRTUAL_SELL"] as const) {
    const input = { ...fixture(), action };
    assert.equal(buildPaperFill(input).quantity, 5.5);
    assert.deepEqual(buildVersionedPaperFill(input, PAPER_EXECUTION_MODEL_VERSION), buildPaperFill(input));
  }
  assert.throws(() => buildVersionedPaperFill(fixture(), "execution_simulator.v999"), /unsupported/);
});

test("v5 floors whole-share quantity overrides before calculating both-side amounts and participation", () => {
  for (const action of ["VIRTUAL_BUY", "VIRTUAL_SELL"] as const) {
    const result = buildVersionedPaperFill({ ...fixture(), action }, V5);
    assert.equal(result.quantity, 5);
    assert.equal(result.grossAmountKrw, 50_000);
    assert.equal(result.netAmountKrw, 50_000);
    assert.equal(result.participationRate, 0.090909);
    assert.equal(result.fillStatus, "partial");
    assert.equal(result.fractionalShares, false);
  }
});

test("v5 enforces the modeled minimum fill ratio after whole-share rounding and rejects zero-share output", () => {
  const input = fixture();
  const accepted = buildVersionedPaperFill({ ...input, policy: { ...input.policy, minLiquidityFillRatio: 0.5 } }, V5);
  assert.equal(accepted.quantity, 5);
  for (const candidate of [
    { ...input, policy: { ...input.policy, minLiquidityFillRatio: 0.5001 } },
    { ...input, volume: 9, policy: { ...input.policy, minLiquidityFillRatio: 0 } },
    { ...input, quantityOverride: undefined, policy: { ...input.policy, minLiquidityFillRatio: 0.5001 } }
  ]) {
    const result = buildVersionedPaperFill(candidate, V5);
    assert.equal(result.quantity, 0);
    assert.equal(result.netAmountKrw, 0);
    assert.equal(result.fillStatus, "rejected");
    assert.equal(result.liquidityStatus, "rejected");
    assert.equal(result.liquidityRejectReason, "insufficient_liquidity");
  }
});

test("v5 rejects fractional or invalid whole-share overrides without changing fractional-share semantics", () => {
  const input = fixture();
  for (const quantityOverride of [0, -1, 10.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildVersionedPaperFill({ ...input, quantityOverride }, V5), /positive integer/);
  }
  for (const volume of [undefined, 0, 55, 1000]) {
    const candidate = { ...input, volume, quantityOverride: 10.5, policy: { ...input.policy, allowFractionalShares: true } };
    assert.deepEqual(buildVersionedPaperFill(candidate, V5), buildPaperFill(candidate));
  }
});
