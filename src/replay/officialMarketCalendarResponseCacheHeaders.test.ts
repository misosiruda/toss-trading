import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOfficialMarketCalendarNetworkResponseCacheHeaders,
  parseOfficialMarketCalendarResponseCacheHeaders
} from "./officialMarketCalendarResponseCacheHeaders.js";

test("calendar response cache headers parse canonical Date and Age", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseCacheHeaders({
      dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
      ageHeaderValues: ["30"]
    }),
    {
      responseDate: "2025-07-01T12:00:00Z",
      responseAgeSeconds: 30
    }
  );
});

test("calendar response cache headers preserve absent Age as null", () => {
  assert.equal(
    parseOfficialMarketCalendarResponseCacheHeaders({
      dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
      ageHeaderValues: []
    }).responseAgeSeconds,
    null
  );
});

test("network calendar cache headers preserve canonical Expires provenance", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarNetworkResponseCacheHeaders({
      dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
      ageHeaderValues: [],
      expiresHeaderValues: ["Tue, 01 Jul 2025 12:02:00 GMT"]
    }),
    {
      responseDate: "2025-07-01T12:00:00Z",
      responseAgeSeconds: null,
      responseExpires: "2025-07-01T12:02:00Z"
    }
  );
  assert.equal(
    parseOfficialMarketCalendarNetworkResponseCacheHeaders({
      dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
      ageHeaderValues: [],
      expiresHeaderValues: []
    }).responseExpires,
    null
  );
});

test("network calendar cache headers reject duplicate or noncanonical Expires", () => {
  for (const expiresHeaderValues of [
    [
      "Tue, 01 Jul 2025 12:02:00 GMT",
      "Tue, 01 Jul 2025 12:03:00 GMT"
    ],
    ["2025-07-01T12:02:00Z"],
    ["Mon, 01 Jul 2025 12:02:00 GMT"]
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarNetworkResponseCacheHeaders({
        dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
        ageHeaderValues: [],
        expiresHeaderValues
      })
    );
  }
});

test("legacy cache header parser remains strict and Expires-unaware", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarResponseCacheHeaders({
        dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
        ageHeaderValues: [],
        expiresHeaderValues: []
      }),
    /Unrecognized key/
  );
});

test("calendar response cache headers accept a valid leap date and decimal Age", () => {
  assert.deepEqual(
    parseOfficialMarketCalendarResponseCacheHeaders({
      dateHeaderValues: ["Thu, 29 Feb 2024 23:59:59 GMT"],
      ageHeaderValues: ["0005"]
    }),
    {
      responseDate: "2024-02-29T23:59:59Z",
      responseAgeSeconds: 5
    }
  );
});

test("calendar response cache headers reject missing or duplicate Date", () => {
  for (const dateHeaderValues of [
    [],
    [
      "Tue, 01 Jul 2025 12:00:00 GMT",
      "Tue, 01 Jul 2025 12:00:01 GMT"
    ]
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarResponseCacheHeaders({
          dateHeaderValues,
          ageHeaderValues: []
        }),
      /exactly one Date/
    );
  }
});

test("calendar response cache headers reject duplicate Age", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarResponseCacheHeaders({
        dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
        ageHeaderValues: ["5", "6"]
      }),
    /duplicate Age/
  );
});

test("calendar response cache headers reject invalid Date values", () => {
  for (const date of [
    "2025-07-01T12:00:00Z",
    "Tue, 1 Jul 2025 12:00:00 GMT",
    "Sun, 30 Feb 2025 12:00:00 GMT",
    "Mon, 01 Jul 2025 12:00:00 GMT",
    "Tue, 01 Jul 2025 12:00:00 UTC"
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarResponseCacheHeaders({
        dateHeaderValues: [date],
        ageHeaderValues: []
      })
    );
  }
});

test("calendar response cache headers reject invalid Age values", () => {
  for (const age of [
    "",
    "-1",
    "1.5",
    "5, 6",
    "9007199254740992"
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarResponseCacheHeaders({
        dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
        ageHeaderValues: [age]
      })
    );
  }
});

test("calendar response cache headers reject unknown fields", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarResponseCacheHeaders({
        dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
        ageHeaderValues: [],
        responseDate: "2025-07-01T12:00:00Z"
      }),
    /Unrecognized key/
  );
});
