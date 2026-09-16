import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifierSchema = z.string().min(1).max(160).refine((value) => value === value.trim(), "identifier must already be canonical")
  .refine((value) => [...value].every((character) => {
    const point = character.codePointAt(0)!;
    return point < 0xd800 || point > 0xdfff;
  }), "identifier must use well-formed Unicode");
const sourceRefsSchema = z.array(identifierSchema).min(1).max(128);

/** Declared conversion evidence only: no provider trust, freshness or durable origin is established here. */
export const sourceFxEvidencePayloadSchema = z.object({
  schemaVersion: z.literal("source_fx_evidence.v1"),
  sourceContractId: identifierSchema,
  baseCurrency: z.literal("USD"),
  quoteCurrency: z.literal("KRW"),
  rate: z.number().finite().positive(),
  observedAt: offsetQualifiedIsoDateTimeSchema,
  sourceRefs: sourceRefsSchema
}).strict();

const inputSchema = sourceFxEvidencePayloadSchema.extend({ createdAt: offsetQualifiedIsoDateTimeSchema }).strict();
export const sourceFxEvidenceRecordSchema = inputSchema.extend({
  evidenceRef: identifierSchema, evidenceHash: sha256HashSchema
}).strict();
export type SourceFxEvidenceRecord = z.infer<typeof sourceFxEvidenceRecordSchema>;

/** Sorts provenance references; all other fields must already be canonical.
 * createdAt is ingestion metadata excluded from semantic identity, never a durable availability timestamp.
 */
export function createSourceFxEvidenceRecord(value: z.input<typeof inputSchema>): SourceFxEvidenceRecord {
  const input = inputSchema.parse(value);
  const { createdAt, ...payload } = { ...input, sourceRefs: [...input.sourceRefs].sort(compareText) };
  assertPayload(payload, createdAt);
  const evidenceHash = hashCanonicalPayload(payload);
  return freeze({ ...payload, evidenceRef: hashDerivedId("source_fx_evidence", evidenceHash), evidenceHash, createdAt });
}

/** Rehashes the complete semantic payload independently; it does not repair stored records. */
export function parseSourceFxEvidenceRecord(value: unknown): SourceFxEvidenceRecord {
  const record = sourceFxEvidenceRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) throw new Error("source FX evidence record must already be canonical");
  const { evidenceRef, evidenceHash, createdAt, ...payload } = record;
  assertPayload(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (evidenceHash !== expectedHash || evidenceRef !== hashDerivedId("source_fx_evidence", expectedHash)) {
    throw new Error("source FX evidence identity does not match its payload");
  }
  return freeze(record);
}

function assertPayload(payload: z.infer<typeof sourceFxEvidencePayloadSchema>, createdAt: string) {
  if (new Set(payload.sourceRefs).size !== payload.sourceRefs.length) throw new Error("source FX evidence refs must not contain duplicates");
  if (!isDeepStrictEqual(payload.sourceRefs, [...payload.sourceRefs].sort(compareText))) throw new Error("source FX evidence refs must use canonical order");
  if (Date.parse(createdAt) < Date.parse(payload.observedAt)) throw new Error("source FX evidence cannot be created before observation");
}

function freeze(record: SourceFxEvidenceRecord): SourceFxEvidenceRecord {
  Object.freeze(record.sourceRefs);
  return Object.freeze(record);
}
