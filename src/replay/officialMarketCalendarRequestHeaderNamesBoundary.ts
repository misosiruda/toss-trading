import { z } from "zod";

const lowercaseHeaderNameSchema = z
  .string()
  .regex(
    /^[!#$%&'*+\-.^_`|~0-9a-z]+$/,
    "request header name must be a lowercase HTTP field name"
  );

const effectiveRequestHeaderNamesSchema = z
  .object({
    requestHeaderNames: z.array(lowercaseHeaderNameSchema).min(1)
  })
  .strict();

const requestHeaderNamesBoundarySchema = z
  .object({
    effectiveRequests: z.array(effectiveRequestHeaderNamesSchema).min(1)
  })
  .strict();

export type OfficialMarketCalendarRequestHeaderNamesBoundary = z.infer<
  typeof requestHeaderNamesBoundarySchema
>;

export function verifyOfficialMarketCalendarRequestHeaderNamesBoundary(
  value: unknown
): OfficialMarketCalendarRequestHeaderNamesBoundary {
  const boundary = requestHeaderNamesBoundarySchema.parse(value);
  for (const request of boundary.effectiveRequests) {
    for (const [index, headerName] of request.requestHeaderNames.entries()) {
      const previousHeaderName = request.requestHeaderNames[index - 1];
      if (
        previousHeaderName !== undefined &&
        previousHeaderName >= headerName
      ) {
        throw new Error(
          "official calendar request header names must use canonical order without duplicates"
        );
      }
    }
  }
  return boundary;
}
