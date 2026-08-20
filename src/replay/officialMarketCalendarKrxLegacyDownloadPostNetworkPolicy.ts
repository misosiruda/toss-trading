import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy
} from "./officialMarketCalendarKrxLegacyDownloadPostWirePolicy.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_legacy_download_post_network_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION =
  "krx_legacy_download_post_network_request.v1";

const SOURCE_PAGE_URL =
  "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp";
const DOWNLOAD_REQUEST_URL = "https://file.krx.co.kr/download.jspx";

export const officialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION
      ),
      sourcePolicyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
      ),
      wirePolicyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION
      ),
      sourceSelector: z
        .object({
          exchange: z.literal("KRX"),
          marketScope: z.literal("derivatives"),
          requestMethod: z.literal("POST"),
          requestedUrl: z.literal(DOWNLOAD_REQUEST_URL)
        })
        .strict()
        .readonly(),
      dedicatedDomainBoundary: z
        .object({
          policyVersion: z.literal("krx_file_download_host.v1"),
          scheme: z.literal("https:"),
          hostname: z.literal("file.krx.co.kr"),
          port: z.literal(""),
          pathname: z.literal("/download.jspx"),
          search: z.literal(""),
          hash: z.literal("")
        })
        .strict()
        .readonly(),
      applicationRequestHeaderNames: z
        .tuple([
          z.literal("accept"),
          z.literal("cache-control"),
          z.literal("content-length"),
          z.literal("content-type"),
          z.literal("origin"),
          z.literal("pragma"),
          z.literal("referer"),
          z.literal("user-agent")
        ])
        .readonly(),
      fixedRequestHeaderValues: z
        .object({
          accept: z.literal("*/*"),
          cacheControl: z.literal("no-cache"),
          contentType: z.literal("application/x-www-form-urlencoded"),
          origin: z.literal("https://global.krx.co.kr"),
          pragma: z.literal("no-cache"),
          referer: z.literal(SOURCE_PAGE_URL),
          userAgent: z.literal("Mozilla/5.0")
        })
        .strict()
        .readonly(),
      derivedRequestHeaderBindings: z
        .object({
          contentLength: z.literal("exact_wire_body_byte_length")
        })
        .strict()
        .readonly(),
      transportDerivedRequestHeaderValues: z
        .object({
          host: z.literal("file.krx.co.kr"),
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
          maximumRequestBodyByteLength: z.literal(903),
          maximumResponseBodyByteLength: z.literal(252_928)
        })
        .strict()
        .readonly(),
      responseBoundary: z
        .object({
          requiredHttpProtocolVersion: z.literal("http_1_1"),
          requiredStatus: z.literal(200),
          requireContentLengthFraming: z.literal(true),
          requiredContentType: z.literal("application/octet-stream"),
          contentLengthBinding: z.literal(
            "registered_document_exact_content_length"
          ),
          contentDispositionBinding: z.literal(
            "attachment_exact_registered_file_name"
          ),
          observedCacheControl: z.literal(
            "max-age=0, no-cache, no-store"
          ),
          observedPragma: z.literal("no-cache"),
          requireExpiresEqualDate: z.literal(true),
          requiredSetCookieHeaderCount: z.literal(0),
          rejectAge: z.literal(true),
          rejectLocation: z.literal(true),
          rejectContentEncoding: z.literal(true),
          rejectTransferEncoding: z.literal(true),
          rejectContentRange: z.literal(true),
          rejectTrailers: z.literal(true)
        })
        .strict()
        .readonly(),
      resultBoundary: z
        .object({
          rawDocumentBytesProcessLocalOnly: z.literal(true),
          rawDocumentRetention: z.literal("not_registered_by_policy"),
          durableEvidenceReusable: z.literal(false),
          acceptedAcquisition: z.literal(false)
        })
        .strict()
        .readonly()
    })
    .strict()
    .readonly();

export type OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION,
  sourcePolicyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  wirePolicyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION,
  sourceSelector: {
    exchange: "KRX",
    marketScope: "derivatives",
    requestMethod: "POST",
    requestedUrl: DOWNLOAD_REQUEST_URL
  },
  dedicatedDomainBoundary: {
    policyVersion: "krx_file_download_host.v1",
    scheme: "https:",
    hostname: "file.krx.co.kr",
    port: "",
    pathname: "/download.jspx",
    search: "",
    hash: ""
  },
  applicationRequestHeaderNames: [
    "accept",
    "cache-control",
    "content-length",
    "content-type",
    "origin",
    "pragma",
    "referer",
    "user-agent"
  ],
  fixedRequestHeaderValues: {
    accept: "*/*",
    cacheControl: "no-cache",
    contentType: "application/x-www-form-urlencoded",
    origin: "https://global.krx.co.kr",
    pragma: "no-cache",
    referer: SOURCE_PAGE_URL,
    userAgent: "Mozilla/5.0"
  },
  derivedRequestHeaderBindings: {
    contentLength: "exact_wire_body_byte_length"
  },
  transportDerivedRequestHeaderValues: {
    host: "file.krx.co.kr",
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
    maximumRequestBodyByteLength: 903,
    maximumResponseBodyByteLength: 252_928
  },
  responseBoundary: {
    requiredHttpProtocolVersion: "http_1_1",
    requiredStatus: 200,
    requireContentLengthFraming: true,
    requiredContentType: "application/octet-stream",
    contentLengthBinding: "registered_document_exact_content_length",
    contentDispositionBinding: "attachment_exact_registered_file_name",
    observedCacheControl: "max-age=0, no-cache, no-store",
    observedPragma: "no-cache",
    requireExpiresEqualDate: true,
    requiredSetCookieHeaderCount: 0,
    rejectAge: true,
    rejectLocation: true,
    rejectContentEncoding: true,
    rejectTransferEncoding: true,
    rejectContentRange: true,
    rejectTrailers: true
  },
  resultBoundary: {
    rawDocumentBytesProcessLocalOnly: true,
    rawDocumentRetention: "not_registered_by_policy",
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition {
  return officialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_NETWORK_POLICY_VERSION
  ).parse(policyVersion);
  const definition =
    parseOfficialMarketCalendarKrxLegacyDownloadPostNetworkPolicyDefinition(
      REGISTERED_POLICY_INPUT
    );
  const sourcePolicy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      definition.sourcePolicyVersion
    );
  const wirePolicy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy(
      definition.wirePolicyVersion
    );
  const parsedUrl = new URL(definition.sourceSelector.requestedUrl);

  if (
    !isDeepStrictEqual(definition.sourceSelector, wirePolicy.sourceSelector) ||
    definition.fixedRequestHeaderValues.contentType !==
      wirePolicy.requestContentType ||
    definition.networkLimits.maximumRequestBodyByteLength !==
      wirePolicy.wireLimits.maximumRequestBodyByteLength ||
    definition.networkLimits.maximumResponseBodyByteLength !==
      Math.max(
        ...sourcePolicy.documents.map((document) => document.contentLength)
      ) ||
    !isDeepStrictEqual(definition.dedicatedDomainBoundary, {
      policyVersion: "krx_file_download_host.v1",
      scheme: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      hash: parsedUrl.hash
    }) ||
    definition.fixedRequestHeaderValues.origin !==
      sourcePolicy.downloadRequest.observedOrigin ||
    definition.fixedRequestHeaderValues.referer !==
      sourcePolicy.downloadRequest.observedReferer ||
    definition.requestIsolation.automaticRedirectFollow !==
      sourcePolicy.downloadRequest.automaticRedirectFollow ||
    definition.requestIsolation.cookieJarEnabled !==
      sourcePolicy.downloadRequest.cookieJarEnabled ||
    definition.requestIsolation.requestAuthorizationHeaderCount !==
      sourcePolicy.downloadRequest.credentialHeaderCount ||
    definition.requestIsolation.requestProxyAuthorizationHeaderCount !==
      sourcePolicy.downloadRequest.credentialHeaderCount ||
    definition.responseBoundary.requiredStatus !==
      sourcePolicy.observedResponse.httpStatus ||
    definition.responseBoundary.requiredContentType !==
      sourcePolicy.observedResponse.contentType ||
    definition.responseBoundary.contentDispositionBinding !==
      "attachment_exact_registered_file_name" ||
    sourcePolicy.observedResponse.contentDispositionBinding !==
      "attachment_exact_file_name" ||
    definition.responseBoundary.rejectLocation !==
      (sourcePolicy.observedResponse.redirectLocationHeaderCount === 0) ||
    definition.resultBoundary.rawDocumentRetention !==
      sourcePolicy.safetyBoundary.rawDocumentRetention ||
    definition.resultBoundary.durableEvidenceReusable !==
      sourcePolicy.safetyBoundary.durableEvidenceReusable ||
    definition.resultBoundary.acceptedAcquisition !==
      sourcePolicy.safetyBoundary.acceptedAcquisition
  ) {
    throw new Error(
      "KRX legacy download POST network policy must match registered source and wire policies"
    );
  }

  return definition;
}
