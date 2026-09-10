import { resolve } from "node:path";
import { PortfolioSizingSnapshotFileRepository, resolveObservedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateDailyCostBasis } from "./storedCandidateDailyCostBasis.js";

/** Historical BUY cash upper bound, not pending-cost reservation, final sizing or execution authority. */
export async function resolveStoredCandidateCashCapacity(
  input: Parameters<typeof resolveStoredCandidateDailyCostBasis>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateDailyCostBasis>[1]> = {}
) {
  const lookup = { ...input, baseDir: resolve(input.baseDir) }, capturedOptions = { ...options };
  const costBasisReplay = await resolveStoredCandidateDailyCostBasis(lookup, capturedOptions);
  const costReplay = costBasisReplay.liquidityReplay.policyCostReplay.costReplay;
  const scoreReplay = costReplay.hardGateAssessment.evidenceAssessment.scoreReplay;
  const candidate = scoreReplay.sizingInputOrigin.record;
  if (candidate.executionCostInput.side !== "BUY") throw new Error("candidate cash capacity requires a BUY reference");
  const { historicalPath: ignored, ...lockOptions } = capturedOptions; void ignored;
  // The previous lock chain has ended. Revalidate its exact observed snapshot prefix under a fresh lease.
  return new PortfolioSizingSnapshotFileRepository(lookup.baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const snapshots = resolveObservedPortfolioSizingSnapshotHistory(history, scoreReplay.sizingInputOrigin.source.snapshotObservation);
    const source = snapshots.find((snapshot) => snapshot.portfolioSnapshotId === candidate.portfolioSnapshotId);
    if (!source) throw new Error("candidate cash snapshot is missing from original source prefix");
    const { snapshot } = resolvePortfolioSizingSnapshot(source);
    const policy = scoreReplay.activePolicy.policy;
    if (snapshot.portfolioSnapshotHash !== candidate.portfolioSnapshotHash || snapshot.portfolioId !== candidate.portfolioId ||
      snapshot.policyHash !== policy.policyHash || Date.parse(snapshot.asOf) !== Date.parse(candidate.asOf)) {
      throw new Error("candidate cash policy or snapshot scope mismatch");
    }
    const { cashKrw, virtualNetWorthKrw, pendingBuyExposureKrw } = snapshot.exposureSnapshot;
    // Same integer-KRW reserve semantics as PortfolioGapAnalyzer and validateRiskDecisionCashCapacity.
    const requiredCashReserveKrw = Math.max(policy.cashPolicy.minimumCashReserveKrw,
      Math.round(virtualNetWorthKrw * policy.cashPolicy.targetCashRatio));
    for (const amount of [cashKrw, requiredCashReserveKrw, pendingBuyExposureKrw]) {
      if (!Number.isSafeInteger(amount) || amount < 0 || Object.is(amount, -0)) throw new Error("candidate cash capacity requires safe KRW amounts");
    }
    // Pending SELL proceeds do not increase cash, and no caller ID exempts a pending BUY.
    const maximumNetCashDebitKrw = Math.max(0, Math.max(0, cashKrw - requiredCashReserveKrw) - pendingBuyExposureKrw);
    if (candidate.exposureCapInputs.cashAvailableKrw !== maximumNetCashDebitKrw) {
      throw new Error("stored candidate cash available differs from actual policy and snapshot replay");
    }
    const referenceNotionalKrw = costBasisReplay.calculation.costBasis.referenceNotionalKrw;
    const estimatedCostKrw = costReplay.calculation.estimatedCostKrw;
    // Compare by subtraction, avoiding an unsafe notional + cost sum or a zero-notional false positive.
    const cashConditionSatisfied = estimatedCostKrw <= maximumNetCashDebitKrw &&
      referenceNotionalKrw <= maximumNetCashDebitKrw - estimatedCostKrw;
    const assessment = Object.freeze({ verificationScope: "stored_snapshot_cash_upper_bound_only" as const,
      sizingInputHash: candidate.sizingInputHash, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
      policyHash: policy.policyHash, costBasisAssessmentHash: costBasisReplay.assessmentHash,
      cashKrw, virtualNetWorthKrw, requiredCashReserveKrw, pendingBuyExposureKrw, maximumNetCashDebitKrw,
      referenceNotionalKrw, estimatedCostKrw, cashConditionSatisfied,
      cashAvailableMeaning: "after_reserve_and_pending_gross_before_candidate_cost" as const,
      pendingCostAndReservationAuthority: "not_verified" as const, sourceTrust: "not_evaluated" as const,
      finalSizing: "not_performed" as const, currentExecutionAuthority: "not_granted" as const,
      evidenceAndHardGateConditionsSatisfied: costBasisReplay.assessment.evidenceAndHardGateConditionsSatisfied });
    return Object.freeze({ costBasisReplay, snapshot, assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}
