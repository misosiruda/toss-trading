import { z } from "zod";

const effectiveRequestCredentialHeadersSchema = z
  .object({
    authorizationHeaderValues: z.array(z.string()),
    proxyAuthorizationHeaderValues: z.array(z.string()),
    cookieHeaderValues: z.array(z.string())
  })
  .strict();

const credentialHeaderBoundarySchema = z
  .object({
    effectiveRequests: z
      .array(effectiveRequestCredentialHeadersSchema)
      .min(1)
  })
  .strict();

export type OfficialMarketCalendarCredentialHeaderBoundary = z.infer<
  typeof credentialHeaderBoundarySchema
>;

export function verifyOfficialMarketCalendarCredentialHeaderBoundary(
  value: unknown
): OfficialMarketCalendarCredentialHeaderBoundary {
  const boundary = credentialHeaderBoundarySchema.parse(value);
  for (const request of boundary.effectiveRequests) {
    if (
      request.authorizationHeaderValues.length !== 0 ||
      request.proxyAuthorizationHeaderValues.length !== 0 ||
      request.cookieHeaderValues.length !== 0
    ) {
      throw new Error(
        "official calendar request must not contain credential headers"
      );
    }
  }
  return boundary;
}
