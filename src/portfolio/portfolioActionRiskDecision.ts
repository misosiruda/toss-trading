import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  marketSchema,
  sha256HashSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
import {
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value === value.trim(), "identifier must be canonical");
const nonNegativeNumberSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const positiveNumberSchema = nonNegativeNumberSchema.refine(
  (value) => value > 0,
  "number must be positive"
);
const ratioSchema = nonNegativeNumberSchema;

const riskRuleScopeSchema = z.discriminatedUnion("scopeKind", [
  z
    .object({
      scopeKind: z.literal("bucket"),
      bucket: strategyBucketSchema
    })
    .strict(),
  z
    .object({
      scopeKind: z.literal("legacy_reduce_only"),
      legacyPolicyHash: sha256HashSchema
    })
    .strict()
]);

const turnoverAssessmentSchema = z.discriminatedUnion("scopeKind", [
  z
    .object({
      scopeKind: z.literal("bucket"),
      turnoverStateId: identifierSchema,
      turnoverStateHash: sha256HashSchema,
      turnoverWindowOpenPortfolioNetWorthKrw: positiveNumberSchema,
      priorBucketTurnoverNotionalKrw: nonNegativeNumberSchema,
      requestedBucketTurnoverNotionalKrw: positiveNumberSchema,
      resultingBucketTurnoverRatio: ratioSchema
    })
    .strict(),
  z
    .object({
      scopeKind: z.literal("legacy_reduce_only"),
      countedInBucketTurnover: z.literal(false)
    })
    .strict()
]);

const cashAssessmentSchema = z.discriminatedUnion("side", [
  z
    .object({
      side: z.literal("BUY"),
      worstCaseNetCashDebitKrw: positiveNumberSchema,
      approvedMaximumNetCashDebitKrw: positiveNumberSchema
    })
    .strict(),
  z
    .object({
      side: z.literal("SELL"),
      expectedMinimumNetCashCreditKrw: nonNegativeNumberSchema
    })
    .strict()
]);

const ruleResultSchema = z
  .object({
    ruleId: identifierSchema,
    result: z.enum(["pass", "fail"]),
    reasonCode: identifierSchema
  })
  .strict();

const portfolioActionRiskDecisionPayloadSchema = z
  .object({
    riskRuleSetRecordId: identifierSchema,
    riskRuleSetVersion: identifierSchema,
    riskRuleSetHash: sha256HashSchema,
    planId: identifierSchema,
    actionId: identifierSchema,
    portfolioId: identifierSchema,
    policyHash: sha256HashSchema,
    expectedPortfolioVersion: identifierSchema,
    expectedPortfolioSnapshotHash: sha256HashSchema,
    market: marketSchema,
    symbol: identifierSchema,
    side: z.enum(["BUY", "SELL"]),
    riskRuleScope: riskRuleScopeSchema,
    actionExecutionTargetHash: sha256HashSchema,
    turnoverAssessment: turnoverAssessmentSchema,
    priorCumulativeFilledNotionalKrw: nonNegativeNumberSchema,
    priorCumulativeFilledQuantity: nonNegativeNumberSchema,
    requestedNotionalKrw: positiveNumberSchema,
    requestedQuantity: positiveNumberSchema,
    worstCaseFillNotionalKrw: positiveNumberSchema,
    approvedMaximumFillNotionalKrw: positiveNumberSchema,
    cashAssessment: cashAssessmentSchema,
    decision: z.enum(["approved", "rejected"]),
    requiredRuleIds: z.array(identifierSchema).min(1).max(128),
    ruleResults: z.array(ruleResultSchema).min(1).max(128),
    riskInputHash: sha256HashSchema,
    riskEvidenceRefs: z.array(identifierSchema).min(1).max(256),
    decidedAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const portfolioActionRiskDecisionSchema =
  portfolioActionRiskDecisionPayloadSchema.safeExtend({
    riskDecisionId: identifierSchema,
    riskDecisionHash: sha256HashSchema
  });

export type PortfolioActionRiskDecision = z.infer<
  typeof portfolioActionRiskDecisionSchema
>;

export function createPortfolioActionRiskDecision(
  input: z.input<typeof portfolioActionRiskDecisionPayloadSchema>
): PortfolioActionRiskDecision {
  const payload = portfolioActionRiskDecisionPayloadSchema.parse(
    canonicalizeLists(input)
  );
  assertPayload(payload);
  const riskDecisionHash = hashCanonicalPayload(payload);
  return deepFreeze(
    portfolioActionRiskDecisionSchema.parse({
      ...payload,
      riskDecisionId: hashDerivedId(
        "portfolio_action_risk_decision",
        riskDecisionHash
      ),
      riskDecisionHash
    })
  );
}

export function parsePortfolioActionRiskDecision(
  value: unknown
): PortfolioActionRiskDecision {
  const decision = portfolioActionRiskDecisionSchema.parse(value);
  if (!isDeepStrictEqual(value, decision)) {
    throw new Error("portfolio action risk decision must already be canonical");
  }
  const { riskDecisionId, riskDecisionHash, ...payload } = decision;
  assertPayload(payload);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    riskDecisionHash !== expectedHash ||
    riskDecisionId !==
      hashDerivedId("portfolio_action_risk_decision", expectedHash)
  ) {
    throw new Error("portfolio action risk decision identity mismatch");
  }
  return deepFreeze(decision);
}

function canonicalizeLists(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    ...(Array.isArray(candidate.requiredRuleIds)
      ? {
          requiredRuleIds: [...candidate.requiredRuleIds].sort((left, right) =>
            compareText(String(left), String(right))
          )
        }
      : {}),
    ...(Array.isArray(candidate.ruleResults)
      ? {
          ruleResults: [...candidate.ruleResults].sort((left, right) =>
            compareText(ruleIdOf(left), ruleIdOf(right))
          )
        }
      : {}),
    ...(Array.isArray(candidate.riskEvidenceRefs)
      ? {
          riskEvidenceRefs: [...candidate.riskEvidenceRefs].sort((left, right) =>
            compareText(String(left), String(right))
          )
        }
      : {})
  };
}

function assertPayload(
  payload: z.infer<typeof portfolioActionRiskDecisionPayloadSchema>
): void {
  assertUnique(payload.requiredRuleIds, "required rule IDs");
  assertUnique(
    payload.ruleResults.map((result) => result.ruleId),
    "rule result IDs"
  );
  assertUnique(payload.riskEvidenceRefs, "risk evidence refs");
  assertCanonical(payload.requiredRuleIds, "required rule IDs");
  assertCanonical(
    payload.ruleResults.map((result) => result.ruleId),
    "rule result IDs"
  );
  assertCanonical(payload.riskEvidenceRefs, "risk evidence refs");
  if (
    !isDeepStrictEqual(
      payload.requiredRuleIds,
      payload.ruleResults.map((result) => result.ruleId)
    )
  ) {
    throw new Error("risk decision required rules do not match rule results");
  }
  const derivedDecision = payload.ruleResults.every(
    (result) => result.result === "pass"
  )
    ? "approved"
    : "rejected";
  if (payload.decision !== derivedDecision) {
    throw new Error("risk decision does not match rule results");
  }
  if (
    payload.decision === "approved" &&
    payload.worstCaseFillNotionalKrw >
      payload.approvedMaximumFillNotionalKrw
  ) {
    throw new Error("approved risk decision exceeds fill notional cap");
  }
  if (
    payload.decision === "approved" &&
    payload.cashAssessment.side === "BUY" &&
    payload.cashAssessment.worstCaseNetCashDebitKrw >
      payload.cashAssessment.approvedMaximumNetCashDebitKrw
  ) {
    throw new Error("approved risk decision exceeds net cash debit cap");
  }
  if (payload.riskRuleScope.scopeKind !== payload.turnoverAssessment.scopeKind) {
    throw new Error("risk decision scope does not match turnover assessment");
  }
  if (payload.cashAssessment.side !== payload.side) {
    throw new Error("risk decision side does not match cash assessment");
  }
  if (payload.side === "BUY" && payload.riskRuleScope.scopeKind === "legacy_reduce_only") {
    throw new Error("legacy reduce-only risk decision must be SELL");
  }
  if (payload.turnoverAssessment.scopeKind === "bucket") {
    if (
      payload.turnoverAssessment.requestedBucketTurnoverNotionalKrw !==
      payload.worstCaseFillNotionalKrw
    ) {
      throw new Error(
        "risk decision turnover contribution does not match worst-case fill"
      );
    }
    const expectedRatio =
      (payload.turnoverAssessment.priorBucketTurnoverNotionalKrw +
        payload.turnoverAssessment.requestedBucketTurnoverNotionalKrw) /
      payload.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw;
    if (payload.turnoverAssessment.resultingBucketTurnoverRatio !== expectedRatio) {
      throw new Error("risk decision turnover ratio mismatch");
    }
  }
}

function ruleIdOf(value: unknown): string {
  if (value !== null && typeof value === "object" && "ruleId" in value) {
    return String((value as { ruleId: unknown }).ruleId);
  }
  return "";
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
}

function assertCanonical(values: readonly string[], label: string): void {
  const canonical = [...values].sort(compareText);
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error(`${label} must use canonical order`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
