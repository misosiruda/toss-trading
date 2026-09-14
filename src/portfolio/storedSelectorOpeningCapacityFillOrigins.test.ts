import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignment } from "./candidateAssignment.js";
import { CandidateAssignmentFileRepository, createCandidateAssignmentPaths } from "./candidateAssignmentFiles.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { RebalancePlanEventFileRepository, createRebalancePlanEventPaths } from "./rebalancePlanEventFiles.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { resolveStoredSelectorOpeningCapacityFillOrigins } from "./storedSelectorOpeningCapacityFillOrigins.js";
import { HASH, START, PORTFOLIO, AT, at, snapshot, seedCapacityExecutionHistory, mandateEvent,
  type Options } from "./storedManualOpeningCapacityTestFixtures.js";

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

async function seedSelectorHistory(dir: string, context: TestContext, options: Options) {
  context.mock.timers.setTime(START + 10);
  const origin = snapshot();
  const request = createBucketSelectionRequest({ cycleId: "selector-cycle", triggerIdentity: "scheduled:boundary", triggerRef: "synthetic",
    portfolioId: PORTFOLIO, portfolioSnapshotId: origin.portfolioSnapshotId, portfolioSnapshotHash: origin.portfolioSnapshotHash, policyHash: HASH,
    asOf: AT, bucket: "intraday", gapBasis: "entry_floor", gapKrw: 100, availableSlots: 1, maximumAdditionalExposureKrw: 100, evidenceCutoffAt: AT, createdAt: AT });
  await new BucketSelectionRequestFileRepository(dir).append(request);
  await new PortfolioSizingSnapshotFileRepository(dir).append(origin);
  const input = createCandidateSizingInputRecord({ requestId: request.requestId, portfolioId: PORTFOLIO, portfolioSnapshotId: origin.portfolioSnapshotId,
    portfolioSnapshotHash: origin.portfolioSnapshotHash, policyHash: HASH, asOf: AT, market: "KR", symbol: "005930", bucket: "intraday",
    scoringModelVersion: "score.v1", sizingAlgorithmVersion: "sizing.v1", selectionScore: 0.8,
    exposureKeys: { sector: "Technology", country: "KR", currency: "KRW", classificationEvidenceRef: "classification" },
    featureInputs: [{ featureDefinitionRef: "feature", value: 1, evidenceRefs: ["evidence"] }],
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 1000, sectorRemainingKrw: 1000, countryRemainingKrw: 1000, currencyRemainingKrw: 1000, cashAvailableKrw: 1000 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 100, participationRate: 0.01, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 0, taxBps: 0, halfSpreadBps: 0, slippageBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0, evidenceRefs: ["cost"] }, createdAt: AT });
  await new CandidateSizingInputFileRepository(dir).append(input);
  const assignment = createCandidateAssignment({ requestId: request.requestId, portfolioId: PORTFOLIO, portfolioSnapshotId: origin.portfolioSnapshotId,
    portfolioSnapshotHash: origin.portfolioSnapshotHash, policyHash: HASH, asOf: AT, market: "KR", symbol: "005930", bucket: "intraday",
    scoringModelVersion: input.scoringModelVersion, selectionScore: input.selectionScore, sizingInputRecordId: input.sizingInputRecordId, sizingInputHash: input.sizingInputHash,
    minWeightRatio: 0.01, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumNotionalKrw: 100, eligibility: "eligible",
    reasonCodes: ["synthetic"], evidenceRefs: ["evidence"], createdAt: at(10) });
  const assignments = new CandidateAssignmentFileRepository(dir);
  await assignments.appendAssignment(assignment);
  const sealed = await assignments.sealRequest(request.requestId);
  context.mock.timers.setTime(START + 20);
  const root = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
    reservationId: "selector-reservation", reservationHash: HASH, capacityLedgerVersion: 1, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true,
    reservationSource: { sourceKind: "selector", candidateAssignmentSetId: sealed.record.candidateAssignmentSetId,
      candidateAssignmentSetHash: sealed.record.candidateAssignmentSetHash, candidateAssignmentId: assignment.assignmentId, reservedSlotOrdinal: 19 }, asOf: at(20), createdAt: at(20) });
  const capacity = new OpeningCapacityReservationEventFileRepository(dir);
  await capacity.append(root);
  context.mock.timers.setTime(START + 30);
  const mandate = createInvestmentMandateRecord({ portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday", market: "KR", symbol: "005930", asOf: AT,
    minWeightRatio: 0.01, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumOpeningNotionalKrw: 100, reasonCodes: ["synthetic"], evidenceRefs: ["evidence"],
    evidenceAsOf: AT, reviewCadence: { mode: "every_tick" }, validFrom: AT, assignmentSource: "deterministic_selector", selectionRequestId: request.requestId,
    candidateAssignmentId: assignment.assignmentId, candidateAssignmentSetId: sealed.record.candidateAssignmentSetId, candidateAssignmentSetHash: sealed.record.candidateAssignmentSetHash,
    selectedRank: 1, openingCapacityReservationId: root.reservationId, openingCapacityReservationHash: root.reservationHash, reservedSlotOrdinal: 19,
    reservedMaximumNotionalKrw: 100, scoringModelVersion: input.scoringModelVersion, selectionScore: input.selectionScore, createdAt: at(30) });
  await new InvestmentMandateFileRepository(dir).appendRecord(mandate);
  context.mock.timers.setTime(START + 40);
  const bound = createOpeningCapacityReservationEvent({ eventType: "bound_to_mandate", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
    reservationId: root.reservationId, reservationHash: root.reservationHash, previousCapacityReservationEventId: root.capacityReservationEventId,
    mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true,
    capacityLedgerVersion: 2, asOf: at(40), createdAt: at(40) });
  await capacity.append(bound);
  return seedCapacityExecutionHistory(dir, context, options, { assignment, root, mandate, bound });
}

const run = (dir: string) => resolveStoredSelectorOpeningCapacityFillOrigins({ baseDir: dir, portfolioId: PORTFOLIO });
async function fixture(context: TestContext, options: Options, operation: (state: Awaited<ReturnType<typeof seedSelectorHistory>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "stored-selector-capacity-fill-"));
  context.mock.timers.enable({ apis: ["Date"], now: START });
  try { await operation(await seedSelectorHistory(dir, context, options)); }
  finally { context.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
}
