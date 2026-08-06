import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";

const redirectMethodTransitionSchema = z
  .object({
    responseStatus: z.union([z.literal(301), z.literal(302), z.literal(303)]),
    requestMethod: z.enum(["GET", "POST"]),
    requestBodyHash: sha256HashSchema.nullable(),
    nextRequestMethod: z.literal("GET"),
    nextRequestBodyHash: z.null()
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      transition.requestMethod === "GET" &&
      transition.requestBodyHash !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestBodyHash"],
        message: "redirect GET request body hash must be null"
      });
    }
  });

const redirectMethodBoundarySchema = z
  .object({
    transitions: z.array(redirectMethodTransitionSchema).min(1)
  })
  .strict();

export type OfficialMarketCalendarRedirectMethodBoundary = z.infer<
  typeof redirectMethodBoundarySchema
>;

export function verifyOfficialMarketCalendarRedirectMethodBoundary(
  value: unknown
): OfficialMarketCalendarRedirectMethodBoundary {
  return redirectMethodBoundarySchema.parse(value);
}
