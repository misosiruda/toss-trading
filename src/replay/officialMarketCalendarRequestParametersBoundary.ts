import { z } from "zod";

import {
  officialMarketCalendarCanonicalJsonObjectSchema,
  verifyOfficialMarketCalendarCanonicalJsonObject
} from "./officialMarketCalendarCanonicalJsonObject.js";

export type { OfficialMarketCalendarCanonicalJsonValue } from "./officialMarketCalendarCanonicalJsonObject.js";

const effectiveRequestParametersSchema = z
  .object({
    requestParameters: officialMarketCalendarCanonicalJsonObjectSchema
  })
  .strict();

const requestParametersBoundarySchema = z
  .object({
    effectiveRequests: z.array(effectiveRequestParametersSchema).min(1)
  })
  .strict();

export type OfficialMarketCalendarRequestParametersBoundary = z.infer<
  typeof requestParametersBoundarySchema
>;

export function verifyOfficialMarketCalendarRequestParametersBoundary(
  value: unknown
): OfficialMarketCalendarRequestParametersBoundary {
  const boundary = requestParametersBoundarySchema.parse(value);
  for (const [index, request] of boundary.effectiveRequests.entries()) {
    verifyOfficialMarketCalendarCanonicalJsonObject(
      request.requestParameters,
      `effectiveRequests[${index}].requestParameters`
    );
  }
  return boundary;
}
