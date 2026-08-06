import { z } from "zod";

import { verifyOfficialMarketCalendarHttpsUrlBoundary } from "./officialMarketCalendarHttpsUrlBoundary.js";

const redirectLocationHopSchema = z
  .object({
    responseUrl: z.string().min(1),
    locationHeaderValues: z.array(z.string()),
    nextEffectiveRequestUrl: z.string().min(1)
  })
  .strict();

const redirectLocationBoundarySchema = z
  .object({
    redirectHops: z.array(redirectLocationHopSchema).min(1)
  })
  .strict();

export type OfficialMarketCalendarRedirectLocationBoundary = z.infer<
  typeof redirectLocationBoundarySchema
>;

export function verifyOfficialMarketCalendarRedirectLocationBoundary(
  value: unknown
): OfficialMarketCalendarRedirectLocationBoundary {
  const boundary = redirectLocationBoundarySchema.parse(value);
  for (const hop of boundary.redirectHops) {
    verifyOfficialMarketCalendarHttpsUrlBoundary({
      requestedUrl: hop.responseUrl,
      effectiveRequestUrls: [hop.responseUrl, hop.nextEffectiveRequestUrl],
      finalUrl: hop.nextEffectiveRequestUrl
    });
    requireCanonicalAbsoluteUrl(hop.responseUrl);
    requireCanonicalAbsoluteUrl(hop.nextEffectiveRequestUrl);
    const [rawLocation] = hop.locationHeaderValues;
    if (hop.locationHeaderValues.length !== 1 || rawLocation === undefined) {
      throw new Error(
        "official calendar redirect must contain exactly one Location header"
      );
    }
    if (rawLocation.length === 0 || /[\x00-\x20\x7f\\]/u.test(rawLocation)) {
      throw new Error("official calendar redirect Location must be valid");
    }
    let resolvedLocation: URL;
    try {
      resolvedLocation = new URL(rawLocation, hop.responseUrl);
    } catch {
      throw new Error("official calendar redirect Location must be valid");
    }
    if (
      /^[A-Za-z][A-Za-z\d+.-]*:/u.test(rawLocation) &&
      resolvedLocation.href !== rawLocation
    ) {
      throw new Error(
        "official calendar redirect Location must use canonical serialization"
      );
    }
    if (resolvedLocation.href !== hop.nextEffectiveRequestUrl) {
      throw new Error(
        "official calendar redirect Location must match next effective request URL"
      );
    }
  }
  return boundary;
}

function requireCanonicalAbsoluteUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("official calendar redirect URL must be valid");
  }
  if (url.href !== rawUrl) {
    throw new Error(
      "official calendar redirect URL must use canonical serialization"
    );
  }
}
