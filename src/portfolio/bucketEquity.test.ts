import assert from "node:assert/strict";
import test from "node:test";

import {
  createBucketEquityEvent,
  createBucketRiskState,
  parseBucketEquityEvent,
  parseBucketRiskState
} from "./bucketEquity.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("bucket equity epoch variants hash the complete initialization payload", () => {
  const initialized = epochInitialized();
  assert.equal(initialized.eventType, "epoch_initialized");
  assert.match(initialized.bucketEquityEventId, /^bucket_equity_event_/);
  assert.deepEqual(parseBucketEquityEvent(initialized), initialized);

  const carried = createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-2",
    activationId: "activation-2",
    previousRiskStateEpochId: initialized.riskStateEpochId,
    portfolioId: initialized.portfolioId,
    bucket: initialized.bucket,
    policyHash: HASH_B,
    drawdownSemanticsHash: initialized.drawdownSemanticsHash,
    initializationMode: "carried_forward",
    initialEquityKrw: 800,
    initialUnits: 1_000,
    initialUnitNavKrw: 0.8,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-02T00:00:00.000Z"
  });
  assert.deepEqual(parseBucketEquityEvent(carried), carried);
  assert.notEqual(
    carried.bucketEquityEventHash,
    initialized.bucketEquityEventHash
  );

  const fractionalNav = createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-3",
    activationId: "activation-3",
    previousRiskStateEpochId: carried.riskStateEpochId,
    portfolioId: initialized.portfolioId,
    bucket: initialized.bucket,
    policyHash: HASH_C,
    drawdownSemanticsHash: initialized.drawdownSemanticsHash,
    initializationMode: "carried_forward",
    initialEquityKrw: 3 * 0.1,
    initialUnits: 3,
    initialUnitNavKrw: 0.1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-03T00:00:00.000Z"
  });
  assert.deepEqual(parseBucketEquityEvent(fractionalNav), fractionalNav);

  const divisionDerivedNav = createBucketEquityEvent({
    eventType: "epoch_initialized",
    riskStateEpochId: "epoch-4",
    activationId: "activation-4",
    previousRiskStateEpochId: fractionalNav.riskStateEpochId,
    portfolioId: initialized.portfolioId,
    bucket: initialized.bucket,
    policyHash: HASH_A,
    drawdownSemanticsHash: initialized.drawdownSemanticsHash,
    initializationMode: "carried_forward",
    initialEquityKrw: 31,
    initialUnits: 39,
    initialUnitNavKrw: 31 / 39,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-04T00:00:00.000Z"
  });
  assert.deepEqual(
    parseBucketEquityEvent(divisionDerivedNav),
    divisionDerivedNav
  );
});

test("bucket equity initialization rejects baseline and unit fabrication", () => {
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...epochPayload(),
        initialUnits: 999
      }),
    /equity must equal units multiplied by unit NAV/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        eventType: "epoch_initialized",
        riskStateEpochId: "epoch-underflow",
        activationId: "activation-underflow",
        previousRiskStateEpochId: "epoch-1",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        initializationMode: "carried_forward",
        initialEquityKrw: 0,
        initialUnits: Number.MIN_VALUE,
        initialUnitNavKrw: 0.5,
        initialHighWaterMarkUnitNavKrw: 1,
        asOf: "2026-09-02T00:00:00.000Z"
      }),
    /equity must equal units multiplied by unit NAV/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        eventType: "epoch_initialized",
        riskStateEpochId: "epoch-self",
        activationId: "activation-self",
        previousRiskStateEpochId: "epoch-self",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        initializationMode: "carried_forward",
        initialEquityKrw: 1,
        initialUnits: 1,
        initialUnitNavKrw: 1,
        initialHighWaterMarkUnitNavKrw: 1,
        asOf: "2026-09-02T00:00:00.000Z"
      }),
    /cannot reference itself/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...epochPayload(),
        initialUnitNavKrw: 0.9,
        initialEquityKrw: 900,
        initialHighWaterMarkUnitNavKrw: 1
      }),
    /initial or empty epoch must start at unit NAV one/
  );
  assert.throws(
    () =>
      createBucketEquityEvent(
        {
          ...epochPayload(),
          previousRiskStateEpochId: "fabricated-epoch"
        } as unknown as Parameters<typeof createBucketEquityEvent>[0]
      ),
    /unrecognized key|Invalid input/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        eventType: "epoch_initialized",
        riskStateEpochId: "epoch-2",
        activationId: "activation-2",
        previousRiskStateEpochId: "epoch-1",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        initializationMode: "carried_forward",
        initialEquityKrw: 1_000,
        initialUnits: 1_000,
        initialUnitNavKrw: 1,
        initialHighWaterMarkUnitNavKrw: 0.9,
        asOf: "2026-09-02T00:00:00.000Z"
      }),
    /high-water mark cannot be below unit NAV/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        eventType: "epoch_initialized",
        riskStateEpochId: "epoch-overflow",
        activationId: "activation-overflow",
        previousRiskStateEpochId: "epoch-1",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        initializationMode: "carried_forward",
        initialEquityKrw: 0,
        initialUnits: Number.MAX_VALUE,
        initialUnitNavKrw: 2,
        initialHighWaterMarkUnitNavKrw: 2,
        asOf: "2026-09-02T00:00:00.000Z"
      }),
    /equity must equal units multiplied by unit NAV/
  );
});

test("bucket equity chained variants preserve exact origins and canonical evidence", () => {
  const initialized = epochInitialized();
  const capitalFlow = createBucketEquityEvent({
    ...chainedPayload(initialized.bucketEquityEventId),
    eventType: "capital_flow",
    amountKrw: 500,
    ...fillOrigin(0)
  });
  const valuation = createBucketEquityEvent({
    ...chainedPayload(capitalFlow.bucketEquityEventId),
    eventType: "valuation",
    equityDeltaKrw: -25,
    bucketValuationMarkRecordId: "valuation-mark-1",
    valuationMarkHash: HASH_C,
    evidenceRefs: ["price-b", "price-a"]
  });
  assert.equal(valuation.eventType, "valuation");
  assert.deepEqual(valuation.evidenceRefs, ["price-a", "price-b"]);

  const cost = createBucketEquityEvent({
    ...chainedPayload(valuation.bucketEquityEventId),
    eventType: "execution_cost",
    equityDeltaKrw: -5,
    ...fillOrigin(1),
    evidenceRefs: ["fee-a"]
  });
  assert.deepEqual(parseBucketEquityEvent(capitalFlow), capitalFlow);
  assert.deepEqual(parseBucketEquityEvent(valuation), valuation);
  assert.deepEqual(parseBucketEquityEvent(cost), cost);
  assert.notEqual(capitalFlow.bucketEquityEventHash, cost.bucketEquityEventHash);

  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(cost.bucketEquityEventId),
        eventType: "valuation",
        equityDeltaKrw: 0,
        bucketValuationMarkRecordId: "valuation-mark-2",
        valuationMarkHash: HASH_C,
        evidenceRefs: ["same", "same"]
      }),
    /must not contain duplicates/
  );
});

test("bucket valuation evidence capacity matches the valuation mark position limit", () => {
  const initialized = epochInitialized();
  const evidenceRefs = Array.from(
    { length: 10_000 },
    (_, index) => `price-${index.toString().padStart(5, "0")}`
  );
  const valuation = createBucketEquityEvent({
    ...chainedPayload(initialized.bucketEquityEventId),
    eventType: "valuation",
    equityDeltaKrw: 0,
    bucketValuationMarkRecordId: "valuation-mark-large",
    valuationMarkHash: HASH_C,
    evidenceRefs
  });

  assert.equal(valuation.eventType, "valuation");
  assert.equal(valuation.evidenceRefs.length, 10_000);
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(valuation.bucketEquityEventId),
        eventType: "execution_cost",
        equityDeltaKrw: -1,
        ...fillOrigin(1),
        evidenceRefs: evidenceRefs.slice(0, 129)
      })
  );
});

test("bucket equity events reject invalid signs, sequences, and stored identity drift", () => {
  const initialized = epochInitialized();
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(initialized.bucketEquityEventId),
        eventType: "capital_flow",
        amountKrw: 0,
        ...fillOrigin(0)
      }),
    /amount cannot be zero/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(initialized.bucketEquityEventId),
        eventType: "capital_flow",
        amountKrw: 100,
        ...fillOrigin(1)
      }),
    /sign does not match its accounting sequence/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(initialized.bucketEquityEventId),
        eventType: "capital_flow",
        amountKrw: -100,
        ...fillOrigin(0)
      }),
    /sign does not match its accounting sequence/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...transferPayload(initialized.bucketEquityEventId),
        eventType: "strategy_transfer_out",
        transferSequence: 0,
        amountKrw: 100
      }),
    /out amount must be negative/
  );
  assert.throws(
    () =>
      createBucketEquityEvent(
        {
          ...transferPayload(initialized.bucketEquityEventId),
          eventType: "strategy_transfer_in",
          transferSequence: 0,
          amountKrw: 100
        } as unknown as Parameters<typeof createBucketEquityEvent>[0]
      ),
    /Invalid input/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(initialized.bucketEquityEventId),
        eventType: "execution_cost",
        equityDeltaKrw: 1,
        ...fillOrigin(0),
        evidenceRefs: ["fee-a"]
      }),
    /expected number to be <=0/
  );
  assert.throws(
    () =>
      createBucketEquityEvent({
        ...chainedPayload(initialized.bucketEquityEventId),
        eventType: "valuation",
        equityDeltaKrw: -0,
        bucketValuationMarkRecordId: "valuation-mark-1",
        valuationMarkHash: HASH_C,
        evidenceRefs: ["price-a"]
      }),
    /number must not be negative zero/
  );
  assert.throws(
    () =>
      parseBucketEquityEvent({
        ...initialized,
        initialEquityKrw: 999
      }),
    /identity does not match|equity must equal units multiplied/
  );
});

test("bucket risk state independently verifies equity, high-water mark, and drawdown", () => {
  const drawdownRatio = 1 - 0.8 / 1;
  const state = createBucketRiskState({
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    units: 1_000,
    unitNavKrw: 0.8,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 800,
    drawdownRatio,
    lastBucketEquityEventId: "bucket-event-1",
    asOf: "2026-09-01T01:00:00.000Z"
  });
  assert.deepEqual(parseBucketRiskState(state), state);
  assert.throws(
    () => parseBucketRiskState({ ...state, equityKrw: 801 }),
    /equity must equal units multiplied by unit NAV/
  );
  assert.throws(
    () => parseBucketRiskState({ ...state, drawdownRatio: 0.1 }),
    /drawdown ratio does not match/
  );
  assert.throws(
    () => parseBucketRiskState({ ...state, riskStateHash: HASH_C }),
    /hash does not match its payload/
  );

  const terminal = createBucketRiskState({
    riskStateEpochId: "epoch-terminal",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    units: 1_000,
    unitNavKrw: 0,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 0,
    drawdownRatio: 1,
    lastBucketEquityEventId: "bucket-event-terminal",
    asOf: "2026-09-01T02:00:00.000Z"
  });
  assert.deepEqual(parseBucketRiskState(terminal), terminal);
  const { riskStateHash: _terminalHash, ...terminalPayload } = terminal;
  assert.throws(
    () =>
      createBucketRiskState({
        ...terminalPayload,
        units: 0
      }),
    /empty bucket risk state must preserve a positive unit NAV/
  );

  const divisionDerivedUnitNav = 31 / 39;
  const divisionDerivedState = createBucketRiskState({
    riskStateEpochId: "epoch-2",
    portfolioId: "portfolio-1",
    bucket: "intraday",
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    units: 39,
    unitNavKrw: divisionDerivedUnitNav,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 31,
    drawdownRatio: 1 - divisionDerivedUnitNav / 1,
    lastBucketEquityEventId: "bucket-event-2",
    asOf: "2026-09-02T01:00:00.000Z"
  });
  assert.deepEqual(
    parseBucketRiskState(divisionDerivedState),
    divisionDerivedState
  );
  assert.throws(
    () =>
      createBucketRiskState({
        riskStateEpochId: "epoch-overflow",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        units: Number.MAX_VALUE,
        unitNavKrw: 2,
        highWaterMarkUnitNavKrw: 2,
        equityKrw: 0,
        drawdownRatio: 0,
        lastBucketEquityEventId: "bucket-event-overflow",
        asOf: "2026-09-03T01:00:00.000Z"
      }),
    /equity must equal units multiplied by unit NAV/
  );
  assert.throws(
    () =>
      createBucketRiskState({
        riskStateEpochId: "epoch-subnormal",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        units: Number.MIN_VALUE,
        unitNavKrw: 1,
        highWaterMarkUnitNavKrw: 1,
        equityKrw: 0,
        drawdownRatio: 0,
        lastBucketEquityEventId: "bucket-event-subnormal",
        asOf: "2026-09-04T01:00:00.000Z"
      }),
    /equity must equal units multiplied by unit NAV/
  );
  assert.throws(
    () =>
      createBucketRiskState({
        riskStateEpochId: "epoch-underflow",
        portfolioId: "portfolio-1",
        bucket: "intraday",
        policyHash: HASH_A,
        drawdownSemanticsHash: HASH_B,
        units: Number.MIN_VALUE,
        unitNavKrw: 0.5,
        highWaterMarkUnitNavKrw: 1,
        equityKrw: 0,
        drawdownRatio: 0.5,
        lastBucketEquityEventId: "bucket-event-underflow",
        asOf: "2026-09-04T01:00:00.000Z"
      }),
    /equity must equal units multiplied by unit NAV/
  );
});

function epochInitialized() {
  return createBucketEquityEvent(epochPayload());
}

function epochPayload() {
  return {
    eventType: "epoch_initialized" as const,
    riskStateEpochId: "epoch-1",
    activationId: "activation-1",
    portfolioId: "portfolio-1",
    bucket: "intraday" as const,
    policyHash: HASH_A,
    drawdownSemanticsHash: HASH_B,
    initializationMode: "initial_or_empty" as const,
    initialEquityKrw: 1_000,
    initialUnits: 1_000,
    initialUnitNavKrw: 1,
    initialHighWaterMarkUnitNavKrw: 1,
    asOf: "2026-09-01T00:00:00.000Z"
  };
}

function chainedPayload(previousBucketEquityEventId: string) {
  return {
    previousBucketEquityEventId,
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "intraday" as const,
    policyHash: HASH_A,
    asOf: "2026-09-01T01:00:00.000Z"
  };
}

function fillOrigin(fillAccountingSequence: 0 | 1) {
  return {
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId: "fill-1",
    paperFillRecordId: "paper-fill-1",
    paperFillHash: HASH_C,
    fillAccountingGroupId: "accounting-group-1",
    fillAccountingSequence
  };
}

function transferPayload(previousBucketEquityEventId: string) {
  return {
    ...chainedPayload(previousBucketEquityEventId),
    migrationRecordId: "migration-1",
    migrationRecordHash: HASH_C,
    transferGroupId: "transfer-group-1"
  };
}
