import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { marketSchema, sha256HashSchema } from "../domain/schemas.js";
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

const thesisStatusSchema = z.enum([
  "intact",
  "watch",
  "invalidated",
  "unknown"
]);

const sourceArtifactShape = {
  sourceContractId: identifierSchema,
  sourceArtifactId: identifierSchema,
  sourceArtifactHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
};

const basePayloadShape = {
  portfolioId: identifierSchema,
  policyHash: sha256HashSchema,
  market: marketSchema,
  ...sourceArtifactShape
};

const regimeChangeEvidencePayloadSchema = z
  .object({
    ...basePayloadShape,
    evidenceType: z.literal("regime_change"),
    previousRegime: identifierSchema,
    currentRegime: identifierSchema
  })
  .strict();

const thesisEvidenceChangePayloadSchema = z
  .object({
    ...basePayloadShape,
    evidenceType: z.literal("thesis_evidence_change"),
    mandateId: identifierSchema,
    symbol: identifierSchema,
    previousThesisStatus: thesisStatusSchema,
    currentThesisStatus: thesisStatusSchema
  })
  .strict();

const portfolioPolicyTriggerEvidencePayloadSchema = z.discriminatedUnion(
  "evidenceType",
  [regimeChangeEvidencePayloadSchema, thesisEvidenceChangePayloadSchema]
);

const recordIdentityShape = {
  evidenceRef: identifierSchema,
  evidenceHash: sha256HashSchema,
  createdAt: offsetQualifiedIsoDateTimeSchema
};

export const portfolioPolicyTriggerEvidenceRecordSchema =
  z.discriminatedUnion("evidenceType", [
    regimeChangeEvidencePayloadSchema.extend(recordIdentityShape).strict(),
    thesisEvidenceChangePayloadSchema.extend(recordIdentityShape).strict()
  ]);

export type PortfolioPolicyTriggerEvidenceRecord = z.infer<
  typeof portfolioPolicyTriggerEvidenceRecordSchema
>;
export type CreatePortfolioPolicyTriggerEvidenceRecordInput = z.input<
  typeof portfolioPolicyTriggerEvidencePayloadSchema
> & { createdAt: string };

/**
 * Creates a typed immutable provenance envelope for one policy-event source.
 *
 * The upstream artifact stays read-only and is bound by its declared contract,
 * exact ID and hash. Contract-specific source validation happens before this
 * envelope is persisted; downstream policy-event replay can then rehash and
 * scope-check the stored envelope without trusting a raw evidence reference.
 */
export function createPortfolioPolicyTriggerEvidenceRecord(
  input: CreatePortfolioPolicyTriggerEvidenceRecordInput
): PortfolioPolicyTriggerEvidenceRecord {
  const { createdAt, ...rawPayload } = input;
  const payload = portfolioPolicyTriggerEvidencePayloadSchema.parse(rawPayload);
  assertEvidenceSemantics(payload, createdAt);
  const evidenceHash = hashCanonicalPayload(payload);
  return deepFreeze(
    portfolioPolicyTriggerEvidenceRecordSchema.parse({
      evidenceRef: hashDerivedId(
        "portfolio_policy_trigger_evidence",
        evidenceHash
      ),
      evidenceHash,
      ...payload,
      createdAt
    })
  );
}

export function parsePortfolioPolicyTriggerEvidenceRecord(
  value: unknown
): PortfolioPolicyTriggerEvidenceRecord {
  const record = portfolioPolicyTriggerEvidenceRecordSchema.parse(value);
  if (!isDeepStrictEqual(value, record)) {
    throw new Error(
      "portfolio policy trigger evidence must already be canonical"
    );
  }
  const { evidenceRef, evidenceHash, createdAt, ...payload } = record;
  assertEvidenceSemantics(payload, createdAt);
  const expectedHash = hashCanonicalPayload(payload);
  if (
    evidenceHash !== expectedHash ||
    evidenceRef !==
      hashDerivedId("portfolio_policy_trigger_evidence", expectedHash)
  ) {
    throw new Error(
      "portfolio policy trigger evidence identity does not match payload"
    );
  }
  return deepFreeze(record);
}

function assertEvidenceSemantics(
  payload: z.infer<typeof portfolioPolicyTriggerEvidencePayloadSchema>,
  createdAt: string
): void {
  offsetQualifiedIsoDateTimeSchema.parse(createdAt);
  if (Date.parse(payload.observedAt) > Date.parse(createdAt)) {
    throw new Error(
      "portfolio policy trigger evidence cannot be created before observation"
    );
  }
  if (
    payload.evidenceType === "regime_change" &&
    payload.previousRegime === payload.currentRegime
  ) {
    throw new Error(
      "regime change evidence requires distinct regime values"
    );
  }
  if (
    payload.evidenceType === "thesis_evidence_change" &&
    payload.previousThesisStatus === payload.currentThesisStatus
  ) {
    throw new Error(
      "thesis change evidence requires distinct thesis statuses"
    );
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
