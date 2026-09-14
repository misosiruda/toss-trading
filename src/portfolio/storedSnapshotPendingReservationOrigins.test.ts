import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { pendingActionExposureTotals } from "./portfolioSizingInputs.js";
import { createRebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { HASH, OTHER, START, PORTFOLIO, at, snapshot, mandateEvent,
  fixture as manualFixture, type State as ManualState, type Options } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture, type SelectorCapacityState } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotPendingReservationOrigins } from "./storedSnapshotPendingReservationOrigins.js";

type State = ManualState | SelectorCapacityState;
type Stored = { state: State; snapshot: Awaited<ReturnType<typeof storeSnapshot>> };
const run = ({ state, snapshot }: Stored) => resolveStoredSnapshotPendingReservationOrigins({ baseDir: state.dir, portfolioSnapshotId: snapshot.portfolioSnapshotId });

test("pending BUY reservation origins bind manual and selector gross balances and old-policy sources across partial fills", async (context) => {
  for (const source of ["manual", "selector"] as const) for (const count of [0, 1, 2, 3]) {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const stored = { state, snapshot: await storeSnapshot(state, context, { policyHash: OTHER }) };
      const result = await run(stored);
      assert.equal(result.bindings.length, count === 3 ? 0 : 1);
      if (count !== 3) {
        const binding = result.bindings[0]!;
        assert.equal(binding.reservation.sourceKind, source);
        assert.equal(binding.reservation.mandate.policyHash, HASH);
        assert.equal(binding.pending.openingCapacityReservationId, state.manual.bound.reservationId);
        assert.equal(binding.priorConsumptionOrigins.length, count);
        assert.equal(result.reservationTotals[0]!.pendingNotionalKrw, count === 0 ? 100 : count === 1 ? 60 : 30);
        assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, result.reservationTotals[0]!.pendingNotionalKrw);
      }
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      assert.equal(result.assessment.slotAndBudgetAllocationAuthority, "not_verified");
      assert.deepEqual(result.assessment.unverifiedCapacityEventIds, []);
      assert.deepEqual(await run(stored), result);
      assert.ok(Object.isFrozen(result.bindings)); assert.ok(Object.isFrozen(result.reservationTotals));
    });
  }
});

test("pending BUY reservation origins reject wrong reservation identity hash and nonactive opening mandate", async (context) => {
  for (const patch of [{ openingCapacityReservationId: "missing" }, { openingCapacityReservationHash: OTHER }]) {
    await fixture(context, "selector", { count: 0 }, async (state) => {
      await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context, { patch }) }), /reservation or mandate lineage mismatch/);
    });
  }
  for (const mandateState of ["proposed", "review_required", "retired"] as const) {
    await fixture(context, "manual", { count: 0, mandateState }, async (state) => {
      await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context) }), /active.*mandate/);
    });
  }
  await fixture(context, "selector", { count: 0, wrongMandate: true }, async (state) => {
    await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context) }), /reservation or mandate lineage mismatch/);
  });
});

test("pending BUY reservation origins reject missing consumption and ambiguous or not-yet-consumed cutoff", async (context) => {
  for (const mode of ["missing", "ambiguous", "before_consumption"] as const) await fixture(context, "selector", { count: 1 }, async (state) => {
    if (mode === "missing") {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const rows = (await readFile(path, "utf8")).trimEnd().split("\n");
      await writeFile(path, rows.slice(0, -2).join("\n") + "\n");
    }
    const stored = { state, snapshot: await storeSnapshot(state, context, { cutoff: mode === "ambiguous" ? 95 : mode === "before_consumption" ? 93 : 170 }) };
    await assert.rejects(run(stored), /ambiguous at cutoff|prior execution lacks its actual reservation consumption/);
  });
});

test("pending BUY reservation origins retain historical balance after later consumption but reject released capacity", async (context) => {
  await fixture(context, "selector", { count: 2 }, async (state) => {
    const result = await run({ state, snapshot: await storeSnapshot(state, context, { cutoff: 100 }) });
    assert.equal(result.bindings[0]!.priorConsumptionOrigins.length, 1);
    assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, 60);
    assert.equal(state.capacity.at(-1)!.remainingReservedNotionalKrw, 30);
  });
  await fixture(context, "manual", { count: 1 }, async (state) => {
    const mandates = new InvestmentMandateFileRepository(state.dir);
    const activated = (await mandates.readSnapshot()).events[0]!;
    context.mock.timers.setTime(START + 160);
    const retired = mandateEvent(state.manual.mandate, "retired", 160, activated.mandateEventId);
    await mandates.appendEvent(retired);
    const previous = state.capacity.at(-1)!;
    context.mock.timers.setTime(START + 165);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({ eventType: "released",
      portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday", reservationId: previous.reservationId, reservationHash: previous.reservationHash,
      previousCapacityReservationEventId: previous.capacityReservationEventId, capacityLedgerVersion: previous.capacityLedgerVersion + 1,
      remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(165), createdAt: at(165), releaseReasonCode: "retired",
      releaseOrigin: { originKind: "mandate_terminal", mandateId: retired.mandateId, mandateHash: retired.mandateHash,
        mandateEventId: retired.mandateEventId, mandateEventHash: retired.mandateEventHash } }));
    const historical = await run({ state, snapshot: await storeSnapshot(state, context, { cutoff: 100 }) });
    assert.equal(historical.bindings[0]!.mandateState.status, "active");
    assert.equal(historical.reservationTotals[0]!.remainingReservedNotionalKrw, 60);
    await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context) }), /available bound reservation at cutoff/);
  });
});

test("pending BUY reservation origins aggregate separate pending actions instead of reusing the full reservation", async (context) => {
  await fixture(context, "selector", { count: 0 }, async (state) => {
    await appendOtherPlan(state, context);
    await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context, { cutoff: 190 }) }), /exceeds remaining reservation gross/);
  });
});

test("pending BUY reservation origins reject final capacity generation changes and preserve corrupt fill bytes", async (context) => {
  await fixture(context, "selector", { count: 1 }, async (state) => {
    const stored = { state, snapshot: await storeSnapshot(state, context) };
    const original = OpeningCapacityReservationEventFileRepository.prototype.withDurableVerifiedHistory;
    let observations = 0;
    const mocked = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory",
      async function(this: OpeningCapacityReservationEventFileRepository, operation: Parameters<typeof original>[0]) {
        if (++observations === 9) await this.append(createOpeningCapacityReservationEvent({ eventType: "reserved",
          portfolioId: PORTFOLIO, policyHash: OTHER, bucket: "intraday", reservationId: "concurrent", reservationHash: HASH,
          capacityLedgerVersion: 1, remainingReservedNotionalKrw: 1, occupiesNewPositionSlot: true, asOf: at(200), createdAt: at(200),
          reservationSource: { sourceKind: "selector", candidateAssignmentId: "unverified", candidateAssignmentSetId: "unverified",
            candidateAssignmentSetHash: HASH, reservedSlotOrdinal: 0 } }));
        return original.call(this, operation);
      } as typeof original);
    try { await assert.rejects(run(stored), /capacity generation changed/); assert.equal(observations, 9); }
    finally { mocked.mock.restore(); }
    const retry = await run(stored);
    assert.equal(retry.bindings.length, 1); assert.equal(retry.assessment.unverifiedCapacityEventIds.length, 1);
    const path = createPaperFillExecutionPaths(state.dir).recordsPath, valid = await readFile(path, "utf8");
    await writeFile(path, valid + "{broken}\n");
    await assert.rejects(run(stored)); assert.equal(await readFile(path, "utf8"), valid + "{broken}\n");
  });
});

test("pending BUY reservation origins capture strict query input before asynchronous source reads", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const stored = await storeSnapshot(state, context), input = { baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId };
    const pending = resolveStoredSnapshotPendingReservationOrigins(input);
    input.baseDir = join(state.dir, "missing"); input.portfolioSnapshotId = "missing";
    assert.equal((await pending).bindings.length, 1);
    await assert.rejects(resolveStoredSnapshotPendingReservationOrigins({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId, trusted: true } as never));
  });
});

test("pending BUY reservation origins reject a changed mandate generation instead of combining source observations", async (context) => {
  await fixture(context, "selector", { count: 0 }, async (state) => {
    const stored = { state, snapshot: await storeSnapshot(state, context) };
    const capacitySpy = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory");
    const original = InvestmentMandateFileRepository.prototype.withDurableVerifiedHistory;
    let injected = false;
    const mocked = context.mock.method(InvestmentMandateFileRepository.prototype, "withDurableVerifiedHistory",
      async function(this: InvestmentMandateFileRepository, operation: Parameters<typeof original>[0]) {
        if (!injected && capacitySpy.mock.callCount() === 8) {
          injected = true;
          const { mandateId: _id, mandateHash: _hash, ...payload } = state.manual.mandate;
          await this.appendRecord(createInvestmentMandateRecord({ ...payload, symbol: "000660", createdAt: at(200) }));
        }
        return original.call(this, operation);
      } as typeof original);
    try { await assert.rejects(run(stored), /mandate generation changed/); assert.equal(injected, true); }
    finally { mocked.mock.restore(); capacitySpy.mock.restore(); }
    assert.equal((await run(stored)).bindings.length, 1);
  });
});

async function storeSnapshot(state: State, context: TestContext, options: { cutoff?: number; policyHash?: string; patch?: Record<string, string> } = {}) {
  const cutoff = options.cutoff ?? 170;
  context.mock.timers.setTime(START + 200);
  const progress = await resolveStoredPendingPlanActionProgress({ baseDir: state.dir, portfolioId: PORTFOLIO, asOf: at(cutoff) });
  const inputs = progress.projection.pendingActions.map((item) => ({ planId: item.planId, planHash: item.planHash,
    planEventId: item.planEventId, planEventHash: item.planEventHash, actionId: item.action.actionId, actionExecutionTargetHash: item.actionExecutionTargetHash,
    market: item.action.market, symbol: item.action.symbol, side: "BUY" as const, remainingNotionalKrw: item.remainingTargetNotionalKrw!, asOf: at(cutoff),
    openingCapacityReservationId: state.manual.bound.reservationId, openingCapacityReservationHash: state.manual.bound.reservationHash, ...options.patch }));
  const base = snapshot(options.policyHash ?? HASH);
  const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = base;
  return new PortfolioSizingSnapshotFileRepository(state.dir).append(createPortfolioSizingSnapshot({ ...payload, asOf: at(cutoff),
    portfolioVersion: "pending-snapshot", virtualPortfolio: { ...base.virtualPortfolio, updatedAt: at(cutoff) }, pendingActionInputs: inputs,
    ...createPortfolioExposureSnapshot({ ...base.exposureSnapshot, ...pendingActionExposureTotals(inputs) }) }));
}
async function appendOtherPlan(state: State, context: TestContext) {
  const { planId: _id, planHash: _hash, ...payload } = state.plan;
  context.mock.timers.setTime(START + 160);
  const plans = new RebalancePlanFileRepository(state.dir), plan = await plans.append(createRebalancePlanRecord({ ...payload,
    cycleId: "other-cycle", createdAt: at(160) }));
  const events = new RebalancePlanEventFileRepository(state.dir, plans);
  const base = { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash };
  context.mock.timers.setTime(START + 175);
  const preview = await events.append(createRebalancePlanEvent({ ...base, eventType: "previewed", asOf: at(175) }));
  context.mock.timers.setTime(START + 180);
  await events.append(createRebalancePlanEvent({ ...base, eventType: "approved", asOf: at(180), previousPlanEventId: preview.planEventId, reasonCodes: ["synthetic"] }));
}
async function fixture(context: TestContext, source: "manual" | "selector", options: Options, operation: (state: State) => Promise<void>) {
  if (source === "manual") await manualFixture(context, options, operation);
  else await selectorFixture(context, options, operation);
}
