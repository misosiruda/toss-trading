import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy
} from "./officialMarketCalendarKrxHolidayDataPostPolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy
} from "./officialMarketCalendarKrxHolidayDataPostWirePolicy.js";
import { OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_MAXIMUM_RESPONSE_BODY_BYTE_LENGTH } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_holiday_data_post_network_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION =
  "krx_holiday_data_post_network_request.v1";

const KRX_HOLIDAY_DATA_POST_URL =
  "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx";
const KRX_HOLIDAY_DATA_POST_HOST = "global.krx.co.kr";

export const officialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
      ),
      postPolicyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
      ),
      wirePolicyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION
      ),
      sourceSelector: z
        .object({
          exchange: z.literal("KRX"),
          requestMethod: z.literal("POST"),
          requestedUrl: z.literal(KRX_HOLIDAY_DATA_POST_URL)
        })
        .strict()
        .readonly(),
      applicationRequestHeaderNames: z
        .tuple([
          z.literal("accept"),
          z.literal("cache-control"),
          z.literal("content-length"),
          z.literal("content-type"),
          z.literal("pragma")
        ])
        .readonly(),
      transportDerivedRequestHeaderValues: z
        .object({
          host: z.literal(KRX_HOLIDAY_DATA_POST_HOST),
          connection: z.literal("close")
        })
        .strict()
        .readonly(),
      fixedRequestHeaderValues: z
        .object({
          accept: z.literal("*/*"),
          cacheControl: z.literal("no-cache"),
          contentType: z.literal(
            "application/x-www-form-urlencoded; charset=UTF-8"
          ),
          pragma: z.literal("no-cache")
        })
        .strict()
        .readonly(),
      derivedRequestHeaderBindings: z
        .object({
          contentLength: z.literal("exact_wire_body_byte_length")
        })
        .strict()
        .readonly(),
      requestIsolation: z
        .object({
          automaticRedirectFollow: z.literal(false),
          cookieJarEnabled: z.literal(false),
          requestCookieHeaderCount: z.literal(0),
          requestAuthorizationHeaderCount: z.literal(0),
          requestProxyAuthorizationHeaderCount: z.literal(0),
          connectionReuseEnabled: z.literal(false)
        })
        .strict()
        .readonly(),
      networkLimits: z
        .object({
          absoluteDeadlineMilliseconds: z.literal(10_000),
          maximumRequestBodyByteLength: z.literal(1_024),
          maximumResponseBodyByteLength: z.literal(1_000_000)
        })
        .strict()
        .readonly(),
      responseBoundary: z
        .object({
          requiredHttpProtocolVersion: z.literal("http_1_1"),
          requiredStatus: z.literal(200),
          requireContentLengthFraming: z.literal(true),
          rejectLocation: z.literal(true),
          rejectContentEncoding: z.literal(true),
          rejectTransferEncoding: z.literal(true),
          rejectContentRange: z.literal(true),
          rejectTrailers: z.literal(true),
          responseSetCookieHandling: z.literal(
            "count_without_value_retention_or_replay"
          )
        })
        .strict()
        .readonly(),
      resultBoundary: z
        .object({
          rawResponseBytesProcessLocalOnly: z.literal(true),
          durableEvidenceReusable: z.literal(false),
          acceptedAcquisition: z.literal(false)
        })
        .strict()
        .readonly()
    })
    .strict()
    .readonly();

export type OfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION,
  postPolicyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  wirePolicyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_WIRE_POLICY_VERSION,
  sourceSelector: {
    exchange: "KRX",
    requestMethod: "POST",
    requestedUrl: KRX_HOLIDAY_DATA_POST_URL
  },
  applicationRequestHeaderNames: [
    "accept",
    "cache-control",
    "content-length",
    "content-type",
    "pragma"
  ],
  transportDerivedRequestHeaderValues: {
    host: KRX_HOLIDAY_DATA_POST_HOST,
    connection: "close"
  },
  fixedRequestHeaderValues: {
    accept: "*/*",
    cacheControl: "no-cache",
    contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    pragma: "no-cache"
  },
  derivedRequestHeaderBindings: {
    contentLength: "exact_wire_body_byte_length"
  },
  requestIsolation: {
    automaticRedirectFollow: false,
    cookieJarEnabled: false,
    requestCookieHeaderCount: 0,
    requestAuthorizationHeaderCount: 0,
    requestProxyAuthorizationHeaderCount: 0,
    connectionReuseEnabled: false
  },
  networkLimits: {
    absoluteDeadlineMilliseconds: 10_000,
    maximumRequestBodyByteLength: 1_024,
    maximumResponseBodyByteLength: 1_000_000
  },
  responseBoundary: {
    requiredHttpProtocolVersion: "http_1_1",
    requiredStatus: 200,
    requireContentLengthFraming: true,
    rejectLocation: true,
    rejectContentEncoding: true,
    rejectTransferEncoding: true,
    rejectContentRange: true,
    rejectTrailers: true,
    responseSetCookieHandling: "count_without_value_retention_or_replay"
  },
  resultBoundary: {
    rawResponseBytesProcessLocalOnly: true,
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition {
  return officialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostNetworkPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_NETWORK_POLICY_VERSION
  ).parse(policyVersion);
  const definition =
    parseOfficialMarketCalendarKrxHolidayDataPostNetworkPolicyDefinition(
      REGISTERED_POLICY_INPUT
    );
  const postPolicy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
      definition.postPolicyVersion
    );
  const wirePolicy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostWirePolicy(
      definition.wirePolicyVersion
    );

  if (
    !isDeepStrictEqual(definition.sourceSelector, postPolicy.sourceSelector) ||
    !isDeepStrictEqual(definition.sourceSelector, wirePolicy.sourceSelector)
  ) {
    throw new Error(
      "KRX holiday data POST network policy must match registered source selectors"
    );
  }
  if (
    definition.fixedRequestHeaderValues.contentType !==
      wirePolicy.requestContentType ||
    definition.networkLimits.maximumRequestBodyByteLength !==
      wirePolicy.maximumRequestBodyByteLength ||
    definition.networkLimits.maximumResponseBodyByteLength !==
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_MAXIMUM_RESPONSE_BODY_BYTE_LENGTH
  ) {
    throw new Error(
      "KRX holiday data POST network policy must match registered wire and response limits"
    );
  }

  return definition;
}
