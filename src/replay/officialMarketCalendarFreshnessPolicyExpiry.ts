import { z } from "zod";

import {
  type OfficialMarketCalendarFreshnessPolicyRegistryEntry,
  parseOfficialMarketCalendarFreshnessPolicyRegistryEntry,
  resolveOfficialMarketCalendarFreshnessPolicyFromRegistry
} from "./officialMarketCalendarFreshnessPolicy.js";
import { resolveOfficialMarketCalendarResponseFreshness } from "./officialMarketCalendarResponseFreshness.js";

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

const expiryInputSchema = z
  .object({
    freshnessPolicyEntry: z.record(z.string(), z.unknown()),
    effectiveResponseAt: canonicalUtcMillisecondSchema,
    staleAfter: canonicalUtcMillisecondSchema
  })
  .strict();

const recordedExpiryInputSchema = z
  .object({
    freshnessPolicyEntry: z.record(z.string(), z.unknown()),
    staleAfter: canonicalUtcMillisecondSchema
  })
  .strict();

export interface ResolvedOfficialMarketCalendarFreshnessPolicyExpiry {
  freshnessPolicyVersion: string;
  freshnessPolicyHash: OfficialMarketCalendarFreshnessPolicyRegistryEntry[
    "freshnessPolicyHash"
  ];
  effectiveResponseAt: string;
  durationSeconds: number;
  staleAfter: string;
}

export function resolveOfficialMarketCalendarFreshnessPolicyExpiry(
  value: unknown
): ResolvedOfficialMarketCalendarFreshnessPolicyExpiry {
  const input = expiryInputSchema.parse(value);
  const policyEntry =
    parseOfficialMarketCalendarFreshnessPolicyRegistryEntry(
      input.freshnessPolicyEntry
    );
  const durationSeconds = policyEntry.freshnessPolicyDefinition.expiryRule
    .durationSeconds;
  const durationMilliseconds = durationSeconds * 1_000;
  if (!Number.isSafeInteger(durationMilliseconds)) {
    throw new Error(
      "official calendar freshness policy duration exceeds safe millisecond range"
    );
  }

  const effectiveTimestamp = Date.parse(input.effectiveResponseAt);
  const expiryTimestamp = effectiveTimestamp + durationMilliseconds;
  if (!Number.isSafeInteger(expiryTimestamp)) {
    throw new Error(
      "official calendar freshness policy expiry exceeds safe timestamp range"
    );
  }
  const staleAfter = canonicalUtcMilliseconds(expiryTimestamp);
  if (input.staleAfter !== staleAfter) {
    throw new Error(
      "official calendar staleAfter does not match freshness policy expiry"
    );
  }

  return {
    freshnessPolicyVersion: policyEntry.freshnessPolicyVersion,
    freshnessPolicyHash: policyEntry.freshnessPolicyHash,
    effectiveResponseAt: input.effectiveResponseAt,
    durationSeconds,
    staleAfter
  };
}

export function resolveOfficialMarketCalendarFreshnessPolicyExpiryFromResponseFreshness(
  value: unknown,
  responseFreshness: unknown
): ResolvedOfficialMarketCalendarFreshnessPolicyExpiry {
  const input = recordedExpiryInputSchema.parse(value);
  const verifiedResponseFreshness =
    resolveOfficialMarketCalendarResponseFreshness(responseFreshness);
  return resolveOfficialMarketCalendarFreshnessPolicyExpiry({
    ...input,
    effectiveResponseAt:
      verifiedResponseFreshness.freshness.effectiveResponseAt
  });
}

export function resolveOfficialMarketCalendarFreshnessPolicyExpiryFromRegistryAndResponseFreshness(
  value: unknown,
  registry: unknown,
  responseFreshness: unknown
): ResolvedOfficialMarketCalendarFreshnessPolicyExpiry {
  const input = recordedExpiryInputSchema.parse(value);
  const freshnessPolicyEntry =
    resolveOfficialMarketCalendarFreshnessPolicyFromRegistry(
      input.freshnessPolicyEntry,
      registry
    );
  return resolveOfficialMarketCalendarFreshnessPolicyExpiryFromResponseFreshness(
    {
      ...input,
      freshnessPolicyEntry
    },
    responseFreshness
  );
}

function canonicalUtcMilliseconds(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      "official calendar freshness policy expiry exceeds Date range"
    );
  }
  const value = date.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(
      "official calendar freshness policy expiry exceeds canonical timestamp range"
    );
  }
  return value;
}
