import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext } from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignment } from "./candidateAssignment.js";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository } from "./candidateSizingInputFiles.js";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createSelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { HASH, START, PORTFOLIO, AT, at, snapshot, seedCapacityExecutionHistory,
  type Options } from "./storedManualOpeningCapacityTestFixtures.js";

type SelectorOptions = Options & { storeSelectorIssuance?: boolean };
async function seedSelectorHistory(dir: string, context: TestContext, options: SelectorOptions) {
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
  context.mock.timers.setTime(START + 15);
  const issuance = createSelectorOpeningCapacityReservationRecord({ selectionRequestId: request.requestId, selectionRequestHash: request.requestHash,
    candidateAssignmentSetId: sealed.record.candidateAssignmentSetId, candidateAssignmentSetHash: sealed.record.candidateAssignmentSetHash,
    candidateAssignmentId: assignment.assignmentId, candidateAssignmentHash: assignment.assignmentHash, selectedRank: 1,
    portfolioId: PORTFOLIO, policyHash: HASH, bucket: assignment.bucket, market: assignment.market, symbol: assignment.symbol,
    currentPortfolioSnapshotId: origin.portfolioSnapshotId, currentPortfolioSnapshotHash: origin.portfolioSnapshotHash,
    capacityLedgerVersion: 1, reservedSlotOrdinal: 19, reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: 100, createdAt: at(15) });
  // Issuance repository tests deliberately start before issuance; downstream provenance fixtures persist it.
  if (options.storeSelectorIssuance !== false) await new SelectorOpeningCapacityReservationFileRepository(dir).append(issuance);
  context.mock.timers.setTime(START + 20);
  const root = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
    reservationId: issuance.selectorCapacityReservationId, reservationHash: issuance.selectorCapacityReservationHash,
    capacityLedgerVersion: 1, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true,
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


export type SelectorCapacityState = Awaited<ReturnType<typeof seedSelectorHistory>>;
export async function fixture(context: TestContext, options: SelectorOptions, operation: (state: Awaited<ReturnType<typeof seedSelectorHistory>>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "stored-selector-capacity-fill-"));
  context.mock.timers.enable({ apis: ["Date"], now: START });
  try { await operation(await seedSelectorHistory(dir, context, options)); }
  finally { context.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
}
