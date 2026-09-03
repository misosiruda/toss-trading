import assert from "node:assert/strict";
import test from "node:test";

import {
  createRebalancePlanExecutionAppliedEvent,
  parseRebalancePlanExecutionAppliedEvent
} from "./rebalancePlanExecutionAppliedEvent.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;
const HASH_D = `sha256:${"d".repeat(64)}` as const;

test("execution-applied event preserves one immutable fill transition", () => {
  const event = createRebalancePlanExecutionAppliedEvent(validInput());

  assert.deepEqual(parseRebalancePlanExecutionAppliedEvent(event), event);
  assert.match(event.planEventId, /^rebalance_plan_event_/);
  assert.equal(event.eventType, "execution_applied");
  assert.equal(Object.isFrozen(event), true);
});

test("execution-applied event identity covers fill and portfolio transition", () => {
  const first = createRebalancePlanExecutionAppliedEvent(validInput());
  const nextFill = createRebalancePlanExecutionAppliedEvent({
    ...validInput(),
    fillSequence: 1,
    fillId: "fill-2",
    paperFillRecordId: "paper-fill-2",
    cumulativeFilledNotionalKrw: 200,
    cumulativeFilledQuantity: 2,
    expectedPrePortfolioVersion: "portfolio-v2",
    expectedPrePortfolioSnapshotHash: HASH_D,
    resultingPortfolioVersion: "portfolio-v3",
    resultingPortfolioSnapshotHash: HASH_C
  });

  assert.notEqual(nextFill.planEventId, first.planEventId);
  assert.notEqual(nextFill.planEventHash, first.planEventHash);
});

test("execution-applied event permits slippage notional and rejects excess quantity", () => {
  const slipped = createRebalancePlanExecutionAppliedEvent({
    ...validInput(),
    filledNotionalKrw: 101,
    cumulativeFilledNotionalKrw: 101
  });
  assert.equal(slipped.filledNotionalKrw, 101);
  assert.throws(
    () =>
      createRebalancePlanExecutionAppliedEvent({
        ...validInput(),
        filledQuantity: 2
      }),
    /quantity exceeds its request/
  );
});

test("execution-applied event rejects cumulative and state transition drift", () => {
  assert.throws(
    () =>
      createRebalancePlanExecutionAppliedEvent({
        ...validInput(),
        cumulativeFilledNotionalKrw: 99
      }),
    /cumulative fill is below current fill/
  );
  assert.throws(
    () =>
      createRebalancePlanExecutionAppliedEvent({
        ...validInput(),
        resultingPortfolioVersion: "portfolio-v1"
      }),
    /must advance portfolio state/
  );
  assert.throws(
    () =>
      createRebalancePlanExecutionAppliedEvent({
        ...validInput(),
        resultingPortfolioSnapshotHash: HASH_B
      }),
    /must advance portfolio state/
  );
});

test("execution-applied event rejects tampered identity and noncanonical shape", () => {
  const event = createRebalancePlanExecutionAppliedEvent(validInput());
  assert.throws(
    () =>
      parseRebalancePlanExecutionAppliedEvent({
        ...event,
        paperFillHash: HASH_D
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      parseRebalancePlanExecutionAppliedEvent({
        ...event,
        planEventHash: HASH_D
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      createRebalancePlanExecutionAppliedEvent({
        ...validInput(),
        unexpected: true
      } as Parameters<typeof createRebalancePlanExecutionAppliedEvent>[0]),
    /Unrecognized key/
  );
});

function validInput() {
  return {
    previousPlanEventId: "plan-event-approved",
    eventType: "execution_applied" as const,
    planId: "plan-1",
    planHash: HASH_A,
    cycleId: "cycle-1",
    portfolioId: "portfolio-1",
    portfolioVersion: "portfolio-v1",
    portfolioSnapshotHash: HASH_B,
    policyHash: HASH_C,
    asOf: "2026-09-03T00:00:00.000Z",
    actionId: "action-1",
    actionSequence: 0,
    fillSequence: 0,
    fillId: "fill-1",
    paperFillRecordId: "paper-fill-1",
    paperFillHash: HASH_A,
    requestedNotionalKrw: 100,
    requestedQuantity: 1,
    filledNotionalKrw: 100,
    filledQuantity: 1,
    cumulativeFilledNotionalKrw: 100,
    cumulativeFilledQuantity: 1,
    riskDecisionId: "risk-decision-1",
    expectedPrePortfolioVersion: "portfolio-v1",
    expectedPrePortfolioSnapshotHash: HASH_B,
    resultingPortfolioVersion: "portfolio-v2",
    resultingPortfolioSnapshotHash: HASH_D
  };
}
