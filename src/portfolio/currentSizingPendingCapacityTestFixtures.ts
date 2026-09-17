import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository } from "./bucketSelectionRequestFiles.js";
import { createCandidateAssignment } from "./candidateAssignment.js";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository } from "./candidateSizingInputFiles.js";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createSelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

/** Synthetic actual issuance journals only; not current portfolio accounting or allocator evidence. */
export async function seedPendingOpeningReservation(baseDir: string, portfolioId: string, policyHash: string, selector: boolean,
  at: (offset: number) => string, move: (offset: number) => void) {
  move(0);
  const hash = hashCanonicalPayload({ synthetic: "pending-opening-source" });
  const scope = { portfolioId, policyHash, market: "KR" as const, symbol: "SYNTH", bucket: "swing" as const };
  const origin = createPortfolioSizingSnapshot({ portfolioId, policyHash, portfolioVersion: "synthetic-opening-source", asOf: at(0),
    virtualPortfolio: { portfolioId, cashKrw: 1000, positions: [], updatedAt: at(0) }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
  await new PortfolioSizingSnapshotFileRepository(baseDir).append(origin);
  const current = { currentPortfolioSnapshotId: origin.portfolioSnapshotId, currentPortfolioSnapshotHash: origin.portfolioSnapshotHash };
  const capacity = new OpeningCapacityReservationEventFileRepository(baseDir);
  if (!selector) {
    const manual = createManualAssignmentEvent({ ...scope, asOf: at(0), createdAt: at(0), evidenceAsOf: at(0),
      selectionPolicyRecordId: "synthetic-selection", selectionPolicyHash: hash, reasonCodes: ["synthetic"], evidenceRefs: ["synthetic"],
      evidenceValidationHash: hash, authorizationRef: "synthetic-opening", authorizationScope: "open_or_increase", evidenceEligibility: "eligible",
      portfolioSnapshotId: origin.portfolioSnapshotId, portfolioSnapshotHash: origin.portfolioSnapshotHash,
      sizingInputRecordId: "synthetic-sizing", sizingInputHash: hash, sizingOutputHash: hash,
      minWeightRatio: 0.05, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumNotionalKrw: 400 });
    await new ManualAssignmentFileRepository(baseDir).append(manual);
    move(1);
    const issuance = createManualOpeningCapacityReservationRecord({ ...scope, ...current,
      manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
      capacityLedgerVersion: 1, reservedMaximumNotionalKrw: 400, resultingReservedNotionalKrw: 400,
      authorizationRef: manual.authorizationRef, reservationKind: "new_position", reservedSlotOrdinal: 0, createdAt: at(1) });
    await new ManualOpeningCapacityReservationFileRepository(baseDir).append(issuance);
    move(2);
    const root = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId, policyHash, bucket: scope.bucket,
      reservationId: issuance.manualCapacityReservationId, reservationHash: issuance.manualCapacityReservationHash,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: issuance.manualCapacityReservationId,
        manualCapacityReservationHash: issuance.manualCapacityReservationHash }, capacityLedgerVersion: 1,
      remainingReservedNotionalKrw: 400, occupiesNewPositionSlot: true, asOf: at(2), createdAt: at(2) });
    await capacity.append(root);
    return { root, lineage: { assignmentSource: "manual_policy" as const, manualAuthorizationScope: "open_or_increase" as const,
      manualAssignmentEventId: manual.manualAssignmentEventId, capacityReservation: {
        manualCapacityReservationId: root.reservationId, manualCapacityReservationHash: root.reservationHash,
        reservedMaximumNotionalKrw: 400, reservationKind: "new_position" as const, reservedSlotOrdinal: 0 } } };
  }
  const snapshotRef = { portfolioSnapshotId: origin.portfolioSnapshotId, portfolioSnapshotHash: origin.portfolioSnapshotHash };
  const request = createBucketSelectionRequest({ portfolioId, policyHash, ...snapshotRef, bucket: scope.bucket,
    cycleId: "synthetic-opening-cycle", triggerIdentity: "scheduled:synthetic", triggerRef: "synthetic", asOf: at(0),
    gapBasis: "entry_floor", gapKrw: 400, availableSlots: 1, maximumAdditionalExposureKrw: 400, evidenceCutoffAt: at(0), createdAt: at(0) });
  await new BucketSelectionRequestFileRepository(baseDir).append(request);
  const input = createCandidateSizingInputRecord({ ...scope, ...snapshotRef, requestId: request.requestId, asOf: at(0),
    scoringModelVersion: "synthetic-v1", sizingAlgorithmVersion: "synthetic-v1", selectionScore: 1,
    exposureKeys: { sector: "Synthetic", country: "KR", currency: "KRW", classificationEvidenceRef: "synthetic" },
    featureInputs: [{ featureDefinitionRef: "synthetic", value: 1, evidenceRefs: ["synthetic"] }],
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 1000, sectorRemainingKrw: 1000,
      countryRemainingKrw: 1000, currencyRemainingKrw: 1000, cashAvailableKrw: 1000 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["synthetic"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 400, participationRate: 0.04, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 0, taxBps: 0, halfSpreadBps: 0, slippageBps: 0, fillRatio: 1,
      allowFractionalShares: true, maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true,
      marketImpactBpsPerParticipationRate: 0, evidenceRefs: ["synthetic"] }, createdAt: at(0) });
  await new CandidateSizingInputFileRepository(baseDir).append(input);
  const assignment = createCandidateAssignment({ ...scope, ...snapshotRef, requestId: request.requestId, asOf: at(0),
    scoringModelVersion: input.scoringModelVersion, selectionScore: input.selectionScore,
    sizingInputRecordId: input.sizingInputRecordId, sizingInputHash: input.sizingInputHash,
    minWeightRatio: 0.05, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumNotionalKrw: 400, eligibility: "eligible",
    reasonCodes: ["synthetic"], evidenceRefs: ["synthetic"], createdAt: at(0) });
  const assignments = new CandidateAssignmentFileRepository(baseDir);
  await assignments.appendAssignment(assignment);
  const sealed = await assignments.sealRequest(request.requestId);
  move(1);
  const issuance = createSelectorOpeningCapacityReservationRecord({ ...scope, ...current,
    selectionRequestId: request.requestId, selectionRequestHash: request.requestHash,
    candidateAssignmentSetId: sealed.record.candidateAssignmentSetId, candidateAssignmentSetHash: sealed.record.candidateAssignmentSetHash,
    candidateAssignmentId: assignment.assignmentId, candidateAssignmentHash: assignment.assignmentHash, selectedRank: 1,
    capacityLedgerVersion: 1, reservedSlotOrdinal: 0, reservedMaximumNotionalKrw: 400, resultingReservedNotionalKrw: 400, createdAt: at(1) });
  await new SelectorOpeningCapacityReservationFileRepository(baseDir).append(issuance);
  move(2);
  const root = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId, policyHash, bucket: scope.bucket,
    reservationId: issuance.selectorCapacityReservationId, reservationHash: issuance.selectorCapacityReservationHash,
    reservationSource: { sourceKind: "selector", candidateAssignmentSetId: sealed.record.candidateAssignmentSetId,
      candidateAssignmentSetHash: sealed.record.candidateAssignmentSetHash, candidateAssignmentId: assignment.assignmentId, reservedSlotOrdinal: 0 },
    capacityLedgerVersion: 1, remainingReservedNotionalKrw: 400, occupiesNewPositionSlot: true, asOf: at(2), createdAt: at(2) });
  await capacity.append(root);
  return { root, lineage: { assignmentSource: "deterministic_selector" as const, selectionRequestId: request.requestId,
    candidateAssignmentId: assignment.assignmentId, candidateAssignmentSetId: sealed.record.candidateAssignmentSetId,
    candidateAssignmentSetHash: sealed.record.candidateAssignmentSetHash, selectedRank: 1,
    openingCapacityReservationId: root.reservationId, openingCapacityReservationHash: root.reservationHash, reservedSlotOrdinal: 0,
    reservedMaximumNotionalKrw: 400, scoringModelVersion: input.scoringModelVersion, selectionScore: input.selectionScore } };
}
