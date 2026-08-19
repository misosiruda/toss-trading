import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import { verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary } from "./officialMarketCalendarAcquisitionFreshnessPolicyBoundary.js";
import { OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES } from "./officialMarketCalendarSourceCollection.js";
import {
  officialMarketCalendarSourceDocumentEnvelopeSchema,
  parseOfficialMarketCalendarSourceDocumentEnvelope
} from "./officialMarketCalendarSourceDocumentEnvelope.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_ACQUISITION_METADATA_SCHEMA_VERSION =
  "official_market_calendar_source_document_acquisition_metadata.v1";

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
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scheduleCoverageIntervalSchema = z
  .object({
    coverageRole: z.enum([
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ]),
    startDate: dateSchema,
    endDate: dateSchema
  })
  .strict();

const createSourceDocumentAcquisitionMetadataInputSchema = z
  .object({
    sourceDocumentEnvelope: officialMarketCalendarSourceDocumentEnvelopeSchema
  })
  .strict();

const sourceDocumentAcquisitionMetadataPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_ACQUISITION_METADATA_SCHEMA_VERSION
    ),
    documentId: identifierSchema,
    exchange: z.enum(["KRX", "NYSE"]),
    publisher: z.enum(["KRX", "NYSE"]),
    sourceDocumentEnvelope: officialMarketCalendarSourceDocumentEnvelopeSchema,
    requestMethod: z.enum(["GET", "POST"]),
    requestedUrl: z.string().min(1),
    requestParameters: z.record(z.string(), z.unknown()),
    requestBodyContentType: z.string().min(1).nullable(),
    requestBodyHash: sha256HashSchema.nullable(),
    requestHeaderPolicyVersion: identifierSchema,
    requestHeaderNames: z.array(z.string()),
    representationHeaders: z.record(z.string(), z.unknown()),
    finalUrl: z.string().min(1),
    redirectPolicyVersion: identifierSchema,
    redirectChain: z.record(z.string(), z.unknown()),
    retrievedAt: z.string().min(1),
    cacheRequestPolicyVersion: identifierSchema,
    responseDate: z.string().min(1),
    responseAgeSeconds: z.number().int().nonnegative().nullable(),
    responseCacheControl: z.array(z.string()).nullable(),
    effectiveResponseAt: z.string().min(1),
    freshnessPolicyVersion: identifierSchema,
    freshnessPolicyDefinition: z.record(z.string(), z.unknown()),
    freshnessPolicyHash: sha256HashSchema,
    staleAfter: z.string().min(1),
    httpStatus: z.literal(200),
    httpProtocolVersion: z.enum([
      "http_1_0",
      "http_1_1",
      "http_2",
      "http_3"
    ]),
    contentType: z.string().min(1),
    contentRange: z.null(),
    contentEncoding: z.enum(["gzip", "deflate", "br"]).nullable(),
    transferFraming: z.enum(["content_length", "chunked", "stream_end"]),
    declaredContentLength: contentLengthSchema.nullable(),
    transferCompleted: z.literal(true),
    contentLength: contentLengthSchema,
    sourceDocumentHash: sha256HashSchema,
    expectedEvidenceRoles: z.array(
      z.enum(OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES)
    ),
    expectedRowCoverageStartDate: dateSchema.nullable(),
    expectedRowCoverageEndDate: dateSchema.nullable(),
    expectedScheduleCoverageIntervals: z.array(scheduleCoverageIntervalSchema),
    expectedApplicabilityStartDate: dateSchema.nullable(),
    expectedApplicabilityEndDate: dateSchema.nullable(),
    expectedParserContractVersion: identifierSchema,
    parserResultBound: z.literal(false)
  })
  .strict();

export const officialMarketCalendarSourceDocumentAcquisitionMetadataSchema =
  sourceDocumentAcquisitionMetadataPayloadSchema
    .safeExtend({ acquisitionMetadataHash: sha256HashSchema })
    .strict();

export type OfficialMarketCalendarSourceDocumentAcquisitionMetadata = z.infer<
  typeof officialMarketCalendarSourceDocumentAcquisitionMetadataSchema
>;

export type OfficialMarketCalendarSourceDocumentAcquisitionMetadataPayload =
  z.infer<typeof sourceDocumentAcquisitionMetadataPayloadSchema>;

interface SourceDocumentAcquisitionMetadataOptions {
  freshnessPolicyRegistry: unknown;
  sourceBytes: unknown;
}

export function createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
  input: unknown,
  options: SourceDocumentAcquisitionMetadataOptions
): OfficialMarketCalendarSourceDocumentAcquisitionMetadata {
  const parsed = createSourceDocumentAcquisitionMetadataInputSchema.parse(input);
  const sourceDocumentEnvelope =
    parseOfficialMarketCalendarSourceDocumentEnvelope(
      parsed.sourceDocumentEnvelope,
      options
    );
  const verified =
    verifyOfficialMarketCalendarAcquisitionFreshnessPolicyBoundary(
      sourceDocumentEnvelope.acquisitionBoundary,
      options.freshnessPolicyRegistry
    );
  const redirect = verified.redirectChainBoundary;
  const initialMethod = redirect.methodBoundary.transitions[0]!;
  const initialParameters =
    redirect.requestParametersBoundary.effectiveRequests[0]!;
  const initialHeaderNames =
    redirect.requestHeaderNamesBoundary.effectiveRequests[0]!;
  const initialRepresentation =
    redirect.representationHeadersBoundary.effectiveRequests[0]!;
  const finalResponse = redirect.finalResponseBoundary;
  const freshness = finalResponse.responseFreshness.freshness;
  const policy = verified.freshnessPolicySelectorBinding.freshnessPolicyEntry;
  const selector = verified.freshnessPolicySelectorBinding.selectorMetadata;
  const transfer = finalResponse.transferCompletion;
  const cacheRequestPolicyVersion =
    redirect.cacheRequestPolicies[0]!.cacheRequestPolicyVersion;
  const payload = sourceDocumentAcquisitionMetadataPayloadSchema.parse({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_SOURCE_DOCUMENT_ACQUISITION_METADATA_SCHEMA_VERSION,
    documentId: sourceDocumentEnvelope.documentId,
    exchange: sourceDocumentEnvelope.exchange,
    publisher: sourceDocumentEnvelope.exchange,
    sourceDocumentEnvelope,
    requestMethod: initialMethod.requestMethod,
    requestedUrl: redirect.httpsUrlBoundary.requestedUrl,
    requestParameters: initialParameters.requestParameters,
    requestBodyContentType: initialMethod.requestBodyContentType,
    requestBodyHash: initialMethod.requestBodyHash,
    requestHeaderPolicyVersion: redirect.requestHeaderPolicyVersion,
    requestHeaderNames: initialHeaderNames.requestHeaderNames,
    representationHeaders: initialRepresentation.representationHeaders,
    finalUrl: redirect.httpsUrlBoundary.finalUrl,
    redirectPolicyVersion: redirect.redirectClientPolicy.redirectPolicyVersion,
    redirectChain: redirect,
    retrievedAt: freshness.retrievedAt,
    cacheRequestPolicyVersion,
    responseDate: freshness.responseDate,
    responseAgeSeconds: freshness.responseAgeSeconds,
    responseCacheControl: finalResponse.responseCacheControl.responseCacheControl,
    effectiveResponseAt: freshness.effectiveResponseAt,
    freshnessPolicyVersion: policy.freshnessPolicyVersion,
    freshnessPolicyDefinition: policy.freshnessPolicyDefinition,
    freshnessPolicyHash: policy.freshnessPolicyHash,
    staleAfter: finalResponse.freshnessPolicyExpiry.staleAfter,
    httpStatus: finalResponse.httpStatus,
    httpProtocolVersion: finalResponse.httpProtocolVersion,
    contentType: finalResponse.responseRepresentationHeaders.contentType,
    contentRange: finalResponse.contentRange,
    contentEncoding: finalResponse.responseRepresentationHeaders.contentEncoding,
    transferFraming: transfer.transferFraming,
    declaredContentLength: transfer.declaredContentLength,
    transferCompleted: transfer.transferCompleted,
    contentLength: sourceDocumentEnvelope.contentLength,
    sourceDocumentHash: sourceDocumentEnvelope.sourceDocumentHash,
    expectedEvidenceRoles: selector.evidenceRoles,
    expectedRowCoverageStartDate: selector.rowCoverageStartDate,
    expectedRowCoverageEndDate: selector.rowCoverageEndDate,
    expectedScheduleCoverageIntervals: selector.scheduleCoverageIntervals,
    expectedApplicabilityStartDate: selector.applicabilityStartDate,
    expectedApplicabilityEndDate: selector.applicabilityEndDate,
    expectedParserContractVersion: selector.parserContractVersion,
    parserResultBound: false
  });
  return deepFreeze({
    ...payload,
    acquisitionMetadataHash:
      createOfficialMarketCalendarSourceDocumentAcquisitionMetadataHash(payload)
  });
}

export function parseOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
  value: unknown,
  options: SourceDocumentAcquisitionMetadataOptions
): OfficialMarketCalendarSourceDocumentAcquisitionMetadata {
  const metadata =
    officialMarketCalendarSourceDocumentAcquisitionMetadataSchema.parse(value);
  const expected = createOfficialMarketCalendarSourceDocumentAcquisitionMetadata(
    { sourceDocumentEnvelope: metadata.sourceDocumentEnvelope },
    options
  );
  if (!isDeepStrictEqual(metadata, expected)) {
    throw new Error(
      "official market calendar source document acquisition metadata does not match verified envelope"
    );
  }
  return deepFreeze(metadata);
}

export function createOfficialMarketCalendarSourceDocumentAcquisitionMetadataHash(
  value: OfficialMarketCalendarSourceDocumentAcquisitionMetadataPayload
): Sha256Hash {
  return createReplayResearchHash(
    sourceDocumentAcquisitionMetadataPayloadSchema.parse(value)
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
