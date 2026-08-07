import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";

const requestBodyContentTypeSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/.test(value),
    "request body content type must be a canonical visible value"
  );

const redirectMethodTransitionSchema = z
  .object({
    responseStatus: z.union([z.literal(301), z.literal(302), z.literal(303)]),
    requestMethod: z.enum(["GET", "POST"]),
    requestBodyContentType: requestBodyContentTypeSchema.nullable(),
    requestBodyHash: sha256HashSchema.nullable(),
    nextRequestMethod: z.literal("GET"),
    nextRequestBodyContentType: z.null(),
    nextRequestBodyHash: z.null()
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      (transition.requestBodyContentType === null) !==
      (transition.requestBodyHash === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestBodyContentType"],
        message: "redirect request body content type and hash must coexist"
      });
    }
    if (
      transition.requestMethod === "GET" &&
      (transition.requestBodyContentType !== null ||
        transition.requestBodyHash !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestBodyContentType"],
        message: "redirect GET request body metadata must be null"
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
  const boundary = redirectMethodBoundarySchema.parse(value);
  for (const [index, transition] of boundary.transitions.entries()) {
    const previousTransition = boundary.transitions[index - 1];
    if (
      previousTransition !== undefined &&
      (previousTransition.nextRequestMethod !== transition.requestMethod ||
        previousTransition.nextRequestBodyContentType !==
          transition.requestBodyContentType ||
        previousTransition.nextRequestBodyHash !== transition.requestBodyHash)
    ) {
      throw new Error(
        "redirect method transitions must form one continuous request chain"
      );
    }
  }
  return boundary;
}
