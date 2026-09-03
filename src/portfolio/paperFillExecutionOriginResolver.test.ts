import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { resolvePaperFillExecutionOrigins } from "./paperFillExecutionOriginResolver.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import {
  SourcePriceEvidenceFileRepository,
  type VerifiedSourcePriceEvidenceHistory
} from "./sourcePriceEvidenceFiles.js";

test("paper fill resolves its source price from verified durable history", async () => {
  const evidence = priceEvidence();
  const record = paperFill({ evidence });
  await withEvidenceHistory([evidence], (history) => {
    const resolved = resolvePaperFillExecutionOrigins({
      value: record,
      sourcePriceEvidenceHistory: history
    });

    assert.deepEqual(resolved.record, record);
    assert.deepEqual(resolved.sourcePriceEvidence, evidence);
    assert.ok(Object.isFrozen(resolved));
    assert.ok(Object.isFrozen(resolved.sourcePriceEvidence));
  });
});

test("paper fill accepts equivalent offset notation for source observation", async () => {
  const evidence = priceEvidence({
    observedAt: "2026-09-03T08:59:59+09:00",
    createdAt: "2026-09-03T08:59:59+09:00"
  });
  const record = paperFill({
    evidence,
    projectionOverrides: {
      observedAt: "2026-09-02T23:59:59.000Z"
    }
  });

  await withEvidenceHistory([evidence], (history) => {
    const resolved = resolvePaperFillExecutionOrigins({
      value: record,
      sourcePriceEvidenceHistory: history
    });
    assert.deepEqual(resolved.sourcePriceEvidence, evidence);
  });
});

test("paper fill rejects unresolved and unverified source history", async () => {
  const evidence = priceEvidence();
  const record = paperFill({ evidence });
  await withEvidenceHistory([], (history) => {
    assert.throws(
      () =>
        resolvePaperFillExecutionOrigins({
          value: record,
          sourcePriceEvidenceHistory: history
        }),
      /does not resolve exactly once/
    );
  });
  assert.throws(
    () =>
      resolvePaperFillExecutionOrigins({
        value: record,
        sourcePriceEvidenceHistory: {
          records: [evidence]
        } as VerifiedSourcePriceEvidenceHistory
      }),
    /history is not verified/
  );
});

test("paper fill rejects source projection scope, identity, and time drift", async () => {
  const evidence = priceEvidence();
  await withEvidenceHistory([evidence], (history) => {
    assert.throws(
      () =>
        resolvePaperFillExecutionOrigins({
          value: paperFill({
            evidence,
            projectionOverrides: { sourceContractId: "other-contract" }
          }),
          sourcePriceEvidenceHistory: history
        }),
      /projection mismatch/
    );
    assert.throws(
      () =>
        resolvePaperFillExecutionOrigins({
          value: paperFill({
            evidence,
            projectionOverrides: {
              observedAt: "2026-09-02T23:59:58.000Z"
            }
          }),
          sourcePriceEvidenceHistory: history
        }),
      /projection mismatch/
    );
  });

  const foreign = priceEvidence({ market: "US", symbol: "US:AAPL" });
  await withEvidenceHistory([foreign], (history) => {
    assert.throws(
      () =>
        resolvePaperFillExecutionOrigins({
          value: paperFill({
            evidence: foreign,
            projectionOverrides: { market: "KR", symbol: "KR:005930" }
          }),
          sourcePriceEvidenceHistory: history
        }),
      /projection mismatch/
    );
  });
});

test("paper fill rejects source price value and durable availability cutoff drift", async () => {
  const wrongPrice = priceEvidence({ priceKrw: 101 });
  await withEvidenceHistory([wrongPrice], (history) => {
    assert.throws(
      () =>
        resolvePaperFillExecutionOrigins({
          value: paperFill({ evidence: wrongPrice, sourcePriceKrw: 100 }),
          sourcePriceEvidenceHistory: history
        }),
      /value mismatch/
    );
  });

  const futureEvidence = priceEvidence({
    createdAt: "2026-09-03T00:00:01.000Z"
  });
  await withEvidenceHistory([futureEvidence], (history) => {
    assert.throws(
      () =>
        resolvePaperFillExecutionOrigins({
          value: paperFill({ evidence: futureEvidence }),
          sourcePriceEvidenceHistory: history
        }),
      /postdates fill cutoff/
    );
  });
});

async function withEvidenceHistory<T>(
  evidence: readonly ReturnType<typeof priceEvidence>[],
  run: (history: VerifiedSourcePriceEvidenceHistory) => T | Promise<T>
): Promise<T> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-fill-origin-"));
  try {
    const repository = new SourcePriceEvidenceFileRepository(baseDir);
    for (const record of evidence) {
      await repository.append(record);
    }
    return await run(await repository.readVerifiedHistory());
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function priceEvidence(
  overrides: Partial<{
    sourceContractId: string;
    market: "KR" | "US";
    symbol: string;
    priceKrw: number;
    observedAt: string;
    createdAt: string;
  }> = {}
) {
  return createSourcePriceEvidenceRecord({
    sourceContractId: overrides.sourceContractId ?? "source-contract-v1",
    market: overrides.market ?? "KR",
    symbol: overrides.symbol ?? "KR:005930",
    priceField: "last_price",
    priceKrw: overrides.priceKrw ?? 100,
    observedAt: overrides.observedAt ?? "2026-09-02T23:59:59.000Z",
    sourceRefs: ["provider-packet-1"],
    createdAt: overrides.createdAt ?? "2026-09-02T23:59:59.000Z"
  });
}

function paperFill(input: {
  evidence: ReturnType<typeof priceEvidence>;
  sourcePriceKrw?: number;
  projectionOverrides?: Partial<{
    sourceContractId: string;
    market: "KR" | "US";
    symbol: string;
    observedAt: string;
  }>;
}) {
  const sourcePriceKrw = input.sourcePriceKrw ?? input.evidence.priceKrw;
  const executionPolicy = {
    modelVersion:
      PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION,
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
    sourcePriceKrw,
    liquidityStale: false,
    policy: executionPolicy
  });
  const sourcePriceEvidence = {
    sourceContractId:
      input.projectionOverrides?.sourceContractId ??
      input.evidence.sourceContractId,
    evidenceRef: input.evidence.evidenceRef,
    evidenceHash: input.evidence.evidenceHash,
    market: input.projectionOverrides?.market ?? "KR",
    symbol: input.projectionOverrides?.symbol ?? "KR:005930",
    priceField: "last_price" as const,
    observedAt:
      input.projectionOverrides?.observedAt ?? input.evidence.observedAt
  };
  return createPaperFillExecutionRecord({
    portfolioId: "portfolio-1",
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId: "fill-1",
    market: "KR",
    symbol: "KR:005930",
    side: "BUY",
    requestedNotionalKrw: replay.requestedNotionalKrw,
    requestedQuantity: replay.requestedNotionalKrw / replay.fillPriceKrw,
    quantityOverride: null,
    sourcePriceKrw: replay.sourcePriceKrw,
    sourcePriceEvidence,
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
    evidenceRefs: [input.evidence.evidenceRef, "fee-evidence-1"],
    asOf: "2026-09-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:01.000Z"
  });
}
