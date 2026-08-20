import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_DEFINITION_VERSION =
  "official_market_calendar_krx_legacy_download_post_wire_policy_definition.v1";
export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION =
  "krx_legacy_download_post_wire.v1";

const DOWNLOAD_REQUEST_URL = "https://file.krx.co.kr/download.jspx";

export const officialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinitionSchema =
  z
    .object({
      schemaVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_DEFINITION_VERSION
      ),
      policyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION
      ),
      sourcePolicyVersion: z.literal(
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
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
      requestContentType: z.literal("application/x-www-form-urlencoded"),
      parameterOrder: z.tuple([z.literal("code")]).readonly(),
      parameterValueSource: z.literal(
        "bound_process_local_otp_parameter_handle_only"
      ),
      encodingBoundary: z
        .object({
          sourceByteEncoding: z.literal("ascii"),
          literalByteCategory: z.literal("rfc3986_unreserved"),
          plusByteEncoding: z.literal("%2B"),
          slashByteEncoding: z.literal("%2F"),
          equalsByteEncoding: z.literal("%3D"),
          percentHexCase: z.literal("uppercase"),
          spaceAsPlusAllowed: z.literal(false)
        })
        .strict()
        .readonly(),
      wireLimits: z
        .object({
          exactRawOtpByteLength: z.literal(300),
          parameterNameAndEqualsByteLength: z.literal(5),
          minimumRequestBodyByteLength: z.literal(307),
          maximumRequestBodyByteLength: z.literal(903)
        })
        .strict()
        .readonly(),
      resultBoundary: z
        .object({
          rawOtpStringMaterializationAllowed: z.literal(false),
          encodedBodyProcessLocalOnly: z.literal(true),
          durableEvidenceReusable: z.literal(false),
          acceptedAcquisition: z.literal(false)
        })
        .strict()
        .readonly()
    })
    .strict()
    .readonly();

export type OfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition =
  z.infer<
    typeof officialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinitionSchema
  >;

const REGISTERED_POLICY_INPUT = {
  schemaVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_DEFINITION_VERSION,
  policyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION,
  sourcePolicyVersion:
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  sourceSelector: {
    exchange: "KRX",
    marketScope: "derivatives",
    requestMethod: "POST",
    requestedUrl: DOWNLOAD_REQUEST_URL
  },
  requestContentType: "application/x-www-form-urlencoded",
  parameterOrder: ["code"],
  parameterValueSource: "bound_process_local_otp_parameter_handle_only",
  encodingBoundary: {
    sourceByteEncoding: "ascii",
    literalByteCategory: "rfc3986_unreserved",
    plusByteEncoding: "%2B",
    slashByteEncoding: "%2F",
    equalsByteEncoding: "%3D",
    percentHexCase: "uppercase",
    spaceAsPlusAllowed: false
  },
  wireLimits: {
    exactRawOtpByteLength: 300,
    parameterNameAndEqualsByteLength: 5,
    minimumRequestBodyByteLength: 307,
    maximumRequestBodyByteLength: 903
  },
  resultBoundary: {
    rawOtpStringMaterializationAllowed: false,
    encodedBodyProcessLocalOnly: true,
    durableEvidenceReusable: false,
    acceptedAcquisition: false
  }
} as const;

export function parseOfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition(
  value: unknown
): OfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition {
  return officialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinitionSchema.parse(
    value
  );
}

export function resolveRegisteredOfficialMarketCalendarKrxLegacyDownloadPostWirePolicy(
  policyVersion: unknown
): OfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition {
  z.literal(
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_POST_WIRE_POLICY_VERSION
  ).parse(policyVersion);
  const definition =
    parseOfficialMarketCalendarKrxLegacyDownloadPostWirePolicyDefinition(
      REGISTERED_POLICY_INPUT
    );
  const sourcePolicy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      definition.sourcePolicyVersion
    );

  if (
    !isDeepStrictEqual(definition.sourceSelector, {
      exchange: sourcePolicy.observation.exchange,
      marketScope: sourcePolicy.observation.marketScope,
      requestMethod: sourcePolicy.downloadRequest.method,
      requestedUrl: sourcePolicy.downloadRequest.requestedUrl
    }) ||
    definition.requestContentType !==
      sourcePolicy.downloadRequest.requestContentType ||
    !isDeepStrictEqual(
      definition.parameterOrder,
      sourcePolicy.downloadRequest.dynamicParameterNames
    )
  ) {
    throw new Error(
      "KRX legacy download POST wire policy must match the registered source policy"
    );
  }

  return definition;
}
