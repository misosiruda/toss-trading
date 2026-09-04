import assert from "node:assert/strict";
import test from "node:test";
import { createRebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, parseRebalancePlanEvent, validateRebalancePlanEventRecordBinding } from "./rebalancePlanEvent.js";
import { createRebalancePlanExecutionAppliedEvent, parseRebalancePlanExecutionAppliedEvent } from "./rebalancePlanExecutionAppliedEvent.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;
const C = `sha256:${"c".repeat(64)}`;
type Input = Parameters<typeof createRebalancePlanEvent>[0];

test("all six rebalance event variants round-trip and freeze canonical payloads", () => {
  for (const input of inputs()) {
    const event = createRebalancePlanEvent(input);
    assert.deepEqual(parseRebalancePlanEvent(JSON.parse(JSON.stringify(event))), event);
    assert.match(event.planEventId, /^rebalance_plan_event_/);
    assert.ok(Object.isFrozen(event));
    if ("reasonCodes" in event) assert.ok(Object.isFrozen(event.reasonCodes));
    if (event.eventType === "applied") assert.ok(Object.isFrozen(event.executionEventIds));
  }
});

test("execution variant retains the existing event identity and invariant checks", () => {
  const input = executionInput();
  const existing = createRebalancePlanExecutionAppliedEvent(input);
  assert.deepEqual(createRebalancePlanEvent(input), existing);
  assert.deepEqual(parseRebalancePlanEvent(existing), parseRebalancePlanExecutionAppliedEvent(existing));
  for (const invalid of [
    { ...input, filledQuantity: 2 }, { ...input, cumulativeFilledNotionalKrw: 99 },
    { ...input, resultingPortfolioVersion: input.expectedPrePortfolioVersion },
    { ...input, resultingPortfolioSnapshotHash: input.expectedPrePortfolioSnapshotHash }
  ]) {
    assert.throws(() => createRebalancePlanEvent(invalid));
    assert.throws(() => parseRebalancePlanEvent(rehash(invalid)));
  }
});

test("preview forbids predecessors and successors require exact variant fields", () => {
  const preview = inputs()[0]!;
  const approved = inputs()[1]!;
  const { previousPlanEventId: _prior, ...missingPrior } = approved as Extract<Input, { eventType: "approved" | "rejected" }>;
  for (const invalid of [
    { ...preview, previousPlanEventId: "prior" }, { ...preview, previousPlanEventId: undefined },
    { ...preview, reasonCodes: ["extra"] }, missingPrior,
    { ...approved, observedCurrentPortfolioVersion: "v2" },
    { ...approved, eventType: "stale" }, { ...approved, eventType: "applied" },
    { ...approved, eventType: "unknown" }, { ...approved, unexpected: true }
  ]) {
    assert.throws(() => createRebalancePlanEvent(invalid as Input));
    assert.throws(() => parseRebalancePlanEvent(rehash(invalid)));
  }
});

test("reason lists are canonical sets while applied execution IDs preserve order", () => {
  const approved = inputs()[1]!;
  const first = createRebalancePlanEvent({ ...approved, reasonCodes: ["z", "a"] } as Input);
  const second = createRebalancePlanEvent({ ...approved, reasonCodes: ["a", "z"] } as Input);
  assert.deepEqual(first, second);
  assert.throws(() => createRebalancePlanEvent({ ...approved, reasonCodes: ["a", "a"] } as Input), /unique/);
  assert.throws(() => createRebalancePlanEvent({ ...approved, reasonCodes: [] } as Input));
  assert.throws(() => parseRebalancePlanEvent(rehash({ ...approved, reasonCodes: ["z", "a"] })), /canonical/);
  const applied = inputs()[5]!;
  const ordered = createRebalancePlanEvent({ ...applied, executionEventIds: ["event-z", "event-a"] } as Input);
  const reversed = createRebalancePlanEvent({ ...applied, executionEventIds: ["event-a", "event-z"] } as Input);
  assert.notEqual(ordered.planEventHash, reversed.planEventHash);
  assert.deepEqual((ordered as Extract<typeof ordered, { eventType: "applied" }>).executionEventIds, ["event-z", "event-a"]);
  for (const ids of [[], ["duplicate", "duplicate"]]) {
    assert.throws(() => createRebalancePlanEvent({ ...applied, executionEventIds: ids } as Input));
    assert.throws(() => parseRebalancePlanEvent(rehash({ ...applied, executionEventIds: ids })));
  }
});

test("complete event payload and identity changes are independently detected", () => {
  for (const input of inputs()) {
    const event = createRebalancePlanEvent(input);
    for (const patch of [
      { planId: "other-plan" }, { planHash: C }, { cycleId: "other-cycle" }, { portfolioId: "other-portfolio" },
      { portfolioVersion: "other-version" }, { portfolioSnapshotHash: C }, { policyHash: C },
      { asOf: "2026-09-01T00:00:02.000Z" }, { planEventId: "forged" }, { planEventHash: C }
    ]) assert.throws(() => parseRebalancePlanEvent({ ...event, ...patch }), /identity/);
    if ("previousPlanEventId" in input) assert.throws(() => parseRebalancePlanEvent({ ...event, previousPlanEventId: "other" }), /identity/);
    if ("reasonCodes" in input) assert.throws(() => parseRebalancePlanEvent({ ...event, reasonCodes: ["other"] }), /identity/);
    if (input.eventType === "stale") for (const patch of [
      { observedCurrentPortfolioVersion: "other" }, { observedCurrentPortfolioSnapshotId: "other" }, { observedCurrentPortfolioSnapshotHash: C }
    ]) assert.throws(() => parseRebalancePlanEvent({ ...event, ...patch }), /identity/);
    if (input.eventType === "applied") for (const patch of [
      { executionEventIds: ["other"] }, { resultingPortfolioVersion: "other" }, { resultingPortfolioSnapshotHash: C }
    ]) assert.throws(() => parseRebalancePlanEvent({ ...event, ...patch }), /identity/);
  }
});

test("plan event binding rehashes both records and compares immutable preview scope", () => {
  const plan = planFixture();
  for (const input of inputs()) {
    const event = createRebalancePlanEvent(input);
    const bound = validateRebalancePlanEventRecordBinding({ plan, event });
    assert.deepEqual(bound.plan, plan);
    assert.deepEqual(bound.event, event);
    assert.ok(Object.isFrozen(bound));
    for (const patch of [
      { planId: "other-plan" }, { planHash: C }, { cycleId: "other-cycle" }, { portfolioId: "other" },
      { portfolioVersion: "other" }, { portfolioSnapshotHash: C }, { policyHash: C }
    ]) assert.throws(() => validateRebalancePlanEventRecordBinding({ plan, event: createRebalancePlanEvent({ ...input, ...patch }) }), /record .* mismatch/);
  }
  assert.throws(() => validateRebalancePlanEventRecordBinding({ plan: { ...plan, triggerRef: "tampered" }, event: createRebalancePlanEvent(inputs()[0]!) }), /identity/);
  assert.throws(() => validateRebalancePlanEventRecordBinding({ plan, event: createRebalancePlanEvent({ ...inputs()[0]!, asOf: "2026-09-01T00:00:00.000Z" }) }), /precede/);
  assert.throws(() => validateRebalancePlanEventRecordBinding({ plan, event: createRebalancePlanEvent(inputs()[0]!), trusted: true } as Parameters<typeof validateRebalancePlanEventRecordBinding>[0]));
});

test("stale and execution events retain original preview state, not observed or resulting state", () => {
  const plan = planFixture();
  const stale = createRebalancePlanEvent(inputs()[3]!);
  assert.equal(stale.portfolioVersion, plan.portfolioVersion);
  assert.equal(validateRebalancePlanEventRecordBinding({ plan, event: stale }).event.eventType, "stale");
  for (const patch of [{ actionId: "other" }, { actionSequence: 1 }]) {
    const event = createRebalancePlanEvent({ ...executionInput(), ...patch });
    assert.throws(() => validateRebalancePlanEventRecordBinding({ plan, event }), /action identity or sequence/);
  }
  const input = executionInput();
  const later = createRebalancePlanEvent({ ...input, expectedPrePortfolioVersion: "v2", expectedPrePortfolioSnapshotHash: B,
    resultingPortfolioVersion: "v3", resultingPortfolioSnapshotHash: C });
  // Matching preview scope is necessary, but does not prove this hypothetical later fill's chain.
  assert.equal(validateRebalancePlanEventRecordBinding({ plan, event: later }).event.eventType, "execution_applied");
});

test("new variants reject noncanonical identifiers and invalid offset timestamps", () => {
  for (const input of inputs().filter((value) => value.eventType !== "execution_applied")) {
    for (const patch of [{ cycleId: " spaced " }, { cycleId: "\ud800" }, { asOf: "2026-09-01T00:00:00" }, { asOf: "not-a-date" }]) {
      assert.throws(() => createRebalancePlanEvent({ ...input, ...patch }));
      assert.throws(() => parseRebalancePlanEvent(rehash({ ...input, ...patch })));
    }
  }
});

function planFixture() {
  return createRebalancePlanRecord({ cycleId: "cycle-1", portfolioId: "paper-main", portfolioVersion: "v1", portfolioSnapshotHash: A,
    policyHash: B, evidenceCutoffAt: "2026-09-01T00:00:00.000Z", triggerRef: "trigger-1", phase: "buy", createdAt: "2026-09-01T00:00:01.000Z",
    actions: [{ actionId: "action-1", actionSequence: 0, market: "KR", symbol: "KR:005930", lineageKind: "mandate", side: "BUY", mandateId: "mandate-1",
      reasonCodes: ["gap"], maximumNotionalKrw: 1100, executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: 1000 } }] });
}
function scope() {
  const plan = planFixture();
  return { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash,
    policyHash: plan.policyHash, asOf: "2026-09-01T00:00:01.000Z" };
}
function inputs(): Input[] {
  const common = scope();
  return [
    { ...common, eventType: "previewed" },
    { ...common, previousPlanEventId: "preview-event", eventType: "approved", reasonCodes: ["risk_passed"] },
    { ...common, previousPlanEventId: "preview-event", eventType: "rejected", reasonCodes: ["risk_failed"] },
    { ...common, previousPlanEventId: "preview-event", eventType: "stale", reasonCodes: ["version_drift"], observedCurrentPortfolioVersion: "v2",
      observedCurrentPortfolioSnapshotId: "snapshot-v2", observedCurrentPortfolioSnapshotHash: B },
    executionInput(),
    { ...common, previousPlanEventId: "execution-event", eventType: "applied", executionEventIds: ["execution-event"], resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: B }
  ];
}
function executionInput() {
  return { ...scope(), previousPlanEventId: "approved-event", eventType: "execution_applied" as const,
    actionId: "action-1", actionSequence: 0, fillSequence: 0, fillId: "fill-1", paperFillRecordId: "paper-fill-1", paperFillHash: C,
    requestedNotionalKrw: 100, requestedQuantity: 1, filledNotionalKrw: 100, filledQuantity: 1,
    cumulativeFilledNotionalKrw: 100, cumulativeFilledQuantity: 1, riskDecisionId: "risk-1", expectedPrePortfolioVersion: "v1",
    expectedPrePortfolioSnapshotHash: A, resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: B };
}
function rehash(payload: unknown) {
  const planEventHash = hashCanonicalPayload(payload);
  return { ...(payload as object), planEventId: hashDerivedId("rebalance_plan_event", planEventHash), planEventHash };
}
