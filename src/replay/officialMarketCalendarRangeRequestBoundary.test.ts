import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarRangeRequestBoundary } from "./officialMarketCalendarRangeRequestBoundary.js";

test("calendar range request boundary accepts absent range headers", () => {
  const boundary = {
    rangeHeaderValues: [],
    ifRangeHeaderValues: []
  };

  assert.deepEqual(
    verifyOfficialMarketCalendarRangeRequestBoundary(boundary),
    boundary
  );
});

test("calendar range request boundary rejects Range headers", () => {
  for (const rangeHeaderValues of [
    ["bytes=0-99"],
    ["bytes=0-99", "bytes=100-199"]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRangeRequestBoundary({
          rangeHeaderValues,
          ifRangeHeaderValues: []
        }),
      /must not contain Range or If-Range/
    );
  }
});

test("calendar range request boundary rejects If-Range headers", () => {
  for (const ifRangeHeaderValues of [
    ['"etag"'],
    ["Tue, 01 Jul 2025 12:00:00 GMT"]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarRangeRequestBoundary({
          rangeHeaderValues: [],
          ifRangeHeaderValues
        }),
      /must not contain Range or If-Range/
    );
  }
});

test("calendar range request boundary rejects invalid types and unknown fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarRangeRequestBoundary({
      rangeHeaderValues: "bytes=0-99",
      ifRangeHeaderValues: []
    })
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarRangeRequestBoundary({
        rangeHeaderValues: [],
        ifRangeHeaderValues: [],
        partialAssemblyEnabled: false
      }),
    /Unrecognized key/
  );
});
