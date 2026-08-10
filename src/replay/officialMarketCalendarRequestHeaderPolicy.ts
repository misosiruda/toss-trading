import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";

export const OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_DEFINITION_VERSION =
  "official_market_calendar_request_header_policy_definition.v1";

const REQUIRED_HEADER_NAMES = ["cache-control", "pragma"] as const;
const HARD_PROHIBITED_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "proxy-authorization",
  "range"
]);
const CREDENTIAL_HEADER_NAME_PATTERN =
  /(?:^|[-_])(?:api[-_]?key|token|secret)(?:$|[-_])/;

const lowercaseHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9a-z]+$/,
    "request header policy name must be a lowercase HTTP field name"
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

export function parseOfficialMarketCalendarRequestHeaderPolicyDefinition(
  value: unknown
): OfficialMarketCalendarRequestHeaderPolicyDefinition {
  return officialMarketCalendarRequestHeaderPolicyDefinitionSchema.parse(
    value
  );
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

  const hardProhibitedHeaderName = value.allowedHeaderNames.find(
    (headerName) =>
      HARD_PROHIBITED_HEADER_NAMES.has(headerName) ||
      CREDENTIAL_HEADER_NAME_PATTERN.test(headerName)
  );
  if (hardProhibitedHeaderName !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["allowedHeaderNames"],
      message: `request header policy must not allow hard-prohibited header ${hardProhibitedHeaderName}`
    });
  }
}
