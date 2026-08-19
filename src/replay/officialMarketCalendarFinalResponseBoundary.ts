import { z } from "zod";

import { officialMarketCalendarHttpProtocolVersionSchema } from "./officialMarketCalendarHttpProtocolVersion.js";
import {
  type OfficialMarketCalendarResponseCacheHeaders,
  parseOfficialMarketCalendarResponseCacheHeaders
} from "./officialMarketCalendarResponseCacheHeaders.js";
import {
  type OfficialMarketCalendarResponseCacheControl,
  parseOfficialMarketCalendarResponseCacheControl
} from "./officialMarketCalendarResponseCacheControl.js";
import {
  type OfficialMarketCalendarResponseRepresentationHeaders,
  parseOfficialMarketCalendarResponseRepresentationHeaders
} from "./officialMarketCalendarResponseRepresentationHeaders.js";
import {
  type ResolvedOfficialMarketCalendarResponseFreshness,
  resolveOfficialMarketCalendarResponseFreshnessFromCacheHeaders
} from "./officialMarketCalendarResponseFreshness.js";
import {
  type ResolvedOfficialMarketCalendarFreshnessPolicyExpiry,
  resolveOfficialMarketCalendarFreshnessPolicyExpiryFromRegistryAndResponseFreshness
} from "./officialMarketCalendarFreshnessPolicyExpiry.js";
import {
  type OfficialMarketCalendarTransferCompletion,
  verifyOfficialMarketCalendarTransferCompletion
} from "./officialMarketCalendarTransferCompletion.js";

const finalResponseBoundarySchema = z
  .object({
    responseUrl: z.string().min(1),
    httpStatus: z.number().int(),
    httpProtocolVersion: officialMarketCalendarHttpProtocolVersionSchema,
    contentRangeHeaderValues: z.array(z.string()),
    contentRange: z.null(),
    responseCacheHeaders: z.record(z.string(), z.unknown()),
    responseCacheControl: z.record(z.string(), z.unknown()),
    responseRepresentationHeaders: z.record(z.string(), z.unknown()),
    responseFreshness: z.record(z.string(), z.unknown()),
    freshnessPolicyExpiry: z.record(z.string(), z.unknown()),
    transferCompletion: z.record(z.string(), z.unknown())
  })
  .strict();

export interface OfficialMarketCalendarFinalResponseBoundary {
  responseUrl: string;
  httpStatus: number;
  httpProtocolVersion: z.infer<
    typeof officialMarketCalendarHttpProtocolVersionSchema
  >;
  contentRangeHeaderValues: string[];
  contentRange: null;
  responseCacheHeaders: OfficialMarketCalendarResponseCacheHeaders;
  responseCacheControl: OfficialMarketCalendarResponseCacheControl;
  responseRepresentationHeaders: OfficialMarketCalendarResponseRepresentationHeaders;
  responseFreshness: ResolvedOfficialMarketCalendarResponseFreshness;
  freshnessPolicyExpiry: ResolvedOfficialMarketCalendarFreshnessPolicyExpiry;
  transferCompletion: OfficialMarketCalendarTransferCompletion;
}

export function verifyOfficialMarketCalendarFinalResponseBoundary(
  value: unknown,
  freshnessPolicyRegistry: unknown
): OfficialMarketCalendarFinalResponseBoundary {
  const rawBoundary = finalResponseBoundarySchema.parse(value);
  const responseCacheHeaders = parseOfficialMarketCalendarResponseCacheHeaders(
    rawBoundary.responseCacheHeaders
  );
  const responseCacheControl =
    parseOfficialMarketCalendarResponseCacheControl(
      rawBoundary.responseCacheControl
    );
  const responseRepresentationHeaders =
    parseOfficialMarketCalendarResponseRepresentationHeaders(
      rawBoundary.responseRepresentationHeaders
    );
  const responseFreshness =
    resolveOfficialMarketCalendarResponseFreshnessFromCacheHeaders(
      rawBoundary.responseFreshness,
      responseCacheHeaders
    );
  const boundary = {
    ...rawBoundary,
    responseCacheHeaders,
    responseCacheControl,
    responseRepresentationHeaders,
    responseFreshness,
    freshnessPolicyExpiry:
      resolveOfficialMarketCalendarFreshnessPolicyExpiryFromRegistryAndResponseFreshness(
        rawBoundary.freshnessPolicyExpiry,
        freshnessPolicyRegistry,
        responseFreshness.freshness
      ),
    transferCompletion: verifyOfficialMarketCalendarTransferCompletion(
      rawBoundary.transferCompletion
    )
  };
  if (
    boundary.httpProtocolVersion !==
    boundary.transferCompletion.httpProtocolVersion
  ) {
    throw new Error(
      "official calendar final response and transfer protocol must match"
    );
  }
  if (boundary.httpStatus !== 200) {
    throw new Error(
      "official calendar final response status must be exactly 200"
    );
  }
  if (boundary.contentRangeHeaderValues.length !== 0) {
    throw new Error(
      "official calendar final response must not contain Content-Range"
    );
  }
  return boundary;
}
