import { createHash } from "node:crypto";

import { z } from "zod";

import {
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import { verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary } from "./officialMarketCalendarAcquisitionFreshnessPolicyBoundary.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_ENVELOPE_SCHEMA_VERSION =
  "official_market_calendar_source_document_envelope.v1";

const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const contentLengthSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const acquisitionBoundarySchema = z.record(z.string(), z.unknown());

const createSourceDocumentEnvelopeInputSchema = z
  .object({
    documentId: identifierSchema,
    sourceBytes: z.instanceof(Uint8Array),
    acquisitionBoundary: acquisitionBoundarySchema
  })
  .strict();

const sourceDocumentEnvelopePayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_ENVELOPE_SCHEMA_VERSION
    ),
    documentId: identifierSchema,
    exchange: z.enum(["KRX", "NYSE"]),
    contentLength: contentLengthSchema,
    sourceDocumentHash: sha256HashSchema,
    acquisitionBoundary: acquisitionBoundarySchema
  })
  .strict();

export const officialMarketCalendarSourceDocumentEnvelopeSchema =
  sourceDocumentEnvelopePayloadSchema
    .safeExtend({ envelopeHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceDocumentEnvelope = z.infer<
  typeof officialMarketCalendarSourceDocumentEnvelopeSchema
>;

export type OfficialMarketCalendarSourceDocumentEnvelopePayload = z.infer<
  typeof sourceDocumentEnvelopePayloadSchema
>;

export function createOfficialMarketCalendarSourceDocumentEnvelope(
  input: unknown,
  freshnessPolicyRegistry: unknown
): OfficialMarketCalendarSourceDocumentEnvelope {
  const parsed = createSourceDocumentEnvelopeInputSchema.parse(input);
  const acquisitionBoundary = structuredClone(parsed.acquisitionBoundary);
  const verified =
    verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
      acquisitionBoundary,
      freshnessPolicyRegistry
    );
  const contentLength = parsed.sourceBytes.byteLength;
  if (
    contentLength !==
    verified.redirectChainBoundary.finalResponseBoundary.transferCompletion
      .contentLength
  ) {
    throw new Error(
      "official calendar source bytes length must match verified transfer completion"
    );
  }
  const payload = sourceDocumentEnvelopePayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_ENVELOPE_SCHEMA_VERSION,
    documentId: parsed.documentId,
    exchange:
      verified.redirectChainBoundary.domainAllowlistBoundary.exchange,
    contentLength,
    sourceDocumentHash: hashBytes(parsed.sourceBytes),
    acquisitionBoundary
  });
  return deepFreeze({
    ...payload,
    envelopeHash:
      createOfficialMarketCalendarSourceDocumentEnvelopeHash(payload)
  });
}

export function parseOfficialMarketCalendarSourceDocumentEnvelope(
  value: unknown,
  options: {
    freshnessPolicyRegistry: unknown;
    sourceBytes: unknown;
  }
): OfficialMarketCalendarSourceDocumentEnvelope {
  const envelope = officialMarketCalendarSourceDocumentEnvelopeSchema.parse(
    value
  );
  const sourceBytes = z.instanceof(Uint8Array).parse(options.sourceBytes);
  const verified =
    verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
      envelope.acquisitionBoundary,
      options.freshnessPolicyRegistry
    );
  if (
    envelope.exchange !==
    verified.redirectChainBoundary.domainAllowlistBoundary.exchange
  ) {
    throw new Error(
      "official calendar source document exchange must match acquisition boundary"
    );
  }
  if (
    envelope.contentLength !==
    verified.redirectChainBoundary.finalResponseBoundary.transferCompletion
      .contentLength
  ) {
    throw new Error(
      "official calendar source document length must match acquisition boundary"
    );
  }
  if (
    sourceBytes.byteLength !== envelope.contentLength ||
    hashBytes(sourceBytes) !== envelope.sourceDocumentHash
  ) {
    throw new Error(
      "official calendar source document bytes do not match the envelope"
    );
  }
  const { envelopeHash, ...payload } = envelope;
  if (
    envelopeHash !==
    createOfficialMarketCalendarSourceDocumentEnvelopeHash(payload)
  ) {
    throw new Error(
      "official market calendar source document envelope hash mismatch"
    );
  }
  return deepFreeze(envelope);
}

export function createOfficialMarketCalendarSourceDocumentEnvelopeHash(
  value: OfficialMarketCalendarSourceDocumentEnvelopePayload
): Sha256Hash {
  return createReplayResearchHash(
    sourceDocumentEnvelopePayloadSchema.parse(value)
  );
}

function hashBytes(value: Uint8Array): Sha256Hash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
