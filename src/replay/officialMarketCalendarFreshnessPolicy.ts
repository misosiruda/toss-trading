import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema, type Sha256Hash } from "../domain/schemas.js";
import {
  OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";
import { OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES } from "./officialMarketCalendarSourceCollection.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION =
  "official_market_calendar_freshness_policy_definition.v1";

const EXCEPTION_COVERAGE_ROLES = [
  "holiday_schedule",
  "session_hours_exception_schedule",
  "special_closure_schedule"
] as const;

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

const canonicalJsonValueSchema: z.ZodType<CanonicalJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(canonicalJsonValueSchema),
    z.record(z.string(), canonicalJsonValueSchema)
  ])
);
const canonicalJsonObjectSchema = z.record(
  z.string(),
  canonicalJsonValueSchema
);
const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "identifier must use the registered ASCII grammar"
  );
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidCalendarDate, "calendar date must be valid");
const mediaTypeSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
    "request body content type must be a canonical visible value"
  );
const scheduleCoverageIntervalSchema = z
  .object({
    coverageRole: z.enum(EXCEPTION_COVERAGE_ROLES),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate > value.endDate) {
      issue(
        context,
        ["endDate"],
        "freshness policy schedule coverage start must not follow end"
      );
    }
  });

export const officialMarketCalendarFreshnessPolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION
    ),
    sourceSelector: z
      .object({
        exchange: z.enum(["KRX", "NYSE"]),
        requestMethod: z.enum(["GET", "POST"]),
        requestedUrl: z.string().min(1),
        requestParameters: canonicalJsonObjectSchema,
        requestBodyContentType: mediaTypeSchema.nullable(),
        requestBodyHash: sha256HashSchema.nullable(),
        representationHeaders: canonicalJsonObjectSchema,
        parserContractVersion: identifierSchema
      })
      .strict(),
    coverageSelector: z
      .object({
        evidenceRoles: z
          .array(z.enum(OFFICIAL_CALENDAR_SOURCE_EVIDENCE_ROLES))
          .min(1),
        rowCoverageStartDate: calendarDateSchema.nullable(),
        rowCoverageEndDate: calendarDateSchema.nullable(),
        scheduleCoverageIntervals: z.array(scheduleCoverageIntervalSchema),
        applicabilityStartDate: calendarDateSchema.nullable(),
        applicabilityEndDate: calendarDateSchema.nullable()
      })
      .strict(),
    expiryRule: z
      .object({
        type: z.literal("fixed_duration_from_effective_response"),
        durationSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
  })
  .strict()
  .superRefine(validateDefinition);

export type OfficialMarketCalendarFreshnessPolicyDefinition = z.infer<
  typeof officialMarketCalendarFreshnessPolicyDefinitionSchema
>;

const registryEntrySchema = z
  .object({
    freshnessPolicyVersion: identifierSchema,
    freshnessPolicyDefinition:
      officialMarketCalendarFreshnessPolicyDefinitionSchema,
    freshnessPolicyHash: sha256HashSchema
  })
  .strict();

export type OfficialMarketCalendarFreshnessPolicyRegistryEntry = z.infer<
  typeof registryEntrySchema
>;

export function parseOfficialMarketCalendarFreshnessPolicyDefinition(
  value: unknown
): OfficialMarketCalendarFreshnessPolicyDefinition {
  return officialMarketCalendarFreshnessPolicyDefinitionSchema.parse(value);
}

export function createOfficialMarketCalendarFreshnessPolicyHash(
  value: unknown
): Sha256Hash {
  return createReplayResearchHash(
    parseOfficialMarketCalendarFreshnessPolicyDefinition(value)
  );
}

export function parseOfficialMarketCalendarFreshnessPolicyRegistryEntry(
  value: unknown
): OfficialMarketCalendarFreshnessPolicyRegistryEntry {
  const entry = registryEntrySchema.parse(value);
  if (
    entry.freshnessPolicyHash !==
    createOfficialMarketCalendarFreshnessPolicyHash(
      entry.freshnessPolicyDefinition
    )
  ) {
    throw new Error("official calendar freshness policy hash mismatch");
  }
  return entry;
}

export function parseOfficialMarketCalendarFreshnessPolicyRegistry(
  value: unknown
): OfficialMarketCalendarFreshnessPolicyRegistryEntry[] {
  const entries = z
    .array(z.unknown())
    .parse(value)
    .map(parseOfficialMarketCalendarFreshnessPolicyRegistryEntry);
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.freshnessPolicyVersion)) {
      throw new Error(
        "official calendar freshness policy versions must be unique"
      );
    }
    versions.add(entry.freshnessPolicyVersion);
  }
  return entries;
}

export function resolveOfficialMarketCalendarFreshnessPolicyFromRegistry(
  value: unknown,
  registry: unknown
): OfficialMarketCalendarFreshnessPolicyRegistryEntry {
  const recordedEntry =
    parseOfficialMarketCalendarFreshnessPolicyRegistryEntry(value);
  const registeredEntry =
    parseOfficialMarketCalendarFreshnessPolicyRegistry(registry).find(
      (entry) =>
        entry.freshnessPolicyVersion ===
        recordedEntry.freshnessPolicyVersion
    );
  if (registeredEntry === undefined) {
    throw new Error(
      "official calendar freshness policy version is not registered"
    );
  }
  if (!isDeepStrictEqual(recordedEntry, registeredEntry)) {
    throw new Error(
      "official calendar recorded freshness policy does not match registry"
    );
  }
  return registeredEntry;
}

function validateDefinition(
  value: OfficialMarketCalendarFreshnessPolicyDefinition,
  context: z.RefinementCtx
): void {
  const { sourceSelector, coverageSelector } = value;
  if (
    (sourceSelector.requestBodyContentType === null) !==
    (sourceSelector.requestBodyHash === null)
  ) {
    issue(
      context,
      ["sourceSelector", "requestBodyHash"],
      "freshness policy request body content type and hash must coexist"
    );
  }

  try {
    verifyOfficialMarketCalendarDomainAllowlist({
      exchange: sourceSelector.exchange,
      domainAllowlistPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
      urls: [sourceSelector.requestedUrl]
    });
  } catch (error) {
    issue(
      context,
      ["sourceSelector", "requestedUrl"],
      error instanceof Error
        ? error.message
        : "freshness policy requested URL is invalid"
    );
  }

  validateCanonicalStrings(
    coverageSelector.evidenceRoles,
    context,
    ["coverageSelector", "evidenceRoles"]
  );
  const rowStart = coverageSelector.rowCoverageStartDate;
  const rowEnd = coverageSelector.rowCoverageEndDate;
  if ((rowStart === null) !== (rowEnd === null)) {
    issue(
      context,
      ["coverageSelector", "rowCoverageEndDate"],
      "freshness policy row coverage start and end must coexist"
    );
  } else if (rowStart !== null && rowEnd !== null && rowStart > rowEnd) {
    issue(
      context,
      ["coverageSelector", "rowCoverageEndDate"],
      "freshness policy row coverage start must not follow end"
    );
  }

  const scheduleKeys = coverageSelector.scheduleCoverageIntervals.map(
    (interval) =>
      `${interval.coverageRole}:${interval.startDate}:${interval.endDate}`
  );
  validateCanonicalStrings(scheduleKeys, context, [
    "coverageSelector",
    "scheduleCoverageIntervals"
  ]);

  const applicabilityStart = coverageSelector.applicabilityStartDate;
  const applicabilityEnd = coverageSelector.applicabilityEndDate;
  if (applicabilityStart === null && applicabilityEnd !== null) {
    issue(
      context,
      ["coverageSelector", "applicabilityEndDate"],
      "freshness policy applicability end requires a start"
    );
  } else if (
    applicabilityStart !== null &&
    applicabilityEnd !== null &&
    applicabilityStart > applicabilityEnd
  ) {
    issue(
      context,
      ["coverageSelector", "applicabilityEndDate"],
      "freshness policy applicability start must not follow end"
    );
  }

}

function validateCanonicalStrings(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[]
): void {
  const canonical = [...new Set(values)].sort(compareCanonicalText);
  if (
    canonical.length !== values.length ||
    canonical.some((value, index) => value !== values[index])
  ) {
    issue(context, path, "values must be unique and use canonical lexical order");
  }
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
