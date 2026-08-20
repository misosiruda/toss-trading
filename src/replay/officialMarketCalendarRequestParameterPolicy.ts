import { z } from "zod";

import { verifyOfficialMarketCalendarCanonicalJsonObject } from "./officialMarketCalendarCanonicalJsonObject.js";
import {
  OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";
import { resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION =
  "official_market_calendar_request_parameter_policy_definition.v1";

const KNOWN_SAFE_PARAMETER_NAMES = new Set(["bld", "name"]);
const parameterNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "request parameter policy name must use lowercase safe grammar"
  );
const parameterValueSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(
    /^[\x21-\x7e]+$/,
    "request parameter policy value must use non-empty visible ASCII"
  );
const policyVersionSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "request parameter policy version must use the registered ASCII grammar"
  );

export const officialMarketCalendarRequestParameterPolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_DEFINITION_VERSION
    ),
    sourceSelector: z
      .object({
        exchange: z.enum(["KRX", "NYSE"]),
        requestMethod: z.enum(["GET", "POST"]),
        requestedUrl: z.string().min(1),
        requestHeaderPolicyVersion: policyVersionSchema
      })
      .strict(),
    requestParameters: z.record(parameterNameSchema, parameterValueSchema)
  })
  .strict()
  .superRefine(validateDefinition);

export type OfficialMarketCalendarRequestParameterPolicyDefinition = z.infer<
  typeof officialMarketCalendarRequestParameterPolicyDefinitionSchema
>;

const registryEntrySchema = z
  .object({
    requestParameterPolicyVersion: policyVersionSchema,
    requestParameterPolicyDefinition:
      officialMarketCalendarRequestParameterPolicyDefinitionSchema
  })
  .strict();

export type OfficialMarketCalendarRequestParameterPolicyRegistryEntry =
  z.infer<typeof registryEntrySchema>;

export function parseOfficialMarketCalendarRequestParameterPolicyDefinition(
  value: unknown
): OfficialMarketCalendarRequestParameterPolicyDefinition {
  return officialMarketCalendarRequestParameterPolicyDefinitionSchema.parse(
    value
  );
}

export function parseOfficialMarketCalendarRequestParameterPolicyRegistryEntry(
  value: unknown
): OfficialMarketCalendarRequestParameterPolicyRegistryEntry {
  return registryEntrySchema.parse(value);
}

export function parseOfficialMarketCalendarRequestParameterPolicyRegistry(
  value: unknown
): OfficialMarketCalendarRequestParameterPolicyRegistryEntry[] {
  const entries = z
    .array(z.unknown())
    .parse(value)
    .map(parseOfficialMarketCalendarRequestParameterPolicyRegistryEntry);
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.requestParameterPolicyVersion)) {
      throw new Error(
        "official calendar request parameter policy versions must be unique"
      );
    }
    versions.add(entry.requestParameterPolicyVersion);
  }
  return entries;
}

export function resolveOfficialMarketCalendarRequestParameterPolicyFromRegistry(
  requestParameterPolicyVersion: unknown,
  registry: unknown
): OfficialMarketCalendarRequestParameterPolicyRegistryEntry {
  const version = policyVersionSchema.parse(requestParameterPolicyVersion);
  const entry = parseOfficialMarketCalendarRequestParameterPolicyRegistry(
    registry
  ).find(
    (candidate) => candidate.requestParameterPolicyVersion === version
  );
  if (entry === undefined) {
    throw new Error(
      "official calendar request parameter policy version is not registered"
    );
  }
  return entry;
}

function validateDefinition(
  value: OfficialMarketCalendarRequestParameterPolicyDefinition,
  context: z.RefinementCtx
): void {
  const selector = value.sourceSelector;
  try {
    verifyOfficialMarketCalendarDomainAllowlist({
      exchange: selector.exchange,
      domainAllowlistPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
      urls: [selector.requestedUrl]
    });
    const requestedUrl = new URL(selector.requestedUrl);
    if (requestedUrl.search !== "" || requestedUrl.hash !== "") {
      context.addIssue({
        code: "custom",
        path: ["sourceSelector", "requestedUrl"],
        message:
          "request parameter policy URL must not contain query or fragment"
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["sourceSelector", "requestedUrl"],
      message:
        error instanceof Error
          ? error.message
          : "request parameter policy requested URL is invalid"
    });
  }

  try {
    const headerPolicy =
      resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
        selector.requestHeaderPolicyVersion
      ).requestHeaderPolicyDefinition.sourceSelector;
    if (
      headerPolicy.exchange !== selector.exchange ||
      headerPolicy.requestedUrl !== selector.requestedUrl
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceSelector", "requestHeaderPolicyVersion"],
        message:
          "request parameter policy must bind a header policy for the same source selector"
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["sourceSelector", "requestHeaderPolicyVersion"],
      message:
        error instanceof Error
          ? error.message
          : "request parameter policy header policy is invalid"
    });
  }

  const parameterNames = Object.keys(value.requestParameters);
  if (parameterNames.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["requestParameters"],
      message: "request parameter policy must contain fixed parameters"
    });
  }
  try {
    verifyOfficialMarketCalendarCanonicalJsonObject(
      value.requestParameters,
      "requestParameters"
    );
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["requestParameters"],
      message:
        error instanceof Error
          ? error.message
          : "request parameter policy parameters are invalid"
    });
  }
  const unknownParameterName = parameterNames.find(
    (parameterName) => !KNOWN_SAFE_PARAMETER_NAMES.has(parameterName)
  );
  if (unknownParameterName !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["requestParameters", unknownParameterName],
      message: `request parameter policy must only contain known-safe names; received ${unknownParameterName}`
    });
  }
}
