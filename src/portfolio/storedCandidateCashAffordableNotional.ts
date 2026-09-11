import { calculateCandidateCashAffordableNotional } from "./candidateCashAffordableNotional.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateInitialExecutionCost } from "./storedCandidateInitialExecutionCost.js";

export async function resolveStoredCandidateCashAffordableNotional(
  input: Parameters<typeof resolveStoredCandidateInitialExecutionCost>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateInitialExecutionCost>[1]> = {}
) {
  const costReplay = await resolveStoredCandidateInitialExecutionCost(input, options);
  const calculation = calculateCandidateCashAffordableNotional({ costRepricing: costReplay.calculation });
  const assessment = Object.freeze({ verificationScope: "stored_cash_bounded_initial_notional_only" as const,
    costAssessmentHash: costReplay.assessmentHash, calculationHash: calculation.calculationHash,
    evidenceAndHardGateConditionsSatisfied: costReplay.assessment.evidenceAndHardGateConditionsSatisfied,
    pendingCostAndReservationAuthority: "not_verified" as const, costBenefitAndWeightBand: "not_evaluated" as const,
    sharedCapacityReservation: "not_performed" as const, currentExecutionAuthority: "not_granted" as const,
    finalSizing: "not_performed" as const });
  return Object.freeze({ costReplay, calculation, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
