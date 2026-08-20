import { z } from "zod";

import { verifyOfficialMarketCalendarCanonicalJsonObject } from "./officialMarketCalendarCanonicalJsonObject.js";
import { resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import { resolveRegisteredOfficialMarketCalendarRequestParameterPolicy } from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION =
  "official_market_calendar_request_header_value_policy_definition.v1";

const KNOWN_FIXED_VALUE_HEADER_NAMES = new Set(["user-agent"]);
const lowercaseHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9a-z]+$/,
    "request header value policy name must be a lowercase HTTP field name"
  );
const headerValueSchema = z
  .string()
  .min(1)
  .max(8_192)
  .regex(
    /^[\x21-\x7e](?:[\x09\x20-\x7e]*[\x21-\x7e])?$/,
    "request header value policy value must use non-empty canonical safe ASCII"
  );
const policyVersionSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "request header value policy version must use the registered ASCII grammar"
  );

export const officialMarketCalendarRequestHeaderValuePolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_DEFINITION_VERSION
    ),
    sourceSelector: z
      .object({
        exchange: z.enum(["KRX", "NYSE"]),
        requestMethod: z.enum(["GET", "POST"]),
        requestedUrl: z.string().min(1),
        requestHeaderPolicyVersion: policyVersionSchema,
        requestParameterPolicyVersion: policyVersionSchema
      })
      .strict(),
    fixedHeaderValues: z.record(lowercaseHeaderNameSchema, headerValueSchema)
  })
  .strict()
  .superRefine(validateDefinition);

export type OfficialMarketCalendarRequestHeaderValuePolicyDefinition = z.infer<
  typeof officialMarketCalendarRequestHeaderValuePolicyDefinitionSchema
>;

const registryEntrySchema = z
  .object({
    requestHeaderValuePolicyVersion: policyVersionSchema,
    requestHeaderValuePolicyDefinition:
      officialMarketCalendarRequestHeaderValuePolicyDefinitionSchema
  })
  .strict();

export type OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry =
  z.infer<typeof registryEntrySchema>;

export function parseOfficialMarketCalendarRequestHeaderValuePolicyDefinition(
  value: unknown
): OfficialMarketCalendarRequestHeaderValuePolicyDefinition {
  return officialMarketCalendarRequestHeaderValuePolicyDefinitionSchema.parse(
    value
  );
}

export function parseOfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry(
  value: unknown
): OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry {
  return registryEntrySchema.parse(value);
}

export function parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry(
  value: unknown
): OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry[] {
  const entries = z
    .array(z.unknown())
    .parse(value)
    .map(parseOfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry);
  const versions = new Set<string>();
  for (const entry of entries) {
    if (versions.has(entry.requestHeaderValuePolicyVersion)) {
      throw new Error(
        "official calendar request header value policy versions must be unique"
      );
    }
    versions.add(entry.requestHeaderValuePolicyVersion);
  }
  return entries;
}

export function resolveOfficialMarketCalendarRequestHeaderValuePolicyFromRegistry(
  requestHeaderValuePolicyVersion: unknown,
  registry: unknown
): OfficialMarketCalendarRequestHeaderValuePolicyRegistryEntry {
  const version = policyVersionSchema.parse(requestHeaderValuePolicyVersion);
  const entry = parseOfficialMarketCalendarRequestHeaderValuePolicyRegistry(
    registry
  ).find(
    (candidate) => candidate.requestHeaderValuePolicyVersion === version
  );
  if (entry === undefined) {
    throw new Error(
      "official calendar request header value policy version is not registered"
    );
  }
  return entry;
}

function validateDefinition(
  value: OfficialMarketCalendarRequestHeaderValuePolicyDefinition,
  context: z.RefinementCtx
): void {
  const selector = value.sourceSelector;
  let allowedHeaderNames: string[] | undefined;
  try {
    const headerPolicy =
      resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
        selector.requestHeaderPolicyVersion
      ).requestHeaderPolicyDefinition;
    allowedHeaderNames = headerPolicy.allowedHeaderNames;
    if (
      headerPolicy.sourceSelector.exchange !== selector.exchange ||
      headerPolicy.sourceSelector.requestedUrl !== selector.requestedUrl
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceSelector", "requestHeaderPolicyVersion"],
        message:
          "request header value policy must bind a header policy for the same source selector"
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["sourceSelector", "requestHeaderPolicyVersion"],
      message:
        error instanceof Error
          ? error.message
          : "request header value policy header policy is invalid"
    });
  }

  try {
    const parameterPolicy =
      resolveRegisteredOfficialMarketCalendarRequestParameterPolicy(
        selector.requestParameterPolicyVersion
      ).requestParameterPolicyDefinition.sourceSelector;
    if (
      parameterPolicy.exchange !== selector.exchange ||
      parameterPolicy.requestMethod !== selector.requestMethod ||
      parameterPolicy.requestedUrl !== selector.requestedUrl ||
      parameterPolicy.requestHeaderPolicyVersion !==
        selector.requestHeaderPolicyVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceSelector", "requestParameterPolicyVersion"],
        message:
          "request header value policy must bind a parameter policy for the same request selector"
      });
    }
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["sourceSelector", "requestParameterPolicyVersion"],
      message:
        error instanceof Error
          ? error.message
          : "request header value policy parameter policy is invalid"
    });
  }

  const headerNames = Object.keys(value.fixedHeaderValues);
  if (headerNames.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["fixedHeaderValues"],
      message: "request header value policy must contain fixed header values"
    });
  }
  try {
    verifyOfficialMarketCalendarCanonicalJsonObject(
      value.fixedHeaderValues,
      "fixedHeaderValues"
    );
  } catch (error) {
    context.addIssue({
      code: "custom",
      path: ["fixedHeaderValues"],
      message:
        error instanceof Error
          ? error.message
          : "request header value policy values are invalid"
    });
  }
  for (const headerName of headerNames) {
    if (!KNOWN_FIXED_VALUE_HEADER_NAMES.has(headerName)) {
      context.addIssue({
        code: "custom",
        path: ["fixedHeaderValues", headerName],
        message: `request header value policy must only contain known fixed-value names; received ${headerName}`
      });
    }
    if (
      allowedHeaderNames !== undefined &&
      !allowedHeaderNames.includes(headerName)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fixedHeaderValues", headerName],
        message:
          "request header value policy name must be allowed by the bound header policy"
      });
    }
  }
}
