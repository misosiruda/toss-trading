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

const identifierSchema = z.string().trim().min(1).max(160);
const positiveNumberSchema = z.number().finite().positive();
const signedAmountSchema = z
  .number()
  .finite()
  .refine((value) => !Object.is(value, -0), "number must not be negative zero");
const FLOATING_POINT_TOLERANCE_FACTOR = 8;
const MAX_POSITION_INPUTS = 10_000;

export const bucketValuationPositionInputSchema = z
  .object({
    market: marketSchema,
    symbol: identifierSchema,
    quantity: positiveNumberSchema,
    previousPositionMarkHeadId: identifierSchema,
    previousPositionMarkHeadHash: sha256HashSchema,
    previousPriceKrw: positiveNumberSchema,
    currentPriceKrw: positiveNumberSchema,
    previousPriceEvidenceRef: identifierSchema,
    currentPriceEvidenceRef: identifierSchema
  })
  .strict();

export const bucketValuationMarkPayloadSchema = z
  .object({
    portfolioId: identifierSchema,
    bucket: strategyBucketSchema,
    policyHash: sha256HashSchema,
    positionInputs: z
      .array(bucketValuationPositionInputSchema)
      .min(1)
      .max(MAX_POSITION_INPUTS),
    equityDeltaKrw: signedAmountSchema,
    asOf: offsetQualifiedIsoDateTimeSchema
  })
  .strict();

const bucketValuationMarkInputSchema =
  bucketValuationMarkPayloadSchema.safeExtend({
    createdAt: offsetQualifiedIsoDateTimeSchema
  });

export const bucketValuationMarkRecordSchema =
  bucketValuationMarkPayloadSchema.safeExtend({
    bucketValuationMarkRecordId: identifierSchema,
    valuationMarkHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  });

export type BucketValuationPositionInput = z.infer<
  typeof bucketValuationPositionInputSchema
>;
export type BucketValuationMarkRecord = z.infer<
  typeof bucketValuationMarkRecordSchema
>;

export function createBucketValuationMarkRecord(
  input: z.input<typeof bucketValuationMarkInputSchema>
): BucketValuationMarkRecord {
  const parsed = bucketValuationMarkInputSchema.parse(
    canonicalizePositionInputs(input)
  );
  const { createdAt, ...payload } = parsed;
  assertValuationMarkPayload(payload);
  assertCreatedAt(payload.asOf, createdAt);
  const valuationMarkHash = hashCanonicalPayload(payload);
  return deepFreeze(
    bucketValuationMarkRecordSchema.parse({
      ...payload,
      bucketValuationMarkRecordId: hashDerivedId(
        "bucket_valuation_mark",
        valuationMarkHash
      ),
      valuationMarkHash,
      createdAt
    })
  );
}

export function parseBucketValuationMarkRecord(
  value: unknown
): BucketValuationMarkRecord {
  const record = bucketValuationMarkRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) {
    throw new Error("bucket valuation mark record must already be canonical");
  }
  const {
    bucketValuationMarkRecordId,
    valuationMarkHash,
    createdAt,
    ...payload
  } = record;
  assertValuationMarkPayload(payload);
  assertCreatedAt(payload.asOf, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    valuationMarkHash !== expectedHash ||
    bucketValuationMarkRecordId !==
      hashDerivedId("bucket_valuation_mark", expectedHash)
  ) {
    throw new Error("bucket valuation mark identity does not match its payload");
  }
  return deepFreeze(record);
}

function canonicalizePositionInputs(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.positionInputs)) {
    return value;
  }
  if (
    candidate.positionInputs.length === 0 ||
    candidate.positionInputs.length > MAX_POSITION_INPUTS
  ) {
    throw new Error(
      `bucket valuation position inputs must contain between 1 and ${MAX_POSITION_INPUTS} entries`
    );
  }
  const positionInputs = candidate.positionInputs
    .map((position) => bucketValuationPositionInputSchema.parse(position))
    .sort(comparePositionInputs);
  assertUniquePositionInputs(positionInputs);
  return { ...candidate, positionInputs };
}

function assertValuationMarkPayload(
  payload: z.infer<typeof bucketValuationMarkPayloadSchema>
): void {
  const canonical = [...payload.positionInputs].sort(comparePositionInputs);
  assertUniquePositionInputs(canonical);
  if (!isDeepStrictEqual(payload.positionInputs, canonical)) {
    throw new Error(
      "bucket valuation position inputs must use canonical market and symbol order"
    );
  }
  let expectedDeltaKrw = 0;
  for (const position of payload.positionInputs) {
    const contribution =
      position.quantity *
      (position.currentPriceKrw - position.previousPriceKrw);
    expectedDeltaKrw += contribution;
    if (!Number.isFinite(contribution) || !Number.isFinite(expectedDeltaKrw)) {
      throw new Error("bucket valuation delta calculation must remain finite");
    }
  }
  if (!isValidFloatingPointResult(payload.equityDeltaKrw, expectedDeltaKrw)) {
    throw new Error(
      "bucket valuation equity delta does not match its position inputs"
    );
  }
}

function assertCreatedAt(asOf: string, createdAt: string): void {
  if (Date.parse(createdAt) < Date.parse(asOf)) {
    throw new Error("bucket valuation mark cannot be created before its asOf");
  }
}

function assertUniquePositionInputs(
  positions: readonly BucketValuationPositionInput[]
): void {
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1] as BucketValuationPositionInput;
    const current = positions[index] as BucketValuationPositionInput;
    if (previous.market === current.market && previous.symbol === current.symbol) {
      throw new Error(
        "bucket valuation position inputs must not contain duplicate instruments"
      );
    }
  }
}

function comparePositionInputs(
  left: BucketValuationPositionInput,
  right: BucketValuationPositionInput
): number {
  return (
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol)
  );
}

function isValidFloatingPointResult(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }
  const scale = Math.max(Math.abs(actual), Math.abs(expected), 1);
  return (
    Math.abs(actual - expected) <=
    Number.EPSILON * scale * FLOATING_POINT_TOLERANCE_FACTOR
  );
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
