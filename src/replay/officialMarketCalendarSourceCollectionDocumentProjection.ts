import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarSourceCollectionDocumentSchema
} from "./officialMarketCalendarSourceCollection.js";
import {
  officialMarketCalendarSourceDocumentMetadataSchema,
  parseOfficialMarketCalendarSourceDocumentMetadata
} from "./officialMarketCalendarSourceDocumentMetadata.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_DOCUMENT_PROJECTION_SCHEMA_VERSION =
  "official_market_calendar_source_collection_document_projection.v1";

const projectionPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_DOCUMENT_PROJECTION_SCHEMA_VERSION
    ),
    exchange: z.enum(["KRX", "NYSE"]),
    sourceDocumentMetadata: officialMarketCalendarSourceDocumentMetadataSchema,
    collectionDocument: officialMarketCalendarSourceCollectionDocumentSchema
  })
  .strict();

export const officialMarketCalendarSourceCollectionDocumentProjectionSchema =
  projectionPayloadSchema
    .safeExtend({ projectionHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceCollectionDocumentProjection = z.infer<
  typeof officialMarketCalendarSourceCollectionDocumentProjectionSchema
>;
export type OfficialMarketCalendarSourceCollectionDocumentProjectionPayload =
  z.infer<typeof projectionPayloadSchema>;

interface ProjectionOptions {
  sourceBytes: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function createOfficialMarketCalendarSourceCollectionDocumentProjection(
  input: unknown,
  options: ProjectionOptions
): OfficialMarketCalendarSourceCollectionDocumentProjection {
  const parsed = z
    .object({ sourceDocumentMetadata: officialMarketCalendarSourceDocumentMetadataSchema })
    .strict()
    .parse(input);
  const sourceDocumentMetadata =
    parseOfficialMarketCalendarSourceDocumentMetadata(
      parsed.sourceDocumentMetadata,
      options
    );
  const collectionDocument =
    officialMarketCalendarSourceCollectionDocumentSchema.parse({
      documentId: sourceDocumentMetadata.documentId,
      metadataHash: sourceDocumentMetadata.metadataHash,
      sourceDocumentHash: sourceDocumentMetadata.sourceDocumentHash,
      evidenceRoles: sourceDocumentMetadata.evidenceRoles,
      regularSessionHours: sourceDocumentMetadata.regularSessionHours,
      scheduleCoverageIntervals:
        sourceDocumentMetadata.scheduleCoverageIntervals,
      applicabilityStartDate: sourceDocumentMetadata.applicabilityStartDate,
      applicabilityEndDate: sourceDocumentMetadata.applicabilityEndDate
    });
  const payload = projectionPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_COLLECTION_DOCUMENT_PROJECTION_SCHEMA_VERSION,
    exchange: sourceDocumentMetadata.exchange,
    sourceDocumentMetadata,
    collectionDocument
  });
  return deepFreeze({
    ...payload,
    projectionHash:
      createOfficialMarketCalendarSourceCollectionDocumentProjectionHash(payload)
  });
}

export function parseOfficialMarketCalendarSourceCollectionDocumentProjection(
  value: unknown,
  options: ProjectionOptions
): OfficialMarketCalendarSourceCollectionDocumentProjection {
  const projection =
    officialMarketCalendarSourceCollectionDocumentProjectionSchema.parse(value);
  const expected =
    createOfficialMarketCalendarSourceCollectionDocumentProjection(
      { sourceDocumentMetadata: projection.sourceDocumentMetadata },
      options
    );
  if (!isDeepStrictEqual(projection, expected)) {
    throw new Error(
      "official calendar collection document projection does not match verified metadata"
    );
  }
  return deepFreeze(projection);
}

export function createOfficialMarketCalendarSourceCollectionDocumentProjectionHash(
  value: OfficialMarketCalendarSourceCollectionDocumentProjectionPayload
): Sha256Hash {
  return createReplayResearchHash(projectionPayloadSchema.parse(value));
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
