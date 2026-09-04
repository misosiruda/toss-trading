import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  resolveVerifiedPortfolioActionRiskDecisionOrigin,
  PortfolioActionRiskDecisionFileRepository
} from "./portfolioActionRiskDecisionFiles.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { resolveActiveRuntimePortfolioPolicyAsOf } from "./runtimePortfolioPolicyActivation.js";

const inputSchema = z.object({ baseDir: z.string().min(1), riskDecisionId: z.string().min(1) }).strict();

/**
 * Resolves the policy-selected rule set and required rule identities at decision
 * time from one configured storage root, without accepting caller-selected
 * history prefixes. This does not authorize execution or authenticate disk
 * against an actor who can rewrite the configured storage root.
 */
export async function resolvePortfolioActionRiskDecisionPolicy(input: {
  baseDir: string;
  riskDecisionId: string;
}) {
  const { baseDir, riskDecisionId } = inputSchema.parse(input);
  const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(
    await new PortfolioActionRiskDecisionFileRepository(baseDir).readVerifiedHistory(), riskDecisionId
  );
  const decision = origin.record;
  const receipt = origin.policyOrigin;
  if (receipt === null) throw new Error("risk decision lacks policy-before-creation provenance; legacy record requires review");
  const snapshot = await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir);
  const active = resolveActiveRuntimePortfolioPolicyAsOf({
    portfolioId: decision.portfolioId,
    asOf: decision.decidedAt,
    events: snapshot.events,
    policies: snapshot.policies,
    dependencies: snapshot.dependencies.repository
  });
  if (receipt.activationId !== active.activation.activationId ||
    receipt.activationEventHash !== active.activation.activationEventHash ||
    receipt.runtimePolicyRecordId !== active.policy.runtimePolicyRecordId ||
    receipt.policyHash !== active.policy.policyHash ||
    receipt.policyLineageHash !== active.policy.lineageHash) {
    throw new Error("risk decision policy origin does not match active policy");
  }
  if (active.policy.policyHash !== decision.policyHash) {
    throw new Error("risk decision active policy hash mismatch");
  }
  const scope = decision.riskRuleScope;
  const bucketPolicy = scope.scopeKind === "bucket"
    ? active.policy.strategyBuckets.find((bucket) => bucket.bucket === scope.bucket)
    : null;
  if (scope.scopeKind === "bucket" &&
    (bucketPolicy == null || !bucketPolicy.enabledMarkets.includes(decision.market))) {
    throw new Error("risk decision bucket or enabled market mismatch");
  }
  if (decision.riskRuleScope.scopeKind === "legacy_reduce_only" &&
    (decision.side !== "SELL" || decision.riskRuleScope.legacyPolicyHash !==
      hashCanonicalPayload(active.policy.legacyReduceOnlyPolicy))) {
    throw new Error("risk decision legacy reduce-only policy mismatch");
  }
  const ref = bucketPolicy?.riskRuleSetRef ?? active.policy.legacyReduceOnlyPolicy.riskRuleSetRef;
  const resolved = snapshot.dependencies.repository.resolveRiskRuleSetDependencies(ref);
  if (decision.riskRuleSetRecordId !== resolved.riskRuleSet.riskRuleSetRecordId ||
    decision.riskRuleSetVersion !== resolved.riskRuleSet.version ||
    decision.riskRuleSetHash !== resolved.riskRuleSet.hash) {
    throw new Error("risk decision policy-selected rule set mismatch");
  }
  const applicableRules = Object.freeze(resolved.riskRules
    .filter(({ rule }) => rule.appliesTo.includes(decision.side))
    .sort((left, right) => compareText(left.rule.ruleId, right.rule.ruleId)));
  const requiredRuleIds = applicableRules.map(({ rule }) => rule.ruleId);
  if (requiredRuleIds.length === 0 ||
    !isDeepStrictEqual(decision.requiredRuleIds, requiredRuleIds) ||
    !isDeepStrictEqual(decision.ruleResults.map((rule) => rule.ruleId), requiredRuleIds)) {
    throw new Error("risk decision required rules do not match policy-selected side rules");
  }
  return Object.freeze({ origin, decision, activePolicy: active, bucketPolicy, ...resolved, applicableRules });
}
