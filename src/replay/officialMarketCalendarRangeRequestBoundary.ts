import { z } from "zod";

const rangeRequestBoundarySchema = z
  .object({
    rangeHeaderValues: z.array(z.string()),
    ifRangeHeaderValues: z.array(z.string())
  })
  .strict();

export type OfficialMarketCalendarRangeRequestBoundary = z.infer<
  typeof rangeRequestBoundarySchema
>;

export function verifyOfficialMarketCalendarRangeRequestBoundary(
  value: unknown
): OfficialMarketCalendarRangeRequestBoundary {
  const boundary = rangeRequestBoundarySchema.parse(value);
  if (
    boundary.rangeHeaderValues.length !== 0 ||
    boundary.ifRangeHeaderValues.length !== 0
  ) {
    throw new Error(
      "official calendar request must not contain Range or If-Range headers"
    );
  }
  return boundary;
}
