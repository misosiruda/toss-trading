import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  type OfficialBrokerObservedCalendarEvidence,
  OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION,
  OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS,
  verifyOfficialBrokerObservedCalendarEvidence
} from "./officialBrokerObservedCalendarEvidence.js";
import {
  OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN,
  OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256,
  assertVerifiedOfficialTossOpenApiCalendarCompatibilityResult,
  type OfficialTossOpenApiCalendarCompatibilityResult
} from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
  officialBrokerObservedCalendarResponseSchema,
  parseOfficialBrokerObservedCalendarResponse,
  type OfficialBrokerObservedCalendarResponse
} from "./officialBrokerObservedCalendarResponse.js";
import { OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION } from "./officialMarketCalendarCacheRequestPolicy.js";
import {
  createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders,
  OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION,
  resolveOfficialMarketCalendarNetworkResponseFreshness
} from "./officialMarketCalendarNetworkResponseFreshness.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION =
  "official_broker_observed_calendar_evidence.v2";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");

const canonicalUtcDateTimeSchema = isoDateTimeSchema
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    "date-time must use canonical UTC millisecond format"
  )
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "date-time must represent an exact canonical UTC timestamp"
  );

const canonicalUtcWholeSecondSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    "response timestamp must use canonical UTC whole-second format"
  )
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().replace(".000Z", "Z") === value,
    "response timestamp must represent an existing calendar date-time"
  );

const operationSchema = z.discriminatedUnion("market", [
  z
    .object({
      market: z.literal("KR"),
      method: z.literal("GET"),
      path: z.literal("/api/v1/market-calendar/KR"),
      operationId: z.literal("getKrMarketCalendar"),
      responseSchemaRef: z.literal(
        "#/components/schemas/KrMarketCalendarResponse"
      )
    })
    .strict(),
  z
    .object({
      market: z.literal("US"),
      method: z.literal("GET"),
      path: z.literal("/api/v1/market-calendar/US"),
      operationId: z.literal("getUsMarketCalendar"),
      responseSchemaRef: z.literal(
        "#/components/schemas/UsMarketCalendarResponse"
      )
    })
    .strict()
]);

const requestSchema = z
  .object({
    method: z.literal("GET"),
    path: z.enum([
      "/api/v1/market-calendar/KR",
      "/api/v1/market-calendar/US"
    ]),
    operationId: z.enum(["getKrMarketCalendar", "getUsMarketCalendar"]),
    query: z.object({ date: calendarDateSchema }).strict()
  })
  .strict();

const sourceSchema = z
  .object({
    publisher: z.literal("Toss Securities Open API"),
    apiContractVersion: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION
    ),
    openApiDocumentUrl: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL
    ),
    openApiDocumentSha256: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256
    ),
    openApiSnapshotSha256: z.literal(
      OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256
    ),
    serverOrigin: z.literal(OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN),
    responseParserContractVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
    ),
    responseSchemaRef: z.enum([
      "#/components/schemas/KrMarketCalendarResponse",
      "#/components/schemas/UsMarketCalendarResponse"
    ]),
    cacheRequestPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION
    ),
    retrievedAt: canonicalUtcDateTimeSchema,
    responseDate: canonicalUtcWholeSecondSchema,
    responseAgeSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    responseExpires: canonicalUtcWholeSecondSchema.nullable(),
    responseDelayMilliseconds: z.number().int().nonnegative().max(10_000),
    responseCacheControl: z.array(z.string()).nullable(),
    effectiveResponseAt: canonicalUtcDateTimeSchema,
    freshnessPolicy: z
      .object({
        policyVersion: z.literal(
          OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION
        ),
        maximumAgeSeconds: z.literal(
          OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS
        )
      })
      .strict(),
    staleAfter: canonicalUtcDateTimeSchema,
    responseHash: sha256HashSchema,
    responseByteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict();

const returnedSessionRangeSchema = z
  .object({
    startAt: canonicalUtcDateTimeSchema,
    endAt: canonicalUtcDateTimeSchema
  })
  .strict();

const coverageSchema = z
  .object({
    status: z.literal("verified"),
    scope: z.literal("requested_date_and_returned_sessions_only"),
    requestedDate: calendarDateSchema,
    returnedDates: z.tuple([
      calendarDateSchema,
      calendarDateSchema,
      calendarDateSchema
    ]),
    returnedDateRange: z
      .object({
        startDate: calendarDateSchema,
        endDate: calendarDateSchema
      })
      .strict(),
    returnedSessionCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    returnedSessionRange: returnedSessionRangeSchema.nullable(),
    historicalCompletenessClaim: z.literal("not_claimed")
  })
  .strict();

const evidencePayloadSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    sourceEvidenceClass: z.literal("official_broker_observed"),
    replayEvidenceClass: z.literal("observed_session_only"),
    market: z.enum(["KR", "US"]),
    requestedDate: calendarDateSchema,
    request: requestSchema,
    source: sourceSchema,
    coverage: coverageSchema,
    response: officialBrokerObservedCalendarResponseSchema
  })
  .strict();

export const officialBrokerObservedCalendarEvidenceV2Schema =
  evidencePayloadSchema
    .safeExtend({ artifactHash: sha256HashSchema })
    .strict()
    .superRefine(validateEvidenceBindings);

const rawResponseBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (value) => value.byteLength > 0,
    "official broker calendar v2 raw response bytes must be non-empty"
  );

const builderInputSchema = z
  .object({
    compatibilityResult: z.record(z.string(), z.unknown()),
    completedAt: canonicalUtcDateTimeSchema,
    responseDelayMilliseconds: z.number().int().nonnegative().max(10_000),
    responseCacheHeaders: z.record(z.string(), z.unknown()),
    responseCacheControl: z.record(z.string(), z.unknown()),
    rawResponseBytes: rawResponseBytesSchema
  })
  .strict();

const verifierOptionsSchema = z
  .object({
    asOf: canonicalUtcDateTimeSchema,
    rawResponseBytes: rawResponseBytesSchema
  })
  .strict();

const versionDiscriminatorSchema = z
  .object({ schemaVersion: z.string() })
  .passthrough();

export type OfficialBrokerObservedCalendarEvidenceV2 = z.infer<
  typeof officialBrokerObservedCalendarEvidenceV2Schema
>;

export type VersionedOfficialBrokerObservedCalendarEvidence =
  | OfficialBrokerObservedCalendarEvidence
  | OfficialBrokerObservedCalendarEvidenceV2;

export interface CreateOfficialBrokerObservedCalendarEvidenceV2Input {
  compatibilityResult: unknown;
  completedAt: string;
  responseDelayMilliseconds: number;
  responseCacheHeaders: unknown;
  responseCacheControl: unknown;
  rawResponseBytes: Uint8Array;
}

export interface VerifyVersionedOfficialBrokerObservedCalendarEvidenceOptions {
  asOf: string;
  rawResponseBytes: Uint8Array;
}

interface TrustedParserContractRegistryEntry {
  apiContractVersion: typeof OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION;
  openApiDocumentUrl: typeof OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL;
  openApiDocumentSha256: typeof OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256;
  openApiSnapshotSha256: typeof OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256;
  serverOrigin: typeof OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN;
  responseParserContractVersion: typeof OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION;
  operation: z.infer<typeof operationSchema>;
}

const TRUSTED_PARSER_CONTRACT_REGISTRY = Object.freeze({
  KR: Object.freeze({
    apiContractVersion:
      OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION,
    openApiDocumentUrl: OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL,
    openApiDocumentSha256: OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256,
    openApiSnapshotSha256: OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256,
    serverOrigin: OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN,
    responseParserContractVersion:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
    operation: Object.freeze({
      market: "KR" as const,
      method: "GET" as const,
      path: "/api/v1/market-calendar/KR" as const,
      operationId: "getKrMarketCalendar" as const,
      responseSchemaRef:
        "#/components/schemas/KrMarketCalendarResponse" as const
    })
  }),
  US: Object.freeze({
    apiContractVersion:
      OFFICIAL_TOSS_OPEN_API_CALENDAR_API_CONTRACT_VERSION,
    openApiDocumentUrl: OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_URL,
    openApiDocumentSha256: OFFICIAL_TOSS_OPEN_API_CALENDAR_DOCUMENT_SHA256,
    openApiSnapshotSha256: OFFICIAL_TOSS_OPEN_API_CALENDAR_SNAPSHOT_SHA256,
    serverOrigin: OFFICIAL_TOSS_OPEN_API_CALENDAR_SERVER_ORIGIN,
    responseParserContractVersion:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
    operation: Object.freeze({
      market: "US" as const,
      method: "GET" as const,
      path: "/api/v1/market-calendar/US" as const,
      operationId: "getUsMarketCalendar" as const,
      responseSchemaRef:
        "#/components/schemas/UsMarketCalendarResponse" as const
    })
  })
}) satisfies Readonly<
  Record<"KR" | "US", Readonly<TrustedParserContractRegistryEntry>>
>;

export function resolveTrustedOfficialTossCalendarParserContract(
  value: unknown
): {
  compatibilityResult: OfficialTossOpenApiCalendarCompatibilityResult;
  registryEntry: TrustedParserContractRegistryEntry;
} {
  const compatibilityResult =
    assertVerifiedOfficialTossOpenApiCalendarCompatibilityResult(value);
  const registryEntry =
    TRUSTED_PARSER_CONTRACT_REGISTRY[
      compatibilityResult.apiContract.operation.market
    ];
  const expectedApiContract = {
    apiContractVersion: registryEntry.apiContractVersion,
    openApiVersion: compatibilityResult.apiContract.openApiVersion,
    documentUrl: registryEntry.openApiDocumentUrl,
    documentSha256: registryEntry.openApiDocumentSha256,
    serverOrigin: registryEntry.serverOrigin,
    responseParserContractVersion:
      registryEntry.responseParserContractVersion,
    operation: registryEntry.operation
  };
  if (!isDeepStrictEqual(compatibilityResult.apiContract, expectedApiContract)) {
    throw new Error(
      "official calendar compatibility result does not match trusted parser registry"
    );
  }
  return { compatibilityResult, registryEntry };
}

export function createOfficialBrokerObservedCalendarEvidenceV2(
  input: CreateOfficialBrokerObservedCalendarEvidenceV2Input
): OfficialBrokerObservedCalendarEvidenceV2 {
  const parsedInput = builderInputSchema.parse(input);
  const { compatibilityResult, registryEntry } =
    resolveTrustedOfficialTossCalendarParserContract(
      input.compatibilityResult
    );
  const rawResponseBytes = parsedInput.rawResponseBytes;
  const response = parseNormalizedResponse(rawResponseBytes, {
    market: registryEntry.operation.market,
    requestedDate: compatibilityResult.requestedDate
  });
  if (!isDeepStrictEqual(response, compatibilityResult.response)) {
    throw new Error(
      "official calendar response bytes do not match verified compatibility result"
    );
  }

  const responseFreshness =
    createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders({
      completedAt: parsedInput.completedAt,
      responseDelayMilliseconds: parsedInput.responseDelayMilliseconds,
      responseCacheHeaders: parsedInput.responseCacheHeaders,
      responseCacheControl: parsedInput.responseCacheControl
    });
  assertFresh(
    parsedInput.completedAt,
    parsedInput.completedAt,
    responseFreshness.freshness.staleAfter
  );

  const payload = evidencePayloadSchema.parse({
    schemaVersion:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    replayEvidenceClass: "observed_session_only",
    market: registryEntry.operation.market,
    requestedDate: compatibilityResult.requestedDate,
    request: requestFor(
      registryEntry.operation,
      compatibilityResult.requestedDate
    ),
    source: {
      publisher: "Toss Securities Open API",
      apiContractVersion: registryEntry.apiContractVersion,
      openApiDocumentUrl: registryEntry.openApiDocumentUrl,
      openApiDocumentSha256: registryEntry.openApiDocumentSha256,
      openApiSnapshotSha256: registryEntry.openApiSnapshotSha256,
      serverOrigin: registryEntry.serverOrigin,
      responseParserContractVersion:
        registryEntry.responseParserContractVersion,
      responseSchemaRef: registryEntry.operation.responseSchemaRef,
      cacheRequestPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION,
      retrievedAt: parsedInput.completedAt,
      responseDate: responseFreshness.freshness.responseDate,
      responseAgeSeconds: responseFreshness.freshness.responseAgeSeconds,
      responseExpires: responseFreshness.freshness.responseExpires,
      responseDelayMilliseconds:
        responseFreshness.freshness.responseDelayMilliseconds,
      responseCacheControl:
        responseFreshness.freshness.responseCacheControl,
      effectiveResponseAt:
        responseFreshness.freshness.effectiveResponseAt,
      freshnessPolicy: {
        policyVersion: responseFreshness.freshnessPolicyVersion,
        maximumAgeSeconds: responseFreshness.maximumAgeSeconds
      },
      staleAfter: responseFreshness.freshness.staleAfter,
      responseHash: createRawResponseHash(rawResponseBytes),
      responseByteLength: rawResponseBytes.byteLength
    },
    coverage: coverageFor(response),
    response
  });

  return verifyOfficialBrokerObservedCalendarEvidenceV2(
    {
      ...payload,
      artifactHash: createReplayResearchHash(payload)
    },
    { asOf: parsedInput.completedAt, rawResponseBytes }
  );
}

export function verifyOfficialBrokerObservedCalendarEvidenceV2(
  value: unknown,
  options: VerifyVersionedOfficialBrokerObservedCalendarEvidenceOptions
): OfficialBrokerObservedCalendarEvidenceV2 {
  const parsedOptions = verifierOptionsSchema.parse(options);
  const rawResponseBytes = parsedOptions.rawResponseBytes;
  const evidence = officialBrokerObservedCalendarEvidenceV2Schema.parse(value);
  const { artifactHash, ...payload } = evidence;
  if (artifactHash !== createReplayResearchHash(payload)) {
    throw new Error("official broker calendar v2 artifact hash mismatch");
  }
  if (evidence.source.responseByteLength !== rawResponseBytes.byteLength) {
    throw new Error(
      "official broker calendar v2 response byte length mismatch"
    );
  }
  if (evidence.source.responseHash !== createRawResponseHash(rawResponseBytes)) {
    throw new Error("official broker calendar v2 response hash mismatch");
  }
  const normalized = parseNormalizedResponse(rawResponseBytes, {
    market: evidence.market,
    requestedDate: evidence.requestedDate
  });
  if (!isDeepStrictEqual(normalized, evidence.response)) {
    throw new Error(
      "official broker calendar v2 normalized response mismatch"
    );
  }
  assertFresh(
    parsedOptions.asOf,
    evidence.source.retrievedAt,
    evidence.source.staleAfter
  );
  return evidence;
}

export function verifyVersionedOfficialBrokerObservedCalendarEvidence(
  value: unknown,
  options: VerifyVersionedOfficialBrokerObservedCalendarEvidenceOptions
): VersionedOfficialBrokerObservedCalendarEvidence {
  const { schemaVersion } = versionDiscriminatorSchema.parse(value);
  if (
    schemaVersion ===
    OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION
  ) {
    return verifyOfficialBrokerObservedCalendarEvidence(value, options);
  }
  if (
    schemaVersion ===
    OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_V2_SCHEMA_VERSION
  ) {
    return verifyOfficialBrokerObservedCalendarEvidenceV2(value, options);
  }
  throw new Error(
    `unsupported official broker calendar evidence schema version: ${schemaVersion}`
  );
}

function validateEvidenceBindings(
  value: z.infer<typeof evidencePayloadSchema> & { artifactHash: Sha256Hash },
  context: z.RefinementCtx
): void {
  const registryEntry = TRUSTED_PARSER_CONTRACT_REGISTRY[value.market];
  if (
    value.source.apiContractVersion !== registryEntry.apiContractVersion ||
    value.source.openApiDocumentUrl !== registryEntry.openApiDocumentUrl ||
    value.source.openApiDocumentSha256 !==
      registryEntry.openApiDocumentSha256 ||
    value.source.openApiSnapshotSha256 !==
      registryEntry.openApiSnapshotSha256 ||
    value.source.serverOrigin !== registryEntry.serverOrigin ||
    value.source.responseParserContractVersion !==
      registryEntry.responseParserContractVersion ||
    value.source.responseSchemaRef !==
      registryEntry.operation.responseSchemaRef
  ) {
    issue(
      context,
      ["source"],
      "official broker calendar v2 source does not match trusted parser registry"
    );
  }
  const expectedRequest = requestFor(
    registryEntry.operation,
    value.requestedDate
  );
  if (!isDeepStrictEqual(value.request, expectedRequest)) {
    issue(
      context,
      ["request"],
      "official broker calendar v2 request identity does not match registry and date"
    );
  }
  if (
    value.response.market !== value.market ||
    value.response.requestedDate !== value.requestedDate
  ) {
    issue(
      context,
      ["response"],
      "official broker calendar v2 response does not match requested market and date"
    );
  }
  if (!isDeepStrictEqual(value.coverage, coverageFor(value.response))) {
    issue(
      context,
      ["coverage"],
      "official broker calendar v2 coverage does not match returned response"
    );
  }
  try {
    resolveOfficialMarketCalendarNetworkResponseFreshness({
      completedAt: value.source.retrievedAt,
      responseDate: value.source.responseDate,
      responseAgeSeconds: value.source.responseAgeSeconds,
      responseExpires: value.source.responseExpires,
      responseDelayMilliseconds: value.source.responseDelayMilliseconds,
      responseCacheControl: value.source.responseCacheControl,
      effectiveResponseAt: value.source.effectiveResponseAt,
      staleAfter: value.source.staleAfter
    });
  } catch (error) {
    issue(
      context,
      ["source"],
      error instanceof Error
        ? error.message
        : "official broker calendar v2 freshness is invalid"
    );
  }
}

function requestFor(
  operation: z.infer<typeof operationSchema>,
  requestedDate: string
) {
  return {
    method: operation.method,
    path: operation.path,
    operationId: operation.operationId,
    query: { date: requestedDate }
  };
}

function coverageFor(response: OfficialBrokerObservedCalendarResponse) {
  const sessions = response.days.flatMap((day) => day.sessions);
  return {
    status: "verified" as const,
    scope: "requested_date_and_returned_sessions_only" as const,
    requestedDate: response.requestedDate,
    returnedDates: [
      response.days[0].marketDate,
      response.days[1].marketDate,
      response.days[2].marketDate
    ] as [string, string, string],
    returnedDateRange: {
      startDate: response.days[0].marketDate,
      endDate: response.days[2].marketDate
    },
    returnedSessionCount: sessions.length,
    returnedSessionRange:
      sessions.length === 0
        ? null
        : {
            startAt: sessions[0]!.startAt,
            endAt: sessions.at(-1)!.endAt
          },
    historicalCompletenessClaim: "not_claimed" as const
  };
}

function parseNormalizedResponse(
  rawResponseBytes: Uint8Array,
  options: { market: "KR" | "US"; requestedDate: string }
): OfficialBrokerObservedCalendarResponse {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawResponseBytes);
  } catch {
    throw new Error(
      "official broker calendar v2 response must be valid UTF-8"
    );
  }
  let response: unknown;
  try {
    response = JSON.parse(text) as unknown;
  } catch {
    throw new Error("official broker calendar v2 response must be valid JSON");
  }
  return parseOfficialBrokerObservedCalendarResponse(response, options);
}

function createRawResponseHash(value: Uint8Array): Sha256Hash {
  return sha256HashSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`
  );
}

function assertFresh(
  asOf: string,
  retrievedAt: string,
  staleAfter: string
): void {
  const asOfTime = Date.parse(asOf);
  if (asOfTime < Date.parse(retrievedAt)) {
    throw new Error(
      "official broker calendar v2 freshness evaluation must not precede retrieval"
    );
  }
  if (asOfTime >= Date.parse(staleAfter)) {
    throw new Error("official broker calendar v2 source is stale");
  }
}

function isValidCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function issue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
