import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish,
  appendCurrentPortfolioSizingSnapshot as publishUnbound } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { canonicalizePendingPortfolioActionInputs, pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalanceExecutionTarget, type RebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository, createRebalancePlanPaths } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";

const T = Date.parse("2026-09-02T00:00:00.000Z"), at = (offset: number) => new Date(T + offset).toISOString();
const H = (value: string) => hashCanonicalPayload({ synthetic: value });
const options = { lockTimeoutMs: 60, lockRetryDelayMs: 3 };
type Kind = "fractional_buy" | "fractional_sell" | "whole_buy" | "whole_sell";
type State = Awaited<ReturnType<typeof seed>>;

async function seed(baseDir: string, kind: Kind, context: TestContext) {
  const policy = policyFixture(), portfolioPath = join(baseDir, "portfolio.json");
  const store = new FileVirtualPortfolioStore(portfolioPath, options);
  await store.write({ portfolioId: policy.policy.portfolioId, cashKrw: 1000, updatedAt: at(0), positions: [{ market: "KR", symbol: "SYNTH",
    quantity: 10, averagePriceKrw: 100, region: "KR", sector: "Synthetic", strategyBucket: "swing", updatedAt: at(0) }] });
  await storePolicyFixture(baseDir, policy);
  const prices = new SourcePriceEvidenceFileRepository(baseDir, options);
  const price = await prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-pending.v1", market: "KR", symbol: "SYNTH",
    priceField: "last_price", priceKrw: 100, observedAt: at(0), createdAt: at(0), sourceRefs: ["synthetic-price"] }));
  const side = kind.endsWith("buy") ? "BUY" : "SELL";
  const target: RebalanceExecutionTarget = kind === "fractional_buy" ? { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 }
    : kind === "fractional_sell" ? { targetKind: "fractional_sell_quantity", targetQuantity: 0.3, referencePriceKrw: 100,
      markedTargetNotionalKrw: 30, priceEvidenceRef: price.evidenceRef }
    : { targetKind: "whole_share_quantity", targetQuantity: 3, referencePriceKrw: 100, plannedNotionalKrw: 300,
      residualNotionalKrw: 0, priceEvidenceRef: price.evidenceRef };
  context.mock.timers.setTime(T + 15);
  const plans = new RebalancePlanFileRepository(baseDir, options);
  const plan = await plans.append(createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: policy.policy.portfolioId,
    portfolioVersion: "synthetic-v1", portfolioSnapshotHash: H("old-snapshot"), policyHash: H("prior-policy"), evidenceCutoffAt: at(12),
    createdAt: at(15), triggerRef: "synthetic-trigger", phase: side === "BUY" ? "buy" : "sell",
    actions: [{ actionId: "synthetic-action", actionSequence: 0, market: "KR", symbol: "SYNTH", lineageKind: "mandate", side,
      mandateId: "synthetic-mandate", executionTarget: target, maximumNotionalKrw: 400, reasonCodes: ["synthetic"] }] }));
  const events = new RebalancePlanEventFileRepository(baseDir, plans, options);
  context.mock.timers.setTime(T + 20); const preview = await events.append(event(plan, "previewed", undefined, 20));
  context.mock.timers.setTime(T + 30); const approved = await events.append(event(plan, "approved", preview, 30));
  context.mock.timers.setTime(T + 40);
  const quantity = kind === "fractional_sell" ? 0.1 : kind.startsWith("whole") ? 1 : 0.4;
  const lastEvent = await events.append(event(plan, "execution_applied", approved, 40, { actionId: "synthetic-action", actionSequence: 0, fillSequence: 0,
    fillId: "synthetic-fill", paperFillRecordId: "synthetic-paper-fill", paperFillHash: H("fill"), riskDecisionId: "synthetic-risk",
    requestedNotionalKrw: 40, requestedQuantity: quantity, filledNotionalKrw: 40, filledQuantity: quantity,
    cumulativeFilledNotionalKrw: 40, cumulativeFilledQuantity: quantity, expectedPrePortfolioVersion: "synthetic-v1", expectedPrePortfolioSnapshotHash: H("old-snapshot"),
    resultingPortfolioVersion: "synthetic-v2", resultingPortfolioSnapshotHash: H("v2") }));
  const common = { planId: plan.planId, planHash: plan.planHash, planEventId: lastEvent.planEventId, planEventHash: lastEvent.planEventHash,
    actionId: "synthetic-action", actionExecutionTargetHash: hashRebalanceExecutionTarget(target), market: "KR" as const, symbol: "SYNTH", asOf: at(50),
    remainingNotionalKrw: kind === "fractional_buy" ? 60 : kind === "fractional_sell" ? 20 : 200 };
  const pending: PendingPortfolioActionInput = side === "BUY" ? { ...common, side, openingCapacityReservationId: "synthetic-unverified", openingCapacityReservationHash: H("reservation") }
    : { ...common, side, remainingQuantity: kind === "fractional_sell" ? 0.2 : 2, priceEvidenceRef: price.evidenceRef };
  context.mock.timers.setTime(T + 100);
  return { baseDir, portfolioPath, policy, plans, events, plan, lastEvent, pending, prices, price,
    records: createPortfolioSizingSnapshotPaths(baseDir).recordsPath, snapshots: new PortfolioSizingSnapshotFileRepository(baseDir, options) };
}
function request(state: State, pending: readonly PendingPortfolioActionInput[] = [state.pending], offset = 50) {
  const pendingActionInputs = canonicalizePendingPortfolioActionInputs(pending);
  return { baseDir: state.baseDir, portfolioPath: state.portfolioPath, policyHash: state.policy.policy.policyHash, asOf: at(offset),
    valuationInputs: [{ kind: "mark_price" as const, market: "KR" as const, symbol: "SYNTH", priceKrw: 100,
      evidenceRef: state.price.evidenceRef, evidenceAsOf: state.price.observedAt }], pendingActionInputs: [...pendingActionInputs],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 2000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 1000 },
      symbolExposureKrw: [{ market: "KR", symbol: "SYNTH", exposureKrw: 1000 }], marketExposureKrw: { KR: 1000, US: 0 },
      sectorExposureKrw: { Synthetic: 1000 }, countryExposureKrw: { KR: 1000 }, currencyExposureKrw: { KRW: 1000 }, ...pendingActionExposureTotals(pendingActionInputs) }) };
}
function event(plan: RebalancePlanRecord, eventType: RebalancePlanEvent["eventType"], previous: RebalancePlanEvent | undefined,
  offset: number, extra: Record<string, unknown> = {}) {
  return createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: at(offset), eventType,
    ...(previous === undefined ? {} : { previousPlanEventId: previous.planEventId }), ...(["approved", "rejected"].includes(eventType) ? { reasonCodes: ["synthetic"] } : {}),
    ...extra } as Parameters<typeof createRebalancePlanEvent>[0]);
}
async function fixture(context: TestContext, kind: Kind, operation: (state: State) => Promise<void>) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "current-sizing-pending-"));
  context.mock.timers.enable({ apis: ["Date"], now: T + 10 });
  try { await operation(await seed(baseDir, kind, context)); }
  finally { context.mock.timers.reset(); await fs.rm(baseDir, { recursive: true, force: true }); }
}

test("policy-bound current sizing binds partial pending progress for every target kind including earlier policy plans", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) await fixture(context, kind, async (state) => {
    const result = await publish(request(state), options);
    assert.deepEqual(result.pendingActionInputs, [state.pending]);
    assert.notEqual(state.plan.policyHash, result.policyHash);
    assert.deepEqual(await publish(request(state), options), result);
    assert.equal((await new PortfolioSizingSnapshotFileRepository(state.baseDir).readAll()).length, 1);
  });
});

test("policy-bound current sizing rejects omitted extra substituted and mismatched pending actions before persistence", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    const wrong = { ...state.pending, actionId: "synthetic-other" };
    for (const pending of [[], [state.pending, wrong], [wrong], [{ ...state.pending, planHash: H("wrong") }],
      [{ ...state.pending, planEventHash: H("wrong") }], [{ ...state.pending, actionExecutionTargetHash: H("wrong") }]]) {
      await assert.rejects(publish(request(state, pending), options), /snapshot pending/);
      await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
    }
    // Legacy publisher still accepts independently valid historical inputs without source-origin binding.
    assert.equal((await publishUnbound(request(state, []), options)).pendingActionInputs.length, 0);
  });
});

test("policy-bound current sizing reads pending quantity price sources even when the portfolio holds only cash", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    await new FileVirtualPortfolioStore(state.portfolioPath).write({ portfolioId: state.policy.policy.portfolioId,
      cashKrw: 1000, positions: [], updatedAt: at(0) });
    const input = { ...request(state), valuationInputs: [], ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      ...pendingActionExposureTotals([state.pending]) }) };
    assert.equal((await publish(input, options)).pendingActionInputs[0]!.remainingNotionalKrw, 200);
  });
});

test("policy-bound current sizing compares remaining target or quantity gross instead of execution cap", async (context) => {
  for (const kind of ["fractional_buy", "fractional_sell", "whole_buy", "whole_sell"] as const) await fixture(context, kind, async (state) => {
    await assert.rejects(publish(request(state, [{ ...state.pending, remainingNotionalKrw: 360 }]), options), /remaining gross/);
    if (state.pending.side === "SELL") {
      await assert.rejects(publish(request(state, [{ ...state.pending, remainingQuantity: 0.1 }]), options), /remaining quantity/);
    }
    await assert.rejects(fs.readFile(state.records), { code: "ENOENT" });
  });
});

test("policy-bound current sizing uses stored SELL revaluation and rejects missing or late pending price origins", async (context) => {
  await fixture(context, "fractional_sell", async (state) => {
    assert.equal(state.pending.side, "SELL"); if (state.pending.side !== "SELL") return;
    await assert.rejects(publish(request(state, [{ ...state.pending, priceEvidenceRef: "missing-price" }]), options), /does not resolve/);
    context.mock.timers.setTime(T + 45);
    const revalued = await state.prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-revalue", market: "KR", symbol: "SYNTH",
      priceField: "last_price", priceKrw: 120, observedAt: at(44), createdAt: at(44), sourceRefs: ["synthetic"] }));
    context.mock.timers.setTime(T + 100);
    const pending = { ...state.pending, priceEvidenceRef: revalued.evidenceRef, remainingNotionalKrw: 24 };
    assert.equal((await publish(request(state, [pending]), options)).exposureSnapshot.pendingSellExposureKrw, 24);
    const late = await state.prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-late", market: "KR", symbol: "SYNTH",
      priceField: "last_price", priceKrw: 120, observedAt: at(44), createdAt: at(44), sourceRefs: ["synthetic-late"] }));
    await assert.rejects(publish(request(state, [{ ...pending, priceEvidenceRef: late.evidenceRef }]), options), /availability mismatch/);
  });
});

test("policy-bound current sizing keeps plan and event writers excluded through append and retry fsync", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    const original = fs.open; let checks = 0, inspect = true;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === state.records && ["a", "r+"].includes(String(args[1]))) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await sync(); if (!inspect) return; inspect = false; checks++;
          await assert.rejects(state.plans.append(state.plan), /lock is unavailable/);
          await assert.rejects(state.events.append(event(state.plan, "rejected", state.lastEvent, 100)), /lock is unavailable/);
        });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { const first = await publish(request(state), options); inspect = true; assert.deepEqual(await publish(request(state), options), first); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checks, 2);
    await state.plans.append(state.plan);
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 100));
  });
});

test("policy-bound current sizing rejects missing and corrupt pending sources on exact retry without changing destination", async (context) => {
  for (const source of ["plan", "events"] as const) await fixture(context, "whole_buy", async (state) => {
    await publish(request(state), options); const before = await fs.readFile(state.records);
    const path = source === "plan" ? createRebalancePlanPaths(state.baseDir).recordsPath : createRebalancePlanEventPaths(state.baseDir).eventsPath;
    const original = await fs.readFile(path);
    for (const damaged of [Buffer.from(""), Buffer.concat([original, Buffer.from("{\n")])]) {
      await fs.writeFile(path, damaged);
      await assert.rejects(publish(request(state), options));
      assert.deepEqual(await fs.readFile(state.records), before);
      assert.deepEqual(await fs.readFile(path), damaged);
    }
  });
});

test("policy-bound current sizing selects cutoff prefix and refuses pending input at its event commit boundary", async (context) => {
  await fixture(context, "fractional_buy", async (state) => {
    await assert.rejects(publish(request(state, [{ ...state.pending, asOf: at(40) }]), options), /predates its stored/);
    await state.events.append(event(state.plan, "rejected", state.lastEvent, 100));
    const earlier = await publish(request(state), options);
    assert.equal(earlier.pendingActionInputs.length, 1);
    context.mock.timers.setTime(T + 120);
    assert.equal((await publish(request(state, [], 110), options)).pendingActionInputs.length, 0);
    await assert.rejects(publish(request(state, [state.pending], 110), options), /action set/);
  });
});
