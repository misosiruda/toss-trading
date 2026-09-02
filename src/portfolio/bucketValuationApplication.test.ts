import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBucketEquityEvent,
  createBucketRiskState
} from "./bucketEquity.js";
import {
  createBucketPositionMarkHeadEvent,
  createBucketPositionMarkHeadState,
  parseBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import { foldBucketPositionMarkHeadHistory } from "./bucketPositionMarkHeadState.js";
import { resolveBucketValuationApplication } from "./bucketValuationApplication.js";
import { createBucketValuationMarkRecord } from "./bucketValuationMark.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("valuation application binds one equity event to every position event", () => {
  const fixture = applicationFixture();

  const resolved = resolveBucketValuationApplication(fixture.input);

  assert.equal(resolved.bucketEquityEvent.eventType, "valuation");
  assert.equal(
    resolved.bucketEquityEvent.previousBucketEquityEventId,
    fixture.riskState.lastBucketEquityEventId
  );
  assert.equal(
    resolved.bucketEquityEvent.equityDeltaKrw,
    fixture.mark.equityDeltaKrw
  );
  assert.deepEqual(
    resolved.bucketEquityEvent.evidenceRefs,
    [
      fixture.samsungEvidence.evidenceRef,
      fixture.hynixEvidence.evidenceRef
    ].sort()
  );
  assert.deepEqual(
    resolved.positionMarkHeadEvents.map((event) => event.symbol),
    ["000660", "005930"]
  );
  assert.equal(resolved.resultingRiskState.equityKrw, 1_010);
  assert.equal(resolved.resultingRiskState.unitNavKrw, 1.01);
  assert.equal(
    resolved.resultingRiskState.lastBucketEquityEventId,
    resolved.bucketEquityEvent.bucketEquityEventId
  );
  for (const event of resolved.positionMarkHeadEvents) {
    assert.equal(
      event.bucketEquityEventId,
      resolved.bucketEquityEvent.bucketEquityEventId
    );
    assert.equal(
      event.bucketEquityEventHash,
      resolved.bucketEquityEvent.bucketEquityEventHash
    );
    assert.equal(
      event.bucketValuationMarkRecordId,
      fixture.mark.bucketValuationMarkRecordId
    );
  }
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.positionMarkHeadEvents));
});

test("valuation application rejects foreign risk scope and policy", () => {
  const fixture = applicationFixture();
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ bucket: "long_term" })
      }),
    /scope mismatch/
  );
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ policyHash: HASH_C })
      }),
    /policy mismatch/
  );
});

test("valuation application rejects stale, ahead, and corrupt risk states", () => {
  const fixture = applicationFixture();
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ asOf: "2026-09-01T00:59:59.999Z" })
      }),
    /predates a position mark head/
  );
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ asOf: "2026-09-01T02:00:00.001Z" })
      }),
    /ahead of the mark/
  );
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: { ...fixture.riskState, riskStateHash: HASH_C }
      }),
    /hash does not match/
  );
});

test("valuation application rejects active positions in an empty risk epoch", () => {
  const fixture = applicationFixture();
  const empty = createBucketRiskState({
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    drawdownSemanticsHash: HASH_A,
    units: 0,
    unitNavKrw: 1,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 0,
    drawdownRatio: 0,
    lastBucketEquityEventId: "bucket-equity-head",
    asOf: "2026-09-01T01:30:00.000Z"
  });
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: empty
      }),
    /active positions cannot use an empty risk epoch/
  );

  const hynixNetZeroEvidence = priceEvidence({
    symbol: "000660",
    priceKrw: 140,
    sourceRefs: ["hynix-net-zero-source"]
  });
  const netZeroMark = createBucketValuationMarkRecord({
    portfolioId: fixture.mark.portfolioId,
    bucket: fixture.mark.bucket,
    policyHash: fixture.mark.policyHash,
    positionInputs: fixture.mark.positionInputs.map((position) =>
      position.symbol === "000660"
        ? {
            ...position,
            currentPriceKrw: hynixNetZeroEvidence.priceKrw,
            currentPriceEvidenceRef: hynixNetZeroEvidence.evidenceRef
          }
        : position
    ),
    equityDeltaKrw: 0,
    asOf: fixture.mark.asOf,
    createdAt: fixture.mark.createdAt
  });
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        value: netZeroMark,
        currentPriceEvidence: [
          fixture.samsungEvidence,
          hynixNetZeroEvidence
        ],
        currentRiskState: empty
      }),
    /active positions cannot use an empty risk epoch/
  );
});

test("valuation application preserves prior event creation chronology", () => {
  const fixture = applicationFixture({
    samsungHeadCreatedAt: "2026-09-01T03:00:00.000Z"
  });

  const resolved = resolveBucketValuationApplication(fixture.input);
  const samsungEvent = resolved.positionMarkHeadEvents.find(
    (event) => event.symbol === "005930"
  );

  assert.ok(samsungEvent);
  assert.equal(samsungEvent?.createdAt, "2026-09-01T03:00:00.000Z");
  assert.doesNotThrow(() =>
    foldBucketPositionMarkHeadHistory([
      fixture.samsungHeadEvent,
      samsungEvent
    ])
  );
});

test("valuation application requires the complete current event set", () => {
  const fixture = applicationFixture();

  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentPositionEvents: [fixture.samsungHeadEvent]
      }),
    /complete active set/
  );
});

test("valuation application supports the complete 129-position mark", () => {
  const origins = Array.from({ length: 129 }, (_, index) => {
    const symbol = `S${index.toString().padStart(5, "0")}`;
    const origin = positionOrigin({
      symbol,
      currentPriceEvidenceRef: `before-${symbol}`
    });
    const evidence = priceEvidence({
      symbol,
      priceKrw: 101,
      sourceRefs: [`source-${symbol}`]
    });
    return { ...origin, evidence };
  });
  const mark = createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    positionInputs: origins.map(({ head, evidence }) =>
      valuationPosition(head, evidence)
    ),
    equityDeltaKrw: 258,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z"
  });

  const resolved = resolveBucketValuationApplication({
    value: mark,
    currentPositionStates: origins.map(({ head }) => head),
    currentPositionEvents: origins.map(({ event }) => event),
    currentPriceEvidence: origins.map(({ evidence }) => evidence),
    currentRiskState: riskState()
  });

  assert.equal(resolved.bucketEquityEvent.evidenceRefs.length, 129);
  assert.equal(resolved.positionMarkHeadEvents.length, 129);
});

test("valuation application emits independently verifiable event identities", () => {
  const fixture = applicationFixture();
  const resolved = resolveBucketValuationApplication(fixture.input);

  assert.deepEqual(
    parseBucketEquityEvent(resolved.bucketEquityEvent),
    resolved.bucketEquityEvent
  );
  for (const event of resolved.positionMarkHeadEvents) {
    assert.deepEqual(parseBucketPositionMarkHeadEvent(event), event);
  }
  assert.throws(
    () =>
      parseBucketEquityEvent({
        ...resolved.bucketEquityEvent,
        bucketValuationMarkRecordId: "foreign-mark"
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      parseBucketPositionMarkHeadEvent({
        ...resolved.positionMarkHeadEvents[0],
        bucketEquityEventHash: HASH_C
      }),
    /identity does not match/
  );
});

test("valuation application preserves the composed price-evidence gate", () => {
  const fixture = applicationFixture();
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentPriceEvidence: [
          fixture.samsungEvidence,
          { ...fixture.hynixEvidence, priceKrw: 146 }
        ]
      }),
    /identity does not match/
  );
});

function applicationFixture(
  overrides: Partial<{ samsungHeadCreatedAt: string }> = {}
) {
  const samsungOrigin = positionOrigin({
    ...(overrides.samsungHeadCreatedAt === undefined
      ? {}
      : { createdAt: overrides.samsungHeadCreatedAt })
  });
  const hynixOrigin = positionOrigin({
    symbol: "000660",
    currentPriceKrw: 150,
    currentPriceEvidenceRef: "hynix-before",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
  const samsung = samsungOrigin.head;
  const hynix = hynixOrigin.head;
  const samsungEvidence = priceEvidence();
  const hynixEvidence = priceEvidence({
    symbol: "000660",
    priceKrw: 145,
    sourceRefs: ["hynix-source"]
  });
  const mark = createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    positionInputs: [
      valuationPosition(samsung, samsungEvidence),
      valuationPosition(hynix, hynixEvidence)
    ],
    equityDeltaKrw: 10,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z"
  });
  const currentRiskState = riskState();
  return {
    mark,
    riskState: currentRiskState,
    samsungEvidence,
    hynixEvidence,
    samsungHeadEvent: samsungOrigin.event,
    hynixHeadEvent: hynixOrigin.event,
    input: {
      value: mark,
      currentPositionStates: [hynix, samsung],
      currentPositionEvents: [hynixOrigin.event, samsungOrigin.event],
      currentPriceEvidence: [samsungEvidence, hynixEvidence],
      currentRiskState
    }
  };
}

function positionOrigin(
  overrides: Partial<{
    symbol: string;
    currentPriceKrw: number;
    currentPriceEvidenceRef: string;
    createdAt: string;
  }> = {}
) {
  const symbol = overrides.symbol ?? "005930";
  const currentPriceKrw = overrides.currentPriceKrw ?? 100;
  const currentPriceEvidenceRef =
    overrides.currentPriceEvidenceRef ?? "samsung-before";
  const event = createBucketPositionMarkHeadEvent({
    eventType: "initialized",
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol,
    resultingQuantity: 2,
    resultingPriceKrw: currentPriceKrw,
    resultingPriceEvidenceRef: currentPriceEvidenceRef,
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef: `observed-${symbol}`,
      markEvidenceRef: currentPriceEvidenceRef
    },
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-01T01:00:01.000Z"
  });
  const head = createBucketPositionMarkHeadState({
    portfolioId: event.portfolioId,
    bucket: event.bucket,
    market: event.market,
    symbol: event.symbol,
    quantity: event.resultingQuantity,
    currentPriceKrw: event.resultingPriceKrw,
    currentPriceEvidenceRef: event.resultingPriceEvidenceRef,
    lastPositionMarkHeadEventId: event.positionMarkHeadEventId,
    lastPositionMarkHeadEventHash: event.positionMarkHeadEventHash,
    asOf: event.asOf
  });
  return { event, head };
}

function priceEvidence(
  overrides: Partial<{
    symbol: string;
    priceKrw: number;
    sourceRefs: string[];
  }> = {}
) {
  return createSourcePriceEvidenceRecord({
    sourceContractId: "contract-v1",
    market: "KR",
    symbol: overrides.symbol ?? "005930",
    priceField: "last_price",
    priceKrw: overrides.priceKrw ?? 110,
    observedAt: "2026-09-01T02:00:00.000Z",
    sourceRefs: overrides.sourceRefs ?? ["samsung-source"],
    createdAt: "2026-09-01T02:00:00.000Z"
  });
}

function valuationPosition(
  head: ReturnType<typeof createBucketPositionMarkHeadState>,
  evidence: ReturnType<typeof priceEvidence>
) {
  return {
    market: head.market,
    symbol: head.symbol,
    quantity: head.quantity,
    previousPositionMarkHeadId: head.positionMarkHeadId,
    previousPositionMarkHeadHash: head.positionMarkHeadHash,
    previousPriceKrw: head.currentPriceKrw,
    currentPriceKrw: evidence.priceKrw,
    previousPriceEvidenceRef: head.currentPriceEvidenceRef,
    currentPriceEvidenceRef: evidence.evidenceRef
  };
}

function riskState(
  overrides: Partial<{
    bucket: "long_term" | "swing";
    policyHash: typeof HASH_B | typeof HASH_C;
    asOf: string;
  }> = {}
) {
  return createBucketRiskState({
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: overrides.bucket ?? "swing",
    policyHash: overrides.policyHash ?? HASH_B,
    drawdownSemanticsHash: HASH_A,
    units: 1_000,
    unitNavKrw: 1,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 1_000,
    drawdownRatio: 0,
    lastBucketEquityEventId: "bucket-equity-head",
    asOf: overrides.asOf ?? "2026-09-01T01:30:00.000Z"
  });
}
