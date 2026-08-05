import { z } from "zod";

const finalResponseBoundarySchema = z
  .object({
    httpStatus: z.number().int(),
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
