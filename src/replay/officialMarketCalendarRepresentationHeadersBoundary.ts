import { z } from "zod";

import {
  officialMarketCalendarCanonicalJsonValueSchema,
  verifyOfficialMarketCalendarCanonicalJsonObject
} from "./officialMarketCalendarCanonicalJsonObject.js";

const lowercaseHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9a-z]+$/,
    "representation header name must be a lowercase HTTP field name"
  );

const effectiveRequestRepresentationHeadersSchema = z
  .object({
    representationHeaders: z.record(
      lowercaseHeaderNameSchema,
      officialMarketCalendarCanonicalJsonValueSchema
    )
  })
  .strict();

const representationHeadersBoundarySchema = z
  .object({
    effectiveRequests: z
      .array(effectiveRequestRepresentationHeadersSchema)
      .min(1)
  })
  .strict();

export type OfficialMarketCalendarRepresentationHeadersBoundary = z.infer<
  typeof representationHeadersBoundarySchema
>;

export function verifyOfficialMarketCalendarRepresentationHeadersBoundary(
  value: unknown
): OfficialMarketCalendarRepresentationHeadersBoundary {
  const boundary = representationHeadersBoundarySchema.parse(value);
  for (const [index, request] of boundary.effectiveRequests.entries()) {
    verifyOfficialMarketCalendarCanonicalJsonObject(
      request.representationHeaders,
      `effectiveRequests[${index}].representationHeaders`
    );
  }
  return boundary;
}
