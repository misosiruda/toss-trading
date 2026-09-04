import assert from "node:assert/strict";
import test from "node:test";
import { createRebalancePlanRecord, type RebalanceExecutionTarget, type RebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { replayRebalancePlanEvents } from "./rebalancePlanEventReplay.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

type Input = Parameters<typeof createRebalancePlanEvent>[0];
const FIRST_TIME = Date.parse("2026-09-04T00:00:00.000Z");
const H = (value: string) => hashCanonicalPayload({ fixture: value });

test("rebalance replay restores ordered partial fills and immutable complete state after serialization", () => {
  const plan = makePlan(undefined, "BUY", 2);
  const events = history(plan, [{ notional: 60, quantity: 0.6 }, { notional: 40, quantity: 0.4 }, { action: 1, notional: 100, quantity: 1 }]);
  const result = replayRebalancePlanEvents({ plan, events });
  assert.equal(result.status, "applied");
  assert.deepEqual(result.actions.map(({ fillCount, complete, cumulativeFilledNotionalKrw, cumulativeFilledQuantity }) =>
    ({ fillCount, complete, cumulativeFilledNotionalKrw, cumulativeFilledQuantity })), [
    { fillCount: 2, complete: true, cumulativeFilledNotionalKrw: 100, cumulativeFilledQuantity: 1 },
    { fillCount: 1, complete: true, cumulativeFilledNotionalKrw: 100, cumulativeFilledQuantity: 1 }
  ]);
  assert.equal(result.executionPortfolioVersion, "v4");
  assert.deepEqual(result.executionEventIds, events.filter((event) => event.eventType === "execution_applied").map((event) => event.planEventId));
  assert.ok(Object.isFrozen(result.actions[0]));
  assert.ok(Object.isFrozen(result.events));
  assert.deepEqual(replayRebalancePlanEvents(JSON.parse(JSON.stringify({ plan, events }))), result);
});

test("rebalance replay handles preview, approved, rejected and stale prefixes without claiming completion", () => {
  const plan = makePlan();
  const events = history(plan, [{ notional: 60, quantity: 0.6 }], false);
  assert.equal(replayRebalancePlanEvents({ plan, events: events.slice(0, 1) }).status, "previewed");
  assert.equal(replayRebalancePlanEvents({ plan, events: events.slice(0, 2) }).status, "approved");
  assert.equal(replayRebalancePlanEvents({ plan, events }).actions[0]!.complete, false);
  for (const count of [1, 2, 3]) for (const kind of ["rejected", "stale"] as const) {
    const prefix = events.slice(0, count);
    const ended = [...prefix, terminal(plan, prefix, kind)];
    const result = replayRebalancePlanEvents({ plan, events: ended });
    assert.equal(result.status, kind);
    assert.equal(result.executionPortfolioVersion, count === 3 ? "v2" : "v1");
    if (kind === "stale") assert.notEqual(result.executionPortfolioVersion, (result.lastEvent as Extract<RebalancePlanEvent, { eventType: "stale" }>).observedCurrentPortfolioVersion);
  }
});

test("rebalance replay rejects missing preview, duplicate events, branches, time reversal and scope drift", () => {
  const plan = makePlan();
  const events = history(plan);
  for (const invalid of [[], events.slice(1), [events[0]!, events[0]!], [events[0]!, ...events.slice(2)]]) {
    assert.throws(() => replayRebalancePlanEvents({ plan, events: invalid }));
  }
  assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 2, { previousPlanEventId: events[0]!.planEventId }) }), /predecessor/);
  assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 2, { asOf: new Date(FIRST_TIME).toISOString() }) }), /time moved backwards/);
  assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 2, { policyHash: H("other") }) }), /record policyHash mismatch/);
  assert.throws(() => replayRebalancePlanEvents({ plan, events: [{ ...events[0], planEventHash: H("forged") }, ...events.slice(1)] }), /identity/);
  assert.throws(() => replayRebalancePlanEvents({ plan: { ...plan, triggerRef: "forged" }, events }), /identity/);
});

test("rebalance replay rejects approval repetition and every successor after terminal states", () => {
  const plan = makePlan();
  const events = history(plan);
  const repeatedApproval = createRebalancePlanEvent({ ...scope(plan, 2), eventType: "approved", previousPlanEventId: events[1]!.planEventId, reasonCodes: ["again"] });
  assert.throws(() => replayRebalancePlanEvents({ plan, events: [events[0], events[1], repeatedApproval] }), /transition/);
  for (const ended of [events, [events[0]!, terminal(plan, events.slice(0, 1), "stale")], [events[0]!, terminal(plan, events.slice(0, 1), "rejected")]]) {
    for (const kind of ["approved", "rejected"] as const) {
      const extra = createRebalancePlanEvent({ ...scope(plan, 99), eventType: kind, previousPlanEventId: ended.at(-1)!.planEventId, reasonCodes: ["after_terminal"] });
      assert.throws(() => replayRebalancePlanEvents({ plan, events: [...ended, extra] }), /terminal transition/);
    }
  }
  assert.throws(() => replayRebalancePlanEvents({ plan, events: [events[0], ...replace(events, 2, { previousPlanEventId: events[0]!.planEventId }).slice(2)] }), /transition/);
});

test("rebalance replay enforces contiguous action and fill order and rejects fills after completion", () => {
  const plan = makePlan(undefined, "BUY", 2);
  const events = history(plan, [{ notional: 60, quantity: 0.6 }, { notional: 40, quantity: 0.4 }, { action: 1, notional: 100, quantity: 1 }]);
  for (const patch of [{ actionId: "action-1", actionSequence: 1 }, { fillSequence: 1 }, { fillSequence: -0 }]) {
    assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 2, patch) }), /sequence/);
  }
  assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 3, { fillSequence: 0 }) }), /sequence/);
  const single = makePlan();
  const extra = history(single, [{ notional: 100, quantity: 1 }, { notional: 1, quantity: 0.01 }], false);
  assert.throws(() => replayRebalancePlanEvents({ plan: single, events: extra }), /each action in sequence/);
});

test("rebalance replay rejects cumulative tampering and independently checks both pre-state fields", () => {
  const plan = makePlan();
  const events = history(plan, [{ notional: 60, quantity: 0.6 }, { notional: 40, quantity: 0.4 }]);
  for (const patch of [{ cumulativeFilledNotionalKrw: 99 }, { cumulativeFilledQuantity: 0.9 }]) {
    assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 3, patch) }), /prior plus fill/);
  }
  for (const index of [2, 3]) for (const patch of [{ expectedPrePortfolioVersion: "foreign" }, { expectedPrePortfolioSnapshotHash: H("foreign") }]) {
    assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, index, patch) }), /pre-state/);
  }
});

test("rebalance replay rejects reuse of fill, immutable paper fill and risk decision IDs", () => {
  const plan = makePlan();
  const events = history(plan, [{ notional: 60, quantity: 0.6 }, { notional: 40, quantity: 0.4 }]);
  const first = events[2] as Extract<RebalancePlanEvent, { eventType: "execution_applied" }>;
  for (const field of ["fillId", "paperFillRecordId", "riskDecisionId"] as const) {
    assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 3, { [field]: first[field] }) }), /reuses/);
  }
});

test("fractional BUY requests, actual fills and totals cannot exceed the remaining target", () => {
  const plan = makePlan();
  const events = history(plan, [{ notional: 60, quantity: 0.6 }, { notional: 40, quantity: 0.4 }]);
  for (const patch of [
    { requestedNotionalKrw: 41 }, { requestedNotionalKrw: 39 },
    { requestedNotionalKrw: 41, filledNotionalKrw: 41, cumulativeFilledNotionalKrw: 101 }
  ]) assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 3, patch) }), /remaining notional target/);
});

test("quantity targets finish by quantity without waiting for reference-price notional", () => {
  const target: RebalanceExecutionTarget = { targetKind: "fractional_sell_quantity", targetQuantity: 1.5, referencePriceKrw: 100, markedTargetNotionalKrw: 150, priceEvidenceRef: "price-1" };
  const plan = makePlan(target, "SELL");
  const events = history(plan, [{ notional: 120, quantity: 1.5 }]);
  const result = replayRebalancePlanEvents({ plan, events });
  assert.equal(result.status, "applied");
  assert.equal(result.actions[0]!.cumulativeFilledNotionalKrw, 120);
  const tooMuch = history(plan, [{ notional: 151, quantity: 1.6 }]);
  assert.throws(() => replayRebalancePlanEvents({ plan, events: tooMuch }), /remaining target/);
  assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 2, { requestedQuantity: 1.6 }) }), /remaining target/);
});

test("whole-share BUY and SELL allow gross slippage within cap but require integer quantities", () => {
  const target: RebalanceExecutionTarget = { targetKind: "whole_share_quantity", targetQuantity: 2, referencePriceKrw: 100, plannedNotionalKrw: 200, residualNotionalKrw: 0, priceEvidenceRef: "price-1" };
  for (const side of ["BUY", "SELL"] as const) {
    const plan = makePlan(target, side);
    const events = history(plan, [{ notional: 100, quantity: 1 }, { notional: 110, quantity: 1 }]);
    const slipped = replace(events, 3, { requestedNotionalKrw: 100 });
    assert.equal(replayRebalancePlanEvents({ plan, events: slipped }).status, "applied");
    assert.throws(() => replayRebalancePlanEvents({ plan, events: history(plan, [{ notional: 50, quantity: 0.5 }], false) }), /integer quantities/);
    assert.throws(() => replayRebalancePlanEvents({ plan, events: history(plan, [{ notional: 100, quantity: 1 }, { notional: 151, quantity: 1 }]) }), /action cap/);
  }
});

test("legacy reduce-only SELL replays quantity completion without fabricating a mandate", () => {
  const { planId: _id, planHash: _hash, ...payload } = makePlan({ targetKind: "fractional_sell_quantity", targetQuantity: 1.5,
    referencePriceKrw: 100, markedTargetNotionalKrw: 150, priceEvidenceRef: "legacy-price" }, "SELL");
  const source = payload.actions[0]!;
  assert.equal(source.lineageKind, "mandate");
  if (source.lineageKind !== "mandate") throw new Error("unexpected fixture lineage");
  const { mandateId: _mandateId, ...action } = source;
  const plan = createRebalancePlanRecord({ ...payload, actions: [{ ...action, lineageKind: "unassigned_legacy_reduce_only", side: "SELL",
    observedPositionRef: "observed-legacy-position", legacyStateDetectedAt: payload.evidenceCutoffAt }] });
  const result = replayRebalancePlanEvents({ plan, events: history(plan, [{ notional: 120, quantity: 1.5 }]) });
  assert.equal(result.status, "applied");
  assert.equal("mandateId" in result.plan.actions[0]!, false);
});

test("rebalance applied requires every target, exact ordered event list and final execution state", () => {
  const plan = makePlan();
  const events = history(plan, [{ notional: 60, quantity: 0.6 }, { notional: 40, quantity: 0.4 }]);
  assert.throws(() => replayRebalancePlanEvents({ plan, events: history(plan, [{ notional: 60, quantity: 0.6 }]) }), /every action target/);
  for (const patch of [
    { executionEventIds: [events[3]!.planEventId, events[2]!.planEventId] },
    { executionEventIds: [events[2]!.planEventId] }, { executionEventIds: ["foreign"] },
    { resultingPortfolioVersion: "foreign" }, { resultingPortfolioSnapshotHash: H("foreign") }
  ]) assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, events.length - 1, patch) }), /ordered history|last execution/);
});

test("rebalance replay rejects fractional or unsafe KRW values and unknown caller assertions", () => {
  const plan = makePlan();
  const events = history(plan);
  for (const patch of [{ requestedNotionalKrw: 100.1 }, { filledNotionalKrw: 99.5, cumulativeFilledNotionalKrw: 99.5 }, { requestedNotionalKrw: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => replayRebalancePlanEvents({ plan, events: replace(events, 2, patch) }), /safe integers/);
  }
  assert.throws(() => replayRebalancePlanEvents({ plan, events, trusted: true } as Parameters<typeof replayRebalancePlanEvents>[0]));
});

function makePlan(target: RebalanceExecutionTarget = { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 }, side: "BUY" | "SELL" = "BUY", count = 1) {
  return createRebalancePlanRecord({ cycleId: "cycle-1", portfolioId: "paper-main", portfolioVersion: "v1", portfolioSnapshotHash: H("v1"), policyHash: H("policy"),
    evidenceCutoffAt: new Date(FIRST_TIME).toISOString(), createdAt: new Date(FIRST_TIME).toISOString(), triggerRef: "trigger-1", phase: side === "BUY" ? "buy" : "sell",
    actions: Array.from({ length: count }, (_, index) => ({ actionId: `action-${index}`, actionSequence: index, market: "KR", symbol: `synthetic-${index}`,
      lineageKind: "mandate", side, mandateId: `mandate-${index}`, executionTarget: target,
      maximumNotionalKrw: target.targetKind === "fractional_buy_notional" ? 110 : 250, reasonCodes: ["fixture"] })) });
}
function scope(plan: RebalancePlanRecord, index: number) {
  return { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId, portfolioVersion: plan.portfolioVersion,
    portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: new Date(FIRST_TIME + index).toISOString() };
}
function history(plan: RebalancePlanRecord, fills = [{ notional: 100, quantity: 1 }] as Array<{ action?: number; notional: number; quantity: number }>, finish = true): RebalancePlanEvent[] {
  const events: RebalancePlanEvent[] = [createRebalancePlanEvent({ ...scope(plan, 0), eventType: "previewed" })];
  events.push(createRebalancePlanEvent({ ...scope(plan, 1), eventType: "approved", previousPlanEventId: events[0]!.planEventId, reasonCodes: ["fixture"] }));
  const progress = plan.actions.map(() => ({ count: 0, notional: 0, quantity: 0 }));
  fills.forEach((fill, index) => {
    const action = fill.action ?? 0;
    const prior = progress[action]!;
    prior.notional += fill.notional; prior.quantity += fill.quantity;
    events.push(createRebalancePlanEvent({ ...scope(plan, index + 2), eventType: "execution_applied", previousPlanEventId: events.at(-1)!.planEventId,
      actionId: plan.actions[action]!.actionId, actionSequence: action, fillSequence: prior.count++, fillId: `fill-${index}`, paperFillRecordId: `paper-fill-${index}`,
      paperFillHash: H(`paper-fill-${index}`), requestedNotionalKrw: fill.notional, requestedQuantity: fill.quantity, filledNotionalKrw: fill.notional, filledQuantity: fill.quantity,
      cumulativeFilledNotionalKrw: prior.notional, cumulativeFilledQuantity: prior.quantity, riskDecisionId: `risk-${index}`,
      expectedPrePortfolioVersion: `v${index + 1}`, expectedPrePortfolioSnapshotHash: H(`v${index + 1}`), resultingPortfolioVersion: `v${index + 2}`, resultingPortfolioSnapshotHash: H(`v${index + 2}`) }));
  });
  if (finish) events.push(createRebalancePlanEvent({ ...scope(plan, events.length), eventType: "applied", previousPlanEventId: events.at(-1)!.planEventId,
    executionEventIds: events.filter((event) => event.eventType === "execution_applied").map((event) => event.planEventId),
    resultingPortfolioVersion: `v${fills.length + 1}`, resultingPortfolioSnapshotHash: H(`v${fills.length + 1}`) }));
  return events;
}
function terminal(plan: RebalancePlanRecord, events: RebalancePlanEvent[], kind: "stale" | "rejected") {
  const common = { ...scope(plan, events.length), previousPlanEventId: events.at(-1)!.planEventId, reasonCodes: ["fixture"] };
  return kind === "rejected" ? createRebalancePlanEvent({ ...common, eventType: kind }) : createRebalancePlanEvent({ ...common, eventType: kind,
    observedCurrentPortfolioVersion: "external-version", observedCurrentPortfolioSnapshotId: "external-snapshot", observedCurrentPortfolioSnapshotHash: H("external") });
}
function replace(events: RebalancePlanEvent[], index: number, patch: Record<string, unknown>): RebalancePlanEvent[] {
  const changed = [...events];
  for (let cursor = index; cursor < changed.length; cursor += 1) {
    const { planEventId: _id, planEventHash: _hash, ...payload } = changed[cursor]!;
    const successor = cursor === index ? patch : {
      previousPlanEventId: changed[cursor - 1]!.planEventId,
      ...(payload.eventType === "applied" ? { executionEventIds: changed.slice(0, cursor)
        .filter((event) => event.eventType === "execution_applied").map((event) => event.planEventId) } : {})
    };
    changed[cursor] = createRebalancePlanEvent({ ...payload, ...successor } as Input);
  }
  return changed;
}
