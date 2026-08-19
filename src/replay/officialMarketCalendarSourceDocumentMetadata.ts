import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  officialMarketCalendarSourceDocumentAcquisitionMetadataSchema
} from "./officialMarketCalendarSourceDocumentAcquisitionMetadata.js";
import { OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES } from "./officialMarketCalendarSourceCollection.js";
import {
  officialMarketCalendarSourceParserResultSchema,
  parseOfficialMarketCalendarSourceParserResult
} from "./officialMarketCalendarSourceParserResult.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_METADATA_SCHEMA_VERSION =
  "official_market_calendar_source_document_metadata.v1";

const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scheduleCoverageIntervalSchema = z
  .object({
    coverageRole: z.enum([
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ]),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema
  })
  .strict();
const regularSessionHoursSchema = z
  .object({
    openLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closeLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  })
  .strict();

const finalAcquisitionFieldsSchema =
  officialMarketCalendarSourceDocumentAcquisitionMetadataSchema.omit({
    schemaVersion: true,
    expectedEvidenceRoles: true,
    expectedRowCoverageStartDate: true,
    expectedRowCoverageEndDate: true,
    expectedScheduleCoverageIntervals: true,
    expectedApplicabilityStartDate: true,
    expectedApplicabilityEndDate: true,
    expectedParserContractVersion: true,
    parserResultBound: true
  });

const sourceDocumentMetadataPayloadSchema = finalAcquisitionFieldsSchema
  .safeExtend({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_METADATA_SCHEMA_VERSION
    ),
    sourceDocumentAcquisitionMetadata:
      officialMarketCalendarSourceDocumentAcquisitionMetadataSchema,
    sourceParserResult: officialMarketCalendarSourceParserResultSchema,
    parserContractVersion: identifierSchema,
    parserContractHash: sha256HashSchema,
    parserOutputSchemaVersion: identifierSchema,
    parserOutputHash: sha256HashSchema,
    parserResultHash: sha256HashSchema,
    evidenceRoles: z.array(
      z.enum(OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES)
    ),
    rowCoverageStartDate: calendarDateSchema.nullable(),
    rowCoverageEndDate: calendarDateSchema.nullable(),
    scheduleCoverageIntervals: z.array(scheduleCoverageIntervalSchema),
    applicabilityStartDate: calendarDateSchema.nullable(),
    applicabilityEndDate: calendarDateSchema.nullable(),
    regularSessionHours: regularSessionHoursSchema.nullable(),
    parserResultBound: z.literal(true)
  })
  .strict();

export const officialMarketCalendarSourceDocumentMetadataSchema =
  sourceDocumentMetadataPayloadSchema
    .safeExtend({ metadataHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceDocumentMetadata = z.infer<
  typeof officialMarketCalendarSourceDocumentMetadataSchema
>;
export type OfficialMarketCalendarSourceDocumentMetadataPayload = z.infer<
  typeof sourceDocumentMetadataPayloadSchema
>;

interface SourceDocumentMetadataOptions {
  sourceBytes: unknown;
  freshnessPolicyRegistry: unknown;
  parserContractRegistry: unknown;
}

export function createOfficialMarketCalendarSourceDocumentMetadata(
  input: unknown,
  options: SourceDocumentMetadataOptions
): OfficialMarketCalendarSourceDocumentMetadata {
  const parsed = z
    .object({ sourceParserResult: officialMarketCalendarSourceParserResultSchema })
    .strict()
    .parse(input);
  const sourceParserResult = parseOfficialMarketCalendarSourceParserResult(
    parsed.sourceParserResult,
    options
  );
  const acquisition =
    sourceParserResult.parserInputBinding.sourceDocumentAcquisitionMetadata;
  const {
    schemaVersion: _acquisitionSchemaVersion,
    expectedEvidenceRoles: _expectedEvidenceRoles,
    expectedRowCoverageStartDate: _expectedRowCoverageStartDate,
    expectedRowCoverageEndDate: _expectedRowCoverageEndDate,
    expectedScheduleCoverageIntervals: _expectedScheduleCoverageIntervals,
    expectedApplicabilityStartDate: _expectedApplicabilityStartDate,
    expectedApplicabilityEndDate: _expectedApplicabilityEndDate,
    expectedParserContractVersion: _expectedParserContractVersion,
    parserResultBound: _acquisitionParserResultBound,
    ...finalAcquisitionFields
  } = acquisition;
  const payload = sourceDocumentMetadataPayloadSchema.parse({
    ...finalAcquisitionFields,
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_METADATA_SCHEMA_VERSION,
    sourceDocumentAcquisitionMetadata: acquisition,
    sourceParserResult,
    parserContractVersion: sourceParserResult.parserContractVersion,
    parserContractHash: sourceParserResult.parserContractHash,
    parserOutputSchemaVersion: sourceParserResult.parserOutputSchemaVersion,
    parserOutputHash: sourceParserResult.parserOutputHash,
    parserResultHash: sourceParserResult.parserResultHash,
    evidenceRoles: sourceParserResult.evidenceRoles,
    rowCoverageStartDate: sourceParserResult.rowCoverageStartDate,
    rowCoverageEndDate: sourceParserResult.rowCoverageEndDate,
    scheduleCoverageIntervals: sourceParserResult.scheduleCoverageIntervals,
    applicabilityStartDate: sourceParserResult.applicabilityStartDate,
    applicabilityEndDate: sourceParserResult.applicabilityEndDate,
    regularSessionHours: sourceParserResult.regularSessionHours,
    parserResultBound: true
  });
  return deepFreeze({
    ...payload,
    metadataHash: createOfficialMarketCalendarSourceDocumentMetadataHash(payload)
  });
}

export function parseOfficialMarketCalendarSourceDocumentMetadata(
  value: unknown,
  options: SourceDocumentMetadataOptions
): OfficialMarketCalendarSourceDocumentMetadata {
  const metadata = officialMarketCalendarSourceDocumentMetadataSchema.parse(value);
  const expected = createOfficialMarketCalendarSourceDocumentMetadata(
    { sourceParserResult: metadata.sourceParserResult },
    options
  );
  if (!isDeepStrictEqual(metadata, expected)) {
    throw new Error(
      "official calendar source document metadata does not match verified parser result"
    );
  }
  return deepFreeze(metadata);
}

export function createOfficialMarketCalendarSourceDocumentMetadataHash(
  value: OfficialMarketCalendarSourceDocumentMetadataPayload
): Sha256Hash {
  return createReplayResearchHash(sourceDocumentMetadataPayloadSchema.parse(value));
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
