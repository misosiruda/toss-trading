import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, strategyBucketSchema } from "../domain/schemas.js";
import {
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z.string().trim().min(1).max(160);
const nonNegativeAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const signedAmountSchema = z
  .number()
  .finite()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const positiveValueSchema = z.number().finite().positive();
const canonicalEvidenceRefsSchema = z.array(identifierSchema).min(1).max(128);

const epochBaseSchema = z
  .object({
    eventType: z.literal("epoch_initialized"),
    riskStateEpochId: identifierSchema,
    activationId: identifierSchema,
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    drawdownSemanticsHash: sha256HashSchema,
    initialEquityKrw: nonNegativeAmountSchema,
    initialUnits: nonNegativeAmountSchema,
    initialUnitNavKrw: positiveValueSchema,
    initialHighWaterMarkUnitNavKrw: positiveValueSchema,
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const initialOrEmptyEpochPayloadSchema = epochBaseSchema
  .safeExtend({ initializationMode: z.literal("initial_or_empty") })
  .strict();

const carriedForwardEpochPayloadSchema = epochBaseSchema
  .safeExtend({
    initializationMode: z.literal("carried_forward"),
    previousRiskStateEpochId: identifierSchema
  })
  .strict();

const chainedEventBaseSchema = z
  .object({
    previousBucketEquityEventId: identifierSchema,
    riskStateEpochId: identifierSchema,
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const fillOriginSchema = z
  .object({
    rebalancePlanId: identifierSchema,
    rebalanceActionId: identifierSchema,
    fillId: identifierSchema,
    paperFillRecordId: identifierSchema,
    paperFillHash: sha256HashSchema,
    fillAccountingGroupId: identifierSchema,
    fillAccountingSequence: z.union([z.literal(0), z.literal(1)])
  })
  .strict();

const capitalFlowPayloadSchema = chainedEventBaseSchema
  .safeExtend({
    eventType: z.literal("capital_flow"),
    amountKrw: signedAmountSchema,
    ...fillOriginSchema.shape
  })
  .strict();

const valuationPayloadSchema = chainedEventBaseSchema
  .safeExtend({
    eventType: z.literal("valuation"),
    equityDeltaKrw: signedAmountSchema,
    bucketValuationMarkRecordId: identifierSchema,
    valuationMarkHash: sha256HashSchema,
    evidenceRefs: canonicalEvidenceRefsSchema
  })
  .strict();

const executionCostPayloadSchema = chainedEventBaseSchema
  .safeExtend({
    eventType: z.literal("execution_cost"),
    equityDeltaKrw: z
      .number()
      .finite()
      .nonpositive()
      .refine(
        (value) => !Object.is(value, -0),
        "number must not be negative zero"
      ),
    ...fillOriginSchema.shape,
    evidenceRefs: canonicalEvidenceRefsSchema
  })
  .strict();

const transferBaseSchema = chainedEventBaseSchema
  .safeExtend({
    migrationRecordId: identifierSchema,
    migrationRecordHash: sha256HashSchema,
    transferGroupId: identifierSchema,
    amountKrw: signedAmountSchema
  })
  .strict();

const strategyTransferOutPayloadSchema = transferBaseSchema
  .safeExtend({
    eventType: z.literal("strategy_transfer_out"),
    transferSequence: z.literal(0)
  })
  .strict();

const strategyTransferInPayloadSchema = transferBaseSchema
  .safeExtend({
    eventType: z.literal("strategy_transfer_in"),
    transferSequence: z.literal(1)
  })
  .strict();

export const bucketEquityEventPayloadSchema = z.union([
  initialOrEmptyEpochPayloadSchema,
  carriedForwardEpochPayloadSchema,
  capitalFlowPayloadSchema,
  valuationPayloadSchema,
  executionCostPayloadSchema,
  strategyTransferOutPayloadSchema,
  strategyTransferInPayloadSchema
]);

export const bucketEquityEventSchema = z.union([
  initialOrEmptyEpochPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  }),
  carriedForwardEpochPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  }),
  capitalFlowPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  }),
  valuationPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  }),
  executionCostPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  }),
  strategyTransferOutPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  }),
  strategyTransferInPayloadSchema.safeExtend({
    bucketEquityEventId: identifierSchema,
    bucketEquityEventHash: sha256HashSchema
  })
]);

export type BucketEquityEvent = z.infer<typeof bucketEquityEventSchema>;

const bucketRiskStatePayloadSchema = z
  .object({
    riskStateEpochId: identifierSchema,
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    drawdownSemanticsHash: sha256HashSchema,
    units: nonNegativeAmountSchema,
    unitNavKrw: positiveValueSchema,
    highWaterMarkUnitNavKrw: positiveValueSchema,
    equityKrw: nonNegativeAmountSchema,
    drawdownRatio: z
      .number()
      .finite()
      .min(0)
      .max(1)
      .refine(
        (value) => !Object.is(value, -0),
        "number must not be negative zero"
      ),
    lastBucketEquityEventId: identifierSchema,
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const bucketRiskStateSchema = bucketRiskStatePayloadSchema.safeExtend({
  riskStateHash: sha256HashSchema
});

export type BucketRiskState = z.infer<typeof bucketRiskStateSchema>;

export function createBucketEquityEvent(
  input: z.input<typeof bucketEquityEventPayloadSchema>
): BucketEquityEvent {
  const payload = bucketEquityEventPayloadSchema.parse(
    canonicalizeEvidenceRefs(input)
  );
  assertBucketEquityEventPayload(payload);
  const bucketEquityEventHash = hashCanonicalPayload(payload);
  return deepFreeze(
    bucketEquityEventSchema.parse({
      ...payload,
      bucketEquityEventId: hashDerivedId(
        "bucket_equity_event",
        bucketEquityEventHash
      ),
      bucketEquityEventHash
    })
  );
}

export function parseBucketEquityEvent(value: unknown): BucketEquityEvent {
  const event = bucketEquityEventSchema.parse(value);
  if (!isDeepStrictEqual(value, event)) {
    throw new Error("bucket equity event must already be canonical");
  }
  const { bucketEquityEventId, bucketEquityEventHash, ...payload } = event;
  assertCanonicalEvidenceRefs(payload);
  assertBucketEquityEventPayload(payload);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    bucketEquityEventHash !== expectedHash ||
    bucketEquityEventId !== hashDerivedId("bucket_equity_event", expectedHash)
  ) {
    throw new Error("bucket equity event identity does not match its payload");
  }
  return deepFreeze(event);
}

export function createBucketRiskState(
  input: z.input<typeof bucketRiskStatePayloadSchema>
): BucketRiskState {
  const payload = bucketRiskStatePayloadSchema.parse(input);
  assertBucketRiskStatePayload(payload);
  return deepFreeze(
    bucketRiskStateSchema.parse({
      ...payload,
      riskStateHash: hashCanonicalPayload(payload)
    })
  );
}

export function parseBucketRiskState(value: unknown): BucketRiskState {
  const state = bucketRiskStateSchema.parse(value);
  if (!isDeepStrictEqual(value, state)) {
    throw new Error("bucket risk state must already be canonical");
  }
  const { riskStateHash, ...payload } = state;
  assertBucketRiskStatePayload(payload);
  if (riskStateHash !== hashCanonicalPayload(payload)) {
    throw new Error("bucket risk state hash does not match its payload");
  }
  return deepFreeze(state);
}

function assertBucketEquityEventPayload(
  payload: z.infer<typeof bucketEquityEventPayloadSchema>
): void {
  if (payload.eventType === "epoch_initialized") {
    const expectedEquity = payload.initialUnits * payload.initialUnitNavKrw;
    if (payload.initialEquityKrw !== expectedEquity) {
      throw new Error("initial bucket equity must equal units multiplied by unit NAV");
    }
    if (
      payload.initialHighWaterMarkUnitNavKrw < payload.initialUnitNavKrw
    ) {
      throw new Error("initial high-water mark cannot be below unit NAV");
    }
    if (
      payload.initializationMode === "initial_or_empty" &&
      (payload.initialUnitNavKrw !== 1 ||
        payload.initialHighWaterMarkUnitNavKrw !== 1)
    ) {
      throw new Error("initial or empty epoch must start at unit NAV one");
    }
    return;
  }
  if (payload.eventType === "capital_flow") {
    if (payload.amountKrw === 0) {
      throw new Error("bucket capital flow amount cannot be zero");
    }
    if (
      (payload.amountKrw > 0 && payload.fillAccountingSequence !== 0) ||
      (payload.amountKrw < 0 && payload.fillAccountingSequence !== 1)
    ) {
      throw new Error(
        "bucket capital flow sign does not match its accounting sequence"
      );
    }
  }
  if (payload.eventType === "strategy_transfer_out") {
    if (payload.amountKrw >= 0) {
      throw new Error("strategy transfer out amount must be negative");
    }
  } else if (
    payload.eventType === "strategy_transfer_in" &&
    payload.amountKrw <= 0
  ) {
    throw new Error("strategy transfer in amount must be positive");
  }
}

function assertBucketRiskStatePayload(
  state: z.infer<typeof bucketRiskStatePayloadSchema>
): void {
  if (state.highWaterMarkUnitNavKrw < state.unitNavKrw) {
    throw new Error("bucket risk high-water mark cannot be below unit NAV");
  }
  if (state.equityKrw !== state.units * state.unitNavKrw) {
    throw new Error("bucket risk equity must equal units multiplied by unit NAV");
  }
  const expectedDrawdown =
    1 - state.unitNavKrw / state.highWaterMarkUnitNavKrw;
  if (state.drawdownRatio !== expectedDrawdown) {
    throw new Error("bucket risk drawdown ratio does not match NAV and high-water mark");
  }
}

function canonicalizeEvidenceRefs(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.eventType === "valuation" ||
      candidate.eventType === "execution_cost") &&
    Array.isArray(candidate.evidenceRefs)
  ) {
    return {
      ...candidate,
      evidenceRefs: canonicalIdentifiers(candidate.evidenceRefs)
    };
  }
  return value;
}

function assertCanonicalEvidenceRefs(
  value: z.infer<typeof bucketEquityEventPayloadSchema>
): void {
  if (value.eventType !== "valuation" && value.eventType !== "execution_cost") {
    return;
  }
  const canonical = canonicalIdentifiers(value.evidenceRefs);
  if (!isDeepStrictEqual(value.evidenceRefs, canonical)) {
    throw new Error("bucket equity evidenceRefs must use canonical order");
  }
}

function canonicalIdentifiers(values: readonly unknown[]): string[] {
  const parsed = values.map((value) => identifierSchema.parse(value));
  const canonical = [...parsed].sort(compareText);
  if (new Set(canonical).size !== canonical.length) {
    throw new Error("bucket equity evidenceRefs must not contain duplicates");
  }
  return canonical;
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
