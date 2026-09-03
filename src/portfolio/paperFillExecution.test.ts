import assert from "node:assert/strict";
import test from "node:test";

import { buildPaperFill } from "../paper/executionModel.js";
import {
  createPaperFillExecutionRecord,
  parsePaperFillExecutionRecord
} from "./paperFillExecution.js";

const HASH_A = `sha256:${"a".repeat(64)}`;

test("paper fill execution record replays one accepted fill deterministically", () => {
  const record = createPaperFillExecutionRecord(validInput());
  const retry = createPaperFillExecutionRecord({
    ...validInput(),
    createdAt: "2026-09-03T00:00:02.000Z"
  });

  assert.deepEqual(parsePaperFillExecutionRecord(record), record);
  assert.equal(retry.paperFillRecordId, record.paperFillRecordId);
  assert.equal(retry.paperFillHash, record.paperFillHash);
  assert.deepEqual(record.evidenceRefs, ["fee-evidence-1", "price-evidence-1"]);
  assert.match(record.paperFillRecordId, /^paper_fill_execution_/);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.executionPolicy), true);
});

test("paper fill execution record replays sell costs and net credit", () => {
  const record = createPaperFillExecutionRecord(validSellInput());

  assert.deepEqual(parsePaperFillExecutionRecord(record), record);
  assert.equal(record.side, "SELL");
  assert.equal(record.quantityOverride, 5);
  assert.ok(record.costBreakdown.totalCostKrw > 0);
  assert.ok(record.netAmountKrw < record.grossAmountKrw);
});

test("paper fill execution record rejects output and identity drift", () => {
  const record = createPaperFillExecutionRecord(validInput());
  assert.throws(
    () => parsePaperFillExecutionRecord({ ...record, quantity: 9 }),
    /output does not match deterministic replay/
  );
  assert.throws(
    () =>
      parsePaperFillExecutionRecord({
        ...record,
        costBreakdown: { ...record.costBreakdown, feeKrw: 1 }
      }),
    /output does not match deterministic replay/
  );
  assert.throws(
    () => parsePaperFillExecutionRecord({ ...record, paperFillHash: HASH_A }),
    /identity does not match its payload/
  );
  assert.throws(
    () =>
      parsePaperFillExecutionRecord({
        ...record,
        paperFillRecordId: "paper-fill-wrong"
      }),
    /identity does not match its payload/
  );
});

test("paper fill execution record rejects request and source evidence drift", () => {
  const input = validInput();
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        requestedQuantity: input.requestedQuantity + 1
      }),
    /requested quantity does not match/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        sourcePriceEvidence: {
          ...input.sourcePriceEvidence,
          market: "US"
        }
      }),
    /source price scope mismatch/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        sourcePriceEvidence: {
          ...input.sourcePriceEvidence,
          observedAt: "2026-09-03T00:00:01.000Z"
        }
      }),
    /cannot be observed after fill asOf/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        evidenceRefs: ["fee-evidence-1"]
      }),
    /must include source price evidence/
  );
});

test("paper fill execution record rejects noncanonical and rejected shapes", () => {
  const input = validInput();
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        evidenceRefs: ["price-evidence-1", "price-evidence-1"]
      }),
    /must not contain duplicates/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        createdAt: "2026-09-02T23:59:59.999Z"
      }),
    /cannot be created before asOf/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        requestedNotionalKrw: -0
      }),
    /greater than 0|negative zero/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        fillStatus: "rejected" as "filled"
      }),
    /Invalid option/
  );
  assert.throws(
    () =>
      createPaperFillExecutionRecord({
        ...input,
        unexpected: true
      } as Parameters<typeof createPaperFillExecutionRecord>[0]),
    /Unrecognized key/
  );
});

function validInput() {
  const executionPolicy = {
    modelVersion: "paper-execution-v1",
    fillPriceRule: "current_candidate_last_price" as const,
    slippageBps: 0,
    feeBps: 0,
    taxBps: 0,
    halfSpreadBps: 0,
    fillRatio: 1,
    allowFractionalShares: true,
    maxVolumeParticipationRate: 0.1,
    minLiquidityFillRatio: 0.1,
    rejectStaleLiquidity: true,
    marketImpactBpsPerParticipationRate: 0
  };
  const replay = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: 1_000,
    sourcePriceKrw: 100,
    liquidityStale: false,
    policy: executionPolicy
  });
  return {
    portfolioId: "portfolio-1",
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId: "fill-1",
    market: "KR" as const,
    symbol: "KR:005930",
    side: "BUY" as const,
    requestedNotionalKrw: replay.requestedNotionalKrw,
    requestedQuantity: replay.requestedNotionalKrw / replay.fillPriceKrw,
    quantityOverride: null,
    sourcePriceKrw: replay.sourcePriceKrw,
    sourcePriceEvidence: {
      sourceContractId: "source-price-contract-v1",
      evidenceRef: "price-evidence-1",
      evidenceHash: HASH_A,
      market: "KR" as const,
      symbol: "KR:005930",
      priceField: "last_price" as const,
      observedAt: "2026-09-02T23:59:59.000Z"
    },
    averagePriceKrw: null,
    fillPriceKrw: replay.fillPriceKrw,
    quantity: replay.quantity,
    filledNotionalKrw: replay.filledNotionalKrw,
    grossAmountKrw: replay.grossAmountKrw,
    netAmountKrw: replay.netAmountKrw,
    participationRate: replay.participationRate ?? null,
    volume: replay.volume ?? null,
    averageVolume: replay.averageVolume ?? null,
    liquidityStale: false,
    fillStatus: replay.fillStatus as "filled" | "partial",
    liquidityStatus: replay.liquidityStatus as
      | "not_modeled"
      | "sufficient"
      | "partial",
    liquidityRejectReason: null,
    fractionalShares: replay.fractionalShares,
    executionPolicy,
    costBreakdown: {
      feeKrw: replay.feeKrw,
      taxKrw: replay.taxKrw,
      slippageKrw: replay.slippageKrw,
      spreadCostKrw: replay.spreadCostKrw,
      impactCostKrw: replay.impactCostKrw,
      totalCostKrw: replay.totalCostKrw
    },
    evidenceRefs: ["price-evidence-1", "fee-evidence-1"],
    asOf: "2026-09-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:01.000Z"
  };
}

function validSellInput() {
  const base = validInput();
  const executionPolicy = {
    ...base.executionPolicy,
    slippageBps: 100,
    feeBps: 10,
    taxBps: 20,
    halfSpreadBps: 5
  };
  const replay = buildPaperFill({
    action: "VIRTUAL_SELL",
    targetNotionalKrw: 1_000,
    sourcePriceKrw: 100,
    averagePriceKrw: 80,
    quantityOverride: 5,
    liquidityStale: false,
    policy: executionPolicy
  });
  return {
    ...base,
    side: "SELL" as const,
    requestedNotionalKrw: replay.requestedNotionalKrw,
    requestedQuantity: 5,
    quantityOverride: 5,
    averagePriceKrw: 80,
    fillPriceKrw: replay.fillPriceKrw,
    quantity: replay.quantity,
    filledNotionalKrw: replay.filledNotionalKrw,
    grossAmountKrw: replay.grossAmountKrw,
    netAmountKrw: replay.netAmountKrw,
    participationRate: replay.participationRate ?? null,
    volume: replay.volume ?? null,
    averageVolume: replay.averageVolume ?? null,
    fillStatus: replay.fillStatus as "filled" | "partial",
    liquidityStatus: replay.liquidityStatus as
      | "not_modeled"
      | "sufficient"
      | "partial",
    fractionalShares: replay.fractionalShares,
    executionPolicy,
    costBreakdown: {
      feeKrw: replay.feeKrw,
      taxKrw: replay.taxKrw,
      slippageKrw: replay.slippageKrw,
      spreadCostKrw: replay.spreadCostKrw,
      impactCostKrw: replay.impactCostKrw,
      totalCostKrw: replay.totalCostKrw
    }
  };
}
