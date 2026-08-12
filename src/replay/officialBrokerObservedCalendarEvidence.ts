import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
  officialBrokerObservedCalendarResponseSchema,
  parseOfficialBrokerObservedCalendarResponse
} from "./officialBrokerObservedCalendarResponse.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION =
  "official_broker_observed_calendar_evidence.v1";
export const OFFICIAL_TOSS_OPEN_API_VERSION = "1.2.13";
export const OFFICIAL_BROKER_OBSERVED_CALENDAR_FRESHNESS_POLICY_VERSION =
  "official_broker_observed_calendar_retrieval_age_24h.v1";
export const OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS = 86_400;

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
    isCanonicalUtcDateTime,
    "date-time must represent an exact canonical UTC timestamp"
  );

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
    apiVersion: z.literal(OFFICIAL_TOSS_OPEN_API_VERSION),
    responseContractVersion: z.literal(
      OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION
    ),
    retrievedAt: canonicalUtcDateTimeSchema,
    responseHash: sha256HashSchema,
    responseByteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    freshnessPolicy: z
      .object({
        policyVersion: z.literal(
          OFFICIAL_BROKER_OBSERVED_CALENDAR_FRESHNESS_POLICY_VERSION
        ),
        maximumAgeSeconds: z.literal(
          OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS
        )
      })
      .strict(),
    staleAfter: canonicalUtcDateTimeSchema
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
      OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION
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

export const officialBrokerObservedCalendarEvidenceSchema =
  evidencePayloadSchema
    .safeExtend({ artifactHash: sha256HashSchema })
    .strict()
    .superRefine(validateEvidenceBindings);

const builderMetadataSchema = z
  .object({
    market: z.enum(["KR", "US"]),
    requestedDate: calendarDateSchema,
    retrievedAt: canonicalUtcDateTimeSchema,
    evaluatedAt: canonicalUtcDateTimeSchema
  })
  .strict();

const verifierOptionsSchema = z
  .object({ asOf: canonicalUtcDateTimeSchema })
  .strict();

export type OfficialBrokerObservedCalendarEvidence = z.infer<
  typeof officialBrokerObservedCalendarEvidenceSchema
>;

export interface CreateOfficialBrokerObservedCalendarEvidenceInput {
  market: "KR" | "US";
  requestedDate: string;
  retrievedAt: string;
  evaluatedAt: string;
  rawResponseBytes: Uint8Array;
}

export interface VerifyOfficialBrokerObservedCalendarEvidenceOptions {
  asOf: string;
  rawResponseBytes: Uint8Array;
}

export function createOfficialBrokerObservedCalendarEvidence(
  input: CreateOfficialBrokerObservedCalendarEvidenceInput
): OfficialBrokerObservedCalendarEvidence {
  const metadata = builderMetadataSchema.parse({
    market: input.market,
    requestedDate: input.requestedDate,
    retrievedAt: input.retrievedAt,
    evaluatedAt: input.evaluatedAt
  });
  const rawResponseBytes = parseRawResponseBytesInput(input.rawResponseBytes);
  const response = parseNormalizedResponse(rawResponseBytes, {
    market: metadata.market,
    requestedDate: metadata.requestedDate
  });
  const staleAfter = addSeconds(
    metadata.retrievedAt,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS
  );
  assertFresh(metadata.evaluatedAt, metadata.retrievedAt, staleAfter);

  const request = requestFor(metadata.market, metadata.requestedDate);
  const coverage = coverageFor(response);
  const payload = evidencePayloadSchema.parse({
    schemaVersion: OFFICIAL_BROKER_OBSERVED_CALENDAR_EVIDENCE_SCHEMA_VERSION,
    mode: "paper_only",
    sourceEvidenceClass: "official_broker_observed",
    replayEvidenceClass: "observed_session_only",
    market: metadata.market,
    requestedDate: metadata.requestedDate,
    request,
    source: {
      publisher: "Toss Securities Open API",
      apiVersion: OFFICIAL_TOSS_OPEN_API_VERSION,
      responseContractVersion:
        OFFICIAL_BROKER_OBSERVED_CALENDAR_RESPONSE_SCHEMA_VERSION,
      retrievedAt: metadata.retrievedAt,
      responseHash: createRawResponseHash(rawResponseBytes),
      responseByteLength: rawResponseBytes.byteLength,
      freshnessPolicy: {
        policyVersion:
          OFFICIAL_BROKER_OBSERVED_CALENDAR_FRESHNESS_POLICY_VERSION,
        maximumAgeSeconds:
          OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS
      },
      staleAfter
    },
    coverage,
    response
  });

  return verifyOfficialBrokerObservedCalendarEvidence(
    {
      ...payload,
      artifactHash: createReplayResearchHash(payload)
    },
    { asOf: metadata.evaluatedAt, rawResponseBytes }
  );
}

export function verifyOfficialBrokerObservedCalendarEvidence(
  value: unknown,
  options: VerifyOfficialBrokerObservedCalendarEvidenceOptions
): OfficialBrokerObservedCalendarEvidence {
  const parsedOptions = verifierOptionsSchema.parse({ asOf: options.asOf });
  const rawResponseBytes = parseRawResponseBytesInput(options.rawResponseBytes);
  const evidence = officialBrokerObservedCalendarEvidenceSchema.parse(value);
  const { artifactHash, ...payload } = evidence;
  if (artifactHash !== createReplayResearchHash(payload)) {
    throw new Error("official broker calendar artifact hash mismatch");
  }
  if (evidence.source.responseByteLength !== rawResponseBytes.byteLength) {
    throw new Error("official broker calendar response byte length mismatch");
  }
  if (evidence.source.responseHash !== createRawResponseHash(rawResponseBytes)) {
    throw new Error("official broker calendar response hash mismatch");
  }

  const normalized = parseNormalizedResponse(rawResponseBytes, {
    market: evidence.market,
    requestedDate: evidence.requestedDate
  });
  if (!isDeepStrictEqual(normalized, evidence.response)) {
    throw new Error("official broker calendar normalized response mismatch");
  }
  assertFresh(
    parsedOptions.asOf,
    evidence.source.retrievedAt,
    evidence.source.staleAfter
  );
  return evidence;
}

function validateEvidenceBindings(
  value: z.infer<typeof evidencePayloadSchema> & { artifactHash: Sha256Hash },
  context: z.RefinementCtx
): void {
  const expectedRequest = requestFor(value.market, value.requestedDate);
  if (!isDeepStrictEqual(value.request, expectedRequest)) {
    issue(
      context,
      ["request"],
      "official broker calendar request identity does not match market and date"
    );
  }
  if (
    value.response.market !== value.market ||
    value.response.requestedDate !== value.requestedDate
  ) {
    issue(
      context,
      ["response"],
      "official broker calendar response does not match requested market and date"
    );
  }

  const expectedCoverage = coverageFor(value.response);
  if (!isDeepStrictEqual(value.coverage, expectedCoverage)) {
    issue(
      context,
      ["coverage"],
      "official broker calendar coverage does not match returned response"
    );
  }

  const expectedStaleAfter = addSeconds(
    value.source.retrievedAt,
    value.source.freshnessPolicy.maximumAgeSeconds
  );
  if (value.source.staleAfter !== expectedStaleAfter) {
    issue(
      context,
      ["source", "staleAfter"],
      "official broker calendar stale time does not match freshness policy"
    );
  }
}

function requestFor(market: "KR" | "US", requestedDate: string) {
  return market === "KR"
    ? {
        method: "GET" as const,
        path: "/api/v1/market-calendar/KR" as const,
        operationId: "getKrMarketCalendar" as const,
        query: { date: requestedDate }
      }
    : {
        method: "GET" as const,
        path: "/api/v1/market-calendar/US" as const,
        operationId: "getUsMarketCalendar" as const,
        query: { date: requestedDate }
      };
}

function coverageFor(
  response: z.infer<typeof officialBrokerObservedCalendarResponseSchema>
) {
  const returnedDates = response.days.map(({ marketDate }) => marketDate) as [
    string,
    string,
    string
  ];
  const sessions = response.days.flatMap(({ sessions: daySessions }) =>
    daySessions.map(({ startAt, endAt }) => ({ startAt, endAt }))
  );
  const returnedSessionRange =
    sessions.length === 0
      ? null
      : {
          startAt: sessions[0]!.startAt,
          endAt: sessions.at(-1)!.endAt
        };

  return {
    status: "verified" as const,
    scope: "requested_date_and_returned_sessions_only" as const,
    requestedDate: response.requestedDate,
    returnedDates,
    returnedDateRange: {
      startDate: returnedDates[0],
      endDate: returnedDates[2]
    },
    returnedSessionCount: sessions.length,
    returnedSessionRange,
    historicalCompletenessClaim: "not_claimed" as const
  };
}

function parseNormalizedResponse(
  rawResponseBytes: Uint8Array,
  options: { market: "KR" | "US"; requestedDate: string }
) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawResponseBytes);
  } catch {
    throw new Error("official broker calendar response must be valid UTF-8");
  }

  let response: unknown;
  try {
    response = JSON.parse(text) as unknown;
  } catch {
    throw new Error("official broker calendar response must be valid JSON");
  }
  return parseOfficialBrokerObservedCalendarResponse(response, options);
}

function parseRawResponseBytesInput(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(
      "official broker calendar raw response bytes must be a non-empty Uint8Array"
    );
  }
  return value;
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
      "official broker calendar freshness evaluation must not precede retrieval"
    );
  }
  if (asOfTime >= Date.parse(staleAfter)) {
    throw new Error("official broker calendar source is stale");
  }
}

function addSeconds(value: string, seconds: number): string {
  const timestamp = Date.parse(value) + seconds * 1_000;
  if (!Number.isFinite(timestamp)) {
    throw new Error("official broker calendar stale time exceeds date range");
  }
  try {
    return new Date(timestamp).toISOString();
  } catch {
    throw new Error("official broker calendar stale time exceeds date range");
  }
}

function isValidCalendarDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function isCanonicalUtcDateTime(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function issue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
