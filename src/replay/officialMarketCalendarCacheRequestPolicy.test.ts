import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_CACHE_REQUEST_POLICY_VERSION,
  verifyOfficialMarketCalendarCacheRequestPolicy
} from "./officialMarketCalendarCacheRequestPolicy.js";

test("calendar cache request policy accepts canonical revalidation headers", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarCacheRequestPolicy(policy()),
    policy()
  );
});

test("calendar cache request policy rejects missing or duplicate Cache-Control", () => {
  for (const cacheControlHeaderValues of [
    [],
    [
      "no-cache, no-store, max-age=0",
      "no-cache, no-store, max-age=0"
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarCacheRequestPolicy(
          policy({ cacheControlHeaderValues })
        ),
      /Cache-Control must be exactly/
    );
  }
});

test("calendar cache request policy rejects non-canonical Cache-Control", () => {
  for (const value of [
    "no-store, no-cache, max-age=0",
    "no-cache,no-store,max-age=0",
    "no-cache, no-store, max-age=1",
    "No-Cache, no-store, max-age=0"
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarCacheRequestPolicy(
        policy({ cacheControlHeaderValues: [value] })
      )
    );
  }
});

test("calendar cache request policy rejects missing, duplicate or invalid Pragma", () => {
  for (const pragmaHeaderValues of [
    [],
    ["no-cache", "no-cache"],
    ["No-Cache"]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarCacheRequestPolicy(
          policy({ pragmaHeaderValues })
        ),
      /Pragma must be exactly/
    );
  }
});

test("calendar cache request policy rejects conditional headers", () => {
  for (const overrides of [
    { ifNoneMatchHeaderValues: ['"etag"'] },
    { ifModifiedSinceHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"] }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarCacheRequestPolicy(policy(overrides)),
      /must not contain conditional headers/
    );
  }
});

test("calendar cache request policy rejects unknown version and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarCacheRequestPolicy({
      ...policy(),
      cacheRequestPolicyVersion: "official_market_calendar_cache_request.v2"
    })
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarCacheRequestPolicy({
        ...policy(),
        authorizationHeaderValues: []
      }),
    /Unrecognized key/
  );
});

function policy(
  overrides: Partial<{
    cacheRequestPolicyVersion: string;
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
