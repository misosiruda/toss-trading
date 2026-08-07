import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarFinalResponseBoundary } from "./officialMarketCalendarFinalResponseBoundary.js";

test("calendar final response boundary accepts exact 200 without Content-Range", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarFinalResponseBoundary(boundary()),
    {
      ...boundary(),
      responseCacheHeaders: {
        responseDate: "2025-07-01T12:00:00Z",
        responseAgeSeconds: 30
      },
      responseFreshness: {
        freshness: {
          retrievedAt: "2025-07-01T12:00:30.000Z",
          effectiveResponseAt: "2025-07-01T12:00:00.000Z",
          responseDate: "2025-07-01T12:00:00Z",
          responseAgeSeconds: 30
        },
        apparentAgeSeconds: 30,
        effectiveCacheAgeSeconds: 30
      }
    }
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

test("calendar final response boundary requires valid nested cache headers", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        boundary({
          responseCacheHeaders: {
            dateHeaderValues: [],
            ageHeaderValues: []
          }
        })
      ),
    /exactly one Date/
  );
});

test("calendar final response boundary derives freshness from nested cache headers", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        boundary({
          responseFreshness: {
            retrievedAt: "2025-07-01T12:00:30.000Z",
            effectiveResponseAt: "2025-07-01T12:00:01.000Z"
          }
        })
      ),
    /does not match cache age/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarFinalResponseBoundary(
      {
        ...boundary(),
        responseFreshness: {
          retrievedAt: "2025-07-01T12:00:30.000Z",
          responseDate: "2025-07-01T12:00:00Z",
          effectiveResponseAt: "2025-07-01T12:00:00.000Z"
        }
      }
    )
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
    responseCacheHeaders: ReturnType<typeof responseCacheHeaders>;
    responseFreshness: ReturnType<typeof responseFreshness>;
    transferCompletion: ReturnType<typeof completion>;
  }> = {}
) {
  return {
    responseUrl: "https://official.example/calendar",
    httpStatus: 200,
    httpProtocolVersion: "http_1_1" as const,
    contentRangeHeaderValues: [],
    contentRange: null,
    responseCacheHeaders: responseCacheHeaders(),
    responseFreshness: responseFreshness(),
    transferCompletion: completion(),
    ...overrides
  };
}

function responseCacheHeaders() {
  return {
    dateHeaderValues: ["Tue, 01 Jul 2025 12:00:00 GMT"],
    ageHeaderValues: ["30"]
  };
}

function responseFreshness() {
  return {
    retrievedAt: "2025-07-01T12:00:30.000Z",
    effectiveResponseAt: "2025-07-01T12:00:00.000Z"
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
