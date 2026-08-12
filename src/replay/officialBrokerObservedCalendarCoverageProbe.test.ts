import assert from "node:assert/strict";
import test from "node:test";

import { createOfficialBrokerObservedCalendarEvidence } from "./officialBrokerObservedCalendarEvidence.js";
import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_PLAN_SCHEMA_VERSION,
  OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_POLICY,
  OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_REPORT_SCHEMA_VERSION,
  buildOfficialBrokerObservedCalendarCoverageProbeReport,
  createOfficialBrokerObservedCalendarCoverageProbePlan,
  officialBrokerObservedCalendarCoverageProbePlanSchema,
  parseOfficialBrokerObservedCalendarCoverageProbeReport
} from "./officialBrokerObservedCalendarCoverageProbe.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

test("creates a deterministic every-calendar-date probe plan", () => {
  const plan = createOfficialBrokerObservedCalendarCoverageProbePlan({
    market: "KR",
    rangeStartDate: "2024-02-28",
    rangeEndDate: "2024-03-01"
  });

  assert.equal(
    plan.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_PLAN_SCHEMA_VERSION
  );
  assert.equal(plan.probePolicy, OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_POLICY);
  assert.deepEqual(plan.requestedDates, [
    "2024-02-28",
    "2024-02-29",
    "2024-03-01"
  ]);
  assert.equal(plan.replayEvidenceClass, "observed_session_only");
  assert.equal(plan.historicalCompletenessClaim, "not_claimed");
  assert.equal(plan.officialExchangeReadiness, "not_established");
  const { planHash, ...payload } = plan;
  assert.equal(planHash, createReplayResearchHash(payload));

  const incomplete = structuredClone(plan);
  incomplete.requestedDates.splice(1, 1);
  const { planHash: _oldHash, ...incompletePayload } = incomplete;
  assert.equal(
    officialBrokerObservedCalendarCoverageProbePlanSchema.safeParse({
      ...incompletePayload,
      planHash: createReplayResearchHash(incompletePayload)
    }).success,
    false
  );
});

test("reports verified planned-date coverage without historical completeness claims", () => {
  const plan = planFor("2026-03-24", "2026-03-26");
  const observations = plan.requestedDates.map(verifiedObservation);
  const report = buildOfficialBrokerObservedCalendarCoverageProbeReport({
    plan,
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    observations
  });

  assert.equal(
    report.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_COVERAGE_PROBE_REPORT_SCHEMA_VERSION
  );
  assert.equal(report.status, "verified");
  assert.equal(report.coverageStatus, "verified");
  assert.equal(report.observedReplayEligibility, "eligible");
  assert.equal(report.historicalCompletenessClaim, "not_claimed");
  assert.equal(report.officialExchangeReadiness, "not_established");
  assert.deepEqual(report.summary, {
    plannedDateCount: 3,
    verifiedDateCount: 3,
    rejectedDateCount: 0,
    missingDateCount: 0,
    conflictDateCount: 0
  });
  assert.deepEqual(report.issueCodes, []);
  assert.deepEqual(report.returnedDateConflicts, []);
  assert.deepEqual(
    report.results.map(({ requestedDate, status }) => ({
      requestedDate,
      status
    })),
    [
      { requestedDate: "2026-03-24", status: "verified" },
      { requestedDate: "2026-03-25", status: "verified" },
      { requestedDate: "2026-03-26", status: "verified" }
    ]
  );
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /rawResponseBytes|accessToken|clientSecret/);
  assert.doesNotMatch(serialized, /"result":/);

  const { reportHash, ...payload } = report;
  assert.equal(reportHash, createReplayResearchHash(payload));
  assert.deepEqual(
    parseOfficialBrokerObservedCalendarCoverageProbeReport(report),
    report
  );
});

test("reports rejected and missing dates as ambiguous and ineligible", () => {
  const plan = planFor("2026-03-24", "2026-03-26");
  const report = buildOfficialBrokerObservedCalendarCoverageProbeReport({
    plan,
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    observations: [
      verifiedObservation("2026-03-24"),
      {
        status: "rejected",
        requestedDate: "2026-03-25",
        rejectionCode: "OFFICIAL_BROKER_CALENDAR_SCHEMA_MISMATCH"
      }
    ]
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.coverageStatus, "ambiguous");
  assert.equal(report.observedReplayEligibility, "rejected");
  assert.deepEqual(report.summary, {
    plannedDateCount: 3,
    verifiedDateCount: 1,
    rejectedDateCount: 1,
    missingDateCount: 1,
    conflictDateCount: 0
  });
  assert.deepEqual(report.issueCodes, [
    "OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED",
    "OFFICIAL_BROKER_CALENDAR_PROBE_REJECTED"
  ]);
  assert.deepEqual(report.results[1], {
    requestedDate: "2026-03-25",
    status: "rejected",
    evidenceArtifactHash: null,
    rejectionCode: "OFFICIAL_BROKER_CALENDAR_SCHEMA_MISMATCH"
  });
  assert.deepEqual(report.results[2], {
    requestedDate: "2026-03-26",
    status: "missing",
    evidenceArtifactHash: null,
    rejectionCode: "OFFICIAL_BROKER_CALENDAR_PROBE_NOT_OBSERVED"
  });
});

test("fails closed when overlapping returned dates disagree", () => {
  const plan = planFor("2026-03-24", "2026-03-25");
  const first = verifiedObservation("2026-03-24");
  const conflictingResponse = krResponse("2026-03-25");
  conflictingResponse.result.today.integrated!.regularMarket!.endTime =
    "2026-03-25T15:25:00+09:00";
  const conflictingBytes = Buffer.from(
    JSON.stringify(conflictingResponse),
    "utf8"
  );
  const second = {
    status: "verified" as const,
    requestedDate: "2026-03-25",
    evidence: evidenceFor("2026-03-25", conflictingBytes),
    rawResponseBytes: conflictingBytes
  };
  const report = buildOfficialBrokerObservedCalendarCoverageProbeReport({
    plan,
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    observations: [first, second]
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.coverageStatus, "ambiguous");
  assert.equal(report.observedReplayEligibility, "rejected");
  assert.equal(report.summary.verifiedDateCount, 2);
  assert.equal(report.summary.conflictDateCount, 1);
  assert.deepEqual(report.issueCodes, [
    "OFFICIAL_BROKER_CALENDAR_RETURNED_DATE_CONFLICT"
  ]);
  assert.equal(report.returnedDateConflicts[0]?.marketDate, "2026-03-25");
  assert.deepEqual(
    report.returnedDateConflicts[0]?.evidenceArtifactHashes,
    [first.evidence.artifactHash, second.evidence.artifactHash].sort()
  );
});

test("rejects evidence that cannot cross the regular-session replay boundary", () => {
  const plan = planFor("2026-03-25", "2026-03-25");
  const response = krResponse("2026-03-25");
  response.result.today.integrated!.regularMarket = null;
  const rawResponseBytes = Buffer.from(JSON.stringify(response), "utf8");
  const report = buildOfficialBrokerObservedCalendarCoverageProbeReport({
    plan,
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    observations: [
      {
        status: "verified",
        requestedDate: "2026-03-25",
        evidence: evidenceFor("2026-03-25", rawResponseBytes),
        rawResponseBytes
      }
    ]
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.coverageStatus, "ambiguous");
  assert.equal(report.observedReplayEligibility, "rejected");
  assert.deepEqual(report.summary, {
    plannedDateCount: 1,
    verifiedDateCount: 0,
    rejectedDateCount: 1,
    missingDateCount: 0,
    conflictDateCount: 0
  });
  assert.deepEqual(report.results[0], {
    requestedDate: "2026-03-25",
    status: "rejected",
    evidenceArtifactHash: null,
    rejectionCode: "OFFICIAL_BROKER_CALENDAR_COVERAGE_AMBIGUOUS"
  });
});

test("rejects duplicate, out-of-plan, and mismatched evidence observations", () => {
  const plan = planFor("2026-03-24", "2026-03-25");
  const observation = verifiedObservation("2026-03-24");

  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan,
        evaluatedAt: "2026-03-25T12:00:00.000Z",
        observations: [observation, observation]
      }),
    /duplicate calendar coverage probe observation/
  );
  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan,
        evaluatedAt: "2026-03-25T12:00:00.000Z",
        observations: [verifiedObservation("2026-03-26")]
      }),
    /outside plan/
  );
  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan,
        evaluatedAt: "2026-03-25T12:00:00.000Z",
        observations: [
          { ...observation, requestedDate: "2026-03-25" }
        ]
      }),
    /evidence does not match plan/
  );

  const usBytes = usResponseBytes("2026-03-24");
  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan,
        evaluatedAt: "2026-03-25T12:00:00.000Z",
        observations: [
          {
            status: "verified",
            requestedDate: "2026-03-24",
            evidence: createOfficialBrokerObservedCalendarEvidence({
              market: "US",
              requestedDate: "2026-03-24",
              retrievedAt: "2026-03-25T01:00:00.000Z",
              evaluatedAt: "2026-03-25T12:00:00.000Z",
              rawResponseBytes: usBytes
            }),
            rawResponseBytes: usBytes
          }
        ]
      }),
    /evidence does not match plan/
  );
});

test("revalidates raw bytes, freshness, report hash, and strict observation fields", () => {
  const plan = planFor("2026-03-24", "2026-03-24");
  const observation = verifiedObservation("2026-03-24");

  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan,
        evaluatedAt: "2026-03-25T12:00:00.000Z",
        observations: [
          { ...observation, rawResponseBytes: Buffer.from("{}", "utf8") }
        ]
      }),
    /response byte length mismatch/
  );
  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarCoverageProbeReport({
        plan,
        evaluatedAt: observation.evidence.source.staleAfter,
        observations: [observation]
      }),
    /source is stale/
  );
  assert.throws(() =>
    buildOfficialBrokerObservedCalendarCoverageProbeReport({
      plan,
      evaluatedAt: "2026-03-25T12:00:00.000Z",
      observations: [
        {
          ...observation,
          accessToken: "must-not-be-accepted"
        }
      ]
    })
  );

  const report = buildOfficialBrokerObservedCalendarCoverageProbeReport({
    plan,
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    observations: [observation]
  });
  assert.throws(
    () =>
      parseOfficialBrokerObservedCalendarCoverageProbeReport({
        ...report,
        reportHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      }),
    /report hash mismatch/
  );
});

test("rejects reversed and excessively large probe ranges", () => {
  assert.throws(() =>
    createOfficialBrokerObservedCalendarCoverageProbePlan({
      market: "KR",
      rangeStartDate: "2026-03-26",
      rangeEndDate: "2026-03-25"
    })
  );
  assert.throws(
    () =>
      createOfficialBrokerObservedCalendarCoverageProbePlan({
        market: "US",
        rangeStartDate: "2000-01-01",
        rangeEndDate: "2030-01-01"
      }),
    /exceeds 10000 days/
  );
});

function planFor(rangeStartDate: string, rangeEndDate: string) {
  return createOfficialBrokerObservedCalendarCoverageProbePlan({
    market: "KR",
    rangeStartDate,
    rangeEndDate
  });
}

function verifiedObservation(requestedDate: string) {
  const rawResponseBytes = krResponseBytes(requestedDate);
  return {
    status: "verified" as const,
    requestedDate,
    evidence: evidenceFor(requestedDate, rawResponseBytes),
    rawResponseBytes
  };
}

function evidenceFor(requestedDate: string, rawResponseBytes: Uint8Array) {
  return createOfficialBrokerObservedCalendarEvidence({
    market: "KR",
    requestedDate,
    retrievedAt: "2026-03-25T01:00:00.000Z",
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });
}

function krResponseBytes(requestedDate: string): Buffer {
  return Buffer.from(JSON.stringify(krResponse(requestedDate)), "utf8");
}

interface KrMarketDayFixture {
  date: string;
  integrated: KrIntegratedFixture | null;
}

interface KrResponseFixture {
  result: {
    today: KrMarketDayFixture;
    previousBusinessDay: KrMarketDayFixture;
    nextBusinessDay: KrMarketDayFixture;
  };
}

function krResponse(requestedDate: string): KrResponseFixture {
  const previousDate = addDays(requestedDate, -1);
  const nextDate = addDays(requestedDate, 1);
  return {
    result: {
      today: {
        date: requestedDate,
        integrated: krIntegrated(requestedDate)
      },
      previousBusinessDay: {
        date: previousDate,
        integrated: krIntegrated(previousDate)
      },
      nextBusinessDay: {
        date: nextDate,
        integrated: krIntegrated(nextDate)
      }
    }
  };
}

interface KrIntegratedFixture {
  preMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  } | null;
  regularMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  } | null;
  afterMarket: {
    startTime: string;
    singlePriceAuctionEndTime: string;
    endTime: string;
  } | null;
}

function krIntegrated(date: string): KrIntegratedFixture {
  return {
    preMarket: {
      startTime: `${date}T08:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T08:50:00+09:00`,
      endTime: `${date}T09:00:00+09:00`
    },
    regularMarket: {
      startTime: `${date}T09:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T15:20:00+09:00`,
      endTime: `${date}T15:30:00+09:00`
    },
    afterMarket: {
      startTime: `${date}T15:30:00+09:00`,
      singlePriceAuctionEndTime: `${date}T15:40:00+09:00`,
      endTime: `${date}T20:00:00+09:00`
    }
  };
}

function usResponseBytes(requestedDate: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      result: {
        today: usDay(requestedDate),
        previousBusinessDay: usDay(addDays(requestedDate, -1)),
        nextBusinessDay: usDay(addDays(requestedDate, 1))
      }
    }),
    "utf8"
  );
}

function usDay(date: string) {
  const nextDate = addDays(date, 1);
  return {
    date,
    dayMarket: session(date, "09:00:00", date, "16:50:00"),
    preMarket: session(date, "17:00:00", date, "22:30:00"),
    regularMarket: session(date, "22:30:00", nextDate, "05:00:00"),
    afterMarket: session(nextDate, "05:00:00", nextDate, "07:00:00")
  };
}

function session(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
) {
  return {
    startTime: `${startDate}T${startTime}+09:00`,
    endTime: `${endDate}T${endTime}+09:00`
  };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
