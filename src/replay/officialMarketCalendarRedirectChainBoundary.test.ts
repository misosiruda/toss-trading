import assert from "node:assert/strict";
import test from "node:test";

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
});

function chain(
  overrides: Partial<{
    responseStatuses: number[];
    redirectHops: ReturnType<typeof locationHop>[];
    transitions: MethodTransition[];
  }> = {}
) {
  return {
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
    responseUrl: "https://official.example/source",
    locationHeaderValues: ["/download"],
    nextEffectiveRequestUrl: "https://official.example/download"
  };
}

function secondLocationHop() {
  return {
    responseUrl: "https://official.example/download",
    locationHeaderValues: ["/final"],
    nextEffectiveRequestUrl: "https://official.example/final"
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
