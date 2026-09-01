import assert from "node:assert/strict";
import test from "node:test";

import {
  type BucketEquityEvent,
  createBucketEquityEvent
} from "./bucketEquity.js";
import { foldBucketEquityHistory } from "./bucketEquityState.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("bucket equity replay derives unit flows, NAV, HWM, and drawdown", () => {
  const initialized = initialization();
  const allocation = capitalFlow(initialized, 500, 0, "fill-buy");
  const valuation = createBucketEquityEvent({
    ...chained(allocation),
    eventType: "valuation",
    equityDeltaKrw: -150,
    bucketValuationMarkRecordId: "valuation-1",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["mark-a"]
  });
  const cost = executionCost(valuation, -15, "fill-buy");
  const deallocation = capitalFlow(cost, -445, 1, "fill-sell");

  const snapshot = foldBucketEquityHistory([
    initialized,
    allocation,
    valuation,
    cost,
    deallocation
  ]);
  const state = snapshot.states[0];
  assert.ok(state);
  assert.equal(state.equityKrw, 890);
  assert.equal(state.units, 1_000);
  assert.equal(state.unitNavKrw, 0.89);
  assert.equal(state.highWaterMarkUnitNavKrw, 1);
  assert.equal(state.drawdownRatio, 1 - 0.89 / 1);
  assert.equal(state.lastBucketEquityEventId, deallocation.bucketEquityEventId);
});

test("bucket equity replay preserves an empty epoch NAV until reset", () => {
  const initialized = initialization();
  const gain = createBucketEquityEvent({
    ...chained(initialized),
    eventType: "valuation",
    equityDeltaKrw: 100,
    bucketValuationMarkRecordId: "valuation-gain",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["mark-a"]
  });
  const emptied = capitalFlow(gain, -1_100, 1, "fill-exit");
  const emptyState = foldBucketEquityHistory([
    initialized,
    gain,
    emptied
  ]).states[0];
  assert.ok(emptyState);
  assert.equal(emptyState.units, 0);
  assert.equal(emptyState.equityKrw, 0);
  assert.equal(emptyState.unitNavKrw, 1.1);
  assert.equal(emptyState.highWaterMarkUnitNavKrw, 1.1);

  const reset = initialization({
    riskStateEpochId: "epoch-2",
    activationId: "activation-2",
    policyHash: HASH_B,
    initialEquityKrw: 0,
    initialUnits: 0,
    asOf: "2026-09-02T00:00:00.000Z"
  });
  const resetState = foldBucketEquityHistory([
    initialized,
    gain,
    emptied,
    reset
  ]).states[0];
  assert.ok(resetState);
  assert.equal(resetState.riskStateEpochId, "epoch-2");
  assert.equal(resetState.unitNavKrw, 1);
  assert.equal(resetState.highWaterMarkUnitNavKrw, 1);
});

test("bucket equity replay carries exact state across compatible policy epochs", () => {
  const initialized = initialization();
  const loss = createBucketEquityEvent({
    ...chained(initialized),
    eventType: "valuation",
    equityDeltaKrw: -200,
    bucketValuationMarkRecordId: "valuation-loss",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["mark-a"]
  });
  const carried = createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-2",
    activationId: "activation-2",
    previousRiskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_B,
    drawdownSemanticsHash: HASH_B,
    initializationMode: "carried_forward",
    initialEquityKrw: 800,
    initialUnits: 1_000,
    initialUnitNavKrw: 0.8,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-02T00:00:00.000Z"
  });

  const state = foldBucketEquityHistory([initialized, loss, carried]).states[0];
  assert.ok(state);
  assert.equal(state.riskStateEpochId, "epoch-2");
  assert.equal(state.policyHash, HASH_B);
  assert.equal(state.drawdownRatio, 0.19999999999999996);
});

test("bucket equity replay rejects branches, stale epochs, scope drift, and chronology regressions", () => {
  const initialized = initialization();
  const first = capitalFlow(initialized, 100, 0, "fill-1");
  const branch = capitalFlow(initialized, 200, 0, "fill-2");
  assert.throws(
    () => foldBucketEquityHistory([initialized, first, branch]),
    /predecessor does not match current head/
  );

  const foreignPolicy = createBucketEquityEvent({
    ...chained(initialized),
    policyHash: HASH_C,
    eventType: "valuation",
    equityDeltaKrw: 0,
    bucketValuationMarkRecordId: "valuation-foreign",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["mark-a"]
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, foreignPolicy]),
    /policy does not match/
  );

  const regressed = capitalFlow(
    initialized,
    100,
    0,
    "fill-regressed",
    "2026-08-31T23:59:59.000Z"
  );
  assert.throws(
    () => foldBucketEquityHistory([initialized, regressed]),
    /asOf cannot move backward/
  );

  const foreignScope = capitalFlow(initialized, 100, 0, "fill-foreign", undefined, {
    portfolioId: "portfolio-2"
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, foreignScope]),
    /appears before epoch initialization/
  );
});

test("bucket equity replay rejects fabricated epoch carry and non-empty resets", () => {
  const initialized = initialization();
  const reset = initialization({
    riskStateEpochId: "epoch-2",
    activationId: "activation-2",
    policyHash: HASH_C,
    asOf: "2026-09-02T00:00:00.000Z"
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, reset]),
    /requires an empty previous state/
  );

  const unknownCarry = carriedInitialization({
    previousRiskStateEpochId: "epoch-missing"
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, unknownCarry]),
    /not the current epoch successor/
  );

  const changedSemantics = carriedInitialization({
    drawdownSemanticsHash: HASH_C
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, changedSemantics]),
    /changes drawdown semantics/
  );

  const changedState = carriedInitialization({
    initialEquityKrw: 999,
    initialUnits: 999
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, changedState]),
    /does not preserve risk state/
  );
});

test("bucket equity replay rejects excessive burns and invalid equity deltas", () => {
  const initialized = initialization();
  const excessiveBurn = capitalFlow(initialized, -1_001, 1, "fill-burn");
  assert.throws(
    () => foldBucketEquityHistory([initialized, excessiveBurn]),
    /burn exceeds current units/
  );

  const excessiveLoss = createBucketEquityEvent({
    ...chained(initialized),
    eventType: "valuation",
    equityDeltaKrw: -1_001,
    bucketValuationMarkRecordId: "valuation-loss",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["mark-a"]
  });
  assert.throws(
    () => foldBucketEquityHistory([initialized, excessiveLoss]),
    /negative or non-finite balance/
  );

  const huge = initialization({
    initialEquityKrw: Number.MAX_VALUE,
    initialUnits: Number.MAX_VALUE
  });
  const invisibleFlow = capitalFlow(huge, 0.5, 0, "fill-sub-precision");
  assert.throws(
    () => foldBucketEquityHistory([huge, invisibleFlow]),
    /unit flow is below numeric precision/
  );

  const invisibleDelta = createBucketEquityEvent({
    ...chained(huge),
    eventType: "valuation",
    equityDeltaKrw: 0.5,
    bucketValuationMarkRecordId: "valuation-sub-precision",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["mark-a"]
  });
  assert.throws(
    () => foldBucketEquityHistory([huge, invisibleDelta]),
    /delta is below numeric precision/
  );
});

test("bucket equity replay returns current states in canonical scope order", () => {
  const swing = initialization({
    portfolioId: "portfolio-2",
    bucket: "swing",
    riskStateEpochId: "epoch-swing",
    activationId: "activation-swing"
  });
  const intraday = initialization();
  const hedge = initialization({
    bucket: "hedge",
    riskStateEpochId: "epoch-hedge",
    activationId: "activation-hedge"
  });
  const states = foldBucketEquityHistory([swing, intraday, hedge]).states;
  assert.deepEqual(
    states.map((state) => [state.portfolioId, state.bucket]),
    [
      ["portfolio-1", "hedge"],
      ["portfolio-1", "intraday"],
      ["portfolio-2", "swing"]
    ]
  );
});

function initialization(
  overrides: Partial<Parameters<typeof createBucketEquityEvent>[0]> = {}
): BucketEquityEvent {
  return createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-1",
    activationId: "activation-1",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    initializationMode: "initial_or_empty",
    initialEquityKrw: 1_000,
    initialUnits: 1_000,
    initialUnitNavKrw: 1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-01T00:00:00.000Z",
    ...overrides
  } as Parameters<typeof createBucketEquityEvent>[0]);
}

function carriedInitialization(
  overrides: Partial<Parameters<typeof createBucketEquityEvent>[0]> = {}
): BucketEquityEvent {
  return createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-2",
    activationId: "activation-2",
    previousRiskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_C,
    drawdownSemanticsHash: HASH_B,
    initializationMode: "carried_forward",
    initialEquityKrw: 1_000,
    initialUnits: 1_000,
    initialUnitNavKrw: 1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-02T00:00:00.000Z",
    ...overrides
  } as Parameters<typeof createBucketEquityEvent>[0]);
}

function chained(previous: BucketEquityEvent) {
  return {
    previousBucketEquityEventId: previous.bucketEquityEventId,
    riskStateEpochId: previous.riskStateEpochId,
    portfolioId: previous.portfolioId,
    bucket: previous.bucket,
    policyHash: previous.policyHash,
    asOf: "2026-09-01T01:00:00.000Z"
  };
}

function capitalFlow(
  previous: BucketEquityEvent,
  amountKrw: number,
  sequence: 0 | 1,
  fillId: string,
  asOf = "2026-09-01T01:00:00.000Z",
  overrides: { portfolioId?: string } = {}
): BucketEquityEvent {
  return createBucketEquityEvent({
    ...chained(previous),
    ...overrides,
    asOf,
    eventType: "capital_flow",
    amountKrw,
    rebalancePlanId: `plan-${fillId}`,
    rebalanceActionId: `action-${fillId}`,
    fillId,
    paperFillRecordId: `record-${fillId}`,
    paperFillHash: HASH_C,
    fillAccountingGroupId: `group-${fillId}`,
    fillAccountingSequence: sequence
  });
}

function executionCost(
  previous: BucketEquityEvent,
  equityDeltaKrw: number,
  fillId: string
): BucketEquityEvent {
  return createBucketEquityEvent({
    ...chained(previous),
    eventType: "execution_cost",
    equityDeltaKrw,
    rebalancePlanId: `plan-${fillId}`,
    rebalanceActionId: `action-${fillId}`,
    fillId,
    paperFillRecordId: `record-${fillId}`,
    paperFillHash: HASH_C,
    fillAccountingGroupId: `group-${fillId}`,
    fillAccountingSequence: 1,
    evidenceRefs: ["cost-a"]
  });
}
