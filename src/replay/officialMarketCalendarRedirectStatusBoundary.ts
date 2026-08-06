import { z } from "zod";

const redirectStatusBoundarySchema = z
  .object({
    responseStatuses: z
      .array(z.union([z.literal(301), z.literal(302), z.literal(303)]))
      .min(1)
  })
  .strict();

export type OfficialMarketCalendarRedirectStatusBoundary = z.infer<
  typeof redirectStatusBoundarySchema
>;

export function verifyOfficialMarketCalendarRedirectStatusBoundary(
  value: unknown
): OfficialMarketCalendarRedirectStatusBoundary {
  return redirectStatusBoundarySchema.parse(value);
}
