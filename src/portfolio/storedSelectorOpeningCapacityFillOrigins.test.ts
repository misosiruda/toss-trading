import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignmentPaths } from "./candidateAssignmentFiles.js";
import { createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { resolveStoredSelectorOpeningCapacityFillOrigins } from "./storedSelectorOpeningCapacityFillOrigins.js";
import { HASH, START, PORTFOLIO, at, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture } from "./storedSelectorOpeningCapacityTestFixtures.js";

test("selector capacity consumption binds actual selected sources plan Risk price and partial fills across restart", async (context) => {
  await fixture(context, { count: 3, feeBps: 250 }, async (state) => {
    const result = await run(state.dir);
    assert.equal(result.bindings.length, 3);
    assert.deepEqual(result.bindings.map((binding) => binding.consumedNotionalKrw), [40, 30, 30]);
    assert.equal(result.bindings[0]!.execution.paperFill.netAmountKrw, 41);
    assert.equal(result.bindings[0]!.event.remainingReservedNotionalKrw, 60);
    assert.equal(result.bindings[2]!.event.remainingReservedNotionalKrw, 0);
    assert.equal(result.mandates.bindings[0]!.mandate.reservedSlotOrdinal, 19);
    assert.equal(result.mandates.bindings[0]!.source.binding.assignment.assignmentId, state.manual.assignment.assignmentId);
    assert.equal(result.bindings[0]!.mandateBinding.source.binding.assignment.assignmentId, state.manual.assignment.assignmentId);
    assert.equal(result.bindings[0]!.fillOrigin.riskOrigin!.commitHash, result.bindings[0]!.riskOrigin.commitHash);
    assert.equal(result.assessment.verificationScope, "stored_selector_capacity_fill_origins_only");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.equal(result.assessment.accountingAndResultingPositionAuthority, "not_verified");
    assert.equal(result.assessment.riskPolicyAndRuleAuthority, "not_verified");
    assert.equal(result.mandates.assessment.rootAllocationAuthority, "not_verified");
    assert.deepEqual(result.assessment.unverifiedEventIds, []);
    assert.ok(Object.isFrozen(result.bindings[0]!.execution.paperFill));
    assert.deepEqual(await run(state.dir), result);
  });
});

test("selector capacity consumption rejects wrong gross decrement Risk origin target bucket mandate and timing", async (context) => {
  for (const options of [{ wrongDelta: true, feeBps: 250 }, { unbound: true }, { wrongRiskTarget: true },
    { wrongRiskBucket: true }, { wrongMandate: true }, { earlyCapacity: true }]) {
    await fixture(context, options, async (state) => {
      await assert.rejects(run(state.dir), /differs from actual filled|risk origin persisted|target|scope mismatch|lineage mismatch|chronology mismatch/);
    });
  }
});

test("selector capacity consumption requires historical active mandate and validates stored Risk source receipts", async (context) => {
  for (const mandateState of ["proposed", "review_required", "retired", "late_activation"] as const) {
    await fixture(context, { mandateState }, async (state) => { await assert.rejects(run(state.dir), /mandate/); });
  }
  await fixture(context, { receipt: "valid" }, async (state) => {
    assert.ok((await run(state.dir)).bindings[0]!.riskOrigin.mandateOrigin);
    const mandates = new InvestmentMandateFileRepository(state.dir);
    const history = await mandates.readSnapshot();
    context.mock.timers.setTime(START + 100);
    await mandates.appendEvent(mandateEvent(state.manual.mandate, "retired", 100, history.events[0]!.mandateEventId));
    assert.equal((await run(state.dir)).bindings[0]!.mandateState.status, "active");
  });
  for (const receipt of ["wrong_mandate", "wrong_event", "wrong_prefix", "wrong_plan"] as const) {
    await fixture(context, { receipt }, async (state) => {
      await assert.rejects(run(state.dir), /receipt mismatch|does not match durable source prefixes/);
    });
  }
});

test("selector capacity consumption preserves corrupt sources and does not authenticate release or manual roots", async (context) => {
  await fixture(context, {}, async (state) => {
    const paths = [createCandidateAssignmentPaths(state.dir).recordsPath, createCandidateSizingInputPaths(state.dir).recordsPath,
      createBucketSelectionRequestPaths(state.dir).recordsPath, createInvestmentMandatePaths(state.dir).eventsPath,
      createPaperFillExecutionPaths(state.dir).recordsPath, createPortfolioActionRiskDecisionPaths(state.dir).recordsPath,
      createRebalancePlanEventPaths(state.dir).eventsPath, createSourcePriceEvidencePaths(state.dir).recordsPath];
    for (const path of paths) {
      const original = await readFile(path, "utf8"), corrupt = original + "{broken}\n";
      await writeFile(path, corrupt);
      await assert.rejects(run(state.dir));
      assert.equal(await readFile(path, "utf8"), corrupt);
      await writeFile(path, original);
    }
    const capacity = new OpeningCapacityReservationEventFileRepository(state.dir), previous = state.capacity[0]!;
    context.mock.timers.setTime(START + 100);
    const release = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: previous.reservationId, reservationHash: previous.reservationHash, previousCapacityReservationEventId: previous.capacityReservationEventId,
      capacityLedgerVersion: 4, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(100), createdAt: at(100),
      releaseReasonCode: "unverified", releaseOrigin: { originKind: "mandate_terminal", mandateId: state.manual.mandate.mandateId,
        mandateHash: state.manual.mandate.mandateHash, mandateEventId: "unverified", mandateEventHash: HASH } });
    await capacity.append(release);
    const manual = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: "unverified-manual", reservationHash: HASH, capacityLedgerVersion: 5, remainingReservedNotionalKrw: 1, occupiesNewPositionSlot: true,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: "unverified-manual", manualCapacityReservationHash: HASH },
      asOf: at(100), createdAt: at(100) });
    await capacity.append(manual);
    const result = await run(state.dir);
    assert.equal(result.bindings.length, 1);
    assert.deepEqual(result.assessment.unverifiedEventIds, [release.capacityReservationEventId, manual.capacityReservationEventId]);
    const before = await readFile(createOpeningCapacityReservationEventPaths(state.dir).eventsPath);
    await assert.rejects(resolveStoredSelectorOpeningCapacityFillOrigins({ baseDir: state.dir, portfolioId: PORTFOLIO, trusted: true } as never));
    assert.deepEqual(await readFile(createOpeningCapacityReservationEventPaths(state.dir).eventsPath), before);
  });
});

test("selector capacity consumption rejects a changed event generation and captures zero-fill query input", async (context) => {
  await fixture(context, { count: 0 }, async (state) => {
    const input = { baseDir: state.dir, portfolioId: PORTFOLIO };
    const pending = resolveStoredSelectorOpeningCapacityFillOrigins(input);
    input.baseDir = join(state.dir, "missing"); input.portfolioId = "foreign";
    const result = await pending;
    assert.equal(result.bindings.length, 0);
    assert.equal(result.mandates.bindings.length, 1);
    assert.deepEqual(result.assessment.unverifiedEventIds, []);
    const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
    const mocked = context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (
      this: RebalancePlanEventFileRepository
    ) {
      const history = await original.call(this);
      await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
        eventType: "reserved", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday", reservationId: "concurrent-manual",
        reservationHash: HASH, capacityLedgerVersion: 3, remainingReservedNotionalKrw: 1, occupiesNewPositionSlot: true,
        reservationSource: { sourceKind: "manual", manualCapacityReservationId: "concurrent-manual", manualCapacityReservationHash: HASH },
        asOf: at(100), createdAt: at(100)
      }));
      return history;
    });
    context.mock.timers.setTime(START + 100);
    try { await assert.rejects(run(state.dir), /event generation changed during fill resolution/); }
    finally { mocked.mock.restore(); }
    const refreshed = await run(state.dir);
    assert.equal(refreshed.bindings.length, 0);
    assert.equal(refreshed.assessment.unverifiedEventIds.length, 1);
  });
});

const run = (dir: string) => resolveStoredSelectorOpeningCapacityFillOrigins({ baseDir: dir, portfolioId: PORTFOLIO });
