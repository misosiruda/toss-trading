import { z } from "zod";

import {
  type OfficialMarketCalendarCacheRequestPolicyInput,
  verifyOfficialMarketCalendarCacheRequestPolicy
} from "./officialMarketCalendarCacheRequestPolicy.js";
import {
  type OfficialMarketCalendarCredentialHeaderBoundary,
  verifyOfficialMarketCalendarCredentialHeaderBoundary
} from "./officialMarketCalendarCredentialHeaderBoundary.js";
import {
  type OfficialMarketCalendarDomainAllowlistInput,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";
import {
  type OfficialMarketCalendarHttpsUrlBoundary,
  verifyOfficialMarketCalendarHttpsUrlBoundary
} from "./officialMarketCalendarHttpsUrlBoundary.js";
import {
  type OfficialMarketCalendarRangeRequestBoundary,
  verifyOfficialMarketCalendarRangeRequestBoundary
} from "./officialMarketCalendarRangeRequestBoundary.js";
import {
  type OfficialMarketCalendarRedirectLocationBoundary,
  verifyOfficialMarketCalendarRedirectLocationBoundary
} from "./officialMarketCalendarRedirectLocationBoundary.js";
import {
  type OfficialMarketCalendarRedirectMethodBoundary,
  verifyOfficialMarketCalendarRedirectMethodBoundary
} from "./officialMarketCalendarRedirectMethodBoundary.js";
import {
  type OfficialMarketCalendarRedirectStatusBoundary,
  verifyOfficialMarketCalendarRedirectStatusBoundary
} from "./officialMarketCalendarRedirectStatusBoundary.js";

const redirectChainBoundarySchema = z
  .object({
    cacheRequestPolicies: z
      .array(z.record(z.string(), z.unknown()))
      .min(1),
    credentialHeaderBoundary: z.record(z.string(), z.unknown()),
    domainAllowlistBoundary: z.record(z.string(), z.unknown()),
    httpsUrlBoundary: z.record(z.string(), z.unknown()),
    rangeRequestBoundaries: z
      .array(z.record(z.string(), z.unknown()))
      .min(1),
    statusBoundary: z.record(z.string(), z.unknown()),
    locationBoundary: z.record(z.string(), z.unknown()),
    methodBoundary: z.record(z.string(), z.unknown())
  })
  .strict();

export interface OfficialMarketCalendarRedirectChainBoundary {
  cacheRequestPolicies: OfficialMarketCalendarCacheRequestPolicyInput[];
  credentialHeaderBoundary: OfficialMarketCalendarCredentialHeaderBoundary;
  domainAllowlistBoundary: OfficialMarketCalendarDomainAllowlistInput;
  httpsUrlBoundary: OfficialMarketCalendarHttpsUrlBoundary;
  rangeRequestBoundaries: OfficialMarketCalendarRangeRequestBoundary[];
  statusBoundary: OfficialMarketCalendarRedirectStatusBoundary;
  locationBoundary: OfficialMarketCalendarRedirectLocationBoundary;
  methodBoundary: OfficialMarketCalendarRedirectMethodBoundary;
}

export function verifyOfficialMarketCalendarRedirectChainBoundary(
  value: unknown
): OfficialMarketCalendarRedirectChainBoundary {
  const rawBoundary = redirectChainBoundarySchema.parse(value);
  const boundary = {
    cacheRequestPolicies: rawBoundary.cacheRequestPolicies.map(
      verifyOfficialMarketCalendarCacheRequestPolicy
    ),
    credentialHeaderBoundary: verifyOfficialMarketCalendarCredentialHeaderBoundary(
      rawBoundary.credentialHeaderBoundary
    ),
    domainAllowlistBoundary: verifyOfficialMarketCalendarDomainAllowlist(
      rawBoundary.domainAllowlistBoundary
    ),
    httpsUrlBoundary: verifyOfficialMarketCalendarHttpsUrlBoundary(
      rawBoundary.httpsUrlBoundary
    ),
    rangeRequestBoundaries: rawBoundary.rangeRequestBoundaries.map(
      verifyOfficialMarketCalendarRangeRequestBoundary
    ),
    statusBoundary: verifyOfficialMarketCalendarRedirectStatusBoundary(
      rawBoundary.statusBoundary
    ),
    locationBoundary: verifyOfficialMarketCalendarRedirectLocationBoundary(
      rawBoundary.locationBoundary
    ),
    methodBoundary: verifyOfficialMarketCalendarRedirectMethodBoundary(
      rawBoundary.methodBoundary
    )
  };
  const hopCount = boundary.statusBoundary.responseStatuses.length;
  if (
    boundary.locationBoundary.redirectHops.length !== hopCount ||
    boundary.methodBoundary.transitions.length !== hopCount
  ) {
    throw new Error(
      "official calendar redirect boundaries must contain the same hop count"
    );
  }
  const expectedEffectiveRequestUrls = [
    boundary.locationBoundary.redirectHops[0]?.responseUrl,
    ...boundary.locationBoundary.redirectHops.map(
      (hop) => hop.nextEffectiveRequestUrl
    )
  ];
  if (
    expectedEffectiveRequestUrls.length !==
      boundary.httpsUrlBoundary.effectiveRequestUrls.length ||
    expectedEffectiveRequestUrls.some(
      (url, index) =>
        url !== boundary.httpsUrlBoundary.effectiveRequestUrls[index]
    )
  ) {
    throw new Error(
      "official calendar redirect Location chain must match effective request URLs"
    );
  }
  if (
    boundary.domainAllowlistBoundary.urls.length !==
      boundary.httpsUrlBoundary.effectiveRequestUrls.length ||
    boundary.domainAllowlistBoundary.urls.some(
      (url, index) =>
        url !== boundary.httpsUrlBoundary.effectiveRequestUrls[index]
    )
  ) {
    throw new Error(
      "official calendar redirect allowlist URLs must match effective request URLs"
    );
  }
  if (
    boundary.cacheRequestPolicies.length !==
    boundary.httpsUrlBoundary.effectiveRequestUrls.length
  ) {
    throw new Error(
      "official calendar cache request observations must match effective request count"
    );
  }
  if (
    boundary.credentialHeaderBoundary.effectiveRequests.length !==
    boundary.httpsUrlBoundary.effectiveRequestUrls.length
  ) {
    throw new Error(
      "official calendar credential observations must match effective request count"
    );
  }
  if (
    boundary.rangeRequestBoundaries.length !==
    boundary.httpsUrlBoundary.effectiveRequestUrls.length
  ) {
    throw new Error(
      "official calendar range observations must match effective request count"
    );
  }
  for (const [index, responseStatus] of
    boundary.statusBoundary.responseStatuses.entries()) {
    if (
      boundary.methodBoundary.transitions[index]?.responseStatus !==
      responseStatus
    ) {
      throw new Error(
        "official calendar redirect status must match its method transition"
      );
    }
  }
  return boundary;
}
