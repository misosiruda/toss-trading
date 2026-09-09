import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createInitialBucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation,
  getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import { PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionExecution } from "./portfolioActionRiskDecisionExecutionResolver.js";
import { validateRiskDecisionTurnoverCapacity } from "./portfolioActionRiskDecisionTurnoverCapacity.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";

const inputSchema = z.object({ baseDir: z.string().min(1), riskDecisionId: z.string().min(1).max(240) }).strict();

/** Read-only current turnover check at observedAt, not all-rule approval, a reservation or reusable execution permission. */
export async function resolveCurrentPortfolioActionRiskDecisionTurnover(value: z.input<typeof inputSchema>) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("current turnover request must already be canonical");
  // Resolve all historical execution sources before acquiring projection locks. Re-entering price/snapshot here would deadlock.
  const resolved = await resolvePortfolioActionRiskDecisionExecution(input);
  const { decision } = resolved;
  const scope = decision.riskRuleScope;
  const assessment = decision.turnoverAssessment;
  if (scope.scopeKind !== "bucket" || assessment.scopeKind !== "bucket") throw new Error("current turnover check requires bucket Risk scope");
  const policies = await readStoredRuntimePortfolioPolicyActivationSnapshot(input.baseDir);
  const activationStore = new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, policies.policies, policies.dependencies.repository);
  return new BucketTurnoverStateFileRepository(input.baseDir).withDurableSnapshot(async (snapshot) => {
    // No source resolver is called while holding Risk. The immutable selected record must still match the first read.
    const current = resolveVerifiedPortfolioActionRiskDecisionOrigin(
      await new PortfolioActionRiskDecisionFileRepository(input.baseDir).readVerifiedHistory(), decision.riskDecisionId);
    if (!isDeepStrictEqual(current, resolved.origin)) throw new Error("current turnover Risk source changed during resolution");
    // Snapshot excludes window creators before they take activation/window locks, so this does not invert a live writer pair.
    return activationStore.withDurableActivePolicy(decision.portfolioId, async (active, observedAt, activationHistory) => {
      if (active.policy.policyHash !== decision.policyHash || active.activation.activationId !== resolved.origin.policyOrigin?.activationId ||
        active.activation.activationEventHash !== resolved.origin.policyOrigin?.activationEventHash) {
        throw new Error("current turnover Risk policy activation drift");
      }
      const bucket = active.policy.strategyBuckets.find((item) => item.bucket === scope.bucket);
      if (bucket === undefined || !bucket.enabledMarkets.includes(decision.market)) throw new Error("current turnover bucket or market mismatch");
      const identity = createInitialBucketTurnoverState({ portfolioId: decision.portfolioId, bucket: scope.bucket,
        policyHash: active.policy.policyHash, asOf: observedAt, durationSeconds: bucket.turnoverWindow.durationSeconds,
        windowOpenPortfolioNetWorthKrw: 1 });
      if (identity.turnoverStateId !== assessment.turnoverStateId) throw new Error("current turnover Risk window expired or mismatched");
      const source = getDurableBucketTurnoverStateSource(snapshot, identity.turnoverStateId);
      const observation = getDurableBucketTurnoverStateObservation(snapshot);
      const state = source.state;
      if (assessment.turnoverStateHash !== state.turnoverStateHash ||
        assessment.priorBucketTurnoverNotionalKrw !== state.cumulativeAbsoluteFilledNotionalKrw ||
        assessment.turnoverWindowOpenPortfolioNetWorthKrw !== state.windowOpenPortfolioNetWorthKrw) {
        throw new Error("current turnover Risk assessment differs from actual state");
      }
      if (Date.parse(decision.decidedAt) < Date.parse(source.availableAt) || Date.parse(decision.decidedAt) > Date.parse(observedAt) ||
        Date.parse(observedAt) < Date.parse(resolved.origin.appendedAt) ||
        Date.parse(observedAt) < Date.parse(observation.observedAt) || Date.parse(observedAt) < Date.parse(source.availableAt)) {
        throw new Error("current turnover Risk source availability or observation chronology mismatch");
      }
      const turnoverCapacity = validateRiskDecisionTurnoverCapacity({ decision, policy: active.policy });
      return Object.freeze({ ...resolved, turnoverCapacity, turnoverObservation: Object.freeze({ ...source,
        projectionHash: snapshot.projectionHash, sourceEventCount: snapshot.sourceEventCount,
        sourceWindowCount: snapshot.sourceWindowCount, observedAt, activationHistory }) });
    });
  });
}
