import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { PortfolioActionRiskDecisionFileRepository, createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { decisionInput, policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalanceExecutionTarget } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { replayRebalancePlanEvents, replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSnapshotPendingActions } from "./storedSnapshotPendingActions.js";
import { resolveStoredSnapshotPendingExecutionOrigins } from "./storedSnapshotPendingExecutionOrigins.js";

const T = Date.parse("2026-09-01T00:00:00.000Z");
const at = (n: number) => new Date(T + n).toISOString();
const H = (text: string) => hashCanonicalPayload({ synthetic: text });
type Kind = "fractional_buy" | "fractional_sell" | "whole_buy" | "whole_sell";
type RiskInput = Parameters<typeof createPortfolioActionRiskDecision>[0];
interface Options { kind?: Kind; risk?: Partial<RiskInput>; unbound?: boolean; noFill?: boolean; terminal?: boolean; secondFill?: boolean;
  planReceipt?: "valid" | "planHash" | "predecessorEventHash" | "predecessorCommitHash" }

test("snapshot pending execution origins bind actual Risk fills prices and predecessor state for four targets", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) await fixture(context, { kind }, async (state) => {
    const result = await run(state);
    assert.equal(result.executionBindings.length, 1);
    const binding = result.executionBindings[0]!;
    assert.equal(binding.event.paperFillHash, binding.paperFill.paperFillHash);
    assert.equal(binding.fillOrigin.riskOrigin!.commitHash, binding.riskOrigin.commitHash);
    assert.equal(binding.riskDecision.actionExecutionTargetHash, hashRebalanceExecutionTarget(state.plan.actions[0]!.executionTarget));
    assert.equal(result.assessment.executionBindingsHash, hashCanonicalPayload(result.executionBindings));
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    assert.equal(result.assessment.riskPolicyAndRuleAuthority, "not_verified");
    assert.equal(result.assessment.accountingAndResultingStateAuthority, "not_verified");
    assert.equal(result.assessment.openingReservationAuthority, "not_verified");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.ok(Object.isFrozen(binding.riskOrigin.record));
    assert.ok(Object.isFrozen(result.executionBindings));
    assert.deepEqual(await run(state), result);
  });
});

test("snapshot pending execution replays each prior cumulative and portfolio state across partial fills", async (context) => {
  await fixture(context, { kind: "fractional_sell", secondFill: true }, async (state) => {
    const result = await run(state);
    assert.equal(result.executionBindings.length, 2);
    assert.equal(result.executionBindings[1]!.riskDecision.priorCumulativeFilledQuantity, 0.1);
    assert.equal(result.executionBindings[1]!.event.cumulativeFilledQuantity, 0.2);
    assert.equal(result.pending.bindings[0]!.remaining.remainingQuantity, 0.1);
  });
});

test("snapshot pending execution rejects absent Risk fill and source price despite valid pending content", async (context) => {
  for (const source of ["risk", "fill", "price"] as const) await fixture(context, {}, async (state) => {
    assert.equal((await resolveStoredSnapshotPendingActions(input(state))).bindings.length, 1);
    const path = sourcePath(state.baseDir, source);
    await writeFile(path, "");
    await assert.rejects(run(state), /exactly once/);
    assert.equal(await readFile(path, "utf8"), "");
  });
});

test("snapshot pending execution rejects unbound persisted fills without retroactive Risk authority", async (context) => {
  await fixture(context, { unbound: true }, async (state) => {
    assert.equal((await resolveStoredSnapshotPendingActions(input(state))).bindings.length, 1);
    await assert.rejects(run(state), /risk origin persisted with the fill/);
  });
});

test("snapshot pending execution rejects forged target scope and approval exceeding the remaining target", async (context) => {
  for (const risk of [{ actionExecutionTargetHash: H("wrong-target") }, { symbol: "OTHER" },
    { approvedMaximumFillNotionalKrw: 101,
      cashAssessment: { side: "BUY" as const, worstCaseNetCashDebitKrw: 40, approvedMaximumNetCashDebitKrw: 101 } },
    { expectedPortfolioSnapshotHash: H("wrong-state") }]) await fixture(context, { risk }, async (state) => {
    await assert.rejects(run(state), /scope mismatch|remaining buy target|pre-state mismatch/);
  });
});

test("snapshot pending execution requires the predecessor commit strictly before the Risk decision", async (context) => {
  for (const offset of [29, 30]) await fixture(context, { risk: { decidedAt: at(offset) } }, async (state) => {
    await assert.rejects(run(state), /predates its stored plan predecessor/);
  });
});

test("snapshot pending execution checks terminal plan fills even when pending membership is empty", async (context) => {
  await fixture(context, { terminal: true }, async (state) => {
    const result = await run(state);
    assert.equal(result.pending.bindings.length, 0);
    assert.equal(result.executionBindings.length, 1);
    await writeFile(sourcePath(state.baseDir, "fill"), "");
    await assert.rejects(run(state), /exactly once/);
  });
});

test("snapshot pending execution handles approved unfilled plans without inventing fill evidence", async (context) => {
  await fixture(context, { noFill: true }, async (state) => {
    const result = await run(state);
    assert.equal(result.executionBindings.length, 0);
    assert.equal(result.pending.bindings[0]!.expectedNotionalKrw, 100);
    assert.equal(result.assessment.executionCount, 0);
  });
});

test("snapshot pending execution preserves corrupt and torn source suffixes even with no referenced fill", async (context) => {
  for (const noFill of [false, true]) for (const source of ["risk", "fill", "price"] as const) await fixture(context, { noFill }, async (state) => {
    const path = sourcePath(state.baseDir, source);
    const before = await readFile(path, "utf8").catch(() => "");
    const corrupt = `${before}{`;
    await writeFile(path, corrupt);
    await assert.rejects(run(state), /corrupt|torn/);
    assert.equal(await readFile(path, "utf8"), corrupt);
  });
});

test("snapshot pending execution rejects caller source injection and isolates mutable input across awaits", async (context) => {
  await fixture(context, {}, async (state) => {
    await assert.rejects(resolveStoredSnapshotPendingExecutionOrigins({ ...input(state), riskDecisionHistory: {} } as never));
    const mutable = input(state), result = resolveStoredSnapshotPendingExecutionOrigins(mutable);
    mutable.baseDir = join(state.baseDir, "wrong"); mutable.portfolioSnapshotId = "missing";
    assert.equal((await result).pending.snapshot.portfolioSnapshotId, state.snapshot.portfolioSnapshotId);
    await assert.rejects(resolveStoredSnapshotPendingExecutionOrigins(mutable), /exactly once/);
  });
});

test("snapshot pending execution compares persisted plan receipts to the actual predecessor origins", async (context) => {
  for (const planReceipt of ["valid", "planHash", "predecessorEventHash", "predecessorCommitHash"] as const) {
    await fixture(context, { planReceipt }, async (state) => {
      if (planReceipt === "valid") assert.notEqual((await run(state)).executionBindings[0]!.riskOrigin.planOrigin, null);
      else await assert.rejects(run(state), /Risk plan receipt mismatch/);
    });
  }
});

test("snapshot pending execution retains historical bindings after a later terminal append", async (context) => {
  await fixture(context, {}, async (state) => {
    const before = await run(state);
    await state.appendEvent("rejected", 90, state.lastEvent);
    context.mock.timers.setTime(T + 100);
    const after = await run(state);
    assert.deepEqual(after.executionBindings, before.executionBindings);
    assert.deepEqual(after.pending.bindings, before.pending.bindings);
    assert.notEqual(after.assessmentHash, before.assessmentHash);
  });
});

test("execution contexts visit a long partial-fill history once and retain immutable next-action pre-states", () => {
  const plan = createRebalancePlanRecord({ cycleId: "long-cycle", portfolioId: "paper-long", portfolioVersion: "v0", portfolioSnapshotHash: H("v0"),
    policyHash: H("policy"), evidenceCutoffAt: at(10), createdAt: at(15), triggerRef: "synthetic", phase: "buy",
    actions: [0, 1].map((n) => ({ actionId: `action-${n}`, actionSequence: n, market: "KR", symbol: `SYNTH-${n}`, side: "BUY", lineageKind: "mandate",
      mandateId: `mandate-${n}`, maximumNotionalKrw: 500, executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: 500 }, reasonCodes: ["synthetic"] })) });
  const common = { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash };
  const events: RebalancePlanEvent[] = [createRebalancePlanEvent({ ...common, eventType: "previewed", asOf: at(20) })];
  events.push(createRebalancePlanEvent({ ...common, eventType: "approved", asOf: at(30), previousPlanEventId: events[0]!.planEventId, reasonCodes: ["synthetic"] }));
  for (let n = 0; n < 1000; n++) events.push(createRebalancePlanEvent({ ...common, eventType: "execution_applied", asOf: at(40),
    previousPlanEventId: events.at(-1)!.planEventId, actionId: `action-${Math.floor(n / 500)}`, actionSequence: Math.floor(n / 500), fillSequence: n % 500,
    fillId: `fill-${n}`, paperFillRecordId: `paper-fill-${n}`, paperFillHash: H(`fill-${n}`), riskDecisionId: `risk-${n}`,
    requestedNotionalKrw: 1, requestedQuantity: 1, filledNotionalKrw: 1, filledQuantity: 1,
    cumulativeFilledNotionalKrw: n % 500 + 1, cumulativeFilledQuantity: n % 500 + 1, expectedPrePortfolioVersion: `v${n}`,
    expectedPrePortfolioSnapshotHash: H(`v${n}`), resultingPortfolioVersion: `v${n + 1}`, resultingPortfolioSnapshotHash: H(`v${n + 1}`) }));
  let identityReads = 0;
  const counted = events.map((event) => new Proxy(event, { get(target, key, receiver) {
    if (key === "planEventId") identityReads++;
    return Reflect.get(target, key, receiver);
  } }));
  const result = replayRebalancePlanExecutionContexts({ plan, events: counted });
  assert.ok(identityReads <= events.length * 20, `event identities were repeatedly reparsed: ${identityReads}`);
  assert.equal(result.executionContexts.length, 1000);
  assert.deepEqual(result.state, replayRebalancePlanEvents({ plan, events }));
  for (const index of [0, 499, 500, 999]) {
    const context = result.executionContexts[index]!;
    assert.equal(context.eventIndex, index + 2);
    assert.equal(context.priorState.executionPortfolioVersion, `v${index}`);
    assert.equal(context.priorState.actions.length, 1);
    assert.equal(context.priorState.actions[0]!.actionSequence, Math.floor(index / 500));
    assert.equal(context.priorState.actions[0]!.cumulativeFilledNotionalKrw, index % 500);
    assert.ok(Object.isFrozen(context.priorState.actions[0]));
    assert.equal(context.priorState.plan, result.state.plan);
    assert.equal("events" in context.priorState, false);
  }
  // A bad late transition must reject the whole result, not return already captured contexts.
  assert.throws(() => replayRebalancePlanExecutionContexts({ plan, events: [...events, events[0]!] }), /duplicate/);
});

async function seed(baseDir: string, context: TestContext, options: Options) {
  const kind = options.kind ?? "fractional_buy", side = kind.endsWith("buy") ? "BUY" : "SELL";
  const policy = options.planReceipt ? policyFixture() : null;
  context.mock.timers.setTime(T + 1);
  if (policy) await storePolicyFixture(baseDir, policy);
  const prices = new SourcePriceEvidenceFileRepository(baseDir);
  context.mock.timers.setTime(T + 10);
  const price = await prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic", market: "KR", symbol: "SYNTH",
    priceField: "last_price", priceKrw: 100, observedAt: at(5), createdAt: at(5), sourceRefs: ["synthetic"] }));
  const target: RebalanceExecutionTarget = kind === "fractional_buy" ? { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 }
    : kind === "fractional_sell" ? { targetKind: "fractional_sell_quantity", targetQuantity: 0.3, referencePriceKrw: 100, markedTargetNotionalKrw: 30, priceEvidenceRef: price.evidenceRef }
      : { targetKind: "whole_share_quantity", targetQuantity: 3, referencePriceKrw: 100, plannedNotionalKrw: 300, residualNotionalKrw: 0, priceEvidenceRef: price.evidenceRef };
  const plans = new RebalancePlanFileRepository(baseDir);
  context.mock.timers.setTime(T + 15);
  const plan = await plans.append(createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: policy?.policy.portfolioId ?? "paper-main", portfolioVersion: "v1",
    portfolioSnapshotHash: H("v1"), policyHash: policy?.policy.policyHash ?? H("old-policy"), evidenceCutoffAt: at(12), createdAt: at(15), triggerRef: "synthetic", phase: side === "BUY" ? "buy" : "sell",
    actions: [{ actionId: "action", actionSequence: 0, market: "KR", symbol: "SYNTH", lineageKind: "mandate", side, mandateId: "synthetic-mandate",
      executionTarget: target, maximumNotionalKrw: 400, reasonCodes: ["synthetic"] }] }));
  const events = new RebalancePlanEventFileRepository(baseDir, plans);
  const appendEvent = async (eventType: RebalancePlanEvent["eventType"], offset: number, previous?: RebalancePlanEvent, extra = {}) => {
    context.mock.timers.setTime(T + offset);
    return events.append(createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
      portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: at(offset), eventType,
      ...(previous ? { previousPlanEventId: previous.planEventId } : {}), ...(["approved", "rejected"].includes(eventType) ? { reasonCodes: ["synthetic"] } : {}),
      ...extra } as Parameters<typeof createRebalancePlanEvent>[0]));
  };
  let lastEvent = await appendEvent("approved", 30, await appendEvent("previewed", 20));
  const risks = new PortfolioActionRiskDecisionFileRepository(baseDir), fills = new PaperFillExecutionFileRepository(baseDir);
  const amount = kind === "fractional_buy" ? 40 : kind === "fractional_sell" ? 10 : 100, quantity = amount / 100;
  const count = options.noFill ? 0 : options.secondFill ? 2 : 1;
  for (let n = 0; n < count; n++) {
    context.mock.timers.setTime(T + 32 + n * 10);
    const policyDecision = policy ? decisionInput(policy, side) : null;
    const candidate = createPortfolioActionRiskDecision({ riskRuleSetRecordId: "synthetic-rules", riskRuleSetVersion: "v1", riskRuleSetHash: H("rules"),
      ...(policyDecision ? { riskRuleSetRecordId: policyDecision.riskRuleSetRecordId, riskRuleSetVersion: policyDecision.riskRuleSetVersion, riskRuleSetHash: policyDecision.riskRuleSetHash } : {}),
      planId: plan.planId, actionId: "action", portfolioId: plan.portfolioId, policyHash: plan.policyHash,
      expectedPortfolioVersion: `v${n + 1}`, expectedPortfolioSnapshotHash: H(`v${n + 1}`), market: "KR", symbol: "SYNTH", side,
      actionExecutionTargetHash: hashRebalanceExecutionTarget(target), riskRuleScope: { scopeKind: "bucket", bucket: "swing" },
      turnoverAssessment: { scopeKind: "bucket", turnoverStateId: "synthetic-turnover", turnoverStateHash: H("turnover"), turnoverWindowOpenPortfolioNetWorthKrw: 1000,
        priorBucketTurnoverNotionalKrw: amount * n, requestedBucketTurnoverNotionalKrw: amount, resultingBucketTurnoverRatio: amount * (n + 1) / 1000 },
      priorCumulativeFilledNotionalKrw: amount * n, priorCumulativeFilledQuantity: quantity * n, requestedNotionalKrw: amount, requestedQuantity: quantity,
      worstCaseFillNotionalKrw: amount, approvedMaximumFillNotionalKrw: amount,
      cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: amount, approvedMaximumNetCashDebitKrw: amount } : { side, expectedMinimumNetCashCreditKrw: amount },
      decision: "approved", requiredRuleIds: ["cash"], ruleResults: [{ ruleId: "cash", result: "pass", reasonCode: "synthetic" }],
      ...(policyDecision ? { requiredRuleIds: policyDecision.requiredRuleIds, ruleResults: policyDecision.ruleResults } : {}),
      riskEvidenceRefs: [price.evidenceRef], decidedAt: at(31 + n * 10), ...options.risk });
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _inputHash, decidedAt: _decidedAt, ...creation } = candidate;
    const risk = policy ? await risks.createAndAppendWithPlanOrigin(creation) : await risks.append(candidate);
    if (options.planReceipt && options.planReceipt !== "valid") {
      const path = sourcePath(baseDir, "risk"), lines = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
      const { entryHash: _entry, ...payload } = lines[0];
      payload.planOrigin[options.planReceipt] = H("forged-receipt");
      const entryHash = hashCanonicalPayload(payload);
      const { commitHash: _commit, ...marker } = lines[1];
      const updated = { ...marker, entryHash };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...updated, commitHash: hashCanonicalPayload(updated) })}\n`);
    }
    const executionPolicy = { modelVersion: PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price" as const,
      slippageBps: 0, feeBps: 0, taxBps: 0, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: !kind.startsWith("whole"),
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 };
    const fill = buildPaperFill({ action: side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL", targetNotionalKrw: amount, sourcePriceKrw: 100, liquidityStale: false, policy: executionPolicy });
    const fillInput: Parameters<PaperFillExecutionFileRepository["createAndAppendWithRiskOrigin"]>[0] = { portfolioId: plan.portfolioId, rebalancePlanId: plan.planId, rebalanceActionId: "action", fillId: `synthetic-fill-${n}`,
      market: "KR" as const, symbol: "SYNTH", side, requestedNotionalKrw: amount, requestedQuantity: quantity, quantityOverride: null,
      sourcePriceKrw: 100, sourcePriceEvidence: { sourceContractId: price.sourceContractId, evidenceRef: price.evidenceRef, evidenceHash: price.evidenceHash,
        market: price.market, symbol: price.symbol, priceField: price.priceField, observedAt: price.observedAt }, averagePriceKrw: null,
      fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity, filledNotionalKrw: fill.filledNotionalKrw, grossAmountKrw: fill.grossAmountKrw, netAmountKrw: fill.netAmountKrw,
      participationRate: null, volume: null, averageVolume: null, liquidityStale: false, fillStatus: "filled" as const, liquidityStatus: "not_modeled" as const,
      liquidityRejectReason: null, fractionalShares: fill.fractionalShares, executionPolicy,
      costBreakdown: { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw, spreadCostKrw: fill.spreadCostKrw, impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw }, evidenceRefs: [price.evidenceRef] };
    context.mock.timers.setTime(T + 35 + n * 10);
    const record = options.unbound ? await fills.append(createPaperFillExecutionRecord({ ...fillInput, asOf: at(35), createdAt: at(35) }))
      : await fills.createAndAppendWithRiskOrigin(fillInput, await risks.readVerifiedHistory(), risk.riskDecisionId);
    lastEvent = await appendEvent("execution_applied", 40 + n * 10, lastEvent, { actionId: "action", actionSequence: 0, fillSequence: n,
      fillId: record.fillId, paperFillRecordId: record.paperFillRecordId, paperFillHash: record.paperFillHash, riskDecisionId: risk.riskDecisionId,
      requestedNotionalKrw: amount, requestedQuantity: quantity, filledNotionalKrw: amount, filledQuantity: quantity,
      cumulativeFilledNotionalKrw: amount * (n + 1), cumulativeFilledQuantity: quantity * (n + 1), expectedPrePortfolioVersion: `v${n + 1}`,
      expectedPrePortfolioSnapshotHash: H(`v${n + 1}`), resultingPortfolioVersion: `v${n + 2}`, resultingPortfolioSnapshotHash: H(`v${n + 2}`) });
  }
  if (options.terminal) lastEvent = await appendEvent("rejected", 55, lastEvent);
  const remaining = target.targetKind === "fractional_buy_notional" ? 100 - count * amount : Math.round((target.targetQuantity - count * quantity) * 100);
  const common = { planId: plan.planId, planHash: plan.planHash, planEventId: lastEvent.planEventId, planEventHash: lastEvent.planEventHash,
    actionId: "action", actionExecutionTargetHash: hashRebalanceExecutionTarget(target), market: "KR" as const, symbol: "SYNTH", asOf: at(60), remainingNotionalKrw: remaining };
  const pending: PendingPortfolioActionInput = side === "BUY" ? { ...common, side, openingCapacityReservationId: "unverified", openingCapacityReservationHash: H("reservation") }
    : { ...common, side, remainingQuantity: remaining / 100, priceEvidenceRef: price.evidenceRef };
  const pendingActionInputs = options.terminal ? [] : [pending];
  context.mock.timers.setTime(T + 80);
  const snapshot = await new PortfolioSizingSnapshotFileRepository(baseDir).append(createPortfolioSizingSnapshot({ portfolioId: plan.portfolioId,
    portfolioVersion: "snapshot-current", policyHash: H("current-policy"), asOf: at(60), virtualPortfolio: { portfolioId: plan.portfolioId, cashKrw: 1000,
      positions: [{ market: "KR", symbol: "SYNTH", quantity: 10, averagePriceKrw: 100, marketPriceKrw: 100, marketValueKrw: 1000,
        unrealizedPnlKrw: 0, strategyBucket: "swing", region: "KR", sector: "Synthetic", updatedAt: at(60) }], updatedAt: at(60) },
    valuationInputs: [{ kind: "mark_price", market: "KR", symbol: "SYNTH", priceKrw: 100, evidenceRef: "synthetic-mark", evidenceAsOf: at(60) }],
    pendingActionInputs, ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 2000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 1000 }, symbolExposureKrw: [{ market: "KR", symbol: "SYNTH", exposureKrw: 1000 }], marketExposureKrw: { KR: 1000, US: 0 },
      sectorExposureKrw: { Synthetic: 1000 }, countryExposureKrw: { KR: 1000 }, currencyExposureKrw: { KRW: 1000 }, ...pendingActionExposureTotals(pendingActionInputs) }) }));
  return { baseDir, plan, snapshot, appendEvent, lastEvent };
}
type State = Awaited<ReturnType<typeof seed>>;
function input(state: State) { return { baseDir: state.baseDir, portfolioSnapshotId: state.snapshot.portfolioSnapshotId }; }
function run(state: State) { return resolveStoredSnapshotPendingExecutionOrigins(input(state)); }
function sourcePath(baseDir: string, source: "risk" | "fill" | "price") {
  return source === "risk" ? createPortfolioActionRiskDecisionPaths(baseDir).recordsPath
    : source === "fill" ? createPaperFillExecutionPaths(baseDir).recordsPath : createSourcePriceEvidencePaths(baseDir).recordsPath;
}
async function fixture(context: TestContext, options: Options, run: (state: State) => Promise<void>) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-pending-execution-"));
  context.mock.timers.enable({ apis: ["Date"], now: T });
  try { await run(await seed(baseDir, context, options)); }
  finally { context.mock.timers.reset(); await rm(baseDir, { recursive: true, force: true }); }
}
