import { z } from "zod";

import { isoDateTimeSchema } from "../domain/schemas.js";

const explicitOffsetDateTimeSchema = isoDateTimeSchema.refine(
  hasExplicitTimeZoneOffset,
  "date-time must include an explicit timezone offset"
).refine(
  hasAtMostMillisecondPrecision,
  "date-time must not exceed millisecond precision"
);
const responseDateTimeSchema = explicitOffsetDateTimeSchema.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value
    ),
  "response Date must use whole-second precision"
);
const effectiveResponseDateTimeSchema = explicitOffsetDateTimeSchema.refine(
  (value) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value,
  "effective response time must use canonical UTC millisecond format"
);

const responseFreshnessInputSchema = z
  .object({
    retrievedAt: explicitOffsetDateTimeSchema,
    responseDate: responseDateTimeSchema,
    responseAgeSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
  })
  .strict();

export const officialMarketCalendarResponseFreshnessSchema =
  responseFreshnessInputSchema
    .safeExtend({
      effectiveResponseAt: effectiveResponseDateTimeSchema
    })
    .strict();

export type OfficialMarketCalendarResponseFreshness = z.infer<
  typeof officialMarketCalendarResponseFreshnessSchema
>;

export interface ResolvedOfficialMarketCalendarResponseFreshness {
  freshness: OfficialMarketCalendarResponseFreshness;
  apparentAgeSeconds: number;
  effectiveCacheAgeSeconds: number;
}

export function resolveOfficialMarketCalendarResponseFreshness(
  value: unknown
): ResolvedOfficialMarketCalendarResponseFreshness {
  const freshness = officialMarketCalendarResponseFreshnessSchema.parse(value);
  const retrievedAt = Date.parse(freshness.retrievedAt);
  const responseDate = Date.parse(freshness.responseDate);
  if (responseDate > retrievedAt) {
    throw new Error(
      "official calendar response Date must not follow retrieval time"
    );
  }

  const apparentAgeSeconds = Math.max(
    0,
    Math.floor((retrievedAt - responseDate) / 1_000)
  );
  const effectiveCacheAgeSeconds = Math.max(
    apparentAgeSeconds,
    freshness.responseAgeSeconds ?? 0
  );
  const effectiveTimestamp = retrievedAt - effectiveCacheAgeSeconds * 1_000;
  if (!Number.isFinite(effectiveTimestamp)) {
    throw new Error(
      "official calendar response cache age exceeds timestamp range"
    );
  }
  const effectiveDate = new Date(effectiveTimestamp);
  if (Number.isNaN(effectiveDate.getTime())) {
    throw new Error(
      "official calendar response cache age exceeds timestamp range"
    );
  }
  if (Date.parse(freshness.effectiveResponseAt) !== effectiveTimestamp) {
    throw new Error(
      "official calendar effective response time does not match cache age"
    );
  }

  return {
    freshness,
    apparentAgeSeconds,
    effectiveCacheAgeSeconds
  };
}

function hasExplicitTimeZoneOffset(value: string): boolean {
  return /T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function hasAtMostMillisecondPrecision(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
    value
  );
}
