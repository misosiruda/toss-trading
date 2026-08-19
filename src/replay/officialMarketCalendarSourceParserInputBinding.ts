import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarSourceDocumentAcquisitionMetadataSchema,
  parseOfficialMarketCalendarSourceDocumentAcquisitionMetadata
} from "./officialMarketCalendarSourceDocumentAcquisitionMetadata.js";
import {
  officialMarketCalendarSourceParserContractRegistryEntrySchema
} from "./officialMarketCalendarSourceParserContract.js";
import {
  decodeOfficialMarketCalendarSourceRepresentation,
  officialMarketCalendarSourceRepresentationDecodeBoundarySchema
} from "./officialMarketCalendarSourceRepresentationDecodeBoundary.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_INPUT_BINDING_SCHEMA_VERSION =
  "official_market_calendar_source_parser_input_binding.v1";

const contentLengthSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const createSourceParserInputBindingInputSchema = z
  .object({
    sourceDocumentAcquisitionMetadata:
      officialMarketCalendarSourceDocumentAcquisitionMetadataSchema,
    parserContractEntry:
      officialMarketCalendarSourceParserContractRegistryEntrySchema
  })
  .strict();

const sourceParserInputBindingPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_INPUT_BINDING_SCHEMA_VERSION
    ),
    documentId: identifierSchema,
    exchange: z.enum(["KRX", "NYSE"]),
    sourceDocumentAcquisitionMetadata:
      officialMarketCalendarSourceDocumentAcquisitionMetadataSchema,
    representationDecodeBoundary:
      officialMarketCalendarSourceRepresentationDecodeBoundarySchema,
    parserContractVersion: identifierSchema,
    parserContractHash: sha256HashSchema,
    parserOutputSchemaVersion: identifierSchema,
    sourceDocumentHash: sha256HashSchema,
    encodedContentLength: contentLengthSchema,
    decodedContentHash: sha256HashSchema,
    decodedContentLength: contentLengthSchema,
    parserResultBound: z.literal(false)
  })
  .strict();

export const officialMarketCalendarSourceParserInputBindingSchema =
  sourceParserInputBindingPayloadSchema
    .safeExtend({ parserInputBindingHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceParserInputBinding = z.infer<
  typeof officialMarketCalendarSourceParserInputBindingSchema
>;

export type OfficialMarketCalendarSourceParserInputBindingPayload = z.infer<
  typeof sourceParserInputBindingPayloadSchema
>;

export interface BoundOfficialMarketCalendarSourceParserInput {
  parserInputBinding: OfficialMarketCalendarSourceParserInputBinding;
  decodedBytes: Uint8Array;
}

interface SourceParserInputBindingOptions {
  sourceBytes: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function bindOfficialMarketCalendarSourceParserInput(
  input: unknown,
  options: SourceParserInputBindingOptions
): BoundOfficialMarketCalendarSourceParserInput {
  const parsed = createSourceParserInputBindingInputSchema.parse(input);
  const sourceDocumentAcquisitionMetadata =
    parseOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
      parsed.sourceDocumentAcquisitionMetadata,
      {
        sourceBytes: options.sourceBytes,
        freshnessPolicyRegistry: options.freshnessPolicyRegistry
      }
    );
  if (
    parsed.parserContractEntry.parserContractVersion !==
    sourceDocumentAcquisitionMetadata.expectedParserContractVersion
  ) {
    throw new Error(
      "official calendar parser contract version does not match acquisition selector"
    );
  }
  const decoded = decodeOfficialMarketCalendarSourceRepresentation(
    {
      sourceBytes: options.sourceBytes,
      contentType: sourceDocumentAcquisitionMetadata.contentType,
      contentEncoding: sourceDocumentAcquisitionMetadata.contentEncoding,
      parserContractEntry: parsed.parserContractEntry
    },
    options.parserContractRegistry
  );
  const representation = decoded.representationDecodeBoundary;
  if (
    representation.exchange !== sourceDocumentAcquisitionMetadata.exchange ||
    representation.sourceDocumentHash !==
      sourceDocumentAcquisitionMetadata.sourceDocumentHash ||
    representation.encodedContentLength !==
      sourceDocumentAcquisitionMetadata.contentLength
  ) {
    throw new Error(
      "official calendar decoded representation does not match acquisition metadata"
    );
  }
  const contract = representation.parserContractEntry;
  const payload = sourceParserInputBindingPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_PARSER_INPUT_BINDING_SCHEMA_VERSION,
    documentId: sourceDocumentAcquisitionMetadata.documentId,
    exchange: sourceDocumentAcquisitionMetadata.exchange,
    sourceDocumentAcquisitionMetadata,
    representationDecodeBoundary: representation,
    parserContractVersion: contract.parserContractVersion,
    parserContractHash: contract.parserContractHash,
    parserOutputSchemaVersion:
      contract.parserContractDefinition.parserOutputSchemaVersion,
    sourceDocumentHash: representation.sourceDocumentHash,
    encodedContentLength: representation.encodedContentLength,
    decodedContentHash: representation.decodedContentHash,
    decodedContentLength: representation.decodedContentLength,
    parserResultBound: false
  });
  return {
    parserInputBinding: deepFreeze({
      ...payload,
      parserInputBindingHash:
        createOfficialMarketCalendarSourceParserInputBindingHash(payload)
    }),
    decodedBytes: Uint8Array.from(decoded.decodedBytes)
  };
}

export function openOfficialMarketCalendarSourceParserInputBinding(
  value: unknown,
  options: SourceParserInputBindingOptions
): BoundOfficialMarketCalendarSourceParserInput {
  const binding = officialMarketCalendarSourceParserInputBindingSchema.parse(value);
  const expected = bindOfficialMarketCalendarSourceParserInput(
    {
      sourceDocumentAcquisitionMetadata:
        binding.sourceDocumentAcquisitionMetadata,
      parserContractEntry:
        binding.representationDecodeBoundary.parserContractEntry
    },
    options
  );
  if (!isDeepStrictEqual(binding, expected.parserInputBinding)) {
    throw new Error(
      "official calendar source parser input binding does not match verified acquisition"
    );
  }
  return {
    parserInputBinding: deepFreeze(binding),
    decodedBytes: Uint8Array.from(expected.decodedBytes)
  };
}

export function createOfficialMarketCalendarSourceParserInputBindingHash(
  value: OfficialMarketCalendarSourceParserInputBindingPayload
): Sha256Hash {
  return createReplayResearchHash(
    sourceParserInputBindingPayloadSchema.parse(value)
  );
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
