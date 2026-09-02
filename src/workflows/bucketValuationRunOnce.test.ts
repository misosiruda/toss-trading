import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBucketEquityEvent } from "../portfolio/bucketEquity.js";
import { BucketEquityFileRepository } from "../portfolio/bucketEquityFiles.js";
import { createBucketPositionMarkHeadEvent } from "../portfolio/bucketPositionMarkHead.js";
import { BucketPositionMarkHeadFileRepository } from "../portfolio/bucketPositionMarkHeadFiles.js";
import { BucketValuationApplicationFileRepository } from "../portfolio/bucketValuationApplicationFiles.js";
import { createBucketValuationMarkRecord } from "../portfolio/bucketValuationMark.js";
import { BucketValuationMarkFileRepository } from "../portfolio/bucketValuationMarkFiles.js";
import { compareText } from "../portfolio/runtimePolicyContracts.js";
import { createSourcePriceEvidenceRecord } from "../portfolio/sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "../portfolio/sourcePriceEvidenceFiles.js";
import {
  bucketValuationRunOnceInputSchema,
  runBucketValuationOnce
} from "./bucketValuationRunOnce.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("bucket valuation run builds and atomically applies one durable mark", async () => {
  await withFixture(async (fixture) => {
    const applied = await runBucketValuationOnce(fixture.input);
    const retried = await runBucketValuationOnce(fixture.input);

    assert.equal(applied.alreadyApplied, false);
    assert.equal(retried.alreadyApplied, true);
    assert.equal(applied.record.equityDeltaKrw, 10);
    assert.deepEqual(
      applied.record.positionInputs.map((position) => [
        position.symbol,
        position.previousPriceKrw,
        position.currentPriceKrw
      ]),
      [
        ["000660", 150, 145],
        ["005930", 100, 110]
      ]
    );
    const snapshot =
      await new BucketValuationApplicationFileRepository(
        fixture.baseDir
      ).readSnapshot();
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.equity.events.length, 2);
    assert.equal(snapshot.equity.states[0]?.equityKrw, 1_010);
    assert.equal(snapshot.positions.events.length, 4);

    const alternateSamsungEvidence = priceEvidence({
      sourceContractId: "contract-v2"
    });
    await new SourcePriceEvidenceFileRepository(fixture.baseDir).append(
      alternateSamsungEvidence
    );
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          currentPriceEvidenceRefs: [
            fixture.evidence.find((record) => record.symbol === "000660")!
              .evidenceRef,
            alternateSamsungEvidence.evidenceRef
          ].sort(compareText)
        }),
      /stored origin evidence mismatch/
    );
  });
});

test("bucket valuation run requires a canonical complete evidence set", async () => {
  await withFixture(async (fixture) => {
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          currentPriceEvidenceRefs: [fixture.evidence[0]!.evidenceRef]
        }),
      /cover every active position exactly once/
    );
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          currentPriceEvidenceRefs: [
            fixture.evidence[0]!.evidenceRef,
            fixture.evidence[0]!.evidenceRef
          ]
        }),
      /must be unique/
    );
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          currentPriceEvidenceRefs: [
            ...fixture.input.currentPriceEvidenceRefs
          ].reverse()
        }),
      /must use canonical order/
    );

    const unrelated = priceEvidence({ symbol: "035420", price: 210 });
    await new SourcePriceEvidenceFileRepository(fixture.baseDir).append(
      unrelated
    );
    const oneCorrectOneUnrelated = [
      fixture.evidence[0]!.evidenceRef,
      unrelated.evidenceRef
    ].sort(compareText);
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          currentPriceEvidenceRefs: oneCorrectOneUnrelated
        }),
      /evidence scope does not resolve exactly once/
    );
    assert.deepEqual(
      await new BucketValuationMarkFileRepository(fixture.baseDir).readAll(),
      []
    );
  });
});

test("bucket valuation run completes an exact standalone stored mark", async () => {
  await withFixture(async (fixture) => {
    const positionSnapshot =
      await new BucketPositionMarkHeadFileRepository(
        fixture.baseDir
      ).readSnapshot();
    const evidenceBySymbol = new Map(
      fixture.evidence.map((record) => [record.symbol, record])
    );
    const positionInputs = positionSnapshot.states.map((state) => {
      const evidence = evidenceBySymbol.get(state.symbol);
      assert.ok(evidence);
      return {
        market: state.market,
        symbol: state.symbol,
        quantity: state.quantity,
        previousPositionMarkHeadId: state.positionMarkHeadId,
        previousPositionMarkHeadHash: state.positionMarkHeadHash,
        previousPriceKrw: state.currentPriceKrw,
        currentPriceKrw: evidence.priceKrw,
        previousPriceEvidenceRef: state.currentPriceEvidenceRef,
        currentPriceEvidenceRef: evidence.evidenceRef
      };
    });
    const mark = createBucketValuationMarkRecord({
      portfolioId: fixture.input.portfolioId,
      bucket: fixture.input.bucket,
      policyHash: fixture.input.policyHash,
      positionInputs,
      equityDeltaKrw: 10,
      asOf: fixture.input.asOf,
      createdAt: fixture.input.createdAt
    });
    await new BucketValuationMarkFileRepository(fixture.baseDir).append(mark);

    const applied = await runBucketValuationOnce(fixture.input);

    assert.equal(applied.alreadyApplied, false);
    assert.deepEqual(applied.record, mark);
    assert.equal(
      (
        await new BucketValuationApplicationFileRepository(
          fixture.baseDir
        ).readSnapshot()
      ).equity.events.length,
      2
    );
  });
});

test("bucket valuation run fails closed for policy and chronology drift", async () => {
  await withFixture(async (fixture) => {
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          policyHash: HASH_A
        }),
      /risk state policy mismatch/
    );
    await assert.rejects(
      () =>
        runBucketValuationOnce({
          ...fixture.input,
          createdAt: "2026-09-01T01:59:59.999Z"
        }),
      /cannot be created before its asOf/
    );
    assert.deepEqual(
      await new BucketValuationMarkFileRepository(fixture.baseDir).readAll(),
      []
    );
  });
});

test("bucket valuation run input rejects shape and canonicalization drift", () => {
  assert.equal(
    bucketValuationRunOnceInputSchema.safeParse({
      storageBaseDir: " data/paper",
      portfolioId: "portfolio-1",
      bucket: "swing",
      policyHash: HASH_B,
      currentPriceEvidenceRefs: ["evidence-1"],
      asOf: "2026-09-01T02:00:00.000Z",
      createdAt: "2026-09-01T02:00:01.000Z"
    }).success,
    false
  );
  assert.equal(
    bucketValuationRunOnceInputSchema.safeParse({
      storageBaseDir: "data/paper",
      portfolioId: "portfolio-1",
      bucket: "swing",
      policyHash: HASH_B,
      currentPriceEvidenceRefs: ["evidence-1"],
      asOf: "2026-09-01T02:00:00.000Z",
      createdAt: "2026-09-01T02:00:01.000Z",
      liveOrder: true
    }).success,
    false
  );
});

interface Fixture {
  baseDir: string;
  evidence: readonly ReturnType<typeof createSourcePriceEvidenceRecord>[];
  input: {
    storageBaseDir: string;
    portfolioId: string;
    bucket: "swing";
    policyHash: typeof HASH_B;
    currentPriceEvidenceRefs: string[];
    asOf: string;
    createdAt: string;
  };
}

async function withFixture(
  operation: (fixture: Fixture) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "bucket-valuation-run-"));
  try {
    await new BucketEquityFileRepository(baseDir).append(initialRiskEvent());
    const positionRepository = new BucketPositionMarkHeadFileRepository(
      baseDir
    );
    for (const root of [
      positionRoot(),
      positionRoot({ symbol: "000660", price: 150 })
    ]) {
      await positionRepository.append(root);
    }
    const evidence = Object.freeze([
      priceEvidence(),
      priceEvidence({ symbol: "000660", price: 145 })
    ]);
    const evidenceRepository = new SourcePriceEvidenceFileRepository(baseDir);
    for (const record of evidence) {
      await evidenceRepository.append(record);
    }
    await operation({
      baseDir,
      evidence,
      input: {
        storageBaseDir: baseDir,
        portfolioId: "portfolio-1",
        bucket: "swing",
        policyHash: HASH_B,
        currentPriceEvidenceRefs: evidence
          .map((record) => record.evidenceRef)
          .sort(compareText),
        asOf: "2026-09-01T02:00:00.000Z",
        createdAt: "2026-09-01T02:00:01.000Z"
      }
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function initialRiskEvent() {
  return createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-1",
    activationId: "activation-1",
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    drawdownSemanticsHash: HASH_A,
    initializationMode: "initial_or_empty",
    initialEquityKrw: 1_000,
    initialUnits: 1_000,
    initialUnitNavKrw: 1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-01T01:30:00.000Z"
  });
}

function positionRoot(
  overrides: Partial<{ symbol: string; price: number }> = {}
) {
  const symbol = overrides.symbol ?? "005930";
  const evidenceRef = `before-${symbol}`;
  return createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol,
    eventType: "initialized",
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef: `observed-${symbol}`,
      markEvidenceRef: evidenceRef
    },
    resultingQuantity: 2,
    resultingPriceKrw: overrides.price ?? 100,
    resultingPriceEvidenceRef: evidenceRef,
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
}

function priceEvidence(
  overrides: Partial<{
    symbol: string;
    price: number;
    sourceContractId: string;
  }> = {}
) {
  const symbol = overrides.symbol ?? "005930";
  return createSourcePriceEvidenceRecord({
    sourceContractId: overrides.sourceContractId ?? "contract-v1",
    market: "KR",
    symbol,
    priceField: "last_price",
    priceKrw: overrides.price ?? 110,
    observedAt: "2026-09-01T02:00:00.000Z",
    sourceRefs: [`source-${symbol}`],
    createdAt: "2026-09-01T02:00:00.000Z"
  });
}
