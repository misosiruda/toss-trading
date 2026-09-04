import assert from "node:assert/strict";
import test from "node:test";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, parseRebalancePlanRecord, type RebalanceAction } from "./rebalancePlan.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;
const CUTOFF = "2026-09-04T01:00:00.000Z";
const CREATED = "2026-09-04T01:00:01.000Z";
type PlanInput = Parameters<typeof createRebalancePlanRecord>[0];

test("rebalance plan canonicalizes reasons and hashes full ordered content independently of creation time", () => {
  const input = planInput();
  input.actions[0]!.reasonCodes = ["target_gap", "risk_checked"];
  const record = createRebalancePlanRecord(input);
  assert.deepEqual(record.actions[0]!.reasonCodes, ["risk_checked", "target_gap"]);
  const { planId, planHash, createdAt: _createdAt, ...payload } = record;
  assert.equal(planHash, hashCanonicalPayload(payload));
  assert.equal(planId, hashDerivedId("rebalance_plan", planHash));
  assert.deepEqual(parseRebalancePlanRecord(JSON.parse(JSON.stringify(record))), record);
  assert.ok(Object.isFrozen(record.actions[0]!.executionTarget));
  assert.ok(Object.isFrozen(record.actions[0]!.reasonCodes));
  const later = createRebalancePlanRecord({ ...input, createdAt: "2026-09-04T01:00:02.000Z" });
  assert.equal(later.planHash, planHash);
  assert.ok(!("predecessor" in createRebalancePlanRecord({ ...input, predecessor: undefined })));
  assert.throws(() => parseRebalancePlanRecord({ ...record, predecessor: undefined }), /canonical/);
  input.actions[0]!.reasonCodes.push("late_mutation");
  assert.equal(record.actions[0]!.reasonCodes.length, 2);
});

test("rebalance plans accept fractional BUY and mandate or legacy SELL targets", () => {
  const buy = createRebalancePlanRecord(planInput());
  assert.equal(hashRebalanceExecutionTarget(buy.actions[0]!.executionTarget), hashCanonicalPayload(buy.actions[0]!.executionTarget));
  const sell = sellAction();
  assert.equal(createRebalancePlanRecord(planInput([sell], "sell")).actions[0]!.side, "SELL");
  const { mandateId: _mandateId, ...common } = sell;
  const legacy = { ...common, lineageKind: "unassigned_legacy_reduce_only" as const, side: "SELL" as const, observedPositionRef: "legacy-1", legacyStateDetectedAt: CUTOFF };
  const record = createRebalancePlanRecord(planInput([legacy], "sell"));
  assert.ok(!("mandateId" in record.actions[0]!));
  assert.deepEqual(parseRebalancePlanRecord(record), record);
});

test("rebalance plan accepts whole-share targets on both sides with independently marked integer KRW", () => {
  for (const side of ["BUY", "SELL"] as const) {
    const action = { ...buyAction(), side, executionTarget: {
      targetKind: "whole_share_quantity" as const, targetQuantity: 3, referencePriceKrw: 333.2,
      plannedNotionalKrw: 1_000, residualNotionalKrw: 50, priceEvidenceRef: "price-1"
    } };
    const record = createRebalancePlanRecord(planInput([action], side === "BUY" ? "buy" : "sell"));
    assert.deepEqual(parseRebalancePlanRecord(record), record);
    assert.equal(hashRebalanceExecutionTarget(action.executionTarget), hashCanonicalPayload(action.executionTarget));
  }
});

test("rebalance plan rejects mixed sides, target-side mismatch and legacy BUY or forged mandate lineage", () => {
  for (const input of [
    planInput([buyAction(), { ...sellAction(), actionId: "sell", actionSequence: 1 }]),
    planInput([sellAction()]),
    planInput([{ ...buyAction(), executionTarget: sellAction().executionTarget }]),
    planInput([{ ...sellAction(), executionTarget: buyAction().executionTarget }], "sell"),
    planInput([{ ...buyAction(), lineageKind: "unassigned_legacy_reduce_only", observedPositionRef: "legacy", legacyStateDetectedAt: CUTOFF } as unknown as RebalanceAction]),
    planInput([{ ...sellAction(), lineageKind: "unassigned_legacy_reduce_only", observedPositionRef: "legacy", legacyStateDetectedAt: CUTOFF } as unknown as RebalanceAction], "sell")
  ]) assert.throws(() => createRebalancePlanRecord(input));
});

test("rebalance plan requires nonempty contiguous unique action order and canonical unique reasons", () => {
  for (const actions of [
    [], [{ ...buyAction(), actionSequence: 1 }],
    [buyAction(), { ...buyAction(), actionSequence: 1 }],
    [{ ...buyAction(), actionId: "second", actionSequence: 1 }, buyAction()],
    [{ ...buyAction(), actionSequence: -0 }],
    [{ ...buyAction(), reasonCodes: ["same", "same"] }],
    [{ ...buyAction(), reasonCodes: [] }]
  ]) assert.throws(() => createRebalancePlanRecord(planInput(actions)));
  const input = planInput([buyAction(), { ...buyAction(), actionId: "second", actionSequence: 1 }]);
  const record = createRebalancePlanRecord(input);
  const reordered = createRebalancePlanRecord(planInput(input.actions.slice().reverse().map((action, actionSequence) => ({ ...action, actionSequence }))));
  assert.notEqual(reordered.planHash, record.planHash);
});

test("rebalance target quantities, amounts and caps reject unsafe or inconsistent values", () => {
  for (const value of [0, -0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createRebalancePlanRecord(planInput([{ ...buyAction(), maximumNotionalKrw: value }])));
    assert.throws(() => hashRebalanceExecutionTarget({ targetKind: "fractional_buy_notional", targetNotionalKrw: value }));
    assert.throws(() => hashRebalanceExecutionTarget({ ...sellAction().executionTarget, targetQuantity: value }));
  }
  const target = { targetKind: "whole_share_quantity", targetQuantity: 2, referencePriceKrw: 500, plannedNotionalKrw: 1_000, residualNotionalKrw: 0, priceEvidenceRef: "price-1" };
  for (const invalid of [
    { ...target, targetQuantity: 1.5 }, { ...target, plannedNotionalKrw: 999 },
    { ...target, residualNotionalKrw: -0 }, { ...target, residualNotionalKrw: -1 },
    { ...target, targetQuantity: Number.MAX_SAFE_INTEGER },
    { ...sellAction().executionTarget, markedTargetNotionalKrw: 999 },
    { ...sellAction().executionTarget, referencePriceKrw: 0.01, targetQuantity: 0.01 }
  ]) assert.throws(() => hashRebalanceExecutionTarget(invalid));
  assert.throws(() => createRebalancePlanRecord(planInput([{ ...buyAction(), maximumNotionalKrw: 999 }])), /notional cap/);
  assert.throws(() => createRebalancePlanRecord(planInput([{ ...sellAction(), maximumNotionalKrw: 999 }], "sell")), /notional cap/);
});

test("rebalance plan validates predecessor shape and chronology without claiming terminal-source resolution", () => {
  const predecessor = { predecessorKind: "applied" as const, predecessorPlanId: "sell-plan", predecessorPlanHash: HASH,
    predecessorPlanEventId: "terminal", predecessorPlanEventHash: HASH };
  assert.ok(createRebalancePlanRecord({ ...planInput(), predecessor }).predecessor);
  assert.ok(createRebalancePlanRecord({ ...planInput([sellAction()], "sell"), predecessor: { ...predecessor, predecessorKind: "stale" } }).predecessor);
  assert.throws(() => createRebalancePlanRecord({ ...planInput([sellAction()], "sell"), predecessor }), /follow-up buy/);
  assert.throws(() => createRebalancePlanRecord({ ...planInput(), predecessor: { ...predecessor, predecessorPlanEventHash: "" } }));
  assert.throws(() => createRebalancePlanRecord({ ...planInput(), createdAt: "2026-09-04T00:00:00.000Z" }), /cutoff/);
  assert.throws(() => createRebalancePlanRecord({ ...planInput(), evidenceCutoffAt: "2026-09-04T01:00:00" }));
  const { mandateId: _mandateId, ...common } = sellAction();
  assert.throws(() => createRebalancePlanRecord(planInput([{ ...common, lineageKind: "unassigned_legacy_reduce_only", side: "SELL", observedPositionRef: "legacy", legacyStateDetectedAt: CREATED }], "sell")), /detection/);
});

test("rebalance plan independently rejects tampered scope, ordered actions, target, identity and unknown fields", () => {
  const record = createRebalancePlanRecord(planInput());
  for (const changes of [
    { planId: "other" }, { planHash: OTHER_HASH }, { policyHash: OTHER_HASH }, { cycleId: "other" },
    { triggerRef: "other" }, { portfolioVersion: "v2" }, { portfolioSnapshotHash: OTHER_HASH },
    { actions: [{ ...record.actions[0]!, maximumNotionalKrw: 2_000 }] },
    { actions: [{ ...record.actions[0]!, executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: 900 } }] },
    { actions: [{ ...record.actions[0]!, reasonCodes: ["z", "a"] }] }, { tradingEnabled: true }
  ]) assert.throws(() => parseRebalancePlanRecord({ ...record, ...changes }));
  for (const cycleId of [" cycle ", "", "bad\ud800"]) {
    assert.throws(() => createRebalancePlanRecord({ ...planInput(), cycleId }));
  }
});

function buyAction(): Extract<RebalanceAction, { lineageKind: "mandate" }> {
  return { actionId: "action-1", actionSequence: 0, market: "KR", symbol: "KR:005930", side: "BUY",
    lineageKind: "mandate", mandateId: "mandate-1", maximumNotionalKrw: 1_100, reasonCodes: ["target_gap"],
    executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: 1_000 } };
}
function sellAction(): Extract<RebalanceAction, { lineageKind: "mandate" }> {
  return { ...buyAction(), side: "SELL", executionTarget: { targetKind: "fractional_sell_quantity", targetQuantity: 2.5,
    referencePriceKrw: 400, markedTargetNotionalKrw: 1_000, priceEvidenceRef: "price-1" } };
}
function planInput(actions: RebalanceAction[] = [buyAction()], phase: "buy" | "sell" = "buy"): PlanInput {
  return { cycleId: "cycle-1", portfolioId: "paper-main", portfolioVersion: "v1", portfolioSnapshotHash: HASH,
    policyHash: HASH, evidenceCutoffAt: CUTOFF, triggerRef: "trigger-1", phase, actions, createdAt: CREATED };
}
