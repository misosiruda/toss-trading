import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarFinalResponseBoundary } from "./officialMarketCalendarFinalResponseBoundary.js";

test("calendar final response boundary accepts exact 200 without Content-Range", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarFinalResponseBoundary(boundary()),
    boundary()
  );
});

test("calendar final response boundary rejects non-200 status", () => {
  for (const httpStatus of [199, 204, 206, 302, 404, 500]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarFinalResponseBoundary(
          boundary({ httpStatus })
        ),
      /status must be exactly 200/
    );
  }
});

test("calendar final response boundary rejects any Content-Range value", () => {
  for (const contentRangeHeaderValues of [
    ["bytes 0-99/200"],
    ["bytes 0-99/200", "bytes 100-199/200"]
  ]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarFinalResponseBoundary(
          boundary({ contentRangeHeaderValues })
        ),
      /must not contain Content-Range/
    );
  }
});

test("calendar final response boundary rejects non-null recorded Content-Range", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarFinalResponseBoundary({
      ...boundary(),
      contentRange: "bytes 0-99/200"
    })
  );
});

test("calendar final response boundary binds nested transfer protocol", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        boundary({ httpProtocolVersion: "http_2" })
      ),
    /response and transfer protocol must match/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        boundary({ transferCompletion: completion({ transferCompleted: false }) })
      ),
    /transfer must be complete/
  );
});

test("calendar final response boundary rejects invalid types and unknown fields", () => {
  assert.throws(() =>
    verifyOfficialMarketCalendarFinalResponseBoundary(
      boundary({ httpStatus: 200.5 })
    )
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary({
        ...boundary(),
        partialResponses: []
      }),
    /Unrecognized key/
  );
});

function boundary(
  overrides: Partial<{
    responseUrl: string;
    httpStatus: number;
    httpProtocolVersion: "http_1_0" | "http_1_1" | "http_2" | "http_3";
    contentRangeHeaderValues: string[];
    contentRange: null;
    transferCompletion: ReturnType<typeof completion>;
  }> = {}
) {
  return {
    responseUrl: "https://official.example/calendar",
    httpStatus: 200,
    httpProtocolVersion: "http_1_1" as const,
    contentRangeHeaderValues: [],
    contentRange: null,
    transferCompletion: completion(),
    ...overrides
  };
}

function completion(
  overrides: Partial<{
    transferCompleted: boolean;
  }> = {}
) {
  return {
    httpProtocolVersion: "http_1_1" as const,
    transferFraming: "content_length" as const,
    transferCompleted: true,
    declaredContentLength: 100,
    contentLength: 100,
    ...overrides
  };
}
