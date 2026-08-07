import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
  createOfficialMarketCalendarFreshnessPolicyHash
} from "./officialMarketCalendarFreshnessPolicy.js";
import { resolveOfficialMarketCalendarFreshnessPolicySelectorBinding } from "./officialMarketCalendarFreshnessPolicySelectorBinding.js";

test("calendar freshness policy selectors bind exact acquisition metadata", () => {
  const entry = registryEntry();
  const metadata = selectorMetadata();
  const { exchange, ...remainingMetadata } = metadata;

  assert.deepEqual(
    resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
      {
        ...remainingMetadata,
        exchange,
        requestParameters: { locale: "en", year: "2026" }
      },
      entry,
      [entry]
    ),
    {
      freshnessPolicyEntry: entry,
      selectorMetadata: metadata
    }
  );
});

test("calendar freshness policy selectors reject source metadata mismatch", () => {
  const entry = registryEntry();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        {
          ...selectorMetadata(),
          requestedUrl: "https://global.krx.co.kr/other"
        },
        entry,
        [entry]
      ),
    /do not match acquisition metadata/
  );
});

test("calendar freshness policy selectors reject coverage metadata mismatch", () => {
  const entry = registryEntry();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        {
          ...selectorMetadata(),
          evidenceRoles: ["holiday_rows"]
        },
        entry,
        [entry]
      ),
    /do not match acquisition metadata/
  );
});

test("calendar freshness policy selectors reject incomplete or unregistered metadata", () => {
  const entry = registryEntry();
  const { parserContractVersion: _parserContractVersion, ...missing } =
    selectorMetadata();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        missing,
        entry,
        [entry]
      ),
    /do not match acquisition metadata/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        {
          ...selectorMetadata(),
          currentTime: "2025-07-01T12:00:00.000Z"
        },
        entry,
        [entry]
      ),
    /do not match acquisition metadata/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        selectorMetadata(),
        entry,
        []
      ),
    /version is not registered/
  );
});

test("calendar freshness policy selectors reject registered policy substitution", () => {
  const entry = registryEntry();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarFreshnessPolicySelectorBinding(
        selectorMetadata(),
        entry,
        [registryEntry(172_800)]
      ),
    /does not match registry/
  );
});

function registryEntry(durationSeconds = 86_400) {
  const definition = policyDefinition(durationSeconds);
  return {
    freshnessPolicyVersion: "krx_calendar_annual.v1",
    freshnessPolicyDefinition: definition,
    freshnessPolicyHash:
      createOfficialMarketCalendarFreshnessPolicyHash(definition)
  };
}

function policyDefinition(durationSeconds: number) {
  const metadata = selectorMetadata();
  return {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
    sourceSelector: {
      exchange: metadata.exchange,
      requestMethod: metadata.requestMethod,
      requestedUrl: metadata.requestedUrl,
      requestParameters: metadata.requestParameters,
      requestBodyContentType: metadata.requestBodyContentType,
      requestBodyHash: metadata.requestBodyHash,
      representationHeaders: metadata.representationHeaders,
      parserContractVersion: metadata.parserContractVersion
    },
    coverageSelector: {
      evidenceRoles: metadata.evidenceRoles,
      rowCoverageStartDate: metadata.rowCoverageStartDate,
      rowCoverageEndDate: metadata.rowCoverageEndDate,
      scheduleCoverageIntervals: metadata.scheduleCoverageIntervals,
      applicabilityStartDate: metadata.applicabilityStartDate,
      applicabilityEndDate: metadata.applicabilityEndDate
    },
    expiryRule: {
      type: "fixed_duration_from_effective_response" as const,
      durationSeconds
    }
  };
}

function selectorMetadata() {
  return {
    exchange: "KRX" as const,
    requestMethod: "GET" as const,
    requestedUrl: "https://global.krx.co.kr/calendar",
    requestParameters: { year: "2026", locale: "en" },
    requestBodyContentType: null,
    requestBodyHash: null,
    representationHeaders: { accept: "application/pdf" },
    parserContractVersion: "krx_calendar_pdf.v1",
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
  };
}
