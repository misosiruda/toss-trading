import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const identifier = z.string().min(1).max(240).refine((v) => v === v.trim(), "identifier must already be canonical");
const metric = z.object({
  name: identifier,
  value: z.number().finite(),
  unit: identifier,
  periodEnd: offsetQualifiedIsoDateTimeSchema,
}).strict();
const payloadSchema = z.object({
  sourceContractId: z.literal("credential-free-fundamental.v1"),
  issuerId: identifier,
  symbol: identifier,
  fiscalPeriod: identifier,
  observedAt: offsetQualifiedIsoDateTimeSchema,
  sourceUri: z.string().url().max(2048),
  sourceDocumentHash: sha256HashSchema,
  metrics: z.array(metric).min(1).max(256),
  quality: z.enum(["reported", "derived", "unavailable"]),
}).strict();
const recordSchema = payloadSchema.extend({
  evidenceRef: identifier,
  evidenceHash: sha256HashSchema,
  createdAt: offsetQualifiedIsoDateTimeSchema,
}).strict();
export type FundamentalEvidencePayload = z.infer<typeof payloadSchema>;
export type FundamentalEvidenceRecord = z.infer<typeof recordSchema>;

/** Credential-free, read-only provenance envelope. It never fetches or certifies an external provider. */
export function createFundamentalEvidenceRecord(value: FundamentalEvidencePayload & { createdAt: string }): FundamentalEvidenceRecord {
  const { createdAt, ...raw } = value;
  const payload = payloadSchema.parse(raw);
  assertSemantics(payload, createdAt);
  const evidenceHash = hashCanonicalPayload(payload);
  return deepFreeze(recordSchema.parse({ ...payload, evidenceRef: hashDerivedId("fundamental_evidence", evidenceHash), evidenceHash, createdAt }));
}

export function parseFundamentalEvidenceRecord(value: unknown): FundamentalEvidenceRecord {
  const record = recordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) throw new Error("fundamental evidence record must already be canonical");
  const { evidenceRef, evidenceHash, createdAt, ...payload } = record;
  assertSemantics(payload, createdAt);
  const expected = hashCanonicalPayload(payload);
  if (expected !== evidenceHash || evidenceRef !== hashDerivedId("fundamental_evidence", expected)) throw new Error("fundamental evidence identity mismatch");
  return deepFreeze(record);
}

function assertSemantics(payload: FundamentalEvidencePayload, createdAt: string): void {
  offsetQualifiedIsoDateTimeSchema.parse(createdAt);
  if (Date.parse(payload.observedAt) > Date.parse(createdAt)) throw new Error("fundamental evidence cannot be created before observation");
  const keys = new Set<string>();
  for (const row of payload.metrics) {
    const key = `${row.name}\u0000${row.periodEnd}`;
    if (keys.has(key)) throw new Error("fundamental evidence contains duplicate metrics");
    keys.add(key);
  }
  if (payload.quality === "unavailable") throw new Error("unavailable fundamental evidence cannot be persisted as evidence");
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as object)) deepFreeze(child); Object.freeze(value); }
  return value;
}
