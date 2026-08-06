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
            requestBodyHash: hash("c")
          })
        ]
      }),
    /GET request body hash must be null/
  );
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
        requestBodyHash: null
      }),
      transition({
        responseStatus: 303,
        requestMethod: "GET",
        requestBodyHash: null
      })
    ]
  };
}

function transition(
  overrides: Partial<{
    responseStatus: number;
    requestMethod: string;
    requestBodyHash: string | null;
    nextRequestMethod: string;
    nextRequestBodyHash: string | null;
  }> = {}
) {
  return {
    responseStatus: 302,
    requestMethod: "POST",
    requestBodyHash: hash("a"),
    nextRequestMethod: "GET",
    nextRequestBodyHash: null,
    ...overrides
  };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
