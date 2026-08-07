import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRedirectMethodBoundary } from "./officialMarketCalendarRedirectMethodBoundary.js";

test("calendar redirect method boundary accepts GET and POST transitions", () => {
  const boundary = transitions();

  assert.deepEqual(
    verifyOfficialMarketCalendarRedirectMethodBoundary(boundary),
    boundary
  );
});

test("calendar redirect method boundary rejects a preserved POST", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectMethodBoundary({
      transitions: [
        {
          ...transition(),
          nextRequestMethod: "POST"
        }
      ]
    })
  );
});

test("calendar redirect method boundary rejects retained next request bodies", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectMethodBoundary({
      transitions: [
        {
          ...transition(),
          nextRequestBodyContentType: "application/json",
          nextRequestBodyHash: hash("b")
        }
      ]
    })
  );
});

test("calendar redirect method boundary rejects GET request bodies", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectMethodBoundary({
        transitions: [
          transition({
            requestMethod: "GET",
            requestBodyContentType: "application/json",
            requestBodyHash: hash("c")
          })
        ]
      }),
    /GET request body metadata must be null/
  );
});

test("calendar redirect method boundary requires body content type and hash together", () => {
  for (const overrides of [
    { requestBodyContentType: null },
    { requestBodyHash: null }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRedirectMethodBoundary({
          transitions: [transition(overrides)]
        }),
      /content type and hash must coexist/
    );
  }
});

test("calendar redirect method boundary rejects disconnected transitions", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectMethodBoundary({
        transitions: [
          transition(),
          transition({
            responseStatus: 303,
            requestMethod: "POST",
            requestBodyContentType: "application/json",
            requestBodyHash: hash("d")
          })
        ]
      }),
    /must form one continuous request chain/
  );
});

test("calendar redirect method boundary rejects unsupported values and fields", () => {
  for (const invalidTransition of [
    { ...transition(), responseStatus: 307 },
    { ...transition(), requestMethod: "PUT" },
    { ...transition(), requestBodyContentType: " application/json" },
    { ...transition(), requestBodyHash: "sha256:invalid" }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRedirectMethodBoundary({
        transitions: [invalidTransition]
      })
    );
  }
  assert.throws(() =>
    verifyOfficialMarketCalendarRedirectMethodBoundary({ transitions: [] })
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRedirectMethodBoundary({
        ...transitions(),
        headersRemoved: true
      }),
    /Unrecognized key/
  );
});

function transitions() {
  return {
    transitions: [
      transition({ responseStatus: 301 }),
      transition({
        requestMethod: "GET",
        requestBodyContentType: null,
        requestBodyHash: null
      }),
      transition({
        responseStatus: 303,
        requestMethod: "GET",
        requestBodyContentType: null,
        requestBodyHash: null
      })
    ]
  };
}

function transition(
  overrides: Partial<{
    responseStatus: number;
    requestMethod: string;
    requestBodyContentType: string | null;
    requestBodyHash: string | null;
    nextRequestMethod: string;
    nextRequestBodyContentType: string | null;
    nextRequestBodyHash: string | null;
  }> = {}
) {
  return {
    responseStatus: 302,
    requestMethod: "POST",
    requestBodyContentType: "application/x-www-form-urlencoded",
    requestBodyHash: hash("a"),
    nextRequestMethod: "GET",
    nextRequestBodyContentType: null,
    nextRequestBodyHash: null,
    ...overrides
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
