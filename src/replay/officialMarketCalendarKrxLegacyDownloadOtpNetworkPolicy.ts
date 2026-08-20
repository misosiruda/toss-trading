import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_legacy_download_otp_network_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION =
  "krx_legacy_download_otp_network_request.v1";

const KRX_GLOBAL_ORIGIN = "https://global.krx.co.kr";
const KRX_LEGACY_CALENDAR_SOURCE_PAGE_URL =
  `${KRX_GLOBAL_ORIGIN}/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp`;
const KRX_LEGACY_DOWNLOAD_OTP_URL =
  `${KRX_GLOBAL_ORIGIN}/contents/COM/GenerateOTP.jspx`;

export const officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION
      ),
      sourcePolicyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
      ),
      sourceSelector: z
        .object({
          exchange: z.literal("KRX"),
          marketScope: z.literal("derivatives"),
          requestMethod: z.literal("GET"),
          requestedUrl: z.literal(KRX_LEGACY_DOWNLOAD_OTP_URL)
        })
        .strict()
        .readonly(),
      applicationRequestHeaderNames: z
        .tuple([
          z.literal("accept"),
          z.literal("cache-control"),
          z.literal("pragma"),
          z.literal("referer"),
          z.literal("user-agent")
        ])
        .readonly(),
      fixedRequestHeaderValues: z
        .object({
          accept: z.literal("*/*"),
          cacheControl: z.literal("no-cache"),
          pragma: z.literal("no-cache"),
          referer: z.literal(KRX_LEGACY_CALENDAR_SOURCE_PAGE_URL),
          userAgent: z.literal("Mozilla/5.0")
        })
        .strict()
        .readonly(),
      requestParameterOrder: z
        .tuple([
          z.literal("name"),
          z.literal("filetype"),
          z.literal("url"),
          z.literal("file_nm")
        ])
        .readonly(),
      fixedRequestParameters: z
        .object({
          name: z.literal("fileDown"),
          filetype: z.literal("att"),
          url: z.literal("MKD/01/0110/01100303/mkd01100303_DN")
        })
        .strict()
        .readonly(),
      dynamicRequestParameterBinding: z
        .object({
          fileNameParameter: z.literal("file_nm"),
          allowedValues: z
            .tuple([
              z.literal("E_Trading_Calendar2013.doc"),
              z.literal("E_Trading_Calendar2014.doc"),
              z.literal("E_Trading_Calendar2015.doc")
            ])
            .readonly()
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
          observedContentLength: z.literal(300),
          observedCacheControl: z.literal("max-age=0, no-cache, no-store"),
          observedPragma: z.literal("no-cache"),
          requireExpiresEqualDate: z.literal(true),
          observedSetCookieHeaderCount: z.literal(2),
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
      otpBodyBoundary: z
        .object({
          requiredAsciiByteLength: z.literal(300),
          requiredEncoding: z.literal("canonical_base64"),
          requiredDecodedByteLength: z.literal(224),
          requiredPaddingCharacterCount: z.literal(1)
        })
        .strict()
        .readonly(),
      resultBoundary: z
        .object({
          rawOtpBytesProcessLocalOnly: z.literal(true),
          rawOtpRetention: z.literal("forbidden"),
          durableEvidenceReusable: z.literal(false),
          acceptedAcquisition: z.literal(false)
        })
        .strict()
        .readonly()
    })
    .strict()
    .readonly();

export type OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION,
  sourcePolicyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  sourceSelector: {
    exchange: "KRX",
    marketScope: "derivatives",
    requestMethod: "GET",
    requestedUrl: KRX_LEGACY_DOWNLOAD_OTP_URL
  },
  applicationRequestHeaderNames: [
    "accept",
    "cache-control",
    "pragma",
    "referer",
    "user-agent"
  ],
  fixedRequestHeaderValues: {
    accept: "*/*",
    cacheControl: "no-cache",
    pragma: "no-cache",
    referer: KRX_LEGACY_CALENDAR_SOURCE_PAGE_URL,
    userAgent: "Mozilla/5.0"
  },
  requestParameterOrder: ["name", "filetype", "url", "file_nm"],
  fixedRequestParameters: {
    name: "fileDown",
    filetype: "att",
    url: "MKD/01/0110/01100303/mkd01100303_DN"
  },
  dynamicRequestParameterBinding: {
    fileNameParameter: "file_nm",
    allowedValues: [
      "E_Trading_Calendar2013.doc",
      "E_Trading_Calendar2014.doc",
      "E_Trading_Calendar2015.doc"
    ]
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
    observedContentLength: 300,
    observedCacheControl: "max-age=0, no-cache, no-store",
    observedPragma: "no-cache",
    requireExpiresEqualDate: true,
    observedSetCookieHeaderCount: 2,
    rejectAge: true,
    rejectLocation: true,
    rejectContentEncoding: true,
    rejectTransferEncoding: true,
    rejectContentRange: true,
    rejectTrailers: true,
    responseSetCookieHandling: "count_without_value_retention_or_replay"
  },
  otpBodyBoundary: {
    requiredAsciiByteLength: 300,
    requiredEncoding: "canonical_base64",
    requiredDecodedByteLength: 224,
    requiredPaddingCharacterCount: 1
  },
  resultBoundary: {
    rawOtpBytesProcessLocalOnly: true,
    rawOtpRetention: "forbidden",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition {
  return officialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_NETWORK_POLICY_VERSION
  ).parse(policyVersion);
  const definition =
    parseOfficialMarketCalendarKrxLegacyDownloadOtpNetworkPolicyDefinition(
      REGISTERED_POLICY_INPUT
    );
  const sourcePolicy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      definition.sourcePolicyVersion
    );

  if (
    definition.sourceSelector.exchange !== sourcePolicy.observation.exchange ||
    definition.sourceSelector.marketScope !==
      sourcePolicy.observation.marketScope ||
    definition.sourceSelector.requestMethod !== sourcePolicy.otpRequest.method ||
    definition.sourceSelector.requestedUrl !==
      sourcePolicy.otpRequest.requestedUrl ||
    definition.fixedRequestHeaderValues.referer !==
      sourcePolicy.observation.sourcePageUrl ||
    !isDeepStrictEqual(
      definition.fixedRequestParameters,
      sourcePolicy.otpRequest.fixedParameters
    ) ||
    definition.dynamicRequestParameterBinding.fileNameParameter !==
      sourcePolicy.otpRequest.dynamicParameterNames[0] ||
    !isDeepStrictEqual(
      definition.dynamicRequestParameterBinding.allowedValues,
      sourcePolicy.documents.map((document) => document.fileName)
    )
  ) {
    throw new Error(
      "KRX legacy download OTP network policy must match the registered source policy"
    );
  }

  return definition;
}
