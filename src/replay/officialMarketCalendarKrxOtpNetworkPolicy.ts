import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS,
  resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy
} from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS,
  resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy
} from "./officialMarketCalendarRequestHeaderValuePolicyRegistry.js";
import {
  OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS,
  resolveRegisteredOfficialMarketCalendarRequestParameterPolicy
} from "./officialMarketCalendarRequestParameterPolicyRegistry.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_otp_network_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION =
  "krx_form_otp_network_request.v1";

const KRX_OTP_URL =
  "https://global.krx.co.kr/contents/COM/GenerateOTP.jspx";

export const officialMarketCalendarKrxOtpNetworkPolicyDefinitionSchema = z
  .object({
    schemaVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_DEFINITION_VERSION
    ),
    policyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION
    ),
    requestHeaderPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP
    ),
    requestParameterPolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_FORM_OTP
    ),
    requestHeaderValuePolicyVersion: z.literal(
      OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS.KRX_FORM_OTP
    ),
    sourceSelector: z
      .object({
        exchange: z.literal("KRX"),
        requestMethod: z.literal("GET"),
        requestedUrl: z.literal(KRX_OTP_URL)
      })
      .strict()
      .readonly(),
    applicationRequestHeaderNames: z
      .tuple([
        z.literal("accept"),
        z.literal("cache-control"),
        z.literal("pragma"),
        z.literal("user-agent")
      ])
      .readonly(),
    fixedRequestHeaderValues: z
      .object({
        accept: z.literal("*/*"),
        cacheControl: z.literal("no-cache"),
        pragma: z.literal("no-cache"),
        userAgent: z.literal("Mozilla/5.0")
      })
      .strict()
      .readonly(),
    requestParameterOrder: z
      .tuple([z.literal("bld"), z.literal("name")])
      .readonly(),
    fixedRequestParameters: z
      .object({
        bld: z.literal("GLB/05/0501/0501110000/glb0501110000_01"),
        name: z.literal("form")
      })
      .strict()
      .readonly(),
    transportDerivedRequestHeaderValues: z
      .object({
        host: z.literal("global.krx.co.kr"),
        connection: z.literal("close")
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
        maximumResponseBodyByteLength: z.literal(1_024)
      })
      .strict()
      .readonly(),
    responseBoundary: z
      .object({
        requiredHttpProtocolVersion: z.literal("http_1_1"),
        requiredStatus: z.literal(200),
        requireContentLengthFraming: z.literal(true),
        observedContentType: z.literal("text/html;charset=UTF-8"),
        observedContentLength: z.literal(216),
        observedCacheControl: z.literal("max-age=0, no-cache, no-store"),
        observedPragma: z.literal("no-cache"),
        requireExpiresEqualDate: z.literal(true),
        requirePositiveSetCookieHeaderCount: z.literal(true),
        rejectAge: z.literal(true),
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
        rawOtpBytesProcessLocalOnly: z.literal(true),
        durableEvidenceReusable: z.literal(false),
        acceptedAcquisition: z.literal(false)
      })
      .strict()
      .readonly()
  })
  .strict()
  .readonly();

export type OfficialMarketCalendarKrxOtpNetworkPolicyDefinition = z.infer<
  typeof officialMarketCalendarKrxOtpNetworkPolicyDefinitionSchema
>;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_DEFINITION_VERSION,
  policyVersion: OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION,
  requestHeaderPolicyVersion:
    OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_POLICY_VERSIONS.KRX_FORM_OTP,
  requestParameterPolicyVersion:
    OFFICIAL_MARKET_CALENDAR_REQUEST_PARAMETER_POLICY_VERSIONS.KRX_FORM_OTP,
  requestHeaderValuePolicyVersion:
    OFFICIAL_MARKET_CALENDAR_REQUEST_HEADER_VALUE_POLICY_VERSIONS.KRX_FORM_OTP,
  sourceSelector: {
    exchange: "KRX",
    requestMethod: "GET",
    requestedUrl: KRX_OTP_URL
  },
  applicationRequestHeaderNames: [
    "accept",
    "cache-control",
    "pragma",
    "user-agent"
  ],
  fixedRequestHeaderValues: {
    accept: "*/*",
    cacheControl: "no-cache",
    pragma: "no-cache",
    userAgent: "Mozilla/5.0"
  },
  requestParameterOrder: ["bld", "name"],
  fixedRequestParameters: {
    bld: "GLB/05/0501/0501110000/glb0501110000_01",
    name: "form"
  },
  transportDerivedRequestHeaderValues: {
    host: "global.krx.co.kr",
    connection: "close"
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
    maximumResponseBodyByteLength: 1_024
  },
  responseBoundary: {
    requiredHttpProtocolVersion: "http_1_1",
    requiredStatus: 200,
    requireContentLengthFraming: true,
    observedContentType: "text/html;charset=UTF-8",
    observedContentLength: 216,
    observedCacheControl: "max-age=0, no-cache, no-store",
    observedPragma: "no-cache",
    requireExpiresEqualDate: true,
    requirePositiveSetCookieHeaderCount: true,
    rejectAge: true,
    rejectLocation: true,
    rejectContentEncoding: true,
    rejectTransferEncoding: true,
    rejectContentRange: true,
    rejectTrailers: true,
    responseSetCookieHandling: "count_without_value_retention_or_replay"
  },
  resultBoundary: {
    rawOtpBytesProcessLocalOnly: true,
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxOtpNetworkPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxOtpNetworkPolicyDefinition {
  return officialMarketCalendarKrxOtpNetworkPolicyDefinitionSchema.parse(value);
}

export function resolveRegisteredOfficialMarketCalendarKrxOtpNetworkPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxOtpNetworkPolicyDefinition {
  z.literal(OFFICIAL_MARKET_CALENDAR_KRX_OTP_NETWORK_POLICY_VERSION).parse(
    policyVersion
  );
  const definition =
    parseOfficialMarketCalendarKrxOtpNetworkPolicyDefinition(
      REGISTERED_POLICY_INPUT
    );
  const headerPolicy =
    resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
      definition.requestHeaderPolicyVersion
    ).requestHeaderPolicyDefinition;
  const parameterPolicy =
    resolveRegisteredOfficialMarketCalendarRequestParameterPolicy(
      definition.requestParameterPolicyVersion
    ).requestParameterPolicyDefinition;
  const headerValuePolicy =
    resolveRegisteredOfficialMarketCalendarRequestHeaderValuePolicy(
      definition.requestHeaderValuePolicyVersion
    ).requestHeaderValuePolicyDefinition;

  if (
    !isDeepStrictEqual(
      definition.applicationRequestHeaderNames,
      headerPolicy.allowedHeaderNames
    ) ||
    !isDeepStrictEqual(
      definition.fixedRequestParameters,
      parameterPolicy.requestParameters
    ) ||
    headerValuePolicy.fixedHeaderValues["user-agent"] !==
      definition.fixedRequestHeaderValues.userAgent ||
    headerPolicy.sourceSelector.exchange !== definition.sourceSelector.exchange ||
    headerPolicy.sourceSelector.requestedUrl !==
      definition.sourceSelector.requestedUrl ||
    !isDeepStrictEqual(parameterPolicy.sourceSelector, {
      ...definition.sourceSelector,
      requestHeaderPolicyVersion: definition.requestHeaderPolicyVersion
    }) ||
    !isDeepStrictEqual(headerValuePolicy.sourceSelector, {
      ...definition.sourceSelector,
      requestHeaderPolicyVersion: definition.requestHeaderPolicyVersion,
      requestParameterPolicyVersion: definition.requestParameterPolicyVersion
    })
  ) {
    throw new Error(
      "KRX OTP network policy must match registered request policies"
    );
  }
  return definition;
}
