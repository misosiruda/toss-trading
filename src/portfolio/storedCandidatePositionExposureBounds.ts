import { resolve } from "node:path";
import { calculateCandidatePositionExposureBounds, CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION } from "./candidatePositionExposureBounds.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateClassification } from "./storedCandidateClassification.js";

/** Actual source chain and position ceilings only, not exact pending/reservation-adjusted candidate caps. */
export async function resolveStoredCandidatePositionExposureBounds(
  input: Parameters<typeof resolveStoredCandidateClassification>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateClassification>[1]> = {}
) {
  const classificationReplay = await resolveStoredCandidateClassification({ ...input, baseDir: resolve(input.baseDir) }, { ...options });
  const { cashReplay, classification } = classificationReplay;
  const { scoreReplay } = cashReplay.costBasisReplay.liquidityReplay.policyCostReplay.costReplay.hardGateAssessment.evidenceAssessment;
  const candidate = scoreReplay.sizingInputOrigin.record;
  const calculation = calculateCandidatePositionExposureBounds({ modelVersion: CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION,
    policy: scoreReplay.activePolicy.policy, selectionPolicy: scoreReplay.selectionPolicy, snapshot: cashReplay.snapshot,
    classification, bucket: candidate.bucket });
  const declaredCapChecks = Object.freeze(Object.fromEntries(Object.entries(calculation.positionUpperBounds).map(([key, bound]) =>
    [key, candidate.exposureCapInputs[key as keyof typeof calculation.positionUpperBounds] <= bound])));
  const assessment = Object.freeze({ verificationScope: "stored_position_exposure_upper_bounds_only" as const,
    sizingInputHash: candidate.sizingInputHash, classificationAssessmentHash: classificationReplay.assessmentHash,
    calculationHash: calculation.calculationHash, declaredCapChecks,
    allDeclaredCapsWithinPositionBounds: Object.values(declaredCapChecks).every(Boolean),
    exactCandidateCaps: "not_verified" as const, pendingAndReservationAuthority: "not_verified" as const,
    sourceTrust: "not_evaluated" as const, finalSizing: "not_performed" as const, currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ classificationReplay, calculation, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
