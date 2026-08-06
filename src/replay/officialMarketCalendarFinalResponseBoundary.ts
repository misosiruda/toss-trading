import { z } from "zod";

import { officialMarketCalendarHttpProtocolVersionSchema } from "./officialMarketCalendarHttpProtocolVersion.js";
import {
  type OfficialMarketCalendarResponseCacheHeaders,
  parseOfficialMarketCalendarResponseCacheHeaders
} from "./officialMarketCalendarResponseCacheHeaders.js";
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
  transferCompletion: OfficialMarketCalendarTransferCompletion;
}

export function verifyOfficialMarketCalendarFinalResponseBoundary(
  value: unknown
): OfficialMarketCalendarFinalResponseBoundary {
  const rawBoundary = finalResponseBoundarySchema.parse(value);
  const boundary = {
    ...rawBoundary,
    responseCacheHeaders: parseOfficialMarketCalendarResponseCacheHeaders(
      rawBoundary.responseCacheHeaders
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
