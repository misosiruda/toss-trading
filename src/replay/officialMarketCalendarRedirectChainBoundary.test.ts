import assert from "node:assert/strict";
import test from "node:test";

import { OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION } from "./officialMarketCalendarCacheRequestPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION } from "./officialMarketCalendarCredentialFreeClientPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION } from "./officialMarketCalendarDomainAllowlist.js";
import { verifyOfficialMarketCalendarRedirectChainBoundary } from "./officialMarketCalendarRedirectChainBoundary.js";
import { OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION } from "./officialMarketCalendarRedirectClientPolicy.js";
import { OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION } from "./officialMarketCalendarTlsClientPolicy.js";

interface MethodTransition {
  responseStatus: number;
  requestMethod: string;
  requestBodyHash: string | null;
  nextRequestMethod: string;
  nextRequestBodyHash: null;
}

test("calendar redirect chain boundary accepts aligned hop contracts", () => {
  const boundary = chain();

  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectChainBoundary(boundary),
    boundary
  );
});

test("calendar redirect chain boundary rejects mismatched hop counts", () => {
  for (const boundary of [
    chain({ responseStatuses: [302, 303] }),
    chain({ redirectHops: [locationHop(), secondLocationHop()] }),
    chain({ transitions: [methodTransition(), secondMethodTransition()] })
  ]) {
    assert.throws(
      () => verifyOfficialMarketCalendarRedirectChainBoundary(boundary),
      /must contain the same hop count/
    );
  }
});

test("calendar redirect chain boundary rejects status identity mismatch", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ responseStatuses: [301] })
      ),
    /status must match its method transition/
  );
});

test("calendar redirect chain boundary rejects effective URL mismatch", () => {
  for (const effectiveRequestUrls of [
    ["https://global.krx.co.kr/source"],
    [
      "https://global.krx.co.kr/source",
      "https://global.krx.co.kr/other"
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ effectiveRequestUrls })
        ),
      /Location chain must match effective request URLs/
    );
  }
});

test("calendar redirect chain boundary rejects allowlist URL mismatch", () => {
  for (const domainUrls of [
    ["https://global.krx.co.kr/source"],
    [
      "https://global.krx.co.kr/source",
      "https://global.krx.co.kr/other"
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ domainUrls })
        ),
      /allowlist URLs must match effective request URLs/
    );
  }
});

test("calendar redirect chain boundary rejects credential observation count mismatch", () => {
  for (const credentialRequests of [
    [credentialRequest()],
    [credentialRequest(), credentialRequest(), credentialRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ credentialRequests })
        ),
      /credential observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary rejects cache request count mismatch", () => {
  for (const cacheRequests of [
    [cacheRequest()],
    [cacheRequest(), cacheRequest(), cacheRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ cacheRequests })
        ),
      /cache request observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary rejects range observation count mismatch", () => {
  for (const rangeRequests of [
    [rangeRequest()],
    [rangeRequest(), rangeRequest(), rangeRequest()]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectChainBoundary(
          chain({ rangeRequests })
        ),
      /range observations must match effective request count/
    );
  }
});

test("calendar redirect chain boundary preserves child fail-closed validation", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ responseStatuses: [307] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary({
        ...chain(),
        followedAutomatically: true
      }),
    /Unrecognized key/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ domainUrls: ["https://www.nyse.com/source"] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          credentialRequests: [
            credentialRequest(),
            credentialRequest({ authorizationHeaderValues: ["secret"] })
          ]
        })
      ),
    /must not contain credential headers/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          rangeRequests: [
            rangeRequest(),
            rangeRequest({ rangeHeaderValues: ["bytes=0-99"] })
          ]
        })
      ),
    /must not contain Range or If-Range headers/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({
          cacheRequests: [
            cacheRequest(),
            cacheRequest({ ifNoneMatchHeaderValues: ['"etag"'] })
          ]
        })
      ),
    /must not contain conditional headers/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ automaticRedirectFollowEnabled: true })
    )
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ credentialProviderConfigured: true })
    )
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectChainBoundary(
      chain({ insecureTlsBypassEnabled: true })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectChainBoundary(
        chain({ finalHttpStatus: 206 })
      ),
    /final response status must be exactly 200/
  );
});

function chain(
  overrides: Partial<{
    cacheRequests: ReturnType<typeof cacheRequest>[];
    credentialProviderConfigured: boolean;
    credentialRequests: ReturnType<typeof credentialRequest>[];
    domainUrls: string[];
    effectiveRequestUrls: string[];
    finalHttpStatus: number;
    insecureTlsBypassEnabled: boolean;
    rangeRequests: ReturnType<typeof rangeRequest>[];
    automaticRedirectFollowEnabled: boolean;
    responseStatuses: number[];
    redirectHops: ReturnType<typeof locationHop>[];
    transitions: MethodTransition[];
  }> = {}
) {
  const effectiveRequestUrls = overrides.effectiveRequestUrls ?? [
    "https://global.krx.co.kr/source",
    "https://global.krx.co.kr/download"
  ];
  return {
    cacheRequestPolicies: overrides.cacheRequests ?? [
      cacheRequest(),
      cacheRequest()
    ],
    credentialFreeClientPolicy: {
      credentialFreeClientPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_CREDENTIAL_FREE_CLIENT_POLICY_VERSION,
      credentialProviderConfigured:
        overrides.credentialProviderConfigured ?? false,
      proxyCredentialConfigured: false,
      httpAuthHandlerConfigured: false,
      cookieJarConfigured: false
    },
    credentialHeaderBoundary: {
      effectiveRequests: overrides.credentialRequests ?? [
        credentialRequest(),
        credentialRequest()
      ]
    },
    domainAllowlistBoundary: {
      exchange: "KRX",
      domainAllowlistPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
      urls: overrides.domainUrls ?? effectiveRequestUrls
    },
    finalResponseBoundary: {
      httpStatus: overrides.finalHttpStatus ?? 200,
      contentRangeHeaderValues: [],
      contentRange: null
    },
    httpsUrlBoundary: {
      requestedUrl: effectiveRequestUrls[0],
      effectiveRequestUrls,
      finalUrl: effectiveRequestUrls[effectiveRequestUrls.length - 1]
    },
    rangeRequestBoundaries: overrides.rangeRequests ?? [
      rangeRequest(),
      rangeRequest()
    ],
    redirectClientPolicy: {
      redirectPolicyVersion: OFFICIAL_MARKET_CALENDAR_REDIRECT_POLICY_VERSION,
      automaticRedirectFollowEnabled:
        overrides.automaticRedirectFollowEnabled ?? false,
      responsePerHopObservationRequired: true,
      effectiveRequestPerHopObservationRequired: true
    },
    statusBoundary: {
      responseStatuses: overrides.responseStatuses ?? [302]
    },
    locationBoundary: {
      redirectHops: overrides.redirectHops ?? [locationHop()]
    },
    methodBoundary: {
      transitions: overrides.transitions ?? [methodTransition()]
    },
    tlsClientPolicy: {
      tlsClientPolicyVersion: OFFICIAL_MARKET_CALENDAR_TLS_CLIENT_POLICY_VERSION,
      trustStore: "platform_default",
      certificateChainVerification: "required",
      hostnameVerification: "required",
      insecureTlsBypassEnabled: overrides.insecureTlsBypassEnabled ?? false,
      clientCertificateConfigured: false
    }
  };
}

function cacheRequest(
  overrides: Partial<{
    cacheControlHeaderValues: string[];
    pragmaHeaderValues: string[];
    ifNoneMatchHeaderValues: string[];
    ifModifiedSinceHeaderValues: string[];
  }> = {}
) {
  return {
    cacheRequestPolicyVersion:
      OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION,
    cacheControlHeaderValues: ["no-cache, no-store, max-age=0"],
    pragmaHeaderValues: ["no-cache"],
    ifNoneMatchHeaderValues: [],
    ifModifiedSinceHeaderValues: [],
    ...overrides
  };
}

function rangeRequest(
  overrides: Partial<{
    rangeHeaderValues: string[];
    ifRangeHeaderValues: string[];
  }> = {}
) {
  return {
    rangeHeaderValues: [],
    ifRangeHeaderValues: [],
    ...overrides
  };
}

function credentialRequest(
  overrides: Partial<{
    authorizationHeaderValues: string[];
    proxyAuthorizationHeaderValues: string[];
    cookieHeaderValues: string[];
  }> = {}
) {
  return {
    authorizationHeaderValues: [],
    proxyAuthorizationHeaderValues: [],
    cookieHeaderValues: [],
    ...overrides
  };
}

function locationHop() {
  return {
    responseUrl: "https://global.krx.co.kr/source",
    locationHeaderValues: ["/download"],
    nextEffectiveRequestUrl: "https://global.krx.co.kr/download"
  };
}

function secondLocationHop() {
  return {
    responseUrl: "https://global.krx.co.kr/download",
    locationHeaderValues: ["/final"],
    nextEffectiveRequestUrl: "https://global.krx.co.kr/final"
  };
}

function methodTransition(): MethodTransition {
  return {
    responseStatus: 302,
    requestMethod: "POST",
    requestBodyHash: hash("a"),
    nextRequestMethod: "GET",
    nextRequestBodyHash: null
  };
}

function secondMethodTransition(): MethodTransition {
  return {
    responseStatus: 303,
    requestMethod: "GET",
    requestBodyHash: null,
    nextRequestMethod: "GET",
    nextRequestBodyHash: null
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
