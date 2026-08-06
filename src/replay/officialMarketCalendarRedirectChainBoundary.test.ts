import assert from "node:assert/strict";
import test from "node:test";

import { OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION } from "./officialMarketCalendarDomainAllowlist.js";
import { verifyOfficialMarketCalendarRedirectChainBoundary } from "./officialMarketCalendarRedirectChainBoundary.js";

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
});

function chain(
  overrides: Partial<{
    domainUrls: string[];
    effectiveRequestUrls: string[];
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
    domainAllowlistBoundary: {
      exchange: "KRX",
      domainAllowlistPolicyVersion:
        OFFICIAL_MARKET_CALENDAR_DOMAIN_ALLOWLIST_POLICY_VERSION,
      urls: overrides.domainUrls ?? effectiveRequestUrls
    },
    httpsUrlBoundary: {
      requestedUrl: effectiveRequestUrls[0],
      effectiveRequestUrls,
      finalUrl: effectiveRequestUrls[effectiveRequestUrls.length - 1]
    },
    statusBoundary: {
      responseStatuses: overrides.responseStatuses ?? [302]
    },
    locationBoundary: {
      redirectHops: overrides.redirectHops ?? [locationHop()]
    },
    methodBoundary: {
      transitions: overrides.transitions ?? [methodTransition()]
    }
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
