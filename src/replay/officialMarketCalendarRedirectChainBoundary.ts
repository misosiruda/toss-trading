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
  type OfficialMarketCalendarCredentialFreeClientPolicy,
  verifyOfficialMarketCalendarCredentialFreeClientPolicy
} from "./officialMarketCalendarCredentialFreeClientPolicy.js";
import {
  type OfficialMarketCalendarDomainAllowlistInput,
  verifyOfficialMarketCalendarDomainAllowlist
} from "./officialMarketCalendarDomainAllowlist.js";
import {
  type OfficialMarketCalendarFinalResponseBoundary,
  verifyOfficialMarketCalendarFinalResponseBoundary
} from "./officialMarketCalendarFinalResponseBoundary.js";
import {
  type OfficialMarketCalendarHttpsUrlBoundary,
  verifyOfficialMarketCalendarHttpsUrlBoundary
} from "./officialMarketCalendarHttpsUrlBoundary.js";
import {
  type OfficialMarketCalendarRangeRequestBoundary,
  verifyOfficialMarketCalendarRangeRequestBoundary
} from "./officialMarketCalendarRangeRequestBoundary.js";
import {
  type OfficialMarketCalendarRequestParametersBoundary,
  verifyOfficialMarketCalendarRequestParametersBoundary
} from "./officialMarketCalendarRequestParametersBoundary.js";
import {
  type OfficialMarketCalendarRepresentationHeadersBoundary,
  verifyOfficialMarketCalendarRepresentationHeadersBoundary
} from "./officialMarketCalendarRepresentationHeadersBoundary.js";
import {
  type OfficialMarketCalendarRedirectClientPolicy,
  verifyOfficialMarketCalendarRedirectClientPolicy
} from "./officialMarketCalendarRedirectClientPolicy.js";
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
import {
  type OfficialMarketCalendarTlsClientPolicy,
  verifyOfficialMarketCalendarTlsClientPolicy
} from "./officialMarketCalendarTlsClientPolicy.js";
const redirectChainBoundarySchema = z
  .object({
    cacheRequestPolicies: z
      .array(z.record(z.string(), z.unknown()))
      .min(1),
    credentialFreeClientPolicy: z.record(z.string(), z.unknown()),
    credentialHeaderBoundary: z.record(z.string(), z.unknown()),
    domainAllowlistBoundary: z.record(z.string(), z.unknown()),
    finalResponseBoundary: z.record(z.string(), z.unknown()),
    httpsUrlBoundary: z.record(z.string(), z.unknown()),
    rangeRequestBoundaries: z
      .array(z.record(z.string(), z.unknown()))
      .min(1),
    requestParametersBoundary: z.record(z.string(), z.unknown()),
    representationHeadersBoundary: z.record(z.string(), z.unknown()),
    redirectClientPolicy: z.record(z.string(), z.unknown()),
    statusBoundary: z.record(z.string(), z.unknown()),
    locationBoundary: z.record(z.string(), z.unknown()),
    methodBoundary: z.record(z.string(), z.unknown()),
    tlsClientPolicy: z.record(z.string(), z.unknown())
  })
  .strict();

export interface OfficialMarketCalendarRedirectChainBoundary {
  cacheRequestPolicies: OfficialMarketCalendarCacheRequestPolicyInput[];
  credentialFreeClientPolicy: OfficialMarketCalendarCredentialFreeClientPolicy;
  credentialHeaderBoundary: OfficialMarketCalendarCredentialHeaderBoundary;
  domainAllowlistBoundary: OfficialMarketCalendarDomainAllowlistInput;
  finalResponseBoundary: OfficialMarketCalendarFinalResponseBoundary;
  httpsUrlBoundary: OfficialMarketCalendarHttpsUrlBoundary;
  rangeRequestBoundaries: OfficialMarketCalendarRangeRequestBoundary[];
  requestParametersBoundary: OfficialMarketCalendarRequestParametersBoundary;
  representationHeadersBoundary: OfficialMarketCalendarRepresentationHeadersBoundary;
  redirectClientPolicy: OfficialMarketCalendarRedirectClientPolicy;
  statusBoundary: OfficialMarketCalendarRedirectStatusBoundary;
  locationBoundary: OfficialMarketCalendarRedirectLocationBoundary;
  methodBoundary: OfficialMarketCalendarRedirectMethodBoundary;
  tlsClientPolicy: OfficialMarketCalendarTlsClientPolicy;
}

export function verifyOfficialMarketCalendarRedirectChainBoundary(
  value: unknown,
  freshnessPolicyRegistry: unknown
): OfficialMarketCalendarRedirectChainBoundary {
  const rawBoundary = redirectChainBoundarySchema.parse(value);
  const boundary = {
    cacheRequestPolicies: rawBoundary.cacheRequestPolicies.map(
      verifyOfficialMarketCalendarCacheRequestPolicy
    ),
    credentialFreeClientPolicy: verifyOfficialMarketCalendarCredentialFreeClientPolicy(
      rawBoundary.credentialFreeClientPolicy
    ),
    credentialHeaderBoundary: verifyOfficialMarketCalendarCredentialHeaderBoundary(
      rawBoundary.credentialHeaderBoundary
    ),
    domainAllowlistBoundary: verifyOfficialMarketCalendarDomainAllowlist(
      rawBoundary.domainAllowlistBoundary
    ),
    finalResponseBoundary: verifyOfficialMarketCalendarFinalResponseBoundary(
      rawBoundary.finalResponseBoundary,
      freshnessPolicyRegistry
    ),
    httpsUrlBoundary: verifyOfficialMarketCalendarHttpsUrlBoundary(
      rawBoundary.httpsUrlBoundary
    ),
    rangeRequestBoundaries: rawBoundary.rangeRequestBoundaries.map(
      verifyOfficialMarketCalendarRangeRequestBoundary
    ),
    requestParametersBoundary:
      verifyOfficialMarketCalendarRequestParametersBoundary(
        rawBoundary.requestParametersBoundary
      ),
    representationHeadersBoundary:
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        rawBoundary.representationHeadersBoundary
      ),
    redirectClientPolicy: verifyOfficialMarketCalendarRedirectClientPolicy(
      rawBoundary.redirectClientPolicy
    ),
    statusBoundary: verifyOfficialMarketCalendarRedirectStatusBoundary(
      rawBoundary.statusBoundary
    ),
    locationBoundary: verifyOfficialMarketCalendarRedirectLocationBoundary(
      rawBoundary.locationBoundary
    ),
    methodBoundary: verifyOfficialMarketCalendarRedirectMethodBoundary(
      rawBoundary.methodBoundary
    ),
    tlsClientPolicy: verifyOfficialMarketCalendarTlsClientPolicy(
      rawBoundary.tlsClientPolicy
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
  if (
    boundary.requestParametersBoundary.effectiveRequests.length !==
    boundary.httpsUrlBoundary.effectiveRequestUrls.length
  ) {
    throw new Error(
      "official calendar parameter observations must match effective request count"
    );
  }
  if (
    boundary.representationHeadersBoundary.effectiveRequests.length !==
    boundary.httpsUrlBoundary.effectiveRequestUrls.length
  ) {
    throw new Error(
      "official calendar representation header observations must match effective request count"
    );
  }
  if (
    boundary.finalResponseBoundary.responseUrl !==
    boundary.httpsUrlBoundary.finalUrl
  ) {
    throw new Error(
      "official calendar final response URL must match final URL"
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
