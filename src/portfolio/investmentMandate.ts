import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  marketSchema,
  sha256HashSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
import {
  bucketReviewCadenceSchema,
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema,
  parseBucketReviewCadence
} from "./runtimePolicyContracts.js";

const identifierSchema = z.string().trim().min(1).max(160);
const ratioSchema = z.number().finite().min(0).max(1);
const moneyKrwSchema = z.number().int().nonnegative();
const canonicalIdentifiersSchema = z.array(identifierSchema).min(1).max(128);

const manualNewPositionReservationSchema = z
  .object({
    manualCapacityReservationId: identifierSchema,
    manualCapacityReservationHash: sha256HashSchema,
    reservedMaximumNotionalKrw: moneyKrwSchema,
    reservationKind: z.literal("new_position"),
    reservedSlotOrdinal: z.number().int().nonnegative()
  })
  .strict();

const manualIncreaseReservationSchema = z
  .object({
    manualCapacityReservationId: identifierSchema,
    manualCapacityReservationHash: sha256HashSchema,
    reservedMaximumNotionalKrw: moneyKrwSchema,
    reservationKind: z.literal("increase_existing"),
    existingPositionRef: identifierSchema
  })
  .strict();

export const manualCapacityReservationLineageSchema = z.discriminatedUnion(
  "reservationKind",
  [manualNewPositionReservationSchema, manualIncreaseReservationSchema]
);

const mandateBasePayloadSchema = z
  .object({
    portfolioId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema,
    targetWeightRatio: ratioSchema,
    minWeightRatio: ratioSchema,
    maxWeightRatio: ratioSchema,
    maximumOpeningNotionalKrw: moneyKrwSchema,
    reasonCodes: canonicalIdentifiersSchema,
    evidenceRefs: canonicalIdentifiersSchema,
    evidenceAsOf: offsetQualifiedIsoDateTimeSchema,
    reviewCadence: bucketReviewCadenceSchema,
    validFrom: offsetQualifiedIsoDateTimeSchema,
    reviewAfter: offsetQualifiedIsoDateTimeSchema.optional(),
    expiresAt: offsetQualifiedIsoDateTimeSchema.optional()
  })
  .strict();

const manualOpenMandatePayloadSchema = mandateBasePayloadSchema
  .safeExtend({
    assignmentSource: z.literal("manual_policy"),
    manualAuthorizationScope: z.literal("open_or_increase"),
    manualAssignmentEventId: identifierSchema,
    capacityReservation: manualCapacityReservationLineageSchema
  })
  .strict();

const manualClassifyMandatePayloadSchema = mandateBasePayloadSchema
  .safeExtend({
    assignmentSource: z.literal("manual_policy"),
    manualAuthorizationScope: z.literal("classify_existing_reduce_only"),
    manualAssignmentEventId: identifierSchema
  })
  .strict();

const selectorMandatePayloadSchema = mandateBasePayloadSchema
  .safeExtend({
    assignmentSource: z.literal("deterministic_selector"),
    selectionRequestId: identifierSchema,
    candidateAssignmentId: identifierSchema,
    candidateAssignmentSetId: identifierSchema,
    candidateAssignmentSetHash: sha256HashSchema,
    selectedRank: z.number().int().positive(),
    openingCapacityReservationId: identifierSchema,
    openingCapacityReservationHash: sha256HashSchema,
    reservedSlotOrdinal: z.number().int().nonnegative(),
    reservedMaximumNotionalKrw: moneyKrwSchema,
    scoringModelVersion: identifierSchema,
    selectionScore: z.number().finite()
  })
  .strict();

export const investmentMandatePayloadSchema = z.union([
  manualOpenMandatePayloadSchema,
  manualClassifyMandatePayloadSchema,
  selectorMandatePayloadSchema
]);

export const investmentMandateRecordSchema = z.union([
  manualOpenMandatePayloadSchema.safeExtend({
    mandateId: identifierSchema,
    mandateHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  }),
  manualClassifyMandatePayloadSchema.safeExtend({
    mandateId: identifierSchema,
    mandateHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  }),
  selectorMandatePayloadSchema.safeExtend({
    mandateId: identifierSchema,
    mandateHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  })
]);

export type InvestmentMandateRecord = z.infer<
  typeof investmentMandateRecordSchema
>;

export function createInvestmentMandateRecord(
  input: z.input<typeof investmentMandatePayloadSchema> & { createdAt: string }
): InvestmentMandateRecord {
  const { createdAt, ...unparsedPayload } = input;
  const payload = investmentMandatePayloadSchema.parse({
    ...unparsedPayload,
    reasonCodes: canonicalIdentifiers(unparsedPayload.reasonCodes, "reasonCodes"),
    evidenceRefs: canonicalIdentifiers(unparsedPayload.evidenceRefs, "evidenceRefs")
  });
  parseBucketReviewCadence(payload.reviewCadence);
  assertWeightRange(payload);
  assertMandateAssignmentInvariants(payload);
  assertMandateChronology(payload, createdAt);
  const mandateHash = hashCanonicalPayload(payload);
  return deepFreeze(
    investmentMandateRecordSchema.parse({
      ...payload,
      mandateId: hashDerivedId("investment_mandate", mandateHash),
      mandateHash,
      createdAt: offsetQualifiedIsoDateTimeSchema.parse(createdAt)
    })
  );
}

export function parseInvestmentMandateRecord(
  value: unknown
): InvestmentMandateRecord {
  const record = investmentMandateRecordSchema.parse(value);
  assertAlreadyCanonical(value, record, "investment mandate record");
  const { mandateId, mandateHash, createdAt: _createdAt, ...payload } = record;
  assertCanonicalIdentifiers(payload.reasonCodes, "reasonCodes");
  assertCanonicalIdentifiers(payload.evidenceRefs, "evidenceRefs");
  parseBucketReviewCadence(payload.reviewCadence);
  assertWeightRange(payload);
  assertMandateAssignmentInvariants(payload);
  assertMandateChronology(payload, record.createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    mandateHash !== expectedHash ||
    mandateId !== hashDerivedId("investment_mandate", expectedHash)
  ) {
    throw new Error("investment mandate identity does not match its payload");
  }
  return deepFreeze(record);
}

const mandateEventBasePayloadSchema = z
  .object({
    mandateId: identifierSchema,
    mandateHash: sha256HashSchema,
    portfolioId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema,
    reasonCodes: canonicalIdentifiersSchema
  })
  .strict();

const mandateActivatedPayloadSchema = mandateEventBasePayloadSchema
  .safeExtend({
    eventType: z.literal("activated"),
    previousMandateEventId: identifierSchema.optional()
  })
  .strict();

const mandateReviewRequiredPayloadSchema = mandateEventBasePayloadSchema
  .safeExtend({
    eventType: z.literal("review_required"),
    previousMandateEventId: identifierSchema
  })
  .strict();

const mandateRetiredPayloadSchema = mandateEventBasePayloadSchema
  .safeExtend({
    eventType: z.literal("retired"),
    previousMandateEventId: identifierSchema,
    supersededByMandateId: identifierSchema.optional()
  })
  .strict();

export const investmentMandateEventPayloadSchema = z.discriminatedUnion(
  "eventType",
  [
    mandateActivatedPayloadSchema,
    mandateReviewRequiredPayloadSchema,
    mandateRetiredPayloadSchema
  ]
);

export const investmentMandateEventSchema = z.discriminatedUnion("eventType", [
  mandateActivatedPayloadSchema.safeExtend({
    mandateEventId: identifierSchema,
    mandateEventHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  }),
  mandateReviewRequiredPayloadSchema.safeExtend({
    mandateEventId: identifierSchema,
    mandateEventHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  }),
  mandateRetiredPayloadSchema.safeExtend({
    mandateEventId: identifierSchema,
    mandateEventHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  })
]);

export type InvestmentMandateEvent = z.infer<
  typeof investmentMandateEventSchema
>;

export function createInvestmentMandateEvent(
  input: z.input<typeof investmentMandateEventPayloadSchema> & {
    createdAt: string;
  }
): InvestmentMandateEvent {
  const { createdAt, ...unparsedPayload } = input;
  const payload = investmentMandateEventPayloadSchema.parse({
    ...unparsedPayload,
    reasonCodes: canonicalIdentifiers(unparsedPayload.reasonCodes, "reasonCodes")
  });
  assertNotAfter(payload.asOf, createdAt, "mandate event asOf");
  const mandateEventHash = hashCanonicalPayload(payload);
  return deepFreeze(
    investmentMandateEventSchema.parse({
      ...payload,
      mandateEventId: hashDerivedId(
        "investment_mandate_event",
        mandateEventHash
      ),
      mandateEventHash,
      createdAt: offsetQualifiedIsoDateTimeSchema.parse(createdAt)
    })
  );
}

export function parseInvestmentMandateEvent(
  value: unknown
): InvestmentMandateEvent {
  const event = investmentMandateEventSchema.parse(value);
  assertAlreadyCanonical(value, event, "investment mandate event");
  const {
    mandateEventId,
    mandateEventHash,
    createdAt,
    ...payload
  } = event;
  assertCanonicalIdentifiers(payload.reasonCodes, "reasonCodes");
  assertNotAfter(payload.asOf, createdAt, "mandate event asOf");
  const expectedHash = hashCanonicalPayload(payload);
  if (
    mandateEventHash !== expectedHash ||
    mandateEventId !==
      hashDerivedId("investment_mandate_event", expectedHash)
  ) {
    throw new Error("investment mandate event identity does not match its payload");
  }
  return deepFreeze(event);
}

const manualAssignmentBasePayloadSchema = z
  .object({
    portfolioId: identifierSchema,
    policyHash: sha256HashSchema,
    market: marketSchema,
    symbol: identifierSchema,
    bucket: strategyBucketSchema,
    asOf: offsetQualifiedIsoDateTimeSchema,
    selectionPolicyRecordId: identifierSchema,
    selectionPolicyHash: sha256HashSchema,
    reasonCodes: canonicalIdentifiersSchema,
    evidenceRefs: canonicalIdentifiersSchema,
    evidenceAsOf: offsetQualifiedIsoDateTimeSchema,
    evidenceValidationHash: sha256HashSchema,
    authorizationRef: identifierSchema
  })
  .strict();

const manualOpenAssignmentPayloadSchema = manualAssignmentBasePayloadSchema
  .safeExtend({
    authorizationScope: z.literal("open_or_increase"),
    evidenceEligibility: z.literal("eligible"),
    portfolioSnapshotId: identifierSchema,
    portfolioSnapshotHash: sha256HashSchema,
    sizingInputRecordId: identifierSchema,
    minWeightRatio: ratioSchema,
    targetWeightRatio: ratioSchema,
    maxWeightRatio: ratioSchema,
    maximumNotionalKrw: moneyKrwSchema,
    sizingInputHash: sha256HashSchema,
    sizingOutputHash: sha256HashSchema
  })
  .strict();

const manualClassifyAssignmentPayloadSchema = manualAssignmentBasePayloadSchema
  .safeExtend({
    authorizationScope: z.literal("classify_existing_reduce_only"),
    evidenceEligibility: z.enum(["eligible", "blocked"]),
    classificationMinWeightRatio: ratioSchema,
    classificationTargetWeightRatio: ratioSchema,
    classificationMaxWeightRatio: ratioSchema
  })
  .strict();

export const manualAssignmentEventPayloadSchema = z.discriminatedUnion(
  "authorizationScope",
  [manualOpenAssignmentPayloadSchema, manualClassifyAssignmentPayloadSchema]
);

export const manualAssignmentEventSchema = z.discriminatedUnion(
  "authorizationScope",
  [
    manualOpenAssignmentPayloadSchema.safeExtend({
      manualAssignmentEventId: identifierSchema,
      manualAssignmentEventHash: sha256HashSchema,
      createdAt: offsetQualifiedIsoDateTimeSchema
    }),
    manualClassifyAssignmentPayloadSchema.safeExtend({
      manualAssignmentEventId: identifierSchema,
      manualAssignmentEventHash: sha256HashSchema,
      createdAt: offsetQualifiedIsoDateTimeSchema
    })
  ]
);

export type ManualAssignmentEvent = z.infer<typeof manualAssignmentEventSchema>;

export function createManualAssignmentEvent(
  input: z.input<typeof manualAssignmentEventPayloadSchema> & {
    createdAt: string;
  }
): ManualAssignmentEvent {
  const { createdAt, ...unparsedPayload } = input;
  const payload = manualAssignmentEventPayloadSchema.parse({
    ...unparsedPayload,
    reasonCodes: canonicalIdentifiers(unparsedPayload.reasonCodes, "reasonCodes"),
    evidenceRefs: canonicalIdentifiers(unparsedPayload.evidenceRefs, "evidenceRefs")
  });
  assertManualAssignmentPayload(payload, createdAt);
  const manualAssignmentEventHash = hashCanonicalPayload(payload);
  return deepFreeze(
    manualAssignmentEventSchema.parse({
      ...payload,
      manualAssignmentEventId: hashDerivedId(
        "manual_assignment_event",
        manualAssignmentEventHash
      ),
      manualAssignmentEventHash,
      createdAt: offsetQualifiedIsoDateTimeSchema.parse(createdAt)
    })
  );
}

export function parseManualAssignmentEvent(value: unknown): ManualAssignmentEvent {
  const event = manualAssignmentEventSchema.parse(value);
  assertAlreadyCanonical(value, event, "manual assignment event");
  const {
    manualAssignmentEventId,
    manualAssignmentEventHash,
    createdAt,
    ...payload
  } = event;
  assertCanonicalIdentifiers(payload.reasonCodes, "reasonCodes");
  assertCanonicalIdentifiers(payload.evidenceRefs, "evidenceRefs");
  assertManualAssignmentPayload(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    manualAssignmentEventHash !== expectedHash ||
    manualAssignmentEventId !==
      hashDerivedId("manual_assignment_event", expectedHash)
  ) {
    throw new Error("manual assignment event identity does not match its payload");
  }
  return deepFreeze(event);
}

function assertManualAssignmentPayload(
  payload: z.infer<typeof manualAssignmentEventPayloadSchema>,
  createdAt: string
): void {
  assertNotAfter(payload.evidenceAsOf, payload.asOf, "manual evidenceAsOf");
  assertNotAfter(payload.asOf, createdAt, "manual assignment asOf");
  if (payload.authorizationScope === "open_or_increase") {
    assertWeightRange(payload);
    return;
  }
  assertWeightRange({
    minWeightRatio: payload.classificationMinWeightRatio,
    targetWeightRatio: payload.classificationTargetWeightRatio,
    maxWeightRatio: payload.classificationMaxWeightRatio
  });
}

function assertWeightRange(value: {
  minWeightRatio: number;
  targetWeightRatio: number;
  maxWeightRatio: number;
}): void {
  if (
    value.minWeightRatio > value.targetWeightRatio ||
    value.targetWeightRatio > value.maxWeightRatio
  ) {
    throw new Error("investment mandate weight range must satisfy min <= target <= max");
  }
}

function assertMandateAssignmentInvariants(
  value: z.infer<typeof investmentMandatePayloadSchema>
): void {
  if (
    value.assignmentSource === "manual_policy" &&
    value.manualAuthorizationScope === "classify_existing_reduce_only"
  ) {
    if (value.maximumOpeningNotionalKrw !== 0) {
      throw new Error("reduce-only mandate opening cap must be zero");
    }
    return;
  }
  const reservedMaximumNotionalKrw =
    value.assignmentSource === "deterministic_selector"
      ? value.reservedMaximumNotionalKrw
      : value.capacityReservation.reservedMaximumNotionalKrw;
  if (
    value.maximumOpeningNotionalKrw <= 0 ||
    reservedMaximumNotionalKrw <= 0
  ) {
    throw new Error("opening mandate cap and reservation must be positive");
  }
  if (reservedMaximumNotionalKrw !== value.maximumOpeningNotionalKrw) {
    throw new Error("mandate opening cap must match its capacity reservation");
  }
}

function assertMandateChronology(
  value: {
    evidenceAsOf: string;
    asOf: string;
    validFrom: string;
    reviewCadence: z.infer<typeof bucketReviewCadenceSchema>;
    reviewAfter?: string | undefined;
    expiresAt?: string | undefined;
  },
  createdAt: string
): void {
  assertNotAfter(value.evidenceAsOf, value.asOf, "mandate evidenceAsOf");
  assertNotAfter(value.asOf, createdAt, "mandate asOf");
  assertNotAfter(value.asOf, value.validFrom, "mandate validFrom");
  if (
    value.reviewCadence.mode === "scheduled" &&
    value.reviewAfter === undefined
  ) {
    throw new Error("scheduled mandate requires reviewAfter");
  }
  if (
    value.reviewCadence.mode === "every_tick" &&
    value.reviewAfter !== undefined
  ) {
    throw new Error("every_tick mandate must omit reviewAfter");
  }
  if (value.reviewAfter !== undefined) {
    assertNotAfter(value.validFrom, value.reviewAfter, "mandate reviewAfter");
  }
  if (value.expiresAt !== undefined) {
    assertNotAfter(value.validFrom, value.expiresAt, "mandate expiresAt");
  }
}

function assertNotAfter(left: string, right: string, label: string): void {
  const leftTime = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(left));
  const rightTime = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(right));
  if (leftTime > rightTime) {
    throw new Error(`${label} must not be after its boundary`);
  }
}

function canonicalIdentifiers(
  values: readonly string[],
  label: string
): string[] {
  const parsed = canonicalIdentifiersSchema.parse(values);
  const canonical = [...parsed].sort(compareText);
  if (new Set(canonical).size !== canonical.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return canonical;
}

function assertCanonicalIdentifiers(
  values: readonly string[],
  label: string
): void {
  const canonical = [...values].sort(compareText);
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error(`${label} must use canonical order`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
}

function assertAlreadyCanonical(
  original: unknown,
  parsed: unknown,
  label: string
): void {
  if (!isDeepStrictEqual(original, parsed)) {
    throw new Error(`${label} must already be canonical`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
