import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  paperPolicyRecordSchema,
  policyRecordIdFor
} from "../api/paperPolicyRecords.js";
import {
  paperPolicyValidationCandidateSchema,
  validatePaperPolicyCandidate
} from "../api/paperPolicyValidation.js";
import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import {
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  hashImmutableRecordLineage,
  parseStrategyBucketRuntimePolicy,
  portfolioRiskRuleSetRefSchema,
  strategyBucketRuntimePolicySchema,
  type PortfolioRiskRuleSetRef,
  type StrategyBucket,
  type StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";
import {
  ImmutablePolicyDependencyRepository,
  resolveStrategyBucketRuntimePolicyDependencies,
  type RequiredCalendarDate
} from "./runtimePolicyDependencyResolver.js";

const identifierSchema = z.string().trim().min(1).max(160);
const versionSchema = z.string().trim().min(1).max(80);
const ratioSchema = z.number().finite().min(0).max(1);

export const runtimeBucketPolicyConfigurationSchema =
  strategyBucketRuntimePolicySchema.omit({
    targetWeightRatio: true,
    minWeightRatio: true,
    maxWeightRatio: true,
    maxTurnoverRatio: true,
    maxDrawdownRatio: true,
    enabledAssetClasses: true
  });

const runtimePortfolioPolicyPayloadSchema = z
  .object({
    mode: z.literal("paper_only"),
    recordType: z.literal("runtime_portfolio_policy_record"),
    portfolioId: identifierSchema,
    sourcePolicyRecordId: identifierSchema,
    sourcePolicyRecordHash: sha256HashSchema,
    sourcePolicyHash: z.string().regex(/^[a-f0-9]{64}$/),
    policyId: identifierSchema,
    version: versionSchema,
    name: identifierSchema,
    strategyBuckets: z
      .array(strategyBucketRuntimePolicySchema)
      .length(5),
    cashPolicy: z
      .object({
        targetCashRatio: ratioSchema,
        minimumCashReserveKrw: z.number().int().nonnegative(),
        ruleSource: z.enum([
          "static",
          "dynamic_regime",
          "high_volatility",
          "fallback"
        ])
      })
      .strict(),
    hedgePolicy: z
      .object({
        hedgeEnabled: z.boolean(),
        hedgeTargetRatio: ratioSchema,
        maxCostRatio: ratioSchema.max(0.1)
      })
      .strict(),
    exposurePolicy: z
      .object({
        maxSymbolExposureRatio: ratioSchema.positive(),
        maxCountryExposureRatio: ratioSchema.positive(),
        maxCurrencyExposureRatio: ratioSchema.positive()
      })
      .strict(),
    legacyReduceOnlyPolicy: z
      .object({
        allowBuyOrIncrease: z.literal(false),
        maximumParticipationRatio: ratioSchema.positive(),
        riskRuleSetRef: portfolioRiskRuleSetRefSchema
      })
      .strict()
  })
  .strict();

export const runtimePortfolioPolicyRecordSchema =
  runtimePortfolioPolicyPayloadSchema
    .safeExtend({
      runtimePolicyRecordId: identifierSchema,
      policyHash: sha256HashSchema,
      lineageHash: sha256HashSchema,
      createdAt: isoDateTimeSchema
    })
    .strict();

export type RuntimeBucketPolicyConfiguration = z.infer<
  typeof runtimeBucketPolicyConfigurationSchema
>;
export type RuntimePortfolioPolicyRecord = z.infer<
  typeof runtimePortfolioPolicyRecordSchema
>;

export interface RuntimeBucketNormalizationInput {
  configuration: RuntimeBucketPolicyConfiguration;
  requiredCalendarDates?: readonly RequiredCalendarDate[];
}

export interface RuntimePortfolioPolicyNormalizationInput {
  portfolioId: string;
  sourcePolicyRecord: unknown;
  bucketInputs: readonly RuntimeBucketNormalizationInput[];
  legacyReduceOnlyPolicy: {
    allowBuyOrIncrease: false;
    maximumParticipationRatio: number;
    riskRuleSetRef: PortfolioRiskRuleSetRef;
  };
  createdAt: string;
}

export function normalizeRuntimePortfolioPolicy(
  input: RuntimePortfolioPolicyNormalizationInput,
  dependencies: ImmutablePolicyDependencyRepository
): RuntimePortfolioPolicyRecord {
  const createdAt = isoDateTimeSchema.parse(input.createdAt);
  const runtimeCreatedAtTime = chronologyTimestamp(createdAt);
  const sourcePolicyRecord = paperPolicyRecordSchema.parse(
    input.sourcePolicyRecord
  );
  const sourcePolicyRecordHash = hashCanonicalPayload(sourcePolicyRecord);
  const candidate = paperPolicyValidationCandidateSchema.parse(
    sourcePolicyRecord.candidate
  );
  assertCanonicalSourceIdentity(candidate);
  if (
    runtimeCreatedAtTime < chronologyTimestamp(sourcePolicyRecord.createdAt)
  ) {
    throw new Error("runtime policy cannot predate its source policy record");
  }
  const validation = validatePaperPolicyCandidate(candidate, new Date(createdAt));
  if (!validation.validatedForPaperSimulationConfig) {
    throw new Error("source policy candidate must pass paper validation");
  }
  if (
    sourcePolicyRecord.policyRecordId !==
      policyRecordIdFor(candidate, new Date(sourcePolicyRecord.createdAt)) ||
    sourcePolicyRecord.validation.validatedAt !== sourcePolicyRecord.createdAt ||
    sourcePolicyRecord.policyId !== validation.policyId ||
    sourcePolicyRecord.version !== validation.version ||
    sourcePolicyRecord.name !== candidate.name ||
    sourcePolicyRecord.policyHash !== validation.policyHash ||
    !isDeepStrictEqual(
      sourcePolicyRecord.validation.summary,
      validation.summary
    )
  ) {
    throw new Error("source policy record lineage does not match its candidate");
  }
  if (input.bucketInputs.length !== candidate.strategyBuckets.length) {
    throw new Error("runtime bucket configuration count must match source buckets");
  }

  const configs = new Map<StrategyBucket, RuntimeBucketNormalizationInput>();
  for (const bucketInput of input.bucketInputs) {
    const configuration = runtimeBucketPolicyConfigurationSchema.parse(
      bucketInput.configuration
    );
    if (configs.has(configuration.bucket)) {
      throw new Error("runtime bucket configuration must resolve exactly once");
    }
    configs.set(
      configuration.bucket,
      bucketInput.requiredCalendarDates === undefined
        ? { configuration }
        : {
            configuration,
            requiredCalendarDates: bucketInput.requiredCalendarDates
          }
    );
  }

  const sourceBuckets = [...candidate.strategyBuckets].sort(
    (left, right) => bucketOrdinal(left.bucket) - bucketOrdinal(right.bucket)
  );
  const strategyBuckets = sourceBuckets.map((sourceBucket) => {
    const bucketInput = configs.get(sourceBucket.bucket);
    if (bucketInput === undefined) {
      throw new Error("runtime bucket configuration is missing");
    }
    const policy = parseStrategyBucketRuntimePolicy({
      ...bucketInput.configuration,
      targetWeightRatio: sourceBucket.targetWeightRatio,
      minWeightRatio: sourceBucket.minWeightRatio,
      maxWeightRatio: sourceBucket.maxWeightRatio,
      maxTurnoverRatio: sourceBucket.maxTurnoverRatio,
      maxDrawdownRatio: sourceBucket.maxDrawdownRatio,
      enabledAssetClasses: canonicalAssetClasses(
        sourceBucket.enabledAssetClasses
      )
    });
    const resolvedDependencies = resolveStrategyBucketRuntimePolicyDependencies(
      policy,
      dependencies,
      bucketInput.requiredCalendarDates
    );
    assertDependenciesDoNotPostdateRuntime(
      [
        resolvedDependencies.selectionPolicy,
        resolvedDependencies.riskRuleSet,
        ...resolvedDependencies.riskRules.map(({ parameter }) => parameter),
        resolvedDependencies.drawdownSemantics,
        ...resolvedDependencies.scheduleBoundaries.flatMap(
          ({ boundary, calendar }) => [boundary, calendar]
        )
      ],
      createdAt
    );
    return policy;
  });
  assertCanonicalBuckets(strategyBuckets);
  const legacyRiskDependencies = dependencies.resolveRiskRuleSetDependencies(
    input.legacyReduceOnlyPolicy.riskRuleSetRef
  );
  assertDependenciesDoNotPostdateRuntime(
    [
      legacyRiskDependencies.riskRuleSet,
      ...legacyRiskDependencies.riskRules.map(({ parameter }) => parameter)
    ],
    createdAt
  );

  const payload = runtimePortfolioPolicyPayloadSchema.parse({
    mode: "paper_only",
    recordType: "runtime_portfolio_policy_record",
    portfolioId: input.portfolioId,
    sourcePolicyRecordId: sourcePolicyRecord.policyRecordId,
    sourcePolicyRecordHash,
    sourcePolicyHash: validation.policyHash,
    policyId: candidate.policyId,
    version: candidate.version,
    name: candidate.name,
    strategyBuckets,
    cashPolicy: candidate.cashPolicy,
    hedgePolicy: candidate.hedgePolicy,
    exposurePolicy: candidate.exposurePolicy,
    legacyReduceOnlyPolicy: input.legacyReduceOnlyPolicy
  });
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId(
    "runtime_portfolio_policy",
    policyHash
  );
  return deepFreeze({
    ...payload,
    runtimePolicyRecordId,
    policyHash,
    lineageHash: hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: runtimePolicyRecordId,
      semanticHash: policyHash,
      createdAt
    }),
    createdAt
  });
}

export function parseRuntimePortfolioPolicyRecord(
  value: unknown
): RuntimePortfolioPolicyRecord {
  const record = runtimePortfolioPolicyRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) {
    throw new Error("runtime portfolio policy record must already be canonical");
  }
  chronologyTimestamp(record.createdAt);
  for (const bucket of record.strategyBuckets) {
    parseStrategyBucketRuntimePolicy(bucket);
  }
  assertCanonicalBuckets(record.strategyBuckets);
  assertPortfolioWideInvariants(record);
  const {
    runtimePolicyRecordId,
    policyHash,
    lineageHash,
    createdAt,
    ...payload
  } = record;
  const expectedHash = hashCanonicalPayload(payload);
  if (policyHash !== expectedHash) {
    throw new Error("runtime portfolio policy hash mismatch");
  }
  if (
    runtimePolicyRecordId !==
    hashDerivedId("runtime_portfolio_policy", expectedHash)
  ) {
    throw new Error("runtime portfolio policy record ID mismatch");
  }
  if (
    lineageHash !==
    hashImmutableRecordLineage({
      recordType: "runtime_portfolio_policy",
      recordId: runtimePolicyRecordId,
      semanticHash: policyHash,
      createdAt
    })
  ) {
    throw new Error("runtime portfolio policy lineage hash mismatch");
  }
  return deepFreeze(record);
}

function assertPortfolioWideInvariants(
  record: RuntimePortfolioPolicyRecord
): void {
  const validation = validatePaperPolicyCandidate(
    {
      mode: "paper_only",
      policyId: record.policyId,
      version: record.version,
      name: record.name,
      strategyBuckets: record.strategyBuckets.map((bucket) => ({
        bucket: bucket.bucket,
        targetWeightRatio: bucket.targetWeightRatio,
        minWeightRatio: bucket.minWeightRatio,
        maxWeightRatio: bucket.maxWeightRatio,
        maxTurnoverRatio: bucket.maxTurnoverRatio,
        maxDrawdownRatio: bucket.maxDrawdownRatio,
        holdingPeriodHint: holdingPeriodHintFor(bucket.bucket),
        enabledAssetClasses: bucket.enabledAssetClasses
      })),
      cashPolicy: record.cashPolicy,
      hedgePolicy: record.hedgePolicy,
      exposurePolicy: record.exposurePolicy,
      executionBoundary: {
        liveTradingEnabled: false,
        orderPlacementEnabled: false,
        backendValidationRequired: true
      }
    },
    new Date(record.createdAt)
  );
  if (!validation.validatedForPaperSimulationConfig) {
    throw new Error("runtime portfolio policy violates portfolio-wide invariants");
  }
}

function holdingPeriodHintFor(bucket: StrategyBucket) {
  switch (bucket) {
    case "long_term":
      return "multi_month" as const;
    case "swing":
      return "multi_week" as const;
    case "short_term":
      return "multi_day" as const;
    case "intraday":
      return "intraday" as const;
    case "hedge":
      return "hedge" as const;
  }
}

function assertCanonicalBuckets(
  buckets: readonly StrategyBucketRuntimePolicy[]
): void {
  const expected: readonly StrategyBucket[] = [
    "long_term",
    "swing",
    "short_term",
    "intraday",
    "hedge"
  ];
  if (
    buckets.length !== expected.length ||
    buckets.some((bucket, index) => bucket.bucket !== expected[index])
  ) {
    throw new Error("runtime strategy buckets must use canonical complete order");
  }
}

function bucketOrdinal(bucket: StrategyBucket): number {
  return ["long_term", "swing", "short_term", "intraday", "hedge"].indexOf(
    bucket
  );
}

function assertCanonicalSourceIdentity(candidate: {
  policyId: string;
  version: string;
  name: string;
}): void {
  if (
    candidate.policyId !== candidate.policyId.trim() ||
    candidate.version !== candidate.version.trim() ||
    candidate.name !== candidate.name.trim()
  ) {
    throw new Error("source policy identity must already be canonical");
  }
}

function assertDependenciesDoNotPostdateRuntime(
  records: readonly { createdAt: string }[],
  runtimeCreatedAt: string
): void {
  const runtimeTime = chronologyTimestamp(runtimeCreatedAt);
  if (
    records.some(
      (record) => chronologyTimestamp(record.createdAt) > runtimeTime
    )
  ) {
    throw new Error("runtime policy dependency cannot postdate the runtime policy");
  }
}

function chronologyTimestamp(value: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("chronology timestamps must include a UTC or numeric offset");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("chronology timestamp must be an ISO-compatible date-time");
  }
  return timestamp;
}

function canonicalAssetClasses(values: readonly string[]): string[] {
  const canonical = values.map((value) => value.trim()).sort(compareText);
  if (canonical.some((value) => value.length === 0)) {
    throw new Error("enabled asset classes cannot contain an empty value");
  }
  if (new Set(canonical).size !== canonical.length) {
    throw new Error("enabled asset classes contain duplicate canonical values");
  }
  return canonical;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
