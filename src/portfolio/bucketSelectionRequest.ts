import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  sha256HashSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
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
  )
  .refine(
    (value) => !containsLoneSurrogate(value),
    "identifier must use well-formed Unicode"
  );
const positiveAmountSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "amount must be a safe integer");
const positiveCountSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, "count must be a safe integer");

const bucketSelectionRequestPayloadSchema = z
  .object({
    cycleId: identifierSchema,
    triggerIdentity: identifierSchema,
    triggerRef: identifierSchema,
    portfolioId: identifierSchema,
    portfolioSnapshotId: identifierSchema,
    portfolioSnapshotHash: sha256HashSchema,
    policyHash: sha256HashSchema,
    asOf: offsetQualifiedIsoDateTimeSchema,
    bucket: strategyBucketSchema,
    gapBasis: z.enum(["min", "entry_floor"]),
    gapKrw: positiveAmountSchema,
    availableSlots: positiveCountSchema,
    maximumAdditionalExposureKrw: positiveAmountSchema,
    evidenceCutoffAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export const bucketSelectionRequestSchema = z
  .object({
    requestId: identifierSchema,
    requestHash: sha256HashSchema,
    ...bucketSelectionRequestPayloadSchema.shape,
    createdAt: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

export type BucketSelectionRequest = z.infer<
  typeof bucketSelectionRequestSchema
>;
export type CreateBucketSelectionRequestInput = z.input<
  typeof bucketSelectionRequestPayloadSchema
> & { createdAt: string };

export function createBucketSelectionRequest(
  input: CreateBucketSelectionRequestInput
): BucketSelectionRequest {
  const { createdAt, ...rawPayload } = input;
  const payload = bucketSelectionRequestPayloadSchema.parse(rawPayload);
  assertRequestSemantics(payload, createdAt);
  const requestHash = hashCanonicalPayload(payload);
  return deepFreeze(
    bucketSelectionRequestSchema.parse({
      requestId: hashDerivedId("bucket_selection_request", requestHash),
      requestHash,
      ...payload,
      createdAt
    })
  );
}

export function parseBucketSelectionRequest(
  value: unknown
): BucketSelectionRequest {
  const request = bucketSelectionRequestSchema.parse(value);
  if (!isDeepStrictEqual(value, request)) {
    throw new Error("bucket selection request must already be canonical");
  }
  const { requestId, requestHash, createdAt, ...payload } = request;
  assertRequestSemantics(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    requestHash !== expectedHash ||
    requestId !== hashDerivedId("bucket_selection_request", expectedHash)
  ) {
    throw new Error("bucket selection request identity does not match payload");
  }
  return deepFreeze(request);
}

function assertRequestSemantics(
  payload: z.infer<typeof bucketSelectionRequestPayloadSchema>,
  createdAt: string
): void {
  offsetQualifiedIsoDateTimeSchema.parse(createdAt);
  if (payload.maximumAdditionalExposureKrw > payload.gapKrw) {
    throw new Error("selection request additional exposure exceeds gap");
  }
  if (Date.parse(payload.evidenceCutoffAt) > Date.parse(payload.asOf)) {
    throw new Error("selection request evidence cutoff is after asOf");
  }
  if (Date.parse(payload.asOf) > Date.parse(createdAt)) {
    throw new Error("selection request cannot be created before asOf");
  }
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode >= 0xd800 && charCode <= 0xdbff) {
      const nextCharCode = value.charCodeAt(index + 1);
      if (nextCharCode >= 0xdc00 && nextCharCode <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (charCode >= 0xdc00 && charCode <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
