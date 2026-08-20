import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION =
  "official_market_calendar_request_header_policy_definition.v1";

const REQUIRED_HEADER_NAMES = ["cache-control", "pragma"] as const;
const KNOWN_SAFE_HEADER_NAMES = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "pragma",
  "referer",
  "user-agent"
]);

const lowercaseHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9a-z]+$/,
    "request header policy name must be a lowercase HTTP field name"
  );
const policyVersionSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "request header policy version must use the registered ASCII grammar"
  );

export const officialMarketCalendarRequestHeaderPolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION
    ),
    sourceSelector: z
      .object({
        exchange: z.enum(["KRX", "NYSE"]),
        requestedUrl: z.string().min(1)
      })
      .strict(),
    allowedHeaderNames: z.array(lowercaseHeaderNameSchema).min(1)
  })
  .strict()
  .superRefine(validateDefinition);

export type OfficialMarketCalendarRequestHeaderPolicyDefinition = z.infer<
  typeof officialMarketCalendarRequestHeaderPolicyDefinitionSchema
>;

const registryEntrySchema = z
  .object({
    requestHeaderPolicyVersion: policyVersionSchema,
    requestHeaderPolicyDefinition:
      officialMarketCalendarRequestHeaderPolicyDefinitionSchema
  })
  .strict();

export type OfficialMarketCalendarRequestHeaderPolicyRegistryEntry = z.infer<
  typeof registryEntrySchema
>;

export function parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
  value: unknown
): OfficialMarketCalendarRequestHeaderPolicyDefinition {
  return officialMarketCalendarRequestHeaderPolicyDefinitionSchema.parse(
    value
  );
}

export function parseOfficialMarketCalendarRequestHeaderPolicyRegistryEntry(
  value: unknown
): OfficialMarketCalendarRequestHeaderPolicyRegistryEntry {
  return registryEntrySchema.parse(value);
}

export function parseOfficialMarketCalendarRequestHeaderPolicyRegistry(
  value: unknown
): OfficialMarketCalendarRequestHeaderPolicyRegistryEntry[] {
  const entries = z
    .array(z.unknown())
    .parse(value)
    .map(parseOfficialMarketCalendarRequestHeaderPolicyRegistryEntry);
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.requestHeaderPolicyVersion)) {
      throw new Error(
        "official calendar request header policy versions must be unique"
      );
    }
    versions.add(entry.requestHeaderPolicyVersion);
  }
  return entries;
}

export function resolveOfficialMarketCalendarRequestHeaderPolicyFromRegistry(
  requestHeaderPolicyVersion: unknown,
  registry: unknown
): OfficialMarketCalendarRequestHeaderPolicyRegistryEntry {
  const version = policyVersionSchema.parse(requestHeaderPolicyVersion);
  const entry = parseOfficialMarketCalendarRequestHeaderPolicyRegistry(
    registry
  ).find(
    (candidate) => candidate.requestHeaderPolicyVersion === version
  );
  if (entry === undefined) {
    throw new Error(
      "official calendar request header policy version is not registered"
    );
  }
  return entry;
}

function validateDefinition(
  value: OfficialMarketCalendarRequestHeaderPolicyDefinition,
  context: z.RefinementCtx
): void {
  try {
    verifyOfficialMarketCalendarDomainAllowlist({
      exchange: value.sourceSelector.exchange,
      domainAllowlistPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
      urls: [value.sourceSelector.requestedUrl]
    });
    if (new URL(value.sourceSelector.requestedUrl).hash !== "") {
      context.addIssue({
        code: "custom",
        path: ["sourceSelector", "requestedUrl"],
        message:
          "request header policy requested URL must not contain a fragment"
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["sourceSelector", "requestedUrl"],
      message:
        error instanceof Error
          ? error.message
          : "request header policy requested URL is invalid"
    });
  }

  for (const [index, headerName] of value.allowedHeaderNames.entries()) {
    const previousHeaderName = value.allowedHeaderNames[index - 1];
    if (
      previousHeaderName !== undefined &&
      previousHeaderName >= headerName
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedHeaderNames", index],
        message:
          "request header policy names must use canonical order without duplicates"
      });
    }
  }

  if (
    REQUIRED_HEADER_NAMES.some(
      (headerName) => !value.allowedHeaderNames.includes(headerName)
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["allowedHeaderNames"],
      message:
        "request header policy must allow cache-control and pragma"
    });
  }

  const unknownHeaderName = value.allowedHeaderNames.find(
    (headerName) => !KNOWN_SAFE_HEADER_NAMES.has(headerName)
  );
  if (unknownHeaderName !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["allowedHeaderNames"],
      message: `request header policy must only allow known-safe header names; received ${unknownHeaderName}`
    });
  }
}
