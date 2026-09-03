import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) => value === value.trim(),
    "identifier must already be canonical"
  );
const positiveNumberSchema = z
  .number()
  .finite()
  .positive()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe();

const rebalancePlanExecutionAppliedPayloadSchema = z
  .object({
    previousPlanEventId: identifierSchema,
    eventType: z.literal("execution_applied"),
    planId: identifierSchema,
    planHash: sha256HashSchema,
    cycleId: identifierSchema,
    portfolioId: identifierSchema,
    portfolioVersion: identifierSchema,
    portfolioSnapshotHash: sha256HashSchema,
    policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema,
    actionId: identifierSchema,
    actionSequence: nonNegativeIntegerSchema,
    fillSequence: nonNegativeIntegerSchema,
    fillId: identifierSchema,
    paperFillRecordId: identifierSchema,
    paperFillHash: sha256HashSchema,
    requestedNotionalKrw: positiveNumberSchema,
    requestedQuantity: positiveNumberSchema,
    filledNotionalKrw: positiveNumberSchema,
    filledQuantity: positiveNumberSchema,
    cumulativeFilledNotionalKrw: positiveNumberSchema,
    cumulativeFilledQuantity: positiveNumberSchema,
    riskDecisionId: identifierSchema,
    expectedPrePortfolioVersion: identifierSchema,
    expectedPrePortfolioSnapshotHash: sha256HashSchema,
    resultingPortfolioVersion: identifierSchema,
    resultingPortfolioSnapshotHash: sha256HashSchema
  })
  .strict();

export const rebalancePlanExecutionAppliedEventSchema =
  rebalancePlanExecutionAppliedPayloadSchema.safeExtend({
    planEventId: identifierSchema,
    planEventHash: sha256HashSchema
  });

export type RebalancePlanExecutionAppliedEvent = z.infer<
  typeof rebalancePlanExecutionAppliedEventSchema
>;

export function createRebalancePlanExecutionAppliedEvent(
  input: z.input<typeof rebalancePlanExecutionAppliedPayloadSchema>
): RebalancePlanExecutionAppliedEvent {
  const payload = rebalancePlanExecutionAppliedPayloadSchema.parse(input);
  assertPayload(payload);
  const planEventHash = hashCanonicalPayload(payload);
  return deepFreeze(
    rebalancePlanExecutionAppliedEventSchema.parse({
      ...payload,
      planEventId: hashDerivedId("rebalance_plan_event", planEventHash),
      planEventHash
    })
  );
}

export function parseRebalancePlanExecutionAppliedEvent(
  value: unknown
): RebalancePlanExecutionAppliedEvent {
  const event = rebalancePlanExecutionAppliedEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) {
    throw new Error(
      "rebalance plan execution-applied event must already be canonical"
    );
  }
  const { planEventId, planEventHash, ...payload } = event;
  assertPayload(payload);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    planEventHash !== expectedHash ||
    planEventId !== hashDerivedId("rebalance_plan_event", expectedHash)
  ) {
    throw new Error(
      "rebalance plan execution-applied event identity does not match its payload"
    );
  }
  return deepFreeze(event);
}

function assertPayload(
  payload: z.infer<typeof rebalancePlanExecutionAppliedPayloadSchema>
): void {
  if (
    payload.filledNotionalKrw > payload.requestedNotionalKrw ||
    payload.filledQuantity > payload.requestedQuantity
  ) {
    throw new Error("execution-applied fill exceeds its requested amount");
  }
  if (
    payload.cumulativeFilledNotionalKrw < payload.filledNotionalKrw ||
    payload.cumulativeFilledQuantity < payload.filledQuantity
  ) {
    throw new Error("execution-applied cumulative fill is below current fill");
  }
  if (
    payload.expectedPrePortfolioVersion === payload.resultingPortfolioVersion ||
    payload.expectedPrePortfolioSnapshotHash ===
      payload.resultingPortfolioSnapshotHash
  ) {
    throw new Error("execution-applied event must advance portfolio state");
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
