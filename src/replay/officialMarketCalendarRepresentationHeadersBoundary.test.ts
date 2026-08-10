import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRepresentationHeadersBoundary } from "./officialMarketCalendarRepresentationHeadersBoundary.js";

test("calendar representation headers boundary accepts canonical requests", () => {
  const boundary = requests();

  assert.deepEqual(
    verifyOfficialMarketCalendarRepresentationHeadersBoundary(boundary),
    boundary
  );
});

test("calendar representation headers boundary rejects invalid header names", () => {
  for (const representationHeaders of [
    { Accept: "application/pdf" },
    { "accept language": "ko-KR" },
    { "": "application/pdf" }
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRepresentationHeadersBoundary(
          requests({ effectiveRequests: [{ representationHeaders }] })
        ),
      /lowercase HTTP field name/
    );
  }
});

test("calendar representation headers boundary rejects non-canonical key order", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({
          effectiveRequests: [
            {
              representationHeaders: {
                "accept-language": "ko-KR",
                accept: "application/pdf"
              }
            }
          ]
        })
      ),
    /must use canonical key order/
  );
});

test("calendar representation headers boundary rejects non-JSON values", () => {
  for (const representationHeaders of [
    { accept: undefined },
    { accept: Number.NaN },
    { accept: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(() =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary(
        requests({ effectiveRequests: [{ representationHeaders }] })
      )
    );
  }
});

test("calendar representation headers boundary rejects invalid shape and fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRepresentationHeadersBoundary(
      requests({ effectiveRequests: [] })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary({
        ...requests(),
        headersMasked: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRepresentationHeadersBoundary({
        effectiveRequests: [
          {
            representationHeaders: {},
            requestHeaderNames: []
          }
        ]
      }),
    /Unrecognized key/
  );
});

function requests(
  overrides: Partial<{
    effectiveRequests: Array<{
      representationHeaders: Record<string, unknown>;
    }>;
  }> = {}
) {
  return {
    effectiveRequests: [
      {
        representationHeaders: {
          accept: "application/pdf",
          "accept-language": "ko-KR"
        }
      },
      { representationHeaders: {} }
    ],
    ...overrides
  };
}
