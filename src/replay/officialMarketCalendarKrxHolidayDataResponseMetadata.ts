import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy
} from "./officialMarketCalendarKrxHolidayDataPostPolicy.js";
import {
  parseOfficialMarketCalendarNetworkResponseCacheHeaders,
  type OfficialMarketCalendarNetworkResponseCacheHeaders
} from "./officialMarketCalendarResponseCacheHeaders.js";
import {
  parseOfficialMarketCalendarResponseCacheControl,
  type OfficialMarketCalendarResponseCacheControl
} from "./officialMarketCalendarResponseCacheControl.js";
import {
  verifyOfficialMarketCalendarTransferCompletion,
  type OfficialMarketCalendarTransferCompletion
} from "./officialMarketCalendarTransferCompletion.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION =
  "krx_holiday_data_response_metadata.v1";

const MAXIMUM_BODY_BYTE_LENGTH = 1_000_000;
const EXPECTED_CACHE_CONTROL = ["max-age=0", "no-cache", "no-store"] as const;
const DURABLE_REJECTION_REASONS = [
  "cache_control_max_age_zero",
  "cache_control_no_cache",
  "cache_control_no_store",
  "expires_not_after_response_date",
  "response_sets_cookie"
] as const;

const headerValueSchema = z
  .string()
  .min(1)
  .max(8_192)
  .regex(
    /^[\x20-\x7e]+$/,
    "KRX holiday data response header values must use visible ASCII or spaces"
  );
const headerValuesSchema = z.array(headerValueSchema).max(16);

const responseMetadataInputSchema = z
  .object({
    requestIsolation: z
      .object({
        automaticRedirectFollow: z.literal(false),
        cookieJarEnabled: z.literal(false),
        requestCookieHeaderCount: z.literal(0)
      })
      .strict(),
    responseUrl: z.string().min(1).max(2_048),
    httpStatus: z.number().int(),
    redirectLocationHeaderValues: headerValuesSchema,
    contentTypeHeaderValues: headerValuesSchema,
    contentEncodingHeaderValues: headerValuesSchema,
    transferEncodingHeaderValues: headerValuesSchema,
    pragmaHeaderValues: headerValuesSchema,
    setCookieHeaderCount: z.number().int().nonnegative().max(100),
    responseCacheHeaders: z.record(z.string(), z.unknown()),
    responseCacheControl: z.record(z.string(), z.unknown()),
    transferCompletion: z.record(z.string(), z.unknown())
  })
  .strict();

export interface OfficialMarketCalendarKrxHolidayDataResponseMetadata {
  responseMetadataVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION;
  requestIsolation: Readonly<{
    automaticRedirectFollow: false;
    cookieJarEnabled: false;
    requestCookieHeaderCount: 0;
  }>;
  responseUrl: string;
  httpStatus: 200;
  contentType: "text/html; charset=UTF-8";
  responseCacheHeaders: OfficialMarketCalendarNetworkResponseCacheHeaders;
  responseCacheControl: OfficialMarketCalendarResponseCacheControl;
  transferCompletion: OfficialMarketCalendarTransferCompletion;
  setCookieHeaderCount: number;
  bodyValidationEligible: true;
  durableEvidenceReusable: false;
  acceptedAcquisition: false;
  durableRejectionReasons: readonly [
    "cache_control_max_age_zero",
    "cache_control_no_cache",
    "cache_control_no_store",
    "expires_not_after_response_date",
    "response_sets_cookie"
  ];
}

export function verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata(
  value: unknown
): OfficialMarketCalendarKrxHolidayDataResponseMetadata {
  const input = responseMetadataInputSchema.parse(value);
  const postPolicy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
    );
  if (input.responseUrl !== postPolicy.sourceSelector.requestedUrl) {
    throw new Error(
      "KRX holiday data response URL must match the registered POST target"
    );
  }
  if (input.httpStatus !== 200) {
    throw new Error("KRX holiday data response status must be exactly 200");
  }
  if (input.redirectLocationHeaderValues.length !== 0) {
    throw new Error(
      "KRX holiday data response must not contain a redirect Location"
    );
  }
  if (
    !isDeepStrictEqual(input.contentTypeHeaderValues, [
      "text/html; charset=UTF-8"
    ])
  ) {
    throw new Error(
      "KRX holiday data response Content-Type must match the observed value"
    );
  }
  if (input.contentEncodingHeaderValues.length !== 0) {
    throw new Error(
      "KRX holiday data response must not contain Content-Encoding"
    );
  }
  if (input.transferEncodingHeaderValues.length !== 0) {
    throw new Error(
      "KRX holiday data response must not contain Transfer-Encoding"
    );
  }
  if (!isDeepStrictEqual(input.pragmaHeaderValues, ["no-cache"])) {
    throw new Error(
      "KRX holiday data response Pragma must match the observed no-cache value"
    );
  }
  if (input.setCookieHeaderCount === 0) {
    throw new Error(
      "KRX holiday data response observation must record response Set-Cookie presence"
    );
  }

  const responseCacheHeaders =
    parseOfficialMarketCalendarNetworkResponseCacheHeaders(
      input.responseCacheHeaders
    );
  if (responseCacheHeaders.responseAgeSeconds !== null) {
    throw new Error("KRX holiday data response must not contain Age");
  }
  if (
    responseCacheHeaders.responseExpires !==
    responseCacheHeaders.responseDate
  ) {
    throw new Error(
      "KRX holiday data response Expires must equal Date for immediate expiry"
    );
  }

  const responseCacheControl =
    parseOfficialMarketCalendarResponseCacheControl(
      input.responseCacheControl
    );
  if (
    !isDeepStrictEqual(
      responseCacheControl.responseCacheControl,
      EXPECTED_CACHE_CONTROL
    )
  ) {
    throw new Error(
      "KRX holiday data response Cache-Control must match the observed no-reuse directives"
    );
  }

  const transferCompletion = verifyOfficialMarketCalendarTransferCompletion(
    input.transferCompletion
  );
  if (
    transferCompletion.httpProtocolVersion !== "http_1_1" ||
    transferCompletion.transferFraming !== "content_length"
  ) {
    throw new Error(
      "KRX holiday data response must use observed HTTP/1.1 content-length framing"
    );
  }
  if (
    transferCompletion.contentLength === 0 ||
    transferCompletion.contentLength > MAXIMUM_BODY_BYTE_LENGTH
  ) {
    throw new Error(
      "KRX holiday data response body length exceeds the local validation boundary"
    );
  }

  return Object.freeze({
    responseMetadataVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_RESPONSE_METADATA_VERSION,
    requestIsolation: Object.freeze({ ...input.requestIsolation }),
    responseUrl: input.responseUrl,
    httpStatus: 200 as const,
    contentType: "text/html; charset=UTF-8" as const,
    responseCacheHeaders: Object.freeze({ ...responseCacheHeaders }),
    responseCacheControl: Object.freeze({
      responseCacheControl: Object.freeze([
        ...EXPECTED_CACHE_CONTROL
      ]) as unknown as string[]
    }),
    transferCompletion: Object.freeze({ ...transferCompletion }),
    setCookieHeaderCount: input.setCookieHeaderCount,
    bodyValidationEligible: true as const,
    durableEvidenceReusable: false as const,
    acceptedAcquisition: false as const,
    durableRejectionReasons: Object.freeze([
      ...DURABLE_REJECTION_REASONS
    ]) as typeof DURABLE_REJECTION_REASONS
  });
}
