import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { calculatePendingPlanActionProgress, parsePendingPlanActionProgress, PENDING_PLAN_ACTION_PROGRESS_MODEL_VERSION } from "./pendingPlanActionProgress.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalancePlanRecord, type RebalanceExecutionTarget } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository, createRebalancePlanPaths } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths, resolveDurableRebalancePlanEventObservedAt } from "./rebalancePlanEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

const T = Date.parse("2026-09-01T00:00:00.000Z");
const at = (offset: number) => new Date(T + offset).toISOString();
const H = (value: string) => hashCanonicalPayload({ synthetic: value });
const buy: RebalanceExecutionTarget = { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 };

test("pending progress derives every remaining action and separates target from maximum cap", () => {
  const plan = makePlan(buy, "BUY", 2);
  const events = history(plan);
  const result = calculate(plan, events);
  assert.equal(result.pendingActions.length, 2);
  assert.deepEqual(result.pendingActions.map((item) => [item.remainingTargetNotionalKrw, item.remainingNotionalCapKrw, item.remainingQuantity]),
    [[60, 80, null], [100, 120, null]]);
  assert.equal(result.pendingActions[0]!.actionExecutionTargetHash, hashRebalanceExecutionTarget(buy));
  assert.equal(result.pendingActions[1]!.planEventHash, events.at(-1)!.planEventHash);
  assert.deepEqual(parsePendingPlanActionProgress(JSON.parse(JSON.stringify(result))), result);
  assert.ok(Object.isFrozen(result.pendingActions[0]!.action.executionTarget));
  assert.ok(Object.isFrozen(result.input.events));
  assert.equal(result.valuationAndReservationAuthority, "not_verified");
  assert.equal(result.currentExecutionAuthority, "not_granted");
});

test("pending progress uses exact decimal quantity and never treats marked target minus fills as remaining valuation", () => {
  const target: RebalanceExecutionTarget = { targetKind: "fractional_sell_quantity", targetQuantity: 0.3,
    referencePriceKrw: 100, markedTargetNotionalKrw: 30, priceEvidenceRef: "synthetic-price" };
  const plan = makePlan(target, "SELL");
  const result = calculate(plan, history(plan, 8, 0.1));
  assert.equal(result.pendingActions[0]!.remainingQuantity, 0.2);
  assert.equal(result.pendingActions[0]!.remainingNotionalCapKrw, 112);
  assert.equal(result.pendingActions[0]!.remainingTargetNotionalKrw, null);
  for (const side of ["BUY", "SELL"] as const) {
    const whole: RebalanceExecutionTarget = { targetKind: "whole_share_quantity", targetQuantity: 3,
      referencePriceKrw: 30, plannedNotionalKrw: 90, residualNotionalKrw: 10, priceEvidenceRef: "synthetic-price" };
    const wholePlan = makePlan(whole, side);
    const pending = calculate(wholePlan, history(wholePlan, 40, 1)).pendingActions[0]!;
    assert.equal(pending.remainingQuantity, 2);
    assert.equal(pending.remainingNotionalCapKrw, 80);
    assert.equal(pending.remainingTargetNotionalKrw, null);
  }
});

test("pending progress excludes previewed terminal and completed actions but retains cap-exhausted incomplete quantities", () => {
  const plan = makePlan();
  const events = history(plan, 100, 1);
  assert.equal(calculate(plan, events.slice(0, 1)).pendingActions.length, 0);
  assert.equal(calculate(plan, events.slice(0, 2)).pendingActions.length, 1);
  assert.equal(calculate(plan, events).pendingActions.length, 0);
  for (const eventType of ["rejected", "stale", "applied"] as const) {
    const extra = eventType === "stale" ? { observedCurrentPortfolioVersion: "stale", observedCurrentPortfolioSnapshotId: "stale", observedCurrentPortfolioSnapshotHash: H("stale") }
      : eventType === "applied" ? { executionEventIds: [events[2]!.planEventId], resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: H("v2") } : {};
    assert.equal(calculate(plan, [...events, event(plan, eventType, events[2], 50, extra)]).pendingActions.length, 0);
  }
  const target: RebalanceExecutionTarget = { targetKind: "whole_share_quantity", targetQuantity: 3,
    referencePriceKrw: 30, plannedNotionalKrw: 90, residualNotionalKrw: 0, priceEvidenceRef: "synthetic-price" };
  const exhausted = makePlan(target);
  const pending = calculate(exhausted, history(exhausted, 120, 1)).pendingActions[0]!;
  assert.equal(pending.remainingQuantity, 2);
  assert.equal(pending.remainingNotionalCapKrw, 0);
});

test("pending progress independently rejects rehashed output tampering input drift and invalid history", () => {
  const plan = makePlan();
  const events = history(plan);
  const result = calculate(plan, events);
  for (const field of ["remainingNotionalCapKrw", "remainingTargetNotionalKrw", "remainingQuantity"] as const) {
    const forged = { ...result, pendingActions: [{ ...result.pendingActions[0], [field]: 1 }] };
    const { calculationHash: _hash, ...payload } = forged;
    assert.throws(() => parsePendingPlanActionProgress({ ...payload, calculationHash: hashCanonicalPayload(payload) }), /independent replay/);
  }
  assert.throws(() => parsePendingPlanActionProgress({ ...result, extra: true }), /independent replay/);
  assert.throws(() => calculate(plan, events, 39), /future event/);
  assert.throws(() => calculate({ ...plan, planHash: H("forged") }, events), /identity/);
  assert.throws(() => calculate(plan, events.slice(1)), /start with previewed/);
  assert.throws(() => calculate(plan, [...events, events[2]!]));
  assert.throws(() => calculatePendingPlanActionProgress({ ...result.input, modelVersion: "unknown" } as never));
  assert.throws(() => calculatePendingPlanActionProgress({ ...result.input, trusted: true } as never));
});

test("pending progress preserves maximum safe amounts and canonical long plan identifiers", () => {
  const plan = makePlan({ targetKind: "fractional_buy_notional", targetNotionalKrw: Number.MAX_SAFE_INTEGER }, "BUY", 1,
    { actions: [{ ...makePlan().actions[0]!, actionId: "a".repeat(240), symbol: "S".repeat(240),
      executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: Number.MAX_SAFE_INTEGER }, maximumNotionalKrw: Number.MAX_SAFE_INTEGER }] });
  const pending = calculate(plan, history(plan, 1, 0.1)).pendingActions[0]!;
  assert.equal(pending.remainingTargetNotionalKrw, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(pending.remainingNotionalCapKrw, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(pending.action.symbol.length, 240);
});

test("stored pending progress replays interleaved portfolios and all policy generations after restart", async (context) => {
  await withStore(context, async (baseDir, plans, repository) => {
    const first = makePlan(buy, "BUY", 2);
    const second = makePlan(buy, "BUY", 1, { cycleId: "second", policyHash: H("older-policy") });
    const foreign = makePlan(buy, "BUY", 1, { cycleId: "foreign", portfolioId: "other" });
    for (const plan of [first, second, foreign]) await plans.append(plan);
    for (let index = 0; index < 3; index++) {
      context.mock.timers.setTime(T + 20 + index * 10);
      for (const plan of [second, foreign, first]) await repository.append(history(plan)[index]!);
    }
    context.mock.timers.setTime(T + 100);
    const result = await stored(baseDir);
    assert.equal(result.projection.planReplays.length, 2);
    assert.equal(result.projection.pendingActions.length, 3);
    assert.deepEqual(new Set(result.projection.pendingActions.map((item) => item.policyHash)), new Set([first.policyHash, second.policyHash]));
    assert.equal(result.assessment.sourceEventCount, 9);
    assert.equal(result.assessment.projectionHash, hashCanonicalPayload(result.projection));
    const { assessmentHash, ...rest } = result;
    assert.equal(assessmentHash, hashCanonicalPayload(rest.assessment));
    assert.equal(result.projection.planReplays[0]!.eventOrigins.length, 3);
    assert.equal(result.assessment.snapshotPendingInputs, "not_verified");
    assert.ok(Object.isFrozen(result.projection.pendingActions[0]!.progress));
    context.mock.timers.setTime(T + 101);
    const restarted = await stored(baseDir);
    assert.deepEqual(restarted.projection, result.projection);
    assert.notEqual(restarted.assessmentHash, result.assessmentHash);
  });
});

test("stored pending progress uses commit cutoff not event assertion and preserves earlier prefix after terminal append", async (context) => {
  await withStore(context, async (baseDir, plans, repository) => {
    const plan = await plans.append(makePlan());
    const events = history(plan);
    context.mock.timers.setTime(T + 20); await repository.append(events[0]);
    context.mock.timers.setTime(T + 60); await repository.append(events[1]);
    context.mock.timers.setTime(T + 100);
    assert.equal((await stored(baseDir, 50)).projection.pendingActions.length, 0);
    const before = await stored(baseDir, 70);
    assert.equal(before.projection.pendingActions[0]!.remainingTargetNotionalKrw, 100);
    await repository.append(event(plan, "rejected", events[1], 100));
    context.mock.timers.setTime(T + 120);
    const historical = await stored(baseDir, 70);
    assert.deepEqual(historical.projection, before.projection);
    assert.notEqual(historical.assessment.sourceGenerationHash, before.assessment.sourceGenerationHash);
    assert.equal((await stored(baseDir, 110)).projection.pendingActions.length, 0);
    await assert.rejects(stored(baseDir, 60), /ambiguous at cutoff/);
    await assert.rejects(stored(baseDir, 121), /cutoff follows/);
  });
});

test("stored pending progress validates complete foreign and future histories and never repairs corruption", async (context) => {
  await withStore(context, async (baseDir, plans, repository) => {
    const plan = await plans.append(makePlan());
    context.mock.timers.setTime(T + 20); await repository.append(history(plan)[0]);
    context.mock.timers.setTime(T + 100);
    const path = createRebalancePlanEventPaths(baseDir).eventsPath;
    const raw = await readFile(path, "utf8");
    for (const corrupt of [`${raw}{\n`, raw.slice(0, -1), `${raw}\n`]) {
      await writeFile(path, corrupt);
      await assert.rejects(stored(baseDir, 15));
      assert.equal(await readFile(path, "utf8"), corrupt);
    }
    await writeFile(path, raw);
    const planPath = createRebalancePlanPaths(baseDir).recordsPath;
    const planRaw = await readFile(planPath, "utf8");
    await writeFile(planPath, `${planRaw}{\n`);
    await assert.rejects(stored(baseDir));
    assert.equal(await readFile(planPath, "utf8"), `${planRaw}{\n`);
  });
});

test("stored pending observation remains lock-bound when a writer appends before the read promise returns", async (context) => {
  for (const populated of [false, true]) await withStore(context, async (baseDir, plans, repository) => {
    const plan = await plans.append(makePlan());
    const events = history(plan);
    if (populated) for (const [index, item] of events.entries()) {
      context.mock.timers.setTime(T + 20 + index * 10); await repository.append(item);
    }
    const ordinary = await repository.readVerifiedHistory();
    assert.throws(() => resolveDurableRebalancePlanEventObservedAt(ordinary), /no durable observation/);
    context.mock.timers.setTime(T + 100);
    const durable = await repository.readDurableVerifiedHistory();
    assert.equal(resolveDurableRebalancePlanEventObservedAt(durable), at(100));
    assert.throws(() => resolveDurableRebalancePlanEventObservedAt({ ...durable }), /no durable observation/);
    const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
    const hook = context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (this: RebalancePlanEventFileRepository) {
      const history = await original.call(this);
      context.mock.timers.setTime(T + 110);
      await repository.append(populated ? event(plan, "rejected", events[2], 110) : event(plan, "previewed", undefined, 110));
      context.mock.timers.setTime(T + 120);
      return history;
    });
    try {
      const result = await stored(baseDir);
      assert.equal(result.assessment.observedAt, at(100));
      assert.equal(result.assessment.sourceEventCount, populated ? 3 : 0);
      assert.equal(result.assessment.sourceGenerationHash, durable.generationHash);
      assert.equal((await repository.readAll()).length, populated ? 4 : 1);
    } finally { hook.mock.restore(); }
  });
});

test("stored pending progress handles no approved plans and rejects caller source injection or clock reversal", async (context) => {
  await withStore(context, async (baseDir) => {
    assert.deepEqual((await stored(baseDir, 5)).projection.pendingActions, []);
    await assert.rejects(resolveStoredPendingPlanActionProgress({ baseDir, portfolioId: "paper-main", asOf: at(5), events: [] } as never));
    const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
    context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (this: RebalancePlanEventFileRepository) {
      const result = await original.call(this);
      context.mock.timers.setTime(T + 9);
      return result;
    });
    await assert.rejects(stored(baseDir, 5), /clock moved backwards/);
  });
});

function makePlan(target: RebalanceExecutionTarget = buy, side: "BUY" | "SELL" = "BUY", count = 1,
  extra: Partial<Parameters<typeof createRebalancePlanRecord>[0]> = {}) {
  return createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: "paper-main", portfolioVersion: "v1", portfolioSnapshotHash: H("v1"),
    policyHash: H("policy"), evidenceCutoffAt: at(0), createdAt: at(0), triggerRef: "synthetic-trigger", phase: side === "BUY" ? "buy" : "sell",
    actions: Array.from({ length: count }, (_, index) => ({ actionId: `action-${index}`, actionSequence: index, market: "KR", symbol: "SYNTH",
      lineageKind: "mandate", side, mandateId: `mandate-${index}`, executionTarget: target, maximumNotionalKrw: 120, reasonCodes: ["synthetic"] })), ...extra });
}
function event(plan: RebalancePlanRecord, eventType: RebalancePlanEvent["eventType"], previous?: RebalancePlanEvent, offset = 20, extra: Record<string, unknown> = {}) {
  return createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: at(offset), eventType,
    ...(previous === undefined ? {} : { previousPlanEventId: previous.planEventId }),
    ...(["approved", "rejected", "stale"].includes(eventType) ? { reasonCodes: ["synthetic"] } : {}), ...extra } as Parameters<typeof createRebalancePlanEvent>[0]);
}
function history(plan: RebalancePlanRecord, notional = 40, quantity = 0.4) {
  const preview = event(plan, "previewed");
  const approved = event(plan, "approved", preview, 30);
  const fill = event(plan, "execution_applied", approved, 40, { actionId: plan.actions[0]!.actionId, actionSequence: 0, fillSequence: 0,
    fillId: "synthetic-fill", paperFillRecordId: "synthetic-paper-fill", paperFillHash: H("fill"), riskDecisionId: "synthetic-risk",
    requestedNotionalKrw: notional, requestedQuantity: quantity, filledNotionalKrw: notional, filledQuantity: quantity,
    cumulativeFilledNotionalKrw: notional, cumulativeFilledQuantity: quantity, expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: H("v1"),
    resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: H("v2") });
  return [preview, approved, fill];
}
function calculate(plan: unknown, events: readonly unknown[], offset = 100) {
  return calculatePendingPlanActionProgress({ modelVersion: PENDING_PLAN_ACTION_PROGRESS_MODEL_VERSION, plan, events: [...events], asOf: at(offset) });
}
function stored(baseDir: string, offset = 50) {
  return resolveStoredPendingPlanActionProgress({ baseDir, portfolioId: "paper-main", asOf: at(offset) });
}
async function withStore(context: TestContext, operation: (baseDir: string, plans: RebalancePlanFileRepository, repository: RebalancePlanEventFileRepository) => Promise<void>) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-pending-progress-"));
  context.mock.timers.enable({ apis: ["Date"], now: T + 10 });
  try {
    const plans = new RebalancePlanFileRepository(baseDir);
    await operation(baseDir, plans, new RebalancePlanEventFileRepository(baseDir, plans));
  } finally {
    context.mock.timers.reset();
    await rm(baseDir, { recursive: true, force: true });
  }
}
