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
  type OfficialMarketCalendarRequestHeaderNamesBoundary,
  verifyOfficialMarketCalendarRequestHeaderNamesBoundary
} from "./officialMarketCalendarRequestHeaderNamesBoundary.js";
import {
  type OfficialMarketCalendarRequestHeaderPolicyRegistryEntry
} from "./officialMarketCalendarRequestHeaderPolicy.js";
import { resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy } from "./officialMarketCalendarRequestHeaderPolicyRegistry.js";
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
    requestHeaderPolicyVersion: z.unknown(),
    requestHeaderNamesBoundary: z.record(z.string(), z.unknown()),
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
  requestHeaderPolicyVersion: OfficialMarketCalendarRequestHeaderPolicyRegistryEntry["requestHeaderPolicyVersion"];
  requestHeaderNamesBoundary: OfficialMarketCalendarRequestHeaderNamesBoundary;
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
  const requestHeaderPolicy =
    resolveRegisteredOfficialMarketCalendarRequestHeaderPolicy(
      rawBoundary.requestHeaderPolicyVersion
    );
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
    requestHeaderPolicyVersion:
      requestHeaderPolicy.requestHeaderPolicyVersion,
    requestHeaderNamesBoundary:
      verifyOfficialMarketCalendarRequestHeaderNamesBoundary(
        rawBoundary.requestHeaderNamesBoundary
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
  const requestHeaderPolicySourceSelector =
    requestHeaderPolicy.requestHeaderPolicyDefinition.sourceSelector;
  if (
    requestHeaderPolicySourceSelector.exchange !==
      boundary.domainAllowlistBoundary.exchange ||
    requestHeaderPolicySourceSelector.requestedUrl !==
      boundary.httpsUrlBoundary.requestedUrl
  ) {
    throw new Error(
      "official calendar request header policy source selector must match verified initial request"
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
    boundary.requestHeaderNamesBoundary.effectiveRequests.length !==
    boundary.httpsUrlBoundary.effectiveRequestUrls.length
  ) {
    throw new Error(
      "official calendar request header name observations must match effective request count"
    );
  }
  for (const [index, request] of
    boundary.requestHeaderNamesBoundary.effectiveRequests.entries()) {
    const requestHeaderNames = request.requestHeaderNames;
    if (
      !requestHeaderNames.includes("cache-control") ||
      !requestHeaderNames.includes("pragma") ||
      requestHeaderNames.includes("if-none-match") ||
      requestHeaderNames.includes("if-modified-since")
    ) {
      throw new Error(
        `official calendar cache request header names must match verified cache policy at effective request ${index}`
      );
    }
  }
  for (const [index, request] of
    boundary.requestHeaderNamesBoundary.effectiveRequests.entries()) {
    const requestHeaderNames = request.requestHeaderNames;
    if (
      requestHeaderNames.includes("authorization") ||
      requestHeaderNames.includes("proxy-authorization") ||
      requestHeaderNames.includes("cookie")
    ) {
      throw new Error(
        `official calendar credential request header names must match verified credential boundary at effective request ${index}`
      );
    }
  }
  for (const [index, request] of
    boundary.requestHeaderNamesBoundary.effectiveRequests.entries()) {
    const requestHeaderNames = request.requestHeaderNames;
    if (
      requestHeaderNames.includes("range") ||
      requestHeaderNames.includes("if-range")
    ) {
      throw new Error(
        `official calendar range request header names must match verified range boundary at effective request ${index}`
      );
    }
  }
  for (const [index, request] of
    boundary.requestHeaderNamesBoundary.effectiveRequests.entries()) {
    const requestBodyContentType =
      index === 0
        ? boundary.methodBoundary.transitions[0]?.requestBodyContentType
        : boundary.methodBoundary.transitions[index - 1]
            ?.nextRequestBodyContentType;
    const hasContentTypeHeader =
      request.requestHeaderNames.includes("content-type");
    if (
      requestBodyContentType === undefined ||
      (requestBodyContentType === null && hasContentTypeHeader) ||
      (requestBodyContentType !== null && !hasContentTypeHeader)
    ) {
      throw new Error(
        `official calendar content-type request header name must match verified request body metadata at effective request ${index}`
      );
    }
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
  for (const [index, request] of
    boundary.representationHeadersBoundary.effectiveRequests.entries()) {
    const requestHeaderNames =
      boundary.requestHeaderNamesBoundary.effectiveRequests[index]
        ?.requestHeaderNames;
    if (
      requestHeaderNames === undefined ||
      Object.keys(request.representationHeaders).some(
        (headerName) => !requestHeaderNames.includes(headerName)
      )
    ) {
      throw new Error(
        `official calendar representation header keys must be present in verified request header names at effective request ${index}`
      );
    }
  }
  const allowedRequestHeaderNames =
    requestHeaderPolicy.requestHeaderPolicyDefinition.allowedHeaderNames;
  for (const [index, request] of
    boundary.requestHeaderNamesBoundary.effectiveRequests.entries()) {
    if (
      request.requestHeaderNames.some(
        (headerName) => !allowedRequestHeaderNames.includes(headerName)
      )
    ) {
      throw new Error(
        `official calendar request header names must stay within registered policy at effective request ${index}`
      );
    }
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
