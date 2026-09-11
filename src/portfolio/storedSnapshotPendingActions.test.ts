import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { canonicalizePendingPortfolioActionInputs, pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalanceExecutionTarget } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredSnapshotPendingActions } from "./storedSnapshotPendingActions.js";

const T = Date.parse("2026-09-01T00:00:00.000Z");
const at = (offset: number) => new Date(T + offset).toISOString();
const H = (value: string) => hashCanonicalPayload({ synthetic: value });
type Kind = "fractional_buy" | "fractional_sell" | "whole_buy" | "whole_sell";

test("stored snapshot pending binds actual partial plans and prices for every target variant", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) await fixture(context, kind, async (state) => {
    const result = await run(state);
    assert.equal(result.bindings.length, 1);
    assert.equal(result.bindings[0]!.expectedNotionalKrw, kind === "fractional_buy" ? 60 : kind === "fractional_sell" ? 20 : 200);
    assert.equal(result.bindings[0]!.remaining.remainingNotionalCapKrw, 360);
    assert.equal(result.bindings[0]!.priceOrigin === null, kind === "fractional_buy");
    assert.equal(result.assessment.openingReservationAuthority, "not_verified");
    assert.equal(result.assessment.fillAndRiskOriginAuthority, "not_verified");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.equal(result.assessment.priceFreshnessAndTrust, "not_evaluated");
    assert.equal(result.assessment.bindingsHash, hashCanonicalPayload(result.bindings));
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    assert.ok(Object.isFrozen(result.bindings[0]!.pending));
    assert.ok(Object.isFrozen(result.snapshot.pendingActionInputs));
    const again = await run(state);
    assert.deepEqual(again, result);
  });
});

test("stored snapshot pending rejects omitted extra and substituted logical actions", async (context) => {
  for (const change of ["missing", "extra", "substituted"] as const) await fixture(context, "fractional_buy", async (state) => {
    const inputs = change === "missing" ? [] : change === "extra" ? [state.pending, { ...state.pending, actionId: "other" }]
      : [{ ...state.pending, actionId: "other" }];
    const snapshot = await state.snapshots.append(snapshotWith(inputs));
    await assert.rejects(run({ ...state, snapshot }), /action set|unfinished plan action/);
  });
});

test("stored snapshot pending rejects stale or forged plan and execution target references", async (context) => {
  for (const field of ["planHash", "planEventId", "planEventHash", "actionExecutionTargetHash", "market", "symbol"] as const) {
    await fixture(context, "fractional_buy", async (state) => {
      const pending = { ...state.pending, [field]: field === "market" ? "US" : field === "symbol" ? "OTHER" : field.endsWith("Hash") ? H("wrong") : "wrong-event" };
      const snapshot = await state.snapshots.append(snapshotWith([pending]));
      await assert.rejects(run({ ...state, snapshot }), /mismatch/);
    });
  }
});

test("stored snapshot pending compares exact gross values not maximum cap or original target", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) {
    await fixture(context, kind, async (state) => {
      for (const amount of [1, 360]) {
        const snapshot = await state.snapshots.append(snapshotWith([{ ...state.pending, remainingNotionalKrw: amount }]));
        await assert.rejects(run({ ...state, snapshot }), /remaining gross notional mismatch/);
      }
      if (state.pending.side === "SELL") {
        const snapshot = await state.snapshots.append(snapshotWith([{ ...state.pending, remainingQuantity: 0.1 }]));
        await assert.rejects(run({ ...state, snapshot }), /remaining quantity mismatch/);
      }
    });
  }
});

test("stored snapshot pending allows explicit SELL revaluation without treating its target price as current", async (context) => {
  await fixture(context, "fractional_sell", async (state) => {
    assert.ok(state.pending.side === "SELL");
    context.mock.timers.setTime(T + 45);
    const price = await state.prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic", market: "KR", symbol: "SYNTH",
      priceField: "last_price", priceKrw: 120, observedAt: at(44), createdAt: at(44), sourceRefs: ["synthetic-revaluation"] }));
    context.mock.timers.setTime(T + 80);
    const pending = { ...state.pending, priceEvidenceRef: price.evidenceRef, remainingNotionalKrw: 24 };
    const snapshot = await state.snapshots.append(snapshotWith([pending]));
    const result = await run({ ...state, snapshot });
    assert.equal(result.bindings[0]!.expectedNotionalKrw, 24);
    assert.equal(result.bindings[0]!.priceOrigin!.record.evidenceHash, price.evidenceHash);
  });
});

test("stored snapshot pending rejects unresolved foreign late and zero-rounded SELL price sources", async (context) => {
  for (const mode of ["missing", "foreign", "late", "zero"] as const) await fixture(context, "fractional_sell", async (state) => {
    assert.ok(state.pending.side === "SELL");
    context.mock.timers.setTime(T + (mode === "late" ? 50 : 45));
    const price = await state.prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic", market: "KR",
      symbol: mode === "foreign" ? "OTHER" : "SYNTH", priceField: "last_price", priceKrw: mode === "zero" ? Number.MIN_VALUE : 120,
      observedAt: at(44), createdAt: at(44), sourceRefs: ["synthetic-alternate"] }));
    context.mock.timers.setTime(T + 80);
    const snapshot = await state.snapshots.append(snapshotWith([{ ...state.pending, priceEvidenceRef: mode === "missing" ? "missing" : price.evidenceRef }]));
    await assert.rejects(run({ ...state, snapshot }), /exactly once|scope or availability|gross notional mismatch/);
  });
});

test("stored snapshot pending BUY requires exact target price and a price commit strictly before plan cutoff", async (context) => {
  for (const options of [{ referencePriceKrw: 101 }, { priceAppendedAt: 12 }, { priceAppendedAt: 13 }]) {
    await fixture(context, "whole_buy", async (state) => {
      await assert.rejects(run(state), /BUY target reference price or plan cutoff differs/);
    }, options);
  }
});

test("stored snapshot pending requires input time after event commit and rejects terminal omissions correctly", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    const snapshot = await state.snapshots.append(snapshotWith([{ ...state.pending, asOf: at(40) }]));
    await assert.rejects(run({ ...state, snapshot }), /predates its stored plan event/);
    context.mock.timers.setTime(T + 80);
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 80));
    context.mock.timers.setTime(T + 100);
    assert.equal((await run(state)).bindings.length, 1);
    const ended = await state.snapshots.append(snapshotWith([], 90));
    assert.equal((await run({ ...state, snapshot: ended })).bindings.length, 0);
    const stale = await state.snapshots.append(snapshotWith([{ ...state.pending, asOf: at(90) }], 90));
    await assert.rejects(run({ ...state, snapshot: stale }), /action set/);
  });
});

test("stored snapshot pending fails on corrupt snapshot plan event or used price suffix without repair", async (context) => {
  for (const source of ["snapshot", "events", "prices"] as const) await fixture(context, "whole_buy", async (state) => {
    const path = source === "snapshot" ? createPortfolioSizingSnapshotPaths(state.baseDir).recordsPath
      : source === "events" ? createRebalancePlanEventPaths(state.baseDir).eventsPath : createSourcePriceEvidencePaths(state.baseDir).recordsPath;
    const corrupt = `${await readFile(path, "utf8")}{\n`;
    await writeFile(path, corrupt);
    await assert.rejects(run(state));
    assert.equal(await readFile(path, "utf8"), corrupt);
  });
});

test("stored snapshot pending rejects injected source inputs and preserves input scope across awaits", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    await assert.rejects(resolveStoredSnapshotPendingActions({ baseDir: state.baseDir, portfolioSnapshotId: state.snapshot.portfolioSnapshotId, trusted: true } as never));
    const input = { baseDir: state.baseDir, portfolioSnapshotId: state.snapshot.portfolioSnapshotId };
    const pending = resolveStoredSnapshotPendingActions(input);
    input.portfolioSnapshotId = "missing";
    assert.equal((await pending).snapshot.portfolioSnapshotId, state.snapshot.portfolioSnapshotId);
    await assert.rejects(resolveStoredSnapshotPendingActions(input), /exactly once/);
  });
});

type State = Awaited<ReturnType<typeof seed>>;
interface SeedOptions { referencePriceKrw?: number; priceAppendedAt?: number }
async function seed(baseDir: string, kind: Kind, context: TestContext, options: SeedOptions = {}) {
  context.mock.timers.setTime(T + (options.priceAppendedAt ?? 10));
  const prices = new SourcePriceEvidenceFileRepository(baseDir);
  const price = await prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic", market: "KR", symbol: "SYNTH",
    priceField: "last_price", priceKrw: 100, observedAt: at(5), createdAt: at(5), sourceRefs: ["synthetic-price"] }));
  const side = kind.endsWith("buy") ? "BUY" : "SELL";
  const target: RebalanceExecutionTarget = kind === "fractional_buy" ? { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 }
    : kind === "fractional_sell" ? { targetKind: "fractional_sell_quantity", targetQuantity: 0.3, referencePriceKrw: 100, markedTargetNotionalKrw: 30, priceEvidenceRef: price.evidenceRef }
      : { targetKind: "whole_share_quantity", targetQuantity: 3, referencePriceKrw: options.referencePriceKrw ?? 100,
        plannedNotionalKrw: 3 * (options.referencePriceKrw ?? 100), residualNotionalKrw: 0, priceEvidenceRef: price.evidenceRef };
  context.mock.timers.setTime(T + 15);
  const plans = new RebalancePlanFileRepository(baseDir);
  const plan = await plans.append(createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: "paper-main", portfolioVersion: "v1",
    portfolioSnapshotHash: H("v1"), policyHash: H("old-policy"), evidenceCutoffAt: at(12), createdAt: at(15), triggerRef: "synthetic-trigger", phase: side === "BUY" ? "buy" : "sell",
    actions: [{ actionId: "synthetic-action", actionSequence: 0, market: "KR", symbol: "SYNTH", lineageKind: "mandate", side,
      mandateId: "synthetic-mandate", executionTarget: target, maximumNotionalKrw: 400, reasonCodes: ["synthetic"] }] }));
  const events = new RebalancePlanEventFileRepository(baseDir, plans);
  context.mock.timers.setTime(T + 20); const preview = await events.append(event(plan, "previewed", undefined, 20));
  context.mock.timers.setTime(T + 30); const approved = await events.append(event(plan, "approved", preview, 30));
  context.mock.timers.setTime(T + 40);
  const quantity = kind === "fractional_sell" ? 0.1 : kind.startsWith("whole") ? 1 : 0.4;
  const lastEvent = await events.append(event(plan, "execution_applied", approved, 40, { actionId: "synthetic-action", actionSequence: 0, fillSequence: 0,
    fillId: "synthetic-fill", paperFillRecordId: "synthetic-paper-fill", paperFillHash: H("fill"), riskDecisionId: "synthetic-risk",
    requestedNotionalKrw: 40, requestedQuantity: quantity, filledNotionalKrw: 40, filledQuantity: quantity,
    cumulativeFilledNotionalKrw: 40, cumulativeFilledQuantity: quantity, expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: H("v1"),
    resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: H("v2") }));
  const common = { planId: plan.planId, planHash: plan.planHash, planEventId: lastEvent.planEventId, planEventHash: lastEvent.planEventHash,
    actionId: "synthetic-action", actionExecutionTargetHash: hashRebalanceExecutionTarget(target), market: "KR" as const, symbol: "SYNTH", asOf: at(50),
    remainingNotionalKrw: kind === "fractional_buy" ? 60 : kind === "fractional_sell" ? 20 : 200 };
  const pending: PendingPortfolioActionInput = side === "BUY" ? { ...common, side, openingCapacityReservationId: "synthetic-unverified", openingCapacityReservationHash: H("reservation") }
    : { ...common, side, remainingQuantity: kind === "fractional_sell" ? 0.2 : 2, priceEvidenceRef: price.evidenceRef };
  context.mock.timers.setTime(T + 80);
  const snapshots = new PortfolioSizingSnapshotFileRepository(baseDir);
  const snapshot = await snapshots.append(snapshotWith([pending]));
  return { baseDir, prices, plans, events, plan, lastEvent, pending, snapshots, snapshot };
}
function snapshotWith(pending: PendingPortfolioActionInput[], offset = 50) {
  pending = [...canonicalizePendingPortfolioActionInputs(pending)];
  return createPortfolioSizingSnapshot({ portfolioId: "paper-main", portfolioVersion: `v-${hashCanonicalPayload(pending)}`, policyHash: H("current-policy"), asOf: at(offset),
    virtualPortfolio: { portfolioId: "paper-main", cashKrw: 1000, positions: [{ market: "KR", symbol: "SYNTH", assetType: "STOCK", assetClass: "equity",
      region: "KR", riskTags: [], strategyBucket: "swing", sector: "Synthetic", quantity: 10, averagePriceKrw: 100,
      marketPriceKrw: 100, marketValueKrw: 1000, unrealizedPnlKrw: 0, updatedAt: at(offset) }], updatedAt: at(offset) },
    valuationInputs: [{ kind: "mark_price", market: "KR", symbol: "SYNTH", priceKrw: 100, evidenceRef: "synthetic-mark", evidenceAsOf: at(offset) }],
    pendingActionInputs: pending, ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 2000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 1000 },
      symbolExposureKrw: [{ market: "KR", symbol: "SYNTH", exposureKrw: 1000 }], marketExposureKrw: { KR: 1000, US: 0 },
      sectorExposureKrw: { Synthetic: 1000 }, countryExposureKrw: { KR: 1000 }, currencyExposureKrw: { KRW: 1000 }, ...pendingActionExposureTotals(pending) }) });
}
function event(plan: ReturnType<typeof createRebalancePlanRecord>, eventType: RebalancePlanEvent["eventType"], previous: RebalancePlanEvent | undefined, offset: number, extra: Record<string, unknown> = {}) {
  return createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: at(offset), eventType,
    ...(previous === undefined ? {} : { previousPlanEventId: previous.planEventId }), ...(["approved", "rejected"].includes(eventType) ? { reasonCodes: ["synthetic"] } : {}), ...extra } as Parameters<typeof createRebalancePlanEvent>[0]);
}
function run(state: State) { return resolveStoredSnapshotPendingActions({ baseDir: state.baseDir, portfolioSnapshotId: state.snapshot.portfolioSnapshotId }); }
async function fixture(context: TestContext, kind: Kind, operation: (state: State) => Promise<void>, options: SeedOptions = {}) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-snapshot-pending-"));
  context.mock.timers.enable({ apis: ["Date"], now: T + 10 });
  try { await operation(await seed(baseDir, kind, context, options)); }
  finally { context.mock.timers.reset(); await rm(baseDir, { recursive: true, force: true }); }
}
