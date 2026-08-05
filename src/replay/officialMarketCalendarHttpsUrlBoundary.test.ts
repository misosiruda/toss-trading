import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarHttpsUrlBoundary } from "./officialMarketCalendarHttpsUrlBoundary.js";

test("calendar HTTPS URL boundary accepts matching secure redirect URLs", () => {
  const boundary = urls();

  assert.deepEqual(
    verifyOfficialMarketCalendarHttpsUrlBoundary(boundary),
    boundary
  );
});

test("calendar HTTPS URL boundary rejects first and final URL mismatches", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarHttpsUrlBoundary(
        urls({ requestedUrl: "https://official.example/other" })
      ),
    /requested URL must match first/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarHttpsUrlBoundary(
        urls({ finalUrl: "https://official.example/other" })
      ),
    /final URL must match last/
  );
});

test("calendar HTTPS URL boundary rejects non-HTTPS URLs and downgrade", () => {
  for (const effectiveRequestUrls of [
    ["http://official.example/source"],
    [
      "https://official.example/source",
      "http://download.official.example/calendar"
    ]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarHttpsUrlBoundary({
          requestedUrl: effectiveRequestUrls[0],
          effectiveRequestUrls,
          finalUrl: effectiveRequestUrls[effectiveRequestUrls.length - 1]
        }),
      /must use HTTPS/
    );
  }
});

test("calendar HTTPS URL boundary rejects URL userinfo", () => {
  for (const rawUrl of [
    "https://user@official.example/source",
    "https://user:secret@official.example/source"
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarHttpsUrlBoundary({
          requestedUrl: rawUrl,
          effectiveRequestUrls: [rawUrl],
          finalUrl: rawUrl
        }),
      /must not contain userinfo/
    );
  }
});

test("calendar HTTPS URL boundary rejects invalid shape and URL", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarHttpsUrlBoundary({
      requestedUrl: "not-a-url",
      effectiveRequestUrls: ["not-a-url"],
      finalUrl: "not-a-url"
    })
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarHttpsUrlBoundary(
      urls({ effectiveRequestUrls: [] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarHttpsUrlBoundary({
        ...urls(),
        certificateVerified: true
      }),
    /Unrecognized key/
  );
});

function urls(
  overrides: Partial<{
    requestedUrl: string;
    effectiveRequestUrls: string[];
    finalUrl: string;
  }> = {}
) {
  return {
    requestedUrl: "https://official.example/source",
    effectiveRequestUrls: [
      "https://official.example/source",
      "https://download.official.example/calendar"
    ],
    finalUrl: "https://download.official.example/calendar",
    ...overrides
  };
}
