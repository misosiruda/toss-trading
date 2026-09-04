import { isDeepStrictEqual } from "node:util";

import {
  resolveVerifiedPortfolioActionRiskDecisionOrigin,
  type VerifiedPortfolioActionRiskDecisionHistory
} from "./portfolioActionRiskDecisionFiles.js";
import { compareText, hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { resolveActiveRuntimePortfolioPolicyAsOf } from "./runtimePortfolioPolicyActivation.js";

/**
 * Resolves the policy-selected rule set and required rule identities at decision
 * time. This does not replay rule outputs or authorize portfolio execution.
 */
export function resolvePortfolioActionRiskDecisionPolicy(input: {
  riskDecisionId: string;
  riskDecisionHistory: VerifiedPortfolioActionRiskDecisionHistory;
  activationEvents: readonly unknown[];
  policies: readonly unknown[];
  dependencies: ImmutablePolicyDependencyRepository;
}) {
  const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(
    input.riskDecisionHistory, input.riskDecisionId
  );
  const decision = origin.record;
  const active = resolveActiveRuntimePortfolioPolicyAsOf({
    portfolioId: decision.portfolioId,
    asOf: decision.decidedAt,
    events: input.activationEvents,
    policies: input.policies,
    dependencies: input.dependencies
  });
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
  const resolved = input.dependencies.resolveRiskRuleSetDependencies(ref);
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
