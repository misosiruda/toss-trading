import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
  createOfficialMarketCalendarFreshnessPolicyHash,
  parseOfficialMarketCalendarFreshnessPolicyDefinition,
  parseOfficialMarketCalendarFreshnessPolicyRegistry,
  parseOfficialMarketCalendarFreshnessPolicyRegistryEntry
} from "./officialMarketCalendarFreshnessPolicy.js";

type EvidenceRole =
  | "holiday_rows"
  | "holiday_schedule"
  | "session_hours"
  | "session_hours_exception_schedule"
  | "special_closure"
  | "special_closure_schedule";

test("calendar freshness policy parses and verifies a canonical registry entry", () => {
  const definition = policyDefinition();
  const entry = registryEntry(definition);

  assert.deepEqual(
    parseOfficialMarketCalendarFreshnessPolicyRegistryEntry(entry),
    entry
  );
  assert.match(entry.freshnessPolicyHash, /^sha256:[a-f0-9]{64}$/);
});

test("calendar freshness policy hash is stable across JSON object key order", () => {
  const first = policyDefinition({
    requestParameters: { year: "2026", locale: "en" },
    representationHeaders: { accept: "application/pdf", language: "en" }
  });
  const second = policyDefinition({
    requestParameters: { locale: "en", year: "2026" },
    representationHeaders: { language: "en", accept: "application/pdf" }
  });

  assert.equal(
    createOfficialMarketCalendarFreshnessPolicyHash(first),
    createOfficialMarketCalendarFreshnessPolicyHash(second)
  );
});

test("calendar freshness policy requires request body content type and hash together", () => {
  for (const sourceSelector of [
    {
      requestBodyContentType: "application/json",
      requestBodyHash: null
    },
    {
      requestBodyContentType: null,
      requestBodyHash: hash("a")
    }
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarFreshnessPolicyDefinition(
          policyDefinition(sourceSelector)
        ),
      /content type and hash must coexist/
    );
  }
});

test("calendar freshness policy rejects invalid coverage ranges", () => {
  for (const coverageSelector of [
    {
      rowCoverageStartDate: "2026-01-01",
      rowCoverageEndDate: null
    },
    {
      rowCoverageStartDate: "2026-01-02",
      rowCoverageEndDate: "2026-01-01"
    },
    {
      scheduleCoverageIntervals: [
        interval("holiday_schedule", "2026-01-02", "2026-01-01")
      ]
    },
    {
      applicabilityStartDate: null,
      applicabilityEndDate: "2026-01-01"
    },
    {
      applicabilityStartDate: "2026-01-02",
      applicabilityEndDate: "2026-01-01"
    }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarFreshnessPolicyDefinition(
        policyDefinition({ coverageSelector })
      )
    );
  }
});

test("calendar freshness policy requires canonical role and interval order", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarFreshnessPolicyDefinition(
        policyDefinition({
          coverageSelector: {
            evidenceRoles: ["session_hours", "holiday_rows"]
          }
        })
      ),
    /canonical lexical order/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarFreshnessPolicyDefinition(
        policyDefinition({
          coverageSelector: {
            scheduleCoverageIntervals: [
              interval(
                "special_closure_schedule",
                "2026-01-01",
                "2026-12-31"
              ),
              interval(
                "holiday_schedule",
                "2026-01-01",
                "2026-12-31"
              )
            ]
          }
        })
      ),
    /canonical lexical order/
  );
});

test("calendar freshness policy rejects invalid source identity and duration", () => {
  for (const definition of [
    policyDefinition({ requestMethod: "get" }),
    policyDefinition({ requestedUrl: "http://global.krx.co.kr/calendar" }),
    policyDefinition({ requestedUrl: "https://www.nyse.com/calendar" }),
    policyDefinition({ durationSeconds: 0 }),
    policyDefinition({ durationSeconds: 1.5 }),
    {
      ...policyDefinition(),
      selectedAfterAcquisition: true
    }
  ]) {
    assert.throws(() =>
      parseOfficialMarketCalendarFreshnessPolicyDefinition(definition)
    );
  }
});

test("calendar freshness policy rejects hash mismatch and duplicate versions", () => {
  const entry = registryEntry();
  assert.throws(
    () =>
      parseOfficialMarketCalendarFreshnessPolicyRegistryEntry({
        ...entry,
        freshnessPolicyHash: hash("f")
      }),
    /hash mismatch/
  );
  assert.throws(
    () => parseOfficialMarketCalendarFreshnessPolicyRegistry([entry, entry]),
    /versions must be unique/
  );
});

function policyDefinition(
  overrides: Partial<{
    requestMethod: string;
    requestedUrl: string;
    requestParameters: Record<string, string>;
    requestBodyContentType: string | null;
    requestBodyHash: string | null;
    representationHeaders: Record<string, string>;
    durationSeconds: number;
    coverageSelector: Partial<ReturnType<typeof coverageSelector>>;
  }> = {}
) {
  const sourceSelector = {
    exchange: "KRX" as const,
    requestMethod: "GET",
    requestedUrl: "https://global.krx.co.kr/calendar",
    requestParameters: {},
    requestBodyContentType: null,
    requestBodyHash: null,
    representationHeaders: {},
    parserContractVersion: "krx_calendar_pdf.v1"
  };
  for (const key of [
    "requestMethod",
    "requestedUrl",
    "requestParameters",
    "requestBodyContentType",
    "requestBodyHash",
    "representationHeaders"
  ] as const) {
    if (key in overrides) {
      Object.assign(sourceSelector, { [key]: overrides[key] });
    }
  }

  return {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_FRESHNESS_POLICY_DEFINITION_VERSION,
    sourceSelector,
    coverageSelector: coverageSelector(overrides.coverageSelector),
    expiryRule: {
      type: "fixed_duration_from_effective_response" as const,
      durationSeconds: overrides.durationSeconds ?? 86_400
    }
  };
}

function coverageSelector(
  overrides: Partial<{
    evidenceRoles: EvidenceRole[];
    rowCoverageStartDate: string | null;
    rowCoverageEndDate: string | null;
    scheduleCoverageIntervals: ReturnType<typeof interval>[];
    applicabilityStartDate: string | null;
    applicabilityEndDate: string | null;
  }> = {}
) {
  return {
    evidenceRoles: ["holiday_rows", "holiday_schedule"] as EvidenceRole[],
    rowCoverageStartDate: "2026-01-01",
    rowCoverageEndDate: "2026-12-31",
    scheduleCoverageIntervals: [
      interval("holiday_schedule", "2026-01-01", "2026-12-31")
    ],
    applicabilityStartDate: null,
    applicabilityEndDate: null,
    ...overrides
  };
}

function registryEntry(definition = policyDefinition()) {
  return {
    freshnessPolicyVersion: "krx_calendar_annual.v1",
    freshnessPolicyDefinition: definition,
    freshnessPolicyHash:
      createOfficialMarketCalendarFreshnessPolicyHash(definition)
  };
}

function interval(
  coverageRole:
    | "holiday_schedule"
    | "session_hours_exception_schedule"
    | "special_closure_schedule",
  startDate: string,
  endDate: string
) {
  return { coverageRole, startDate, endDate };
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
