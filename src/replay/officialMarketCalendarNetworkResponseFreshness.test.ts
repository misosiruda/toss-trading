import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders,
  OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION,
  resolveOfficialMarketCalendarNetworkResponseFreshness
} from "./officialMarketCalendarNetworkResponseFreshness.js";

test("network calendar freshness applies response delay to corrected age", () => {
  const resolved = createFreshness({
    completedAt: "2025-07-01T12:00:10.000Z",
    responseDelayMilliseconds: 250,
    dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
    ageHeaderValues: ["30"],
    cacheControlHeaderValues: ["public, max-age=60"]
  });

  assert.equal(
    resolved.freshnessPolicyVersion,
    OFFICIAL_MARKET_CALENDAR_NETWORK_FRESHNESS_POLICY_VERSION
  );
  assert.equal(resolved.apparentAgeMilliseconds, 10_000);
  assert.equal(resolved.correctedAgeValueMilliseconds, 30_250);
  assert.equal(resolved.correctedInitialAgeMilliseconds, 30_250);
  assert.equal(
    resolved.freshness.effectiveResponseAt,
    "2025-07-01T11:59:39.750Z"
  );
  assert.equal(resolved.validatedResponseMaxAgeSeconds, 60);
  assert.equal(
    resolved.freshness.staleAfter,
    "2025-07-01T12:00:39.750Z"
  );
});

test("network calendar freshness uses Expires only without max-age", () => {
  const expires = createFreshness({
    expiresHeaderValues: ["Tue, 01 Jul 2025 12:02:00 GMT"]
  });
  assert.equal(expires.freshness.responseExpires, "2025-07-01T12:02:00Z");
  assert.equal(expires.validatedResponseMaxAgeSeconds, null);
  assert.equal(expires.responseFreshnessLifetimeMilliseconds, 120_000);
  assert.equal(expires.freshness.staleAfter, "2025-07-01T12:02:00.000Z");

  const maxAge = createFreshness({
    expiresHeaderValues: ["Tue, 01 Jul 2025 12:10:00 GMT"],
    cacheControlHeaderValues: ["max-age=30"]
  });
  assert.equal(maxAge.validatedResponseMaxAgeSeconds, 30);
  assert.equal(maxAge.freshness.staleAfter, "2025-07-01T12:00:30.000Z");
});

test("network calendar freshness falls back to the 24-hour policy", () => {
  const resolved = createFreshness();
  assert.equal(resolved.maximumAgeSeconds, 86_400);
  assert.equal(
    resolved.freshness.staleAfter,
    "2025-07-02T12:00:00.000Z"
  );
});

test("network calendar freshness rejects unsafe response cache semantics", () => {
  for (const cacheControlHeaderValues of [
    ["no-cache"],
    ["no-store"],
    ["stale-while-revalidate=60"],
    ['max-age="60"'],
    ["max-age=060"],
    ["private=field"],
    ["max-age=9007199254740992"]
  ]) {
    assert.throws(() => createFreshness({ cacheControlHeaderValues }));
  }
});

test("network calendar freshness rejects stale, invalid, and overflowing boundaries", () => {
  assert.throws(
    () => createFreshness({ cacheControlHeaderValues: ["max-age=0"] }),
    /already stale/
  );
  assert.throws(
    () =>
      createFreshness({
        expiresHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"]
      }),
    /Expires must follow/
  );
  assert.throws(
    () =>
      createFreshness({
        dateHeaderValues: ["Tue, 01 Jul 2025 12:00:11 GMT"]
      }),
    /must not follow completion/
  );
  assert.throws(() =>
    createFreshness({ ageHeaderValues: [String(Number.MAX_SAFE_INTEGER)] })
  );
  for (const responseDelayMilliseconds of [-1, 1.5, 10_001]) {
    assert.throws(() => createFreshness({ responseDelayMilliseconds }));
  }
});

test("network calendar freshness rejects recorded derived-value tampering", () => {
  const resolved = createFreshness({
    cacheControlHeaderValues: ["public, max-age=60"]
  });
  assert.throws(
    () =>
      resolveOfficialMarketCalendarNetworkResponseFreshness({
        ...resolved.freshness,
        effectiveResponseAt: "2025-07-01T12:00:00.001Z"
      }),
    /does not match network corrected age/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarNetworkResponseFreshness({
        ...resolved.freshness,
        staleAfter: "2025-07-01T12:01:00.001Z"
      }),
    /does not match network response expiry/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarNetworkResponseFreshness({
        ...resolved.freshness,
        providerApiVersion: "1.2.14"
      }),
    /Unrecognized key/
  );
});

function createFreshness(
  overrides: Partial<{
    completedAt: string;
    responseDelayMilliseconds: number;
    dateHeaderValues: string[];
    ageHeaderValues: string[];
    expiresHeaderValues: string[];
    cacheControlHeaderValues: string[];
  }> = {}
) {
  return createOfficialMarketCalendarNetworkResponseFreshnessFromHeaders({
    completedAt: overrides.completedAt ?? "2025-07-01T12:00:10.000Z",
    responseDelayMilliseconds: overrides.responseDelayMilliseconds ?? 0,
    responseCacheHeaders: {
      dateHeaderValues:
        overrides.dateHeaderValues ?? ["Tue, 01 Jul 2025 12:00:00 GMT"],
      ageHeaderValues: overrides.ageHeaderValues ?? [],
      expiresHeaderValues: overrides.expiresHeaderValues ?? []
    },
    responseCacheControl: {
      cacheControlHeaderValues: overrides.cacheControlHeaderValues ?? []
    }
  });
}
