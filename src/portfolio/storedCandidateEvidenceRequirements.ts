import { resolve } from "node:path";
import { BucketSelectionRequestFileRepository, resolveObservedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { resolveCandidateSizingInputRequestBinding } from "./candidateSizingInput.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateSelectionScore } from "./storedCandidateSelectionScore.js";

type Reason = "required_evidence_missing" | "source_contract_mismatch" | "insufficient_observations" |
  "stale_observation" | "observation_after_cutoff" | "source_materialized_after_cutoff";

/**
 * Evaluates policy-declared evidence content requirements against actual stored sources.
 * Recorded source times are checked, but historical disk availability/provider trust are not proved.
 * The result cannot grant eligibility: hard gates, sizing and current authority remain separate.
 */
export async function assessStoredCandidateEvidenceRequirements(
  input: Parameters<typeof resolveStoredCandidateSelectionScore>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateSelectionScore>[1]> = {}
) {
  const lookup = { ...input, baseDir: resolve(input.baseDir) };
  const capturedOptions = { ...options };
  const scoreReplay = await resolveStoredCandidateSelectionScore(lookup, capturedOptions);
  const { historicalPath: ignoredPath, ...lockOptions } = capturedOptions; void ignoredPath;
  return new BucketSelectionRequestFileRepository(lookup.baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
    const candidate = scoreReplay.sizingInputOrigin.record;
    const requests = resolveObservedBucketSelectionRequestHistory(history, scoreReplay.sizingInputOrigin.source.requestObservation);
    const request = requests.find((item) => item.requestId === candidate.requestId);
    if (!request) throw new Error("candidate evidence request is missing from original source prefix");
    resolveCandidateSizingInputRequestBinding({ sizingInput: candidate, request });
    const evidence = scoreReplay.evidenceOrigin.binding.evidence;
    const snapshots = evidence.calculationInput.snapshots;
    const latestObservationAt = snapshots.at(-1)!.observedAt;
    const ageSeconds = (Date.parse(request.asOf) - Date.parse(latestObservationAt)) / 1000;
    const cutoff = Date.parse(request.evidenceCutoffAt);
    const requirements = scoreReplay.selectionPolicy.requiredEvidence.map((requirement) => {
      const reasons: Reason[] = [];
      const available = requirement.evidenceClass === "market_technical";
      if (!available) reasons.push("required_evidence_missing");
      else {
        if (requirement.sourceContractId !== evidence.sourceContractId) reasons.push("source_contract_mismatch");
        if (snapshots.length < (requirement.minimumObservationCount ?? 1)) reasons.push("insufficient_observations");
        // Freshness is measured at the request asOf, not the derivation/commit time or an older cutoff.
        if (ageSeconds > requirement.maximumAgeSeconds) reasons.push("stale_observation");
        if (snapshots.some((item) => Date.parse(item.observedAt) > cutoff)) reasons.push("observation_after_cutoff");
        if (snapshots.some((item) => Date.parse(item.createdAt) > cutoff)) reasons.push("source_materialized_after_cutoff");
      }
      return Object.freeze({ requirement, status: reasons.length === 0 ? "satisfied" as const : "blocked" as const,
        reasonCodes: Object.freeze(reasons.sort(compareText)), evidenceRefs: Object.freeze(available ? [evidence.evidenceRef] : []) });
    });
    const assessment = Object.freeze({ verificationScope: "stored_evidence_content_requirements_only" as const,
      conditionsSatisfied: requirements.every((item) => item.status === "satisfied"),
      sourceTrust: "not_evaluated" as const, historicalDiskAvailability: "not_proven" as const,
      requestId: request.requestId, requestHash: request.requestHash, sizingInputHash: candidate.sizingInputHash,
      policyHash: candidate.policyHash, selectionPolicyHash: scoreReplay.selectionPolicy.hash,
      policySnapshotHash: scoreReplay.policySnapshotHash, evidenceHash: evidence.evidenceHash,
      asOf: request.asOf, evidenceCutoffAt: request.evidenceCutoffAt, latestObservationAt, ageSeconds,
      requirements: Object.freeze(requirements),
      unevaluatedHardGateRuleIds: Object.freeze([...scoreReplay.selectionPolicy.hardGateRuleIds]) });
    return Object.freeze({ scoreReplay, request, assessment, assessmentHash: hashCanonicalPayload(assessment) });
  });
}
