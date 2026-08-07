import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRequestParametersBoundary } from "./officialMarketCalendarRequestParametersBoundary.js";

test("calendar request parameters boundary accepts canonical per-request objects", () => {
  const boundary = requests();

  assert.deepEqual(
    verifyOfficialMarketCalendarRequestParametersBoundary(boundary),
    boundary
  );
});

test("calendar request parameters boundary rejects non-canonical key order", () => {
  for (const requestParameters of [
    { year: "2026", locale: "en" },
    { filters: { year: "2026", market: "KRX" } },
    { filters: [{ year: "2026", market: "KRX" }] }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRequestParametersBoundary(
          requests({ effectiveRequests: [{ requestParameters }] })
        ),
      /must use canonical key order/
    );
  }
});

test("calendar request parameters boundary rejects non-JSON values", () => {
  for (const requestParameters of [
    { year: undefined },
    { offset: Number.NaN },
    { offset: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRequestParametersBoundary(
        requests({ effectiveRequests: [{ requestParameters }] })
      )
    );
  }
});

test("calendar request parameters boundary rejects malformed Unicode keys", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRequestParametersBoundary(
        requests({
          effectiveRequests: [
            { requestParameters: { ["bad\ud800key"]: "value" } }
          ]
        })
      ),
    /keys must be valid Unicode/
  );
});

test("calendar request parameters boundary rejects array-index-like keys", () => {
  for (const requestParameters of [
    { "0": "value" },
    JSON.parse('{"10":"a","2":"b"}') as Record<string, unknown>,
    { nested: { "4294967294": "value" } }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRequestParametersBoundary(
          requests({ effectiveRequests: [{ requestParameters }] })
        ),
      /must not use array-index grammar/
    );
  }
});

test("calendar request parameters boundary rejects invalid shape and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRequestParametersBoundary(
      requests({ effectiveRequests: [] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRequestParametersBoundary({
        ...requests(),
        parametersMasked: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRequestParametersBoundary({
        effectiveRequests: [
          {
            requestParameters: {},
            requestedUrl: "https://global.krx.co.kr/source"
          }
        ]
      }),
    /Unrecognized key/
  );
});

function requests(
  overrides: Partial<{
    effectiveRequests: Array<{
      requestParameters: Record<string, unknown>;
    }>;
  }> = {}
) {
  return {
    effectiveRequests: [
      {
        requestParameters: {
          filters: {
            locale: "en",
            markets: ["KRX", "NYSE"]
          },
          year: "2026"
        }
      },
      { requestParameters: {} }
    ],
    ...overrides
  };
}
