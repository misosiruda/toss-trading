import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS } from "./officialBrokerObservedCalendarEvidence.js";
import {
  parseOfficialMarketCalendarNetworkResponseCacheHeaders,
  type OfficialMarketCalendarNetworkResponseCacheHeaders
} from "./officialMarketCalendarResponseCacheHeaders.js";
import {
  parseOfficialMarketCalendarResponseCacheControl,
  type OfficialMarketCalendarResponseCacheControl
} from "./officialMarketCalendarResponseCacheControl.js";

export const OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION =
  "official_market_calendar_network_corrected_age_24h.v1";
export const OFFICIAL_MARKET_CALENDAR_MAXIMUM_RESPONSE_DELAY_MILLISECONDS =
  10_000;

const canonicalUtcMillisecondSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "timestamp must use canonical UTC millisecond format"
  )
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "timestamp must represent an existing calendar date-time"
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

const responseDelayMillisecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(OFFICIAL_MARKET_CALENDAR_MAXIMUM_RESPONSE_DELAY_MILLISECONDS);

const recordedFreshnessSchema = z
  .object({
    completedAt: canonicalUtcMillisecondSchema,
    responseDate: canonicalUtcWholeSecondSchema,
    responseAgeSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    responseExpires: canonicalUtcWholeSecondSchema.nullable(),
    responseDelayMilliseconds: responseDelayMillisecondsSchema,
    responseCacheControl: z.array(z.string()).nullable(),
    effectiveResponseAt: canonicalUtcMillisecondSchema,
    staleAfter: canonicalUtcMillisecondSchema
  })
  .strict();

const rawHeadersFreshnessSchema = z
  .object({
    completedAt: canonicalUtcMillisecondSchema,
    responseDelayMilliseconds: responseDelayMillisecondsSchema,
    responseCacheHeaders: z.record(z.string(), z.unknown()),
    responseCacheControl: z.record(z.string(), z.unknown())
  })
  .strict();

export type OfficialMarketCalendarNetworkResponseFreshness = z.infer<
  typeof recordedFreshnessSchema
>;

export interface ResolvedOfficialMarketCalendarNetworkResponseFreshness {
  freshnessPolicyVersion: typeof OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION;
  maximumAgeSeconds: typeof OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS;
  freshness: OfficialMarketCalendarNetworkResponseFreshness;
  apparentAgeMilliseconds: number;
  correctedAgeValueMilliseconds: number;
  correctedInitialAgeMilliseconds: number;
  validatedResponseMaxAgeSeconds: number | null;
  responseFreshnessLifetimeMilliseconds: number;
}

export function createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders(
  value: unknown
): ResolvedOfficialMarketCalendarNetworkResponseFreshness {
  const input = rawHeadersFreshnessSchema.parse(value);
  const responseCacheHeaders =
    parseOfficialMarketCalendarNetworkResponseCacheHeaders(
      input.responseCacheHeaders
    );
  const responseCacheControl =
    parseOfficialMarketCalendarResponseCacheControl(
      input.responseCacheControl
    );
  const derived = deriveFreshness({
    completedAt: input.completedAt,
    responseDelayMilliseconds: input.responseDelayMilliseconds,
    ...responseCacheHeaders,
    ...responseCacheControl
  });
  return resolveOfficialMarketCalendarNetworkResponseFreshness({
    completedAt: input.completedAt,
    responseDelayMilliseconds: input.responseDelayMilliseconds,
    ...responseCacheHeaders,
    ...responseCacheControl,
    effectiveResponseAt: derived.effectiveResponseAt,
    staleAfter: derived.staleAfter
  });
}

export function resolveOfficialMarketCalendarNetworkResponseFreshness(
  value: unknown
): ResolvedOfficialMarketCalendarNetworkResponseFreshness {
  const freshness = recordedFreshnessSchema.parse(value);
  const derived = deriveFreshness(freshness);
  if (freshness.effectiveResponseAt !== derived.effectiveResponseAt) {
    throw new Error(
      "official calendar effective response time does not match network corrected age"
    );
  }
  if (freshness.staleAfter !== derived.staleAfter) {
    throw new Error(
      "official calendar staleAfter does not match network response expiry"
    );
  }
  return {
    freshnessPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION,
    maximumAgeSeconds:
      OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS,
    freshness,
    apparentAgeMilliseconds: derived.apparentAgeMilliseconds,
    correctedAgeValueMilliseconds:
      derived.correctedAgeValueMilliseconds,
    correctedInitialAgeMilliseconds:
      derived.correctedInitialAgeMilliseconds,
    validatedResponseMaxAgeSeconds:
      derived.validatedResponseMaxAgeSeconds,
    responseFreshnessLifetimeMilliseconds:
      derived.responseFreshnessLifetimeMilliseconds
  };
}

function deriveFreshness(
  value: Pick<
    OfficialMarketCalendarNetworkResponseFreshness,
    | "completedAt"
    | "responseDate"
    | "responseAgeSeconds"
    | "responseExpires"
    | "responseDelayMilliseconds"
    | "responseCacheControl"
  >
) {
  const completedAt = Date.parse(value.completedAt);
  const responseDate = Date.parse(value.responseDate);
  if (responseDate > completedAt) {
    throw new Error(
      "official calendar response Date must not follow completion time"
    );
  }

  const apparentAgeMilliseconds = completedAt - responseDate;
  const ageMilliseconds = multiplyExactMilliseconds(
    value.responseAgeSeconds ?? 0,
    "response Age"
  );
  const correctedAgeValueMilliseconds = addExact(
    ageMilliseconds,
    value.responseDelayMilliseconds,
    "response Age and delay"
  );
  const correctedInitialAgeMilliseconds = Math.max(
    apparentAgeMilliseconds,
    correctedAgeValueMilliseconds
  );
  const effectiveResponseAtTimestamp = subtractExact(
    completedAt,
    correctedInitialAgeMilliseconds,
    "effective response time"
  );
  const effectiveResponseAt = canonicalUtcMilliseconds(
    effectiveResponseAtTimestamp,
    "effective response time"
  );

  const policyLifetimeMilliseconds = multiplyExactMilliseconds(
    OFFICIAL_BROKER_OBSERVED_CALENDAR_MAXIMUM_AGE_SECONDS,
    "freshness policy"
  );
  const policyStaleAfter = addTimestamp(
    effectiveResponseAtTimestamp,
    policyLifetimeMilliseconds,
    "freshness policy expiry"
  );
  const validatedResponseMaxAgeSeconds = validateResponseCacheControl(
    value.responseCacheControl
  );
  const responseFreshnessLifetimeMilliseconds =
    validatedResponseMaxAgeSeconds !== null
      ? multiplyExactMilliseconds(
          validatedResponseMaxAgeSeconds,
          "response max-age"
        )
      : value.responseExpires !== null
        ? expiresLifetimeMilliseconds(value.responseExpires, responseDate)
        : policyLifetimeMilliseconds;
  const responseStaleAfter = addTimestamp(
    effectiveResponseAtTimestamp,
    responseFreshnessLifetimeMilliseconds,
    "response expiry"
  );
  const staleAfterTimestamp = Math.min(
    policyStaleAfter,
    responseStaleAfter
  );
  if (completedAt >= staleAfterTimestamp) {
    throw new Error(
      "official calendar network response is already stale at completion"
    );
  }

  return {
    apparentAgeMilliseconds,
    correctedAgeValueMilliseconds,
    correctedInitialAgeMilliseconds,
    validatedResponseMaxAgeSeconds,
    responseFreshnessLifetimeMilliseconds,
    effectiveResponseAt,
    staleAfter: canonicalUtcMilliseconds(
      staleAfterTimestamp,
      "network response expiry"
    )
  };
}

function validateResponseCacheControl(value: string[] | null): number | null {
  if (value === null) {
    return null;
  }
  if (!isDeepStrictEqual(value, [...value].sort(compareCanonicalStrings))) {
    throw new Error(
      "official calendar response Cache-Control must use canonical order"
    );
  }

  const noArgumentDirectives = new Set([
    "public",
    "private",
    "no-transform",
    "must-revalidate",
    "proxy-revalidate"
  ]);
  const names = new Set<string>();
  const maxAges: number[] = [];
  for (const directive of value) {
    const separator = directive.indexOf("=");
    const name = separator === -1 ? directive : directive.slice(0, separator);
    const argument = separator === -1 ? null : directive.slice(separator + 1);
    if (names.has(name)) {
      throw new Error(
        "official calendar response Cache-Control must not contain duplicate directives"
      );
    }
    names.add(name);

    if (name === "no-cache" || name === "no-store") {
      throw new Error(
        `official calendar response Cache-Control ${name} forbids evidence reuse`
      );
    }
    if (name === "max-age" || name === "s-maxage") {
      if (argument === null || !/^(?:0|[1-9]\d*)$/.test(argument)) {
        throw new Error(
          `official calendar response Cache-Control ${name} must use an unquoted canonical decimal`
        );
      }
      const seconds = Number(argument);
      if (!Number.isSafeInteger(seconds)) {
        throw new Error(
          `official calendar response Cache-Control ${name} exceeds the safe integer range`
        );
      }
      maxAges.push(seconds);
      continue;
    }
    if (!noArgumentDirectives.has(name) || argument !== null) {
      throw new Error(
        "official calendar response Cache-Control contains an unsupported directive"
      );
    }
  }
  return maxAges.length === 0 ? null : Math.min(...maxAges);
}

function expiresLifetimeMilliseconds(
  responseExpires: string,
  responseDateTimestamp: number
): number {
  const expiresTimestamp = Date.parse(responseExpires);
  const lifetime = expiresTimestamp - responseDateTimestamp;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0) {
    throw new Error(
      "official calendar response Expires must follow response Date"
    );
  }
  return lifetime;
}

function multiplyExactMilliseconds(value: number, label: string): number {
  const milliseconds = value * 1_000;
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`official calendar ${label} exceeds safe millisecond range`);
  }
  return milliseconds;
}

function addExact(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`official calendar ${label} exceeds safe integer range`);
  }
  return result;
}

function subtractExact(left: number, right: number, label: string): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`official calendar ${label} exceeds safe timestamp range`);
  }
  return result;
}

function addTimestamp(timestamp: number, delta: number, label: string): number {
  const result = addExact(timestamp, delta, label);
  canonicalUtcMilliseconds(result, label);
  return result;
}

function canonicalUtcMilliseconds(timestamp: number, label: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`official calendar ${label} exceeds Date range`);
  }
  const value = date.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`official calendar ${label} exceeds canonical date range`);
  }
  return value;
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type {
  OfficialMarketCalendarNetworkResponseCacheHeaders,
  OfficialMarketCalendarResponseCacheControl
};
