import { resolve } from "node:path";
import { calculateCandidateBoundedNotional } from "./candidateBoundedNotional.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidatePositionExposureBounds } from "./storedCandidatePositionExposureBounds.js";

/** Actual historical sources and policy, still not exact pending/reservation caps or final executable sizing. */
export async function resolveStoredCandidateBoundedNotional(input: Parameters<typeof resolveStoredCandidatePositionExposureBounds>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidatePositionExposureBounds>[1]> = {}) {
  const boundsReplay = await resolveStoredCandidatePositionExposureBounds({ ...input, baseDir: resolve(input.baseDir) }, { ...options });
  if (!boundsReplay.assessment.allDeclaredCapsWithinPositionBounds) throw new Error("candidate bounded notional declared caps exceed actual position bounds");
  const evidence = boundsReplay.classificationReplay.cashReplay.costBasisReplay.liquidityReplay.policyCostReplay.costReplay.hardGateAssessment.evidenceAssessment;
  const { scoreReplay, request } = evidence;
  const calculation = calculateCandidateBoundedNotional({ policy: scoreReplay.activePolicy.policy, selectionPolicy: scoreReplay.selectionPolicy,
    request, sizingInput: scoreReplay.sizingInputOrigin.record });
  const assessment = Object.freeze({ verificationScope: "stored_initial_notional_replay_only" as const,
    boundsAssessmentHash: boundsReplay.assessmentHash, calculationHash: calculation.calculationHash,
    policySnapshotHash: scoreReplay.policySnapshotHash, sizingInputHash: scoreReplay.sizingInputOrigin.record.sizingInputHash,
    exactCandidateCaps: "not_verified" as const, costBenefitAndWeightBand: "not_evaluated" as const,
    currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
  return Object.freeze({ boundsReplay, calculation, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
