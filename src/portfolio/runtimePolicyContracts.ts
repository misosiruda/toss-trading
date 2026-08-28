import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  isoDateTimeSchema,
  marketSchema,
  sha256HashSchema,
  strategyBucketSchema,
  type Market,
  type Sha256Hash,
  type StrategyBucket
} from "../domain/schemas.js";

const identifierSchema = z.string().trim().min(1).max(160);
const versionSchema = z.string().trim().min(1).max(80);
const ratioSchema = z.number().finite().min(0).max(1);
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "expected a valid calendar date");
const offsetIsoDateTimeSchema = isoDateTimeSchema.refine(
  (value) => /(Z|[+-]\d{2}:\d{2})$/.test(value),
  "session date-time must include a UTC or numeric timezone offset"
);

export const evidenceClassSchema = z.enum([
  "market_technical",
  "fundamental_quality",
  "portfolio_fit",
  "execution_fit"
]);

export const evidenceRequirementSchema = z
  .object({
    evidenceClass: evidenceClassSchema,
    sourceContractId: identifierSchema,
    maximumAgeSeconds: positiveIntegerSchema,
    minimumObservationCount: positiveIntegerSchema.optional()
  })
  .strict();

const everyTickSourceRequirementSchema = z
  .object({
    sourceContractId: identifierSchema,
    eventType: z.literal("verified_market_packet"),
    maximumAgeSeconds: positiveIntegerSchema,
    dedupeKey: z.literal("packet_hash")
  })
  .strict();

const bucketSelectionPolicyPayloadSchema = z
  .object({
    bucket: strategyBucketSchema,
    version: versionSchema,
    requiredEvidence: z.array(evidenceRequirementSchema).min(1).max(32),
    everyTickSourceRequirement: everyTickSourceRequirementSchema.optional(),
    hardGateRuleIds: z.array(identifierSchema).min(1).max(64),
    scoringModelVersion: versionSchema,
    featureDefinitionRefs: z.array(identifierSchema).min(1).max(128)
  })
  .strict();

export const bucketSelectionPolicyRefSchema = z
  .object({
    selectionPolicyRecordId: identifierSchema,
    version: versionSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema
  })
  .strict();

export const bucketSelectionPolicyRecordSchema =
  bucketSelectionPolicyPayloadSchema
    .safeExtend({
      selectionPolicyRecordId: identifierSchema,
      hash: sha256HashSchema,
      lineageHash: sha256HashSchema,
      createdAt: isoDateTimeSchema
    })
    .strict();

export type EvidenceRequirement = z.infer<typeof evidenceRequirementSchema>;
export type BucketSelectionPolicyRecord = z.infer<
  typeof bucketSelectionPolicyRecordSchema
>;
export type BucketSelectionPolicyRef = z.infer<
  typeof bucketSelectionPolicyRefSchema
>;

export type CanonicalRiskParameterValue =
  | string
  | number
  | boolean
  | null
  | CanonicalRiskParameterValue[]
  | { [key: string]: CanonicalRiskParameterValue };

const canonicalRiskParameterValueSchema: z.ZodType<CanonicalRiskParameterValue> =
  z.lazy(() =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(canonicalRiskParameterValueSchema).max(256),
      z.record(
        z.string().min(1).max(120),
        canonicalRiskParameterValueSchema
      )
    ])
  );

const portfolioRiskRuleParameterPayloadSchema = z
  .object({
    ruleId: identifierSchema,
    ruleVersion: versionSchema,
    version: versionSchema,
    parameters: z.record(
      z.string().min(1).max(120),
      canonicalRiskParameterValueSchema
    )
  })
  .strict();

export const portfolioRiskRuleParameterRefSchema = z
  .object({
    riskRuleParameterRecordId: identifierSchema,
    version: versionSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema
  })
  .strict();

export const portfolioRiskRuleParameterRecordSchema =
  portfolioRiskRuleParameterPayloadSchema
    .safeExtend({
      riskRuleParameterRecordId: identifierSchema,
      hash: sha256HashSchema,
      lineageHash: sha256HashSchema,
      createdAt: isoDateTimeSchema
    })
    .strict();

const riskRuleApplicationSchema = z.enum(["BUY", "SELL"]);

const portfolioRiskRuleSchema = z
  .object({
    ruleId: identifierSchema,
    ruleVersion: versionSchema,
    appliesTo: z.array(riskRuleApplicationSchema).min(1).max(2),
    parameterRef: portfolioRiskRuleParameterRefSchema
  })
  .strict();

const portfolioRiskRuleSetPayloadSchema = z
  .object({
    version: versionSchema,
    rules: z.array(portfolioRiskRuleSchema).min(1).max(128)
  })
  .strict();

export const portfolioRiskRuleSetRefSchema = z
  .object({
    riskRuleSetRecordId: identifierSchema,
    version: versionSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema
  })
  .strict();

export const portfolioRiskRuleSetRecordSchema = portfolioRiskRuleSetPayloadSchema
  .safeExtend({
    riskRuleSetRecordId: identifierSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema,
    createdAt: isoDateTimeSchema
  })
  .strict();

export type PortfolioRiskRuleParameterRecord = z.infer<
  typeof portfolioRiskRuleParameterRecordSchema
>;
export type PortfolioRiskRuleParameterRef = z.infer<
  typeof portfolioRiskRuleParameterRefSchema
>;
export type PortfolioRiskRuleSetRecord = z.infer<
  typeof portfolioRiskRuleSetRecordSchema
>;
export type PortfolioRiskRuleSetRef = z.infer<
  typeof portfolioRiskRuleSetRefSchema
>;

const bucketDrawdownSemanticsPayloadSchema = z
  .object({
    version: versionSchema,
    equityBasis: z.literal("bucket_assets_plus_cash"),
    unitFlowRule: z.literal("mint_burn_at_pre_flow_unit_nav"),
    pnlRule: z.literal("mark_to_market_and_execution_cost_only"),
    highWaterMarkRule: z.literal("max_previous_and_resulting_unit_nav"),
    drawdownFormula: z.literal("one_minus_unit_nav_over_high_water_mark"),
    emptyEpochRule: z.literal(
      "preserve_nav_until_explicit_initial_or_empty_epoch"
    ),
    activationCarryRule: z.literal("carry_when_semantics_hash_matches")
  })
  .strict();

export const bucketDrawdownSemanticsRefSchema = z
  .object({
    drawdownSemanticsRecordId: identifierSchema,
    version: versionSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema
  })
  .strict();

export const bucketDrawdownSemanticsRecordSchema =
  bucketDrawdownSemanticsPayloadSchema
    .safeExtend({
      drawdownSemanticsRecordId: identifierSchema,
      hash: sha256HashSchema,
      lineageHash: sha256HashSchema,
      createdAt: isoDateTimeSchema
    })
    .strict();

export type BucketDrawdownSemanticsRecord = z.infer<
  typeof bucketDrawdownSemanticsRecordSchema
>;
export type BucketDrawdownSemanticsRef = z.infer<
  typeof bucketDrawdownSemanticsRefSchema
>;

const sessionCalendarClosedEntrySchema = z
  .object({
    exchangeDate: calendarDateSchema,
    sessionKind: z.literal("closed"),
    sourceEvidenceRefs: z.array(identifierSchema).min(1).max(32)
  })
  .strict();

const sessionCalendarOpenEntrySchema = z
  .object({
    exchangeDate: calendarDateSchema,
    sessionKind: z.enum(["regular", "early_close", "delayed_open"]),
    opensAt: offsetIsoDateTimeSchema,
    closesAt: offsetIsoDateTimeSchema,
    sourceEvidenceRefs: z.array(identifierSchema).min(1).max(32)
  })
  .strict();

export const sessionCalendarEntrySchema = z.discriminatedUnion("sessionKind", [
  sessionCalendarClosedEntrySchema,
  sessionCalendarOpenEntrySchema
]);

const sessionCalendarPayloadSchema = z
  .object({
    market: marketSchema,
    version: versionSchema,
    timeZone: identifierSchema,
    validFromExchangeDate: calendarDateSchema,
    validThroughExchangeDate: calendarDateSchema,
    sessions: z.array(sessionCalendarEntrySchema).min(1).max(3660)
  })
  .strict();

export const sessionCalendarRecordSchema = sessionCalendarPayloadSchema
  .safeExtend({
    sessionCalendarRecordId: identifierSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema,
    createdAt: isoDateTimeSchema
  })
  .strict();

export type SessionCalendarEntry = z.infer<typeof sessionCalendarEntrySchema>;
export type SessionCalendarRecord = z.infer<
  typeof sessionCalendarRecordSchema
>;

const scheduleBoundaryPayloadSchema = z
  .object({
    market: marketSchema,
    version: versionSchema,
    timeZone: identifierSchema,
    sessionCalendarRecordId: identifierSchema,
    sessionCalendarVersion: versionSchema,
    sessionCalendarHash: sha256HashSchema,
    sessionCalendarLineageHash: sha256HashSchema,
    interval: z.enum(["hourly", "daily", "weekly"]),
    anchorLocalTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
    weeklyAnchorDay: z
      .enum(["monday", "tuesday", "wednesday", "thursday", "friday"])
      .optional(),
    nonSessionDayRule: z.enum(["previous_session", "next_session"])
  })
  .strict();

export const scheduleBoundaryRefSchema = z
  .object({
    scheduleBoundaryRecordId: identifierSchema,
    version: versionSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema
  })
  .strict();

export const scheduleBoundaryRecordSchema = scheduleBoundaryPayloadSchema
  .safeExtend({
    scheduleBoundaryRecordId: identifierSchema,
    hash: sha256HashSchema,
    lineageHash: sha256HashSchema,
    createdAt: isoDateTimeSchema
  })
  .strict();

export type ScheduleBoundaryRecord = z.infer<
  typeof scheduleBoundaryRecordSchema
>;
export type ScheduleBoundaryRef = z.infer<typeof scheduleBoundaryRefSchema>;

const bucketReviewCadenceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("every_tick") }).strict(),
  z
    .object({
      mode: z.literal("scheduled"),
      boundaryRefs: z.array(scheduleBoundaryRefSchema).min(1).max(2)
    })
    .strict()
]);

const takeProfitPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }).strict(),
  z
    .object({
      mode: z.literal("full_exit"),
      takeProfitRatio: z.number().finite().positive().max(10)
    })
    .strict(),
  z
    .object({
      mode: z.literal("partial_then_trail"),
      takeProfitRatio: z.number().finite().positive().max(10),
      takeProfitSellRatio: z.number().finite().positive().max(1),
      trailingStopFromPeakRatio: z.number().finite().positive().max(1)
    })
    .strict()
]);

const bucketSelectionTriggerSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("below_min") }).strict(),
  z
    .object({
      mode: z.literal("entry_floor_on_due_cycle"),
      entryWeightRatio: ratioSchema
    })
    .strict()
]);

export const strategyBucketRuntimePolicySchema = z
  .object({
    bucket: strategyBucketSchema,
    targetWeightRatio: ratioSchema,
    minWeightRatio: ratioSchema,
    maxWeightRatio: ratioSchema,
    maxTurnoverRatio: ratioSchema,
    turnoverWindow: z
      .object({
        mode: z.literal("fixed_utc"),
        durationSeconds: positiveIntegerSchema,
        anchor: z.literal("unix_epoch"),
        denominator: z.literal("window_open_portfolio_net_worth_krw")
      })
      .strict(),
    maxDrawdownRatio: ratioSchema,
    drawdownSemanticsRef: bucketDrawdownSemanticsRefSchema,
    reviewCadence: bucketReviewCadenceSchema,
    eventTriggers: z
      .array(z.enum(["regime_change", "thesis_evidence_change"]))
      .max(2),
    selectionTrigger: bucketSelectionTriggerSchema,
    minimumHoldingSeconds: nonNegativeIntegerSchema.optional(),
    maximumHoldingSeconds: positiveIntegerSchema.optional(),
    exitPolicy: z
      .object({
        takeProfit: takeProfitPolicySchema,
        stopLossRatio: z.number().finite().positive().max(1).optional(),
        timeExpiryAction: z.enum(["review_required", "sell_all"])
      })
      .strict(),
    enabledMarkets: z.array(marketSchema).min(1).max(2),
    enabledAssetClasses: z.array(identifierSchema).min(1).max(32),
    selectionPolicyRef: bucketSelectionPolicyRefSchema,
    riskRuleSetRef: portfolioRiskRuleSetRefSchema
  })
  .strict();

export type StrategyBucketRuntimePolicy = z.infer<
  typeof strategyBucketRuntimePolicySchema
>;

export interface ImmutablePolicyDependencyRecords {
  selectionPolicies: readonly BucketSelectionPolicyRecord[];
  riskParameters: readonly PortfolioRiskRuleParameterRecord[];
  riskRuleSets: readonly PortfolioRiskRuleSetRecord[];
  drawdownSemantics: readonly BucketDrawdownSemanticsRecord[];
  sessionCalendars: readonly SessionCalendarRecord[];
  scheduleBoundaries: readonly ScheduleBoundaryRecord[];
}

export function createBucketSelectionPolicyRecord(
  input: z.input<typeof bucketSelectionPolicyPayloadSchema> & {
    createdAt: string;
  }
): BucketSelectionPolicyRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = bucketSelectionPolicyPayloadSchema.parse({
    ...unparsedPayload,
    requiredEvidence: canonicalEvidenceRequirements(
      unparsedPayload.requiredEvidence
    ),
    hardGateRuleIds: canonicalIdentifiers(
      unparsedPayload.hardGateRuleIds,
      "hardGateRuleIds"
    ),
    featureDefinitionRefs: canonicalIdentifiers(
      unparsedPayload.featureDefinitionRefs,
      "featureDefinitionRefs"
    )
  });
  const hash = hashCanonicalPayload(payload);
  const identity = immutableRecordIdentity("selection_policy", hash, createdAt);
  return deepFreeze({
    ...payload,
    selectionPolicyRecordId: identity.recordId,
    hash,
    lineageHash: identity.lineageHash,
    createdAt: identity.createdAt
  });
}

export function parseBucketSelectionPolicyRecord(
  value: unknown
): BucketSelectionPolicyRecord {
  const record = bucketSelectionPolicyRecordSchema.parse(value);
  assertCanonicalEvidenceRequirements(record.requiredEvidence);
  assertCanonicalUniqueText(record.hardGateRuleIds, "hardGateRuleIds");
  assertCanonicalUniqueText(
    record.featureDefinitionRefs,
    "featureDefinitionRefs"
  );
  return verifyImmutableRecord(
    record,
    bucketSelectionPolicyPayload(record),
    "selectionPolicyRecordId",
    "selection_policy"
  );
}

export function selectionPolicyRefFor(
  record: BucketSelectionPolicyRecord
): BucketSelectionPolicyRef {
  const parsed = parseBucketSelectionPolicyRecord(record);
  return deepFreeze({
    selectionPolicyRecordId: parsed.selectionPolicyRecordId,
    version: parsed.version,
    hash: parsed.hash,
    lineageHash: parsed.lineageHash
  });
}

export function createPortfolioRiskRuleParameterRecord(
  input: z.input<typeof portfolioRiskRuleParameterPayloadSchema> & {
    createdAt: string;
  }
): PortfolioRiskRuleParameterRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = portfolioRiskRuleParameterPayloadSchema.parse(unparsedPayload);
  const hash = hashCanonicalPayload(payload);
  const identity = immutableRecordIdentity("risk_parameter", hash, createdAt);
  return deepFreeze({
    ...payload,
    riskRuleParameterRecordId: identity.recordId,
    hash,
    lineageHash: identity.lineageHash,
    createdAt: identity.createdAt
  });
}

export function parsePortfolioRiskRuleParameterRecord(
  value: unknown
): PortfolioRiskRuleParameterRecord {
  const record = portfolioRiskRuleParameterRecordSchema.parse(value);
  return verifyImmutableRecord(
    record,
    portfolioRiskRuleParameterPayload(record),
    "riskRuleParameterRecordId",
    "risk_parameter"
  );
}

export function riskRuleParameterRefFor(
  record: PortfolioRiskRuleParameterRecord
): PortfolioRiskRuleParameterRef {
  const parsed = parsePortfolioRiskRuleParameterRecord(record);
  return deepFreeze({
    riskRuleParameterRecordId: parsed.riskRuleParameterRecordId,
    version: parsed.version,
    hash: parsed.hash,
    lineageHash: parsed.lineageHash
  });
}

export function createPortfolioRiskRuleSetRecord(
  input: z.input<typeof portfolioRiskRuleSetPayloadSchema> & {
    createdAt: string;
  }
): PortfolioRiskRuleSetRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = portfolioRiskRuleSetPayloadSchema.parse({
    ...unparsedPayload,
    rules: canonicalRiskRules(unparsedPayload.rules)
  });
  assertRiskRuleCoverage(payload.rules);
  const hash = hashCanonicalPayload(payload);
  const identity = immutableRecordIdentity("risk_rule_set", hash, createdAt);
  return deepFreeze({
    ...payload,
    riskRuleSetRecordId: identity.recordId,
    hash,
    lineageHash: identity.lineageHash,
    createdAt: identity.createdAt
  });
}

export function parsePortfolioRiskRuleSetRecord(
  value: unknown
): PortfolioRiskRuleSetRecord {
  const record = portfolioRiskRuleSetRecordSchema.parse(value);
  assertCanonicalRiskRules(record.rules);
  assertRiskRuleCoverage(record.rules);
  return verifyImmutableRecord(
    record,
    portfolioRiskRuleSetPayload(record),
    "riskRuleSetRecordId",
    "risk_rule_set"
  );
}

export function riskRuleSetRefFor(
  record: PortfolioRiskRuleSetRecord
): PortfolioRiskRuleSetRef {
  const parsed = parsePortfolioRiskRuleSetRecord(record);
  return deepFreeze({
    riskRuleSetRecordId: parsed.riskRuleSetRecordId,
    version: parsed.version,
    hash: parsed.hash,
    lineageHash: parsed.lineageHash
  });
}

export function createBucketDrawdownSemanticsRecord(
  input: z.input<typeof bucketDrawdownSemanticsPayloadSchema> & {
    createdAt: string;
  }
): BucketDrawdownSemanticsRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = bucketDrawdownSemanticsPayloadSchema.parse(unparsedPayload);
  const hash = hashCanonicalPayload(payload);
  const identity = immutableRecordIdentity(
    "drawdown_semantics",
    hash,
    createdAt
  );
  return deepFreeze({
    ...payload,
    drawdownSemanticsRecordId: identity.recordId,
    hash,
    lineageHash: identity.lineageHash,
    createdAt: identity.createdAt
  });
}

export function parseBucketDrawdownSemanticsRecord(
  value: unknown
): BucketDrawdownSemanticsRecord {
  const record = bucketDrawdownSemanticsRecordSchema.parse(value);
  return verifyImmutableRecord(
    record,
    bucketDrawdownSemanticsPayload(record),
    "drawdownSemanticsRecordId",
    "drawdown_semantics"
  );
}

export function drawdownSemanticsRefFor(
  record: BucketDrawdownSemanticsRecord
): BucketDrawdownSemanticsRef {
  const parsed = parseBucketDrawdownSemanticsRecord(record);
  return deepFreeze({
    drawdownSemanticsRecordId: parsed.drawdownSemanticsRecordId,
    version: parsed.version,
    hash: parsed.hash,
    lineageHash: parsed.lineageHash
  });
}

export function createSessionCalendarRecord(
  input: z.input<typeof sessionCalendarPayloadSchema> & { createdAt: string }
): SessionCalendarRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = sessionCalendarPayloadSchema.parse({
    ...unparsedPayload,
    sessions: canonicalSessions(unparsedPayload.sessions)
  });
  assertSessionCalendarPayload(payload);
  const hash = hashCanonicalPayload(payload);
  const identity = immutableRecordIdentity("session_calendar", hash, createdAt);
  return deepFreeze({
    ...payload,
    sessionCalendarRecordId: identity.recordId,
    hash,
    lineageHash: identity.lineageHash,
    createdAt: identity.createdAt
  });
}

export function parseSessionCalendarRecord(
  value: unknown
): SessionCalendarRecord {
  const record = sessionCalendarRecordSchema.parse(value);
  assertCanonicalSessions(record.sessions);
  assertSessionCalendarPayload(record);
  return verifyImmutableRecord(
    record,
    sessionCalendarPayload(record),
    "sessionCalendarRecordId",
    "session_calendar"
  );
}

export function createScheduleBoundaryRecord(
  input: z.input<typeof scheduleBoundaryPayloadSchema> & { createdAt: string }
): ScheduleBoundaryRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = scheduleBoundaryPayloadSchema.parse(unparsedPayload);
  assertScheduleBoundaryPayload(payload);
  const hash = hashCanonicalPayload(payload);
  const identity = immutableRecordIdentity("schedule_boundary", hash, createdAt);
  return deepFreeze({
    ...payload,
    scheduleBoundaryRecordId: identity.recordId,
    hash,
    lineageHash: identity.lineageHash,
    createdAt: identity.createdAt
  });
}

export function parseScheduleBoundaryRecord(
  value: unknown
): ScheduleBoundaryRecord {
  const record = scheduleBoundaryRecordSchema.parse(value);
  assertScheduleBoundaryPayload(record);
  return verifyImmutableRecord(
    record,
    scheduleBoundaryPayload(record),
    "scheduleBoundaryRecordId",
    "schedule_boundary"
  );
}

export function scheduleBoundaryRefFor(
  record: ScheduleBoundaryRecord
): ScheduleBoundaryRef {
  const parsed = parseScheduleBoundaryRecord(record);
  return deepFreeze({
    scheduleBoundaryRecordId: parsed.scheduleBoundaryRecordId,
    version: parsed.version,
    hash: parsed.hash,
    lineageHash: parsed.lineageHash
  });
}

export function parseStrategyBucketRuntimePolicy(
  value: unknown
): StrategyBucketRuntimePolicy {
  const policy = strategyBucketRuntimePolicySchema.parse(value);
  assertStrategyBucketRuntimePolicy(policy);
  return deepFreeze(policy);
}

function assertStrategyBucketRuntimePolicy(
  policy: StrategyBucketRuntimePolicy
): void {
  if (
    policy.minWeightRatio > policy.targetWeightRatio ||
    policy.targetWeightRatio > policy.maxWeightRatio
  ) {
    throw new Error("bucket target weight must stay inside the min/max band");
  }
  if (
    policy.selectionTrigger.mode === "below_min" &&
    policy.targetWeightRatio > 0 &&
    policy.minWeightRatio === 0
  ) {
    throw new Error(
      "positive-target zero-min bucket must use entry_floor_on_due_cycle"
    );
  }
  if (policy.selectionTrigger.mode === "entry_floor_on_due_cycle") {
    const entry = policy.selectionTrigger.entryWeightRatio;
    if (
      entry <= 0 ||
      entry < policy.minWeightRatio ||
      entry > policy.targetWeightRatio
    ) {
      throw new Error(
        "entry floor must be positive and stay between min and target"
      );
    }
  }
  if (policy.reviewCadence.mode === "every_tick" && policy.bucket !== "intraday") {
    throw new Error("every_tick cadence is restricted to intraday bucket");
  }
  if (
    policy.minimumHoldingSeconds !== undefined &&
    policy.maximumHoldingSeconds !== undefined &&
    policy.minimumHoldingSeconds >= policy.maximumHoldingSeconds
  ) {
    throw new Error("minimum holding seconds must be below maximum holding seconds");
  }
  assertCanonicalUniqueText(policy.eventTriggers, "eventTriggers");
  assertCanonicalUniqueText(policy.enabledMarkets, "enabledMarkets");
  assertCanonicalUniqueText(
    policy.enabledAssetClasses,
    "enabledAssetClasses"
  );
  if (policy.reviewCadence.mode === "scheduled") {
    assertCanonicalBoundaryRefs(policy.reviewCadence.boundaryRefs);
  }
}

function canonicalEvidenceRequirements(
  values: readonly z.input<typeof evidenceRequirementSchema>[]
): EvidenceRequirement[] {
  const parsed = values.map((value) => evidenceRequirementSchema.parse(value));
  const canonical = [...parsed].sort(compareEvidenceRequirement);
  assertNoDuplicateKeys(
    canonical,
    (value) => `${value.evidenceClass}\u0000${value.sourceContractId}`,
    "requiredEvidence"
  );
  return canonical;
}

function assertCanonicalEvidenceRequirements(
  values: readonly EvidenceRequirement[]
): void {
  const canonical = [...values].sort(compareEvidenceRequirement);
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error("requiredEvidence must use canonical order");
  }
  assertNoDuplicateKeys(
    values,
    (value) => `${value.evidenceClass}\u0000${value.sourceContractId}`,
    "requiredEvidence"
  );
}

function compareEvidenceRequirement(
  left: EvidenceRequirement,
  right: EvidenceRequirement
): number {
  return compareText(
    `${left.evidenceClass}\u0000${left.sourceContractId}`,
    `${right.evidenceClass}\u0000${right.sourceContractId}`
  );
}

function canonicalRiskRules(
  values: readonly z.input<
    typeof portfolioRiskRuleSetPayloadSchema
  >["rules"][number][]
): z.infer<typeof portfolioRiskRuleSetPayloadSchema>["rules"] {
  const rules = values.map((value) => {
    const parsed = portfolioRiskRuleSchema.parse(value);
    return {
      ...parsed,
      appliesTo: canonicalUniqueText(parsed.appliesTo, "appliesTo")
    };
  });
  const canonical = [...rules].sort((left, right) =>
    compareText(left.ruleId, right.ruleId)
  );
  assertNoDuplicateKeys(canonical, (value) => value.ruleId, "rules");
  return portfolioRiskRuleSetPayloadSchema.shape.rules.parse(canonical);
}

function assertCanonicalRiskRules(
  rules: PortfolioRiskRuleSetRecord["rules"]
): void {
  const canonical = [...rules].sort((left, right) =>
    compareText(left.ruleId, right.ruleId)
  );
  if (!isDeepStrictEqual(rules, canonical)) {
    throw new Error("risk rules must use canonical ruleId order");
  }
  assertNoDuplicateKeys(rules, (value) => value.ruleId, "rules");
  for (const rule of rules) {
    assertCanonicalUniqueText(rule.appliesTo, `${rule.ruleId}.appliesTo`);
  }
}

function assertRiskRuleCoverage(
  rules: PortfolioRiskRuleSetRecord["rules"]
): void {
  for (const side of riskRuleApplicationSchema.options) {
    if (!rules.some((rule) => rule.appliesTo.includes(side))) {
      throw new Error(`risk rule set must include at least one ${side} rule`);
    }
  }
}

function canonicalSessions(
  values: readonly z.input<typeof sessionCalendarEntrySchema>[]
): SessionCalendarEntry[] {
  const sessions = values.map((value) => {
    const parsed = sessionCalendarEntrySchema.parse(value);
    return {
      ...parsed,
      sourceEvidenceRefs: canonicalUniqueText(
        parsed.sourceEvidenceRefs,
        `${parsed.exchangeDate}.sourceEvidenceRefs`
      )
    };
  });
  const canonical = [...sessions].sort((left, right) =>
    compareText(left.exchangeDate, right.exchangeDate)
  );
  assertNoDuplicateKeys(
    canonical,
    (value) => value.exchangeDate,
    "sessions"
  );
  return canonical;
}

function assertCanonicalSessions(
  sessions: readonly SessionCalendarEntry[]
): void {
  const canonical = [...sessions].sort((left, right) =>
    compareText(left.exchangeDate, right.exchangeDate)
  );
  if (!isDeepStrictEqual(sessions, canonical)) {
    throw new Error("calendar sessions must use canonical exchange-date order");
  }
  assertNoDuplicateKeys(sessions, (value) => value.exchangeDate, "sessions");
  for (const session of sessions) {
    assertCanonicalUniqueText(
      session.sourceEvidenceRefs,
      `${session.exchangeDate}.sourceEvidenceRefs`
    );
  }
}

function assertSessionCalendarPayload(
  payload: z.infer<typeof sessionCalendarPayloadSchema>
): void {
  assertIanaTimeZone(payload.timeZone);
  if (payload.validFromExchangeDate > payload.validThroughExchangeDate) {
    throw new Error("calendar valid range is reversed");
  }
  const rangeLength = calendarDayDistance(
    payload.validFromExchangeDate,
    payload.validThroughExchangeDate
  );
  if (rangeLength >= 3660) {
    throw new Error("calendar valid range exceeds the contract maximum");
  }
  const expectedDates = inclusiveCalendarDates(
    payload.validFromExchangeDate,
    payload.validThroughExchangeDate
  );
  const actualDates = payload.sessions.map((session) => session.exchangeDate);
  if (!isDeepStrictEqual(actualDates, expectedDates)) {
    throw new Error(
      "calendar sessions must cover every date in the declared valid range"
    );
  }
  for (const session of payload.sessions) {
    if (
      session.sessionKind !== "closed" &&
      Date.parse(session.opensAt) >= Date.parse(session.closesAt)
    ) {
      throw new Error(`${session.exchangeDate} session open must precede close`);
    }
    if (
      session.sessionKind !== "closed" &&
      (calendarDateInTimeZone(session.opensAt, payload.timeZone) !==
        session.exchangeDate ||
        calendarDateInTimeZone(session.closesAt, payload.timeZone) !==
          session.exchangeDate)
    ) {
      throw new Error(
        `${session.exchangeDate} session timestamps must resolve to the exchange date`
      );
    }
  }
}

function assertScheduleBoundaryPayload(
  payload: z.infer<typeof scheduleBoundaryPayloadSchema>
): void {
  assertIanaTimeZone(payload.timeZone);
  if (payload.interval === "weekly" && payload.weeklyAnchorDay === undefined) {
    throw new Error("weekly boundary requires weeklyAnchorDay");
  }
  if (payload.interval !== "weekly" && payload.weeklyAnchorDay !== undefined) {
    throw new Error("weeklyAnchorDay is allowed only for weekly boundary");
  }
}

function assertCanonicalBoundaryRefs(
  refs: readonly ScheduleBoundaryRef[]
): void {
  const canonical = [...refs].sort((left, right) =>
    compareText(left.scheduleBoundaryRecordId, right.scheduleBoundaryRecordId)
  );
  if (!isDeepStrictEqual(refs, canonical)) {
    throw new Error("schedule boundary refs must use canonical record ID order");
  }
  assertNoDuplicateKeys(
    refs,
    (value) => value.scheduleBoundaryRecordId,
    "boundaryRefs"
  );
}

function bucketSelectionPolicyPayload(
  record: BucketSelectionPolicyRecord
): z.infer<typeof bucketSelectionPolicyPayloadSchema> {
  const {
    selectionPolicyRecordId: _selectionPolicyRecordId,
    hash: _hash,
    lineageHash: _lineageHash,
    createdAt: _createdAt,
    ...payload
  } = record;
  return payload;
}

function portfolioRiskRuleParameterPayload(
  record: PortfolioRiskRuleParameterRecord
): z.infer<typeof portfolioRiskRuleParameterPayloadSchema> {
  const {
    riskRuleParameterRecordId: _riskRuleParameterRecordId,
    hash: _hash,
    lineageHash: _lineageHash,
    createdAt: _createdAt,
    ...payload
  } = record;
  return payload;
}

function portfolioRiskRuleSetPayload(
  record: PortfolioRiskRuleSetRecord
): z.infer<typeof portfolioRiskRuleSetPayloadSchema> {
  const {
    riskRuleSetRecordId: _riskRuleSetRecordId,
    hash: _hash,
    lineageHash: _lineageHash,
    createdAt: _createdAt,
    ...payload
  } = record;
  return payload;
}

function bucketDrawdownSemanticsPayload(
  record: BucketDrawdownSemanticsRecord
): z.infer<typeof bucketDrawdownSemanticsPayloadSchema> {
  const {
    drawdownSemanticsRecordId: _drawdownSemanticsRecordId,
    hash: _hash,
    lineageHash: _lineageHash,
    createdAt: _createdAt,
    ...payload
  } = record;
  return payload;
}

function sessionCalendarPayload(
  record: SessionCalendarRecord
): z.infer<typeof sessionCalendarPayloadSchema> {
  const {
    sessionCalendarRecordId: _sessionCalendarRecordId,
    hash: _hash,
    lineageHash: _lineageHash,
    createdAt: _createdAt,
    ...payload
  } = record;
  return payload;
}

function scheduleBoundaryPayload(
  record: ScheduleBoundaryRecord
): z.infer<typeof scheduleBoundaryPayloadSchema> {
  const {
    scheduleBoundaryRecordId: _scheduleBoundaryRecordId,
    hash: _hash,
    lineageHash: _lineageHash,
    createdAt: _createdAt,
    ...payload
  } = record;
  return payload;
}

function verifyImmutableRecord<
  TRecord extends Record<
    TIdKey | "hash" | "lineageHash" | "createdAt",
    string
  >,
  TIdKey extends keyof TRecord & string
>(
  record: TRecord,
  payload: unknown,
  idKey: TIdKey,
  idPrefix: string
): TRecord {
  const expectedHash = hashCanonicalPayload(payload);
  if (record.hash !== expectedHash) {
    throw new Error(`${idPrefix} record hash mismatch`);
  }
  if (record[idKey] !== hashDerivedId(idPrefix, expectedHash)) {
    throw new Error(`${idPrefix} record ID must be derived from its hash`);
  }
  const expectedLineageHash = lineageHashFor(
    idPrefix,
    record[idKey],
    record.hash,
    record.createdAt
  );
  if (record.lineageHash !== expectedLineageHash) {
    throw new Error(`${idPrefix} record lineage hash mismatch`);
  }
  return deepFreeze(record);
}

function immutableRecordIdentity(
  recordType: string,
  semanticHash: Sha256Hash,
  value: string
): { recordId: string; lineageHash: Sha256Hash; createdAt: string } {
  const createdAt = isoDateTimeSchema.parse(value);
  const recordId = hashDerivedId(recordType, semanticHash);
  return {
    recordId,
    lineageHash: lineageHashFor(
      recordType,
      recordId,
      semanticHash,
      createdAt
    ),
    createdAt
  };
}

function lineageHashFor(
  recordType: string,
  recordId: string,
  semanticHash: string,
  createdAt: string
): Sha256Hash {
  return hashCanonicalPayload({
    recordType,
    recordId,
    semanticHash,
    createdAt
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function hashCanonicalPayload(value: unknown): Sha256Hash {
  return sha256HashSchema.parse(
    `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

export function hashDerivedId(prefix: string, hash: Sha256Hash): string {
  return `${prefix}_${hash.slice("sha256:".length)}`;
}

function canonicalUniqueText<T extends string>(
  values: readonly T[],
  label: string
): T[] {
  const canonical = [...values].sort(compareText);
  assertNoDuplicateKeys(canonical, (value) => value, label);
  return canonical;
}

function canonicalIdentifiers(
  values: readonly string[],
  label: string
): string[] {
  return canonicalUniqueText(
    values.map((value) => identifierSchema.parse(value)),
    label
  );
}

function assertCanonicalUniqueText<T extends string>(
  values: readonly T[],
  label: string
): void {
  const canonical = [...values].sort(compareText);
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error(`${label} must use canonical order`);
  }
  assertNoDuplicateKeys(values, (value) => value, label);
}

function assertNoDuplicateKeys<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
  label: string
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      throw new Error(`${label} must not contain duplicate canonical keys`);
    }
    seen.add(key);
  }
}

export function compareText(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function assertIanaTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new Error("timeZone must be a valid IANA timezone");
  }
}

function inclusiveCalendarDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function calendarDayDistance(start: string, end: string): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00.000Z`) -
      Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000
  );
}

function calendarDateInTimeZone(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("session timestamp could not resolve an exchange date");
  }
  return `${year}-${month}-${day}`;
}

function isValidCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type { Market, Sha256Hash, StrategyBucket };
