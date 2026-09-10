import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { portfolioExecutionRuleParametersSchema } from "./portfolioPolicyExecutionPreview.js";
import { hashCanonicalPayload, riskRuleParameterRefFor, riskRuleSetRefFor } from "./runtimePolicyContracts.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { resolveStoredCandidateExecutionCost } from "./storedCandidateExecutionCost.js";

/** Historical binding of selected cost model and parameters, not cost-source or current execution authority. */
export async function resolveStoredPolicyCandidateExecutionCost(
  input: Parameters<typeof resolveStoredCandidateExecutionCost>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateExecutionCost>[1]> = {}
) {
  const lookup = { ...input, baseDir: resolve(input.baseDir) };
  const capturedOptions = { ...options };
  const { historicalPath: ignoredPath, ...lockOptions } = capturedOptions; void ignoredPath;
  // Read before candidate source locks. Never combine parameters from one generation with
  // score/activation evidence from another, including append-only changes between reads.
  const snapshot = await readStoredRuntimePortfolioPolicyActivationSnapshot(lookup.baseDir, lockOptions);
  const policySnapshotHash = hashCanonicalPayload({ dependencies: snapshot.dependencies.records,
    policies: snapshot.policies, events: snapshot.events });
  const costReplay = await resolveStoredCandidateExecutionCost(lookup, capturedOptions);
  const scoreReplay = costReplay.hardGateAssessment.evidenceAssessment.scoreReplay;
  if (policySnapshotHash !== scoreReplay.policySnapshotHash) throw new Error("candidate cost policy snapshot changed during replay");
  if (scoreReplay.selectionPolicy.costEstimationModelVersion === undefined ||
    scoreReplay.selectionPolicy.costEstimationModelVersion !== costReplay.calculation.input.modelVersion) {
    throw new Error("candidate cost estimation model is not selected by the as-of selection policy");
  }
  const candidate = scoreReplay.sizingInputOrigin.record;
  const selected = snapshot.dependencies.repository.resolveRiskRuleSetDependencies(scoreReplay.bucketPolicy.riskRuleSetRef);
  const executionRule = selected.riskRules.find(({ rule }) => rule.ruleId === "paper_execution");
  if (!executionRule || executionRule.rule.ruleVersion !== "v1" || !executionRule.rule.appliesTo.includes(candidate.executionCostInput.side)) {
    throw new Error("candidate cost requires policy-selected paper_execution v1 for its side");
  }
  const parameters = portfolioExecutionRuleParametersSchema.parse(executionRule.parameter.parameters);
  if (!isDeepStrictEqual(parameters, executionRule.parameter.parameters)) throw new Error("candidate cost execution parameters must be canonical");
  const settings = parameters.markets[candidate.market];
  if (!settings) throw new Error("candidate cost policy market parameters are missing");
  // Estimation and fill are different algorithms. Compare the full shared parameter set,
  // preserve both versions, and do not silently equate their computations or authorization.
  const { modelVersion: executionModelVersion, ...expectedParameters } = settings.executionPolicy;
  const { modelVersion: estimationModelVersion, side, referenceNotionalKrw, participationRate,
    estimatedCostKrw, evidenceRefs, ...actualParameters } = candidate.executionCostInput;
  void referenceNotionalKrw; void participationRate; void estimatedCostKrw; void evidenceRefs;
  if (!isDeepStrictEqual(actualParameters, expectedParameters)) throw new Error("candidate cost parameters differ from as-of bucket policy");
  const assessment = Object.freeze({ verificationScope: "stored_as_of_cost_parameter_binding_only" as const,
    policyHash: scoreReplay.activePolicy.policy.policyHash, policySnapshotHash,
    activationId: scoreReplay.activePolicy.activation.activationId,
    activationEventHash: scoreReplay.activePolicy.activation.activationEventHash,
    asOf: candidate.asOf, bucket: candidate.bucket, market: candidate.market, side,
    riskRuleSetRef: riskRuleSetRefFor(selected.riskRuleSet), executionParameterRef: riskRuleParameterRefFor(executionRule.parameter),
    executionParameters: settings.executionPolicy, executionModelVersion, estimationModelVersion,
    costReplayAssessmentHash: costReplay.assessmentHash,
    costParameterAuthority: "as_of_policy_bound" as const,
    costEstimationModelSelection: "as_of_selection_policy_bound" as const,
    costEvidenceAuthority: "not_verified" as const, fillSimulation: "not_performed" as const,
    evidenceAndHardGateConditionsSatisfied: costReplay.assessment.evidenceAndHardGateConditionsSatisfied });
  // The parameter schema creates a copy; freeze this nested copy as well as the result.
  Object.freeze(settings.executionPolicy);
  return Object.freeze({ costReplay, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
