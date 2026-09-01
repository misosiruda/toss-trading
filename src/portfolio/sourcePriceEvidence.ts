import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  marketSchema,
  sha256HashSchema
} from "../domain/schemas.js";
import {
  compareText,
  hashCanonicalPayload,
  hashDerivedId,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";

const identifierSchema = z.string().trim().min(1).max(160);
const positivePriceSchema = z
  .number()
  .finite()
  .positive()
  .refine((value) => !Object.is(value, -0), "price must not be negative zero");
const sourceRefsSchema = z.array(identifierSchema).min(1).max(128);

export const sourcePriceEvidencePayloadSchema = z
  .object({
    sourceContractId: identifierSchema,
    market: marketSchema,
    symbol: identifierSchema,
    priceField: z.literal("last_price"),
    priceKrw: positivePriceSchema,
    observedAt: offsetQualifiedIsoDateTimeSchema,
    sourceRefs: sourceRefsSchema
  })
  .strict();

const sourcePriceEvidenceInputSchema =
  sourcePriceEvidencePayloadSchema.safeExtend({
    createdAt: offsetQualifiedIsoDateTimeSchema
  });

export const sourcePriceEvidenceRecordSchema =
  sourcePriceEvidencePayloadSchema.safeExtend({
    evidenceRef: identifierSchema,
    evidenceHash: sha256HashSchema,
    createdAt: offsetQualifiedIsoDateTimeSchema
  });

export type SourcePriceEvidenceRecord = z.infer<
  typeof sourcePriceEvidenceRecordSchema
>;

export function createSourcePriceEvidenceRecord(
  input: z.input<typeof sourcePriceEvidenceInputSchema>
): SourcePriceEvidenceRecord {
  const parsed = sourcePriceEvidenceInputSchema.parse(
    canonicalizeSourceRefs(input)
  );
  const { createdAt, ...payload } = parsed;
  assertPayload(payload);
  assertCreatedAt(payload.observedAt, createdAt);
  const evidenceHash = hashCanonicalPayload(payload);
  return deepFreeze(
    sourcePriceEvidenceRecordSchema.parse({
      ...payload,
      evidenceRef: hashDerivedId("source_price_evidence", evidenceHash),
      evidenceHash,
      createdAt
    })
  );
}

export function parseSourcePriceEvidenceRecord(
  value: unknown
): SourcePriceEvidenceRecord {
  const record = sourcePriceEvidenceRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) {
    throw new Error("source price evidence record must already be canonical");
  }
  const { evidenceRef, evidenceHash, createdAt, ...payload } = record;
  assertPayload(payload);
  assertCreatedAt(payload.observedAt, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    evidenceHash !== expectedHash ||
    evidenceRef !== hashDerivedId("source_price_evidence", expectedHash)
  ) {
    throw new Error("source price evidence identity does not match its payload");
  }
  return deepFreeze(record);
}

function canonicalizeSourceRefs(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.sourceRefs)) {
    return value;
  }
  const sourceRefs = sourceRefsSchema.parse(candidate.sourceRefs);
  assertUniqueSourceRefs(sourceRefs);
  return {
    ...candidate,
    sourceRefs: [...sourceRefs].sort(compareText)
  };
}

function assertPayload(
  payload: z.infer<typeof sourcePriceEvidencePayloadSchema>
): void {
  const canonical = [...payload.sourceRefs].sort(compareText);
  assertUniqueSourceRefs(canonical);
  if (!isDeepStrictEqual(payload.sourceRefs, canonical)) {
    throw new Error("source price evidence refs must use canonical order");
  }
}

function assertUniqueSourceRefs(values: readonly string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) {
      throw new Error("source price evidence refs must not contain duplicates");
    }
  }
}

function assertCreatedAt(observedAt: string, createdAt: string): void {
  if (Date.parse(createdAt) < Date.parse(observedAt)) {
    throw new Error("source price evidence cannot be created before observation");
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
