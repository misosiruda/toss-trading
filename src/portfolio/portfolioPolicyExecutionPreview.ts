import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { marketSchema, sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import { paperFillExecutionPolicySchema } from "./paperFillExecution.js";
import { createPortfolioActionExecutionPreview, portfolioActionExecutionPreviewInputSchema } from "./portfolioActionExecutionPreview.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { SourcePriceEvidenceFileRepository, getDurableSourcePriceEvidenceObservation, resolveVerifiedSourcePriceEvidenceOrigin } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload, riskRuleParameterRefFor, riskRuleSetRefFor } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((value) => value === value.trim());
const marketParameters = z.object({
  executionPolicy: paperFillExecutionPolicySchema,
  maximumPriceAgeSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  allowedPriceSourceContractIds: z.array(identifier).min(1).max(128).refine((values) =>
    values.every((value, index) => index === 0 || values[index - 1]! < value), "source contracts must be sorted and unique")
}).strict();

/** Opt-in semantics for the policy-selected paper_execution rule, version v1. No defaults. */
export const portfolioExecutionRuleParametersSchema = z.object({
  schemaVersion: z.literal("portfolio_execution_rule.v1"),
  markets: z.object({ KR: marketParameters.optional(), US: marketParameters.optional() }).strict()
    .refine((value) => value.KR !== undefined || value.US !== undefined, "at least one market is required")
}).strict();

export const portfolioPolicyExecutionPreviewInputSchema = portfolioActionExecutionPreviewInputSchema
  .omit({ executionPolicy: true, sourcePriceEvidence: true, asOf: true }).extend({
    baseDir: z.string().min(1), portfolioId: identifier, expectedPolicyHash: sha256HashSchema,
    scope: z.discriminatedUnion("scopeKind", [
      z.object({ scopeKind: z.literal("bucket"), bucket: strategyBucketSchema }).strict(),
      z.object({ scopeKind: z.literal("legacy_reduce_only") }).strict()
    ]),
    market: marketSchema, symbol: identifier, priceEvidenceRef: identifier
  }).strict();

/**
 * Concrete pre-Risk calculation from stored policy and price. Liquidity remains caller-supplied.
 * The returned value is an observation, never a reusable execution authorization or durable record.
 */
export async function createPortfolioPolicyExecutionPreview(value: z.input<typeof portfolioPolicyExecutionPreviewInputSchema>) {
  const input = portfolioPolicyExecutionPreviewInputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("policy execution preview input must already be canonical");
  if (input.scope.scopeKind === "legacy_reduce_only" && input.side !== "SELL") {
    throw new Error("legacy execution preview is SELL only");
  }
  // Same relative lock order as price-bound Risk creation: price -> activation.
  return new SourcePriceEvidenceFileRepository(input.baseDir).withDurableVerifiedHistory(async (history) => {
    const priceOrigin = resolveVerifiedSourcePriceEvidenceOrigin(history, input.priceEvidenceRef);
    const priceObservation = getDurableSourcePriceEvidenceObservation(history);
    const snapshot = await readStoredRuntimePortfolioPolicyActivationSnapshot(input.baseDir);
    const store = new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, snapshot.policies, snapshot.dependencies.repository);
    return store.withDurableActivePolicy(input.portfolioId, async (active, observedAt, activationHistory) => {
      if (active.policy.policyHash !== input.expectedPolicyHash) throw new Error("execution preview active policy drift");
      const scope = input.scope;
      const bucket = scope.scopeKind === "bucket"
        ? active.policy.strategyBuckets.find((candidate) => candidate.bucket === scope.bucket) : null;
      if (input.scope.scopeKind === "bucket" && (bucket == null || !bucket.enabledMarkets.includes(input.market))) {
        throw new Error("execution preview bucket market is not enabled");
      }
      const selected = snapshot.dependencies.repository.resolveRiskRuleSetDependencies(
        bucket?.riskRuleSetRef ?? active.policy.legacyReduceOnlyPolicy.riskRuleSetRef);
      const executionRule = selected.riskRules.find(({ rule }) => rule.ruleId === "paper_execution");
      if (executionRule === undefined || executionRule.rule.ruleVersion !== "v1" || !executionRule.rule.appliesTo.includes(input.side)) {
        throw new Error("execution preview requires policy-selected paper_execution v1 for its side");
      }
      const parameters = portfolioExecutionRuleParametersSchema.parse(executionRule.parameter.parameters);
      if (!isDeepStrictEqual(parameters, executionRule.parameter.parameters)) throw new Error("execution parameters must already be canonical");
      const settings = parameters.markets[input.market];
      if (settings === undefined) throw new Error("execution preview market parameters are missing");
      const price = priceOrigin.record;
      const cutoff = Date.parse(observedAt);
      if (price.market !== input.market || price.symbol !== input.symbol ||
        !settings.allowedPriceSourceContractIds.includes(price.sourceContractId) ||
        [price.observedAt, price.createdAt, priceOrigin.appendedAt, priceObservation.observedAt]
          .some((timestamp) => Date.parse(timestamp) > cutoff)) {
        throw new Error("execution preview price scope, source or availability mismatch");
      }
      if ((cutoff - Date.parse(price.observedAt)) / 1000 > settings.maximumPriceAgeSeconds) {
        throw new Error("execution preview source price is stale");
      }
      const preview = createPortfolioActionExecutionPreview({ side: input.side,
        requestedNotionalKrw: input.requestedNotionalKrw, quantityOverride: input.quantityOverride,
        sourcePriceEvidence: price, executionPolicy: settings.executionPolicy,
        volume: input.volume, averageVolume: input.averageVolume, liquidityStale: input.liquidityStale, asOf: observedAt });
      const policyContext = {
        portfolioId: input.portfolioId, scope: input.scope, market: input.market, symbol: input.symbol,
        activationId: active.activation.activationId, activationEventHash: active.activation.activationEventHash,
        runtimePolicyRecordId: active.policy.runtimePolicyRecordId, policyHash: active.policy.policyHash,
        policyLineageHash: active.policy.lineageHash, activationHistory, observedAt,
        riskRuleSetRef: riskRuleSetRefFor(selected.riskRuleSet),
        executionParameterRef: riskRuleParameterRefFor(executionRule.parameter),
        priceOrigin: { evidenceRef: price.evidenceRef, evidenceHash: price.evidenceHash, observation: priceObservation }
      };
      return deepFreeze({ preview, policyContext, observationHash: hashCanonicalPayload({ preview, policyContext }) });
    });
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
