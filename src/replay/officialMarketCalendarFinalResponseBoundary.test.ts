import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfficialMarketCalendarFinalResponseBoundary as verifyOfficialMarketCalendarFinalResponseBoundaryWithRegistry } from "./officialMarketCalendarFinalResponseBoundary.js";
import {
  OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
  createOfficialMarketCalendarFreshnessPolicyHash
} from "./officialMarketCalendarFreshnessPolicy.js";

test("calendar final response boundary accepts exact 200 without Content-Range", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarFinalResponseBoundary(boundary()),
    {
      ...boundary(),
      responseCacheHeaders: {
        responseDate: "2025-07-01T12:00:00Z",
        responseAgeSeconds: 30
      },
      responseCacheControl: {
        responseCacheControl: null
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
      },
      freshnessPolicyExpiry: {
        freshnessPolicyVersion: "krx_calendar_annual.v1",
        freshnessPolicyHash:
          boundary().freshnessPolicyExpiry.freshnessPolicyEntry
            .freshnessPolicyHash,
        effectiveResponseAt: "2025-07-01T12:00:00.000Z",
        durationSeconds: 86_400,
        staleAfter: "2025-07-02T12:00:00.000Z"
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

test("calendar final response boundary binds nested Cache-Control", () => {
  assert.deepEqual(
    verifyOfficialMarketCalendarFinalResponseBoundary(
      boundary({
        responseCacheControl: {
          cacheControlHeaderValues: ["Public, max-age=60"]
        }
      })
    ).responseCacheControl,
    {
      responseCacheControl: ["max-age=60", "public"]
    }
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        boundary({
          responseCacheControl: {
            cacheControlHeaderValues: ["max-age =60"]
          }
        })
      ),
    /valid directive syntax/
  );
  const { responseCacheControl: _responseCacheControl, ...missing } = boundary();
  assert.throws(() =>
    verifyOfficialMarketCalendarFinalResponseBoundary(missing)
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

test("calendar final response boundary binds nested policy expiry", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        boundary({
          freshnessPolicyExpiry: policyExpiry({
            staleAfter: "2025-07-02T12:00:00.001Z"
          })
        })
      ),
    /does not match/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundary(
        {
          ...boundary(),
          freshnessPolicyExpiry: {
            ...policyExpiry(),
            effectiveResponseAt: "2025-07-01T12:00:00.000Z"
          }
        }
      ),
    /Unrecognized key/
  );
  const { freshnessPolicyExpiry: _freshnessPolicyExpiry, ...missing } =
    boundary();
  assert.throws(() => verifyOfficialMarketCalendarFinalResponseBoundary(missing));
});

test("calendar final response boundary requires a registered policy", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundaryWithRegistry(
        boundary(),
        []
      ),
    /version is not registered/
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarFinalResponseBoundaryWithRegistry(
        boundary(),
        [policyExpiry({ durationSeconds: 172_800 }).freshnessPolicyEntry]
      ),
    /does not match registry/
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
    responseCacheControl: {
      cacheControlHeaderValues: string[];
    };
    responseFreshness: ReturnType<typeof responseFreshness>;
    freshnessPolicyExpiry: ReturnType<typeof policyExpiry>;
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
    responseCacheControl: {
      cacheControlHeaderValues: []
    },
    responseFreshness: responseFreshness(),
    freshnessPolicyExpiry: policyExpiry(),
    transferCompletion: completion(),
    ...overrides
  };
}

function policyExpiry(
  overrides: Partial<{
    staleAfter: string;
    durationSeconds: number;
  }> = {}
) {
  const definition = {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
    sourceSelector: {
      exchange: "KRX" as const,
      requestMethod: "GET" as const,
      requestedUrl: "https://global.krx.co.kr/calendar",
      requestParameters: {},
      requestBodyContentType: null,
      requestBodyHash: null,
      representationHeaders: {},
      parserContractVersion: "krx_calendar_pdf.v1"
    },
    coverageSelector: {
      evidenceRoles: ["holiday_rows", "holiday_schedule"] as const,
      rowCoverageStartDate: "2026-01-01",
      rowCoverageEndDate: "2026-12-31",
      scheduleCoverageIntervals: [
        {
          coverageRole: "holiday_schedule" as const,
          startDate: "2026-01-01",
          endDate: "2026-12-31"
        }
      ],
      applicabilityStartDate: null,
      applicabilityEndDate: null
    },
    expiryRule: {
      type: "fixed_duration_from_effective_response" as const,
      durationSeconds: overrides.durationSeconds ?? 86_400
    }
  };
  return {
    freshnessPolicyEntry: {
      freshnessPolicyVersion: "krx_calendar_annual.v1",
      freshnessPolicyDefinition: definition,
      freshnessPolicyHash:
        createOfficialMarketCalendarFreshnessPolicyHash(definition)
    },
    staleAfter: overrides.staleAfter ?? "2025-07-02T12:00:00.000Z"
  };
}

function verifyOfficialMarketCalendarFinalResponseBoundary(value: unknown) {
  return verifyOfficialMarketCalendarFinalResponseBoundaryWithRegistry(
    value,
    [policyExpiry().freshnessPolicyEntry]
  );
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
