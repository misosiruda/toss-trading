import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRequestHeaderNamesBoundary } from "./officialMarketCalendarRequestHeaderNamesBoundary.js";

test("calendar request header names boundary accepts canonical requests", () => {
  const boundary = requests();

  assert.deepEqual(
    verifyOfficialMarketCalendarRequestHeaderNamesBoundary(boundary),
    boundary
  );
});

test("calendar request header names boundary rejects invalid names", () => {
  for (const requestHeaderNames of [
    ["Accept"],
    ["accept language"],
    [""]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRequestHeaderNamesBoundary(
          requests({ effectiveRequests: [{ requestHeaderNames }] })
        ),
      /lowercase HTTP field name/
    );
  }
});

test("calendar request header names boundary rejects non-canonical order and duplicates", () => {
  for (const requestHeaderNames of [
    ["pragma", "cache-control"],
    ["accept", "accept"]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRequestHeaderNamesBoundary(
          requests({ effectiveRequests: [{ requestHeaderNames }] })
        ),
      /canonical order without duplicates/
    );
  }
});

test("calendar request header names boundary rejects empty observations", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRequestHeaderNamesBoundary(
      requests({ effectiveRequests: [] })
    )
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarRequestHeaderNamesBoundary(
      requests({ effectiveRequests: [{ requestHeaderNames: [] }] })
    )
  );
});

test("calendar request header names boundary rejects unknown fields", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRequestHeaderNamesBoundary({
        ...requests(),
        headerNamesMasked: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRequestHeaderNamesBoundary({
        effectiveRequests: [
          {
            requestHeaderNames: ["accept"],
            requestHeaderValues: []
          }
        ]
      }),
    /Unrecognized key/
  );
});

function requests(
  overrides: Partial<{
    effectiveRequests: Array<{
      requestHeaderNames: string[];
    }>;
  }> = {}
) {
  return {
    effectiveRequests: [
      {
        requestHeaderNames: [
          "accept",
          "accept-language",
          "cache-control",
          "content-type",
          "pragma"
        ]
      },
      {
        requestHeaderNames: ["accept", "cache-control", "pragma"]
      }
    ],
    ...overrides
  };
}
