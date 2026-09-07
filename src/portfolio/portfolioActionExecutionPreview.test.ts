import assert from "node:assert/strict";
import test from "node:test";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { createPortfolioActionExecutionPreview, parsePortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

type Input = Parameters<typeof createPortfolioActionExecutionPreview>[0];

test("execution preview calculates all BUY and SELL costs before creating any fill identity", () => {
  for (const side of ["BUY", "SELL"] as const) {
    const result = createPortfolioActionExecutionPreview(fixture({ side }));
    assert.deepEqual(parsePortfolioActionExecutionPreview(JSON.parse(JSON.stringify(result))), result);
    assert.equal(result.requestedQuantity, 10);
    assert.equal(result.execution.fillPriceKrw, side === "BUY" ? 10_010 : 9_990);
    assert.equal(result.execution.netAmountKrw, side === "BUY" ? 101_251 : 98_551);
    assert.deepEqual(result.execution.costBreakdown, side === "BUY"
      ? { feeKrw: 100, taxKrw: 0, slippageKrw: 100, spreadCostKrw: 50, impactCostKrw: 1_001, totalCostKrw: 1_251 }
      : { feeKrw: 100, taxKrw: 200, slippageKrw: 100, spreadCostKrw: 50, impactCostKrw: 999, totalCostKrw: 1_449 });
    assert.ok(!("fillId" in result));
    assert.ok(Object.isFrozen(result.input.executionPolicy));
    assert.ok(Object.isFrozen(result.execution.costBreakdown));
    assertFillParity(result);
  }
});

test("execution preview models partial liquidity, minimum fill rejection and stale rejection", () => {
  const partial = createPortfolioActionExecutionPreview(fixture({ volume: 50 }));
  assert.equal(partial.execution.fillStatus, "partial");
  assert.equal(partial.execution.quantity, 5);
  assert.equal(partial.execution.filledNotionalKrw, 50_050);
  assertFillParity(partial);
  const insufficient = createPortfolioActionExecutionPreview(fixture({ volume: 1 }));
  assert.equal(insufficient.execution.fillStatus, "rejected");
  assert.equal(insufficient.execution.liquidityRejectReason, "insufficient_liquidity");
  const stale = createPortfolioActionExecutionPreview(fixture({ liquidityStale: true }));
  assert.equal(stale.execution.liquidityStatus, "stale");
  assert.equal(stale.execution.netAmountKrw, 0);
  assert.deepEqual(parsePortfolioActionExecutionPreview(stale), stale);
});

test("execution preview preserves explicit unmodeled liquidity but never calls stale missing-volume input fillable", () => {
  const result = createPortfolioActionExecutionPreview(fixture({ volume: null, averageVolume: null }));
  assert.equal(result.execution.liquidityStatus, "not_modeled");
  assert.equal(result.execution.participationRate, null);
  assert.equal(result.execution.costBreakdown.impactCostKrw, 0);
  assertFillParity(result);
  assert.throws(() => createPortfolioActionExecutionPreview(fixture({ volume: null, averageVolume: null, liquidityStale: true })), /stale modeled fill/);
  assert.equal(createPortfolioActionExecutionPreview(fixture({ volume: 0 })).execution.fillStatus, "rejected");
});

test("execution preview uses post-fillRatio notional and preserves whole-share sizing semantics", () => {
  const input = fixture({ quantityOverride: null });
  for (const ratio of [1, 0.5, 0.3]) {
    const preview = createPortfolioActionExecutionPreview({ ...input, executionPolicy: { ...input.executionPolicy, fillRatio: ratio } });
    assert.equal(preview.requestedQuantity, 100_000 / 10_010);
    assert.equal(preview.execution.grossAmountKrw, 100_000);
    assertFillParity(preview);
  }
  const whole = createPortfolioActionExecutionPreview({ ...input, executionPolicy: { ...input.executionPolicy, allowFractionalShares: false } });
  assert.equal(whole.execution.quantity, 9);
  assertFillParity(whole);
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, quantityOverride: 0.5,
    executionPolicy: { ...input.executionPolicy, allowFractionalShares: false } }), /whole-share/);
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, quantityOverride: 10, volume: 55,
    executionPolicy: { ...input.executionPolicy, allowFractionalShares: false } }), /whole-share.*fractional fill/);
  assert.throws(() => createPortfolioActionExecutionPreview(fixture({ quantityOverride: 9 })), /request notional differs/);
});

test("execution preview rejects absent policy fields, unknown fields, invalid versions and noncanonical numbers", () => {
  const input = fixture();
  const { taxBps: _tax, ...incomplete } = input.executionPolicy;
  for (const value of [
    { ...input, executionPolicy: incomplete }, { ...input, unexpected: true },
    { ...input, executionPolicy: { ...input.executionPolicy, unknown: 1 } },
    { ...input, executionPolicy: { ...input.executionPolicy, modelVersion: "other" } },
    { ...input, executionPolicy: { ...input.executionPolicy, fillRatio: 0 } },
    { ...input, executionPolicy: { ...input.executionPolicy, feeBps: -1 } },
    { ...input, requestedNotionalKrw: 1.5 }, { ...input, volume: -0 }, { ...input, volume: Infinity }
  ]) assert.throws(() => createPortfolioActionExecutionPreview(value as Input));
});

test("execution preview rejects future or forged typed prices and unsafe monetary outputs", () => {
  const input = fixture();
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, asOf: "2020-01-01T00:00:00.000Z" }), /postdates/);
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, sourcePriceEvidence: { ...input.sourcePriceEvidence, priceKrw: 9_999 } }), /identity/);
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, executionPolicy: { ...input.executionPolicy, feeBps: Number.MAX_VALUE } }), /safe integer/);
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, executionPolicy: { ...input.executionPolicy, fillRatio: Number.MIN_VALUE } }), /not representable/);
  assert.throws(() => createPortfolioActionExecutionPreview({ ...input, side: "SELL", executionPolicy: { ...input.executionPolicy, slippageBps: 10_000 } }), /fill price/);
});

test("execution preview independently replays outputs even when every exposed hash is recomputed", () => {
  const preview = createPortfolioActionExecutionPreview(fixture());
  const { executionPreviewId: _id, executionPreviewHash: _hash, ...original } = preview;
  for (const payload of [
    { ...original, requestedQuantity: 11 },
    { ...original, execution: { ...original.execution, netAmountKrw: 1 } },
    { ...original, execution: { ...original.execution, costBreakdown: { ...original.execution.costBreakdown, taxKrw: 5 } } },
    { ...original, input: { ...original.input, volume: 50 }, executionInputHash: hashCanonicalPayload({ ...original.input, volume: 50 }) }
  ]) {
    const executionPreviewHash = hashCanonicalPayload(payload);
    assert.throws(() => parsePortfolioActionExecutionPreview({ ...payload, executionPreviewHash,
      executionPreviewId: hashDerivedId("portfolio_execution_preview", executionPreviewHash) }), /deterministic replay/);
  }
  assert.throws(() => parsePortfolioActionExecutionPreview({ ...preview, extra: true }), /deterministic replay/);
  assert.throws(() => parsePortfolioActionExecutionPreview(null), /complete input/);
});

test("execution preview never adds slippage twice and charges SELL tax even when fee is zero", () => {
  const input = fixture({ volume: null, averageVolume: null });
  const policy = { ...input.executionPolicy, feeBps: 0, halfSpreadBps: 0, marketImpactBpsPerParticipationRate: 0 };
  const buy = createPortfolioActionExecutionPreview({ ...input, executionPolicy: policy });
  assert.equal(buy.execution.netAmountKrw, buy.execution.grossAmountKrw);
  assert.equal(buy.execution.costBreakdown.totalCostKrw, 100);
  assert.equal(buy.execution.costBreakdown.taxKrw, 0);
  const sell = createPortfolioActionExecutionPreview({ ...input, side: "SELL", executionPolicy: policy });
  assert.equal(sell.execution.costBreakdown.taxKrw, 200);
  assert.equal(sell.execution.netAmountKrw, 99_700);
  assert.equal(sell.execution.costBreakdown.totalCostKrw, 300);
  assertFillParity(buy);
  assertFillParity(sell);
});

function fixture(overrides: Partial<Input> = {}): Input {
  return { side: "BUY", requestedNotionalKrw: 100_000, quantityOverride: 10,
    sourcePriceEvidence: createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-price", market: "KR", symbol: "KR:005930",
      priceField: "last_price", priceKrw: 10_000, observedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:01.000Z", sourceRefs: ["synthetic"] }),
    executionPolicy: { modelVersion: PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price", slippageBps: 10,
      feeBps: 10, taxBps: 20, halfSpreadBps: 5, fillRatio: 1, allowFractionalShares: true, maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 1_000 },
    volume: 100, averageVolume: 200, liquidityStale: false, asOf: "2026-01-01T00:00:02.000Z", ...overrides };
}

function assertFillParity(preview: ReturnType<typeof createPortfolioActionExecutionPreview>) {
  const { input, execution, requestedQuantity } = preview;
  const { evidenceRef, evidenceHash, sourceContractId, market, symbol, priceField, observedAt } = input.sourcePriceEvidence;
  assert.notEqual(execution.fillStatus, "rejected");
  const record = createPaperFillExecutionRecord({ portfolioId: "synthetic", rebalancePlanId: "synthetic-plan", rebalanceActionId: "action-1", fillId: "synthetic-fill",
    market, symbol, side: input.side, requestedNotionalKrw: input.requestedNotionalKrw, requestedQuantity, quantityOverride: input.quantityOverride,
    sourcePriceKrw: input.sourcePriceEvidence.priceKrw, sourcePriceEvidence: { evidenceRef, evidenceHash, sourceContractId, market, symbol, priceField, observedAt },
    averagePriceKrw: null, ...execution, fillStatus: execution.fillStatus as "filled" | "partial",
    liquidityStatus: execution.liquidityStatus as "not_modeled" | "sufficient" | "partial", liquidityRejectReason: null,
    volume: input.volume, averageVolume: input.averageVolume, liquidityStale: input.liquidityStale, executionPolicy: input.executionPolicy,
    fractionalShares: input.executionPolicy.allowFractionalShares, evidenceRefs: [evidenceRef], asOf: input.asOf, createdAt: input.asOf });
  assert.deepEqual(record.costBreakdown, execution.costBreakdown);
  assert.equal(record.netAmountKrw, execution.netAmountKrw);
}
