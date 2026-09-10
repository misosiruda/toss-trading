import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { assessStoredCandidateEvidenceRequirements } from "./storedCandidateEvidenceRequirements.js";

/** Policy-selected hard gates on replayed market content, not source trust, sizing or execution approval. */
export async function assessStoredCandidateHardGates(
  input: Parameters<typeof assessStoredCandidateEvidenceRequirements>[0],
  options: Parameters<typeof assessStoredCandidateEvidenceRequirements>[1] = {}
) {
  const evidenceAssessment = await assessStoredCandidateEvidenceRequirements(input, options);
  const replay = evidenceAssessment.scoreReplay;
  const policy = replay.selectionPolicy;
  const evidence = replay.evidenceOrigin.binding.evidence;
  const ruleResults = policy.hardGateRuleIds.map((ruleId) => {
    const rule = policy.hardGateRules?.find((item) => item.ruleId === ruleId) ?? null;
    const reasonCodes: string[] = [];
    let observedValue: number | string | null = null;
    if (rule === null) reasonCodes.push("missing_rule_definition");
    else if (rule.algorithm === "market_interval.v1") {
      observedValue = evidence.calculationInput.interval;
      if (!rule.allowedIntervals.includes(evidence.calculationInput.interval)) reasonCodes.push("interval_not_allowed");
    } else {
      const feature = evidence.calculation.featureInputs.find((item) => item.featureDefinitionRef === rule.featureDefinitionRef);
      if (!feature) reasonCodes.push("feature_unavailable");
      else {
        observedValue = feature.value;
        if (rule.minimum !== undefined && feature.value < rule.minimum) reasonCodes.push("below_minimum");
        if (rule.maximum !== undefined && feature.value > rule.maximum) reasonCodes.push("above_maximum");
      }
    }
    return Object.freeze({ ruleId, rule, observedValue, evidenceRef: evidence.evidenceRef,
      status: reasonCodes.length === 0 ? "passed" as const : "blocked" as const, reasonCodes: Object.freeze(reasonCodes) });
  });
  const allHardGatesPassed = ruleResults.every((result) => result.status === "passed");
  const evaluation = Object.freeze({ verificationScope: "stored_market_hard_gate_content_only" as const,
    evidenceAssessmentHash: evidenceAssessment.assessmentHash, selectionPolicyHash: policy.hash,
    ruleResults: Object.freeze(ruleResults), allHardGatesPassed,
    evidenceConditionsSatisfied: evidenceAssessment.assessment.conditionsSatisfied,
    contentChecksPassed: allHardGatesPassed && evidenceAssessment.assessment.conditionsSatisfied,
    sourceTrust: "not_evaluated" as const, historicalDiskAvailability: "not_proven" as const });
  return Object.freeze({ evidenceAssessment, evaluation, evaluationHash: hashCanonicalPayload(evaluation) });
}
