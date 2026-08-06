import { z } from "zod";

export const officialMarketCalendarHttpProtocolVersionSchema = z.enum([
  "http_1_0",
  "http_1_1",
  "http_2",
  "http_3"
]);

const finalResponseBoundarySchema = z
  .object({
    responseUrl: z.string().min(1),
    httpStatus: z.number().int(),
    httpProtocolVersion: officialMarketCalendarHttpProtocolVersionSchema,
    contentRangeHeaderValues: z.array(z.string()),
    contentRange: z.null()
  })
  .strict();

export type OfficialMarketCalendarFinalResponseBoundary = z.infer<
  typeof finalResponseBoundarySchema
>;

export function verifyOfficialMarketCalendarFinalResponseBoundary(
  value: unknown
): OfficialMarketCalendarFinalResponseBoundary {
  const boundary = finalResponseBoundarySchema.parse(value);
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
