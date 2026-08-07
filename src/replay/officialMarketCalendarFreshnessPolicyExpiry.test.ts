import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
  createOfficialMarketCalendarFreshnessPolicyHash
} from "./officialMarketCalendarFreshnessPolicy.js";
import {
  resolveOfficialMarketCalendarFreshnessPolicyExpiry,
  resolveOfficialMarketCalendarFreshnessPolicyExpiryFromResponseFreshness
} from "./officialMarketCalendarFreshnessPolicyExpiry.js";
import { resolveOfficialMarketCalendarResponseFreshness } from "./officialMarketCalendarResponseFreshness.js";

test("calendar freshness policy expiry derives staleAfter deterministically", () => {
  const input = expiry();
  const expected = {
    freshnessPolicyVersion: "krx_calendar_annual.v1",
    freshnessPolicyHash: input.freshnessPolicyEntry.freshnessPolicyHash,
    effectiveResponseAt: "2025-07-01T12:00:00.000Z",
    durationSeconds: 86_400,
    staleAfter: "2025-07-02T12:00:00.000Z"
  };

  assert.deepEqual(
    resolveOfficialMarketCalendarFreshnessPolicyExpiry(input),
    expected
  );
  assert.deepEqual(
    resolveOfficialMarketCalendarFreshnessPolicyExpiry(input),
    expected
  );
});

test("calendar freshness policy expiry rejects staleAfter mismatch", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry(
        expiry({ staleAfter: "2025-07-02T12:00:00.001Z" })
      ),
    /does not match/
  );
});

test("calendar freshness policy expiry requires canonical timestamps", () => {
  for (const overrides of [
    { effectiveResponseAt: "2025-07-01T21:00:00.000+09:00" },
    { effectiveResponseAt: "2025-07-01T12:00:00Z" },
    { effectiveResponseAt: "2025-02-30T12:00:00.000Z" },
    { staleAfter: "2025-07-02T12:00:00Z" }
  ]) {
    assert.throws(() =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry(expiry(overrides))
    );
  }
});

test("calendar freshness policy expiry rejects unsafe duration arithmetic", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry(
        expiry({ durationSeconds: Number.MAX_SAFE_INTEGER })
      ),
    /safe millisecond range/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry(
        expiry({ durationSeconds: 8_640_000_000_000 })
      ),
    /exceeds Date range/
  );
});

test("calendar freshness policy expiry rejects unsupported derived year", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry(
        expiry({
          effectiveResponseAt: "9999-12-31T23:59:59.000Z",
          durationSeconds: 1,
          staleAfter: "9999-12-31T23:59:59.999Z"
        })
      ),
    /canonical timestamp range/
  );
});

test("calendar freshness policy expiry propagates policy hash validation", () => {
  const input = expiry();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry({
        ...input,
        freshnessPolicyEntry: {
          ...input.freshnessPolicyEntry,
          freshnessPolicyHash: hash("f")
        }
      }),
    /policy hash mismatch/
  );
});

test("calendar freshness policy expiry rejects unknown fields", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiry({
        ...expiry(),
        currentTime: "2025-07-01T12:00:00.000Z"
      }),
    /Unrecognized key/
  );
});

test("calendar freshness policy expiry derives effective time from response freshness", () => {
  const { effectiveResponseAt: _effectiveResponseAt, ...recordedExpiry } =
    expiry();

  assert.deepEqual(
    resolveOfficialMarketCalendarFreshnessPolicyExpiryFromResponseFreshness(
      recordedExpiry,
      responseFreshness().freshness
    ),
    resolveOfficialMarketCalendarFreshnessPolicyExpiry(expiry())
  );
});

test("calendar freshness policy expiry rejects caller effective time in bound input", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiryFromResponseFreshness(
        expiry(),
        responseFreshness().freshness
      ),
    /Unrecognized key/
  );
});

test("calendar freshness policy expiry bound input preserves mismatch rejection", () => {
  const { effectiveResponseAt: _effectiveResponseAt, ...recordedExpiry } =
    expiry({ staleAfter: "2025-07-02T12:00:00.001Z" });
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicyExpiryFromResponseFreshness(
        recordedExpiry,
        responseFreshness().freshness
      ),
    /does not match/
  );
});

function expiry(
  overrides: Partial<{
    effectiveResponseAt: string;
    staleAfter: string;
    durationSeconds: number;
  }> = {}
) {
  const definition = policyDefinition(
    overrides.durationSeconds ?? 86_400
  );
  return {
    freshnessPolicyEntry: {
      freshnessPolicyVersion: "krx_calendar_annual.v1",
      freshnessPolicyDefinition: definition,
      freshnessPolicyHash:
        createOfficialMarketCalendarFreshnessPolicyHash(definition)
    },
    effectiveResponseAt:
      overrides.effectiveResponseAt ?? "2025-07-01T12:00:00.000Z",
    staleAfter: overrides.staleAfter ?? "2025-07-02T12:00:00.000Z"
  };
}

function policyDefinition(durationSeconds: number) {
  return {
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
      durationSeconds
    }
  };
}

function responseFreshness() {
  return resolveOfficialMarketCalendarResponseFreshness({
    retrievedAt: "2025-07-01T12:00:10.000Z",
    responseDate: "2025-07-01T12:00:00Z",
    responseAgeSeconds: 5,
    effectiveResponseAt: "2025-07-01T12:00:00.000Z"
  });
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
