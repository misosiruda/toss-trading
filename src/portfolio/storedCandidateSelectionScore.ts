import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { CandidateMarketTechnicalFeatureResolver } from "./candidateMarketTechnicalFeatures.js";
import { calculateCandidateSelectionScore } from "./candidateScoringModel.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveActiveRuntimePortfolioPolicyAsOf } from "./runtimePortfolioPolicyActivation.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";

const inputSchema = z.object({ baseDir: z.string().min(1), sizingInputRecordId: z.string().min(1).max(240)
  .refine((value) => value.trim() === value) }).strict();

/**
 * Replays a stored candidate's numeric score against the policy active at its asOf.
 * All inputs come from the configured files, never caller-supplied models or prefixes.
 * This is a historical diagnostic, not PIT/source-trust, eligibility or current execution authority.
 */
export async function resolveStoredCandidateSelectionScore(input: z.input<typeof inputSchema>,
  options: { historicalPath?: string; lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
  const parsed = inputSchema.parse(input);
  const baseDir = resolve(parsed.baseDir);
  const { historicalPath, ...lockOptions } = options;
  // Do not acquire policy locks while holding the candidate source lock chain.
  const snapshot = await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir, lockOptions);
  const resolver = new CandidateMarketTechnicalFeatureResolver(baseDir,
    { ...lockOptions, ...(historicalPath === undefined ? {} : { historicalPath }) });
  return resolver.withResolvedFeatures(parsed.sizingInputRecordId, async (binding) => {
    const candidate = binding.sizingInputOrigin.record;
    const activePolicy = resolveActiveRuntimePortfolioPolicyAsOf({ portfolioId: candidate.portfolioId,
      asOf: candidate.asOf, events: snapshot.events, policies: snapshot.policies, dependencies: snapshot.dependencies.repository });
    if (candidate.policyHash !== activePolicy.policy.policyHash) throw new Error("candidate score active policy hash mismatch");
    const bucketPolicy = activePolicy.policy.strategyBuckets.find((bucket) => bucket.bucket === candidate.bucket);
    if (!bucketPolicy || !bucketPolicy.enabledMarkets.includes(candidate.market)) {
      throw new Error("candidate score bucket or enabled market mismatch");
    }
    const selectionPolicy = snapshot.dependencies.repository.resolveSelectionPolicy(bucketPolicy.selectionPolicyRef);
    const model = snapshot.dependencies.repository.resolveSelectionScoringModel(selectionPolicy);
    if (candidate.scoringModelVersion !== model.version) throw new Error("candidate score policy-selected model version mismatch");
    const features = binding.evidenceOrigin.binding.evidence.calculation.featureInputs;
    // The source resolver verifies six market features. Never score additional unverified declarations.
    if (!isDeepStrictEqual(candidate.featureInputs, features)) {
      throw new Error("candidate score requires the exact verified market feature set");
    }
    const score = calculateCandidateSelectionScore({ model, features });
    if (candidate.selectionScore !== score.selectionScore) throw new Error("stored candidate selection score does not match independent calculation");
    return Object.freeze({ verificationScope: "stored_score_replay_only" as const,
      sizingInputOrigin: binding.sizingInputOrigin, evidenceOrigin: binding.evidenceOrigin,
      activePolicy, bucketPolicy, selectionPolicy, score,
      policySnapshotHash: hashCanonicalPayload({ dependencies: snapshot.dependencies.records,
        policies: snapshot.policies, events: snapshot.events }) });
  });
}
