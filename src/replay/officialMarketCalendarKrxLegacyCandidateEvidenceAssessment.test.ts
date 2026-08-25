import assert from "node:assert/strict";
import test from "node:test";

import { assessOfficialMarketCalendarKrxLegacyCandidateEvidence } from "./officialMarketCalendarKrxLegacyCandidateEvidenceAssessment.js";

test("registered legacy calendar semantics produce only a fail-closed holiday-row candidate", () => {
  const assessment = assessOfficialMarketCalendarKrxLegacyCandidateEvidence({
    identityVerificationAuthority: "registered_source_policy",
    targetYear: "2014",
    calendarSemantics: registeredSemantics("2014")
  });

  assert.deepEqual(assessment, {
    status: "holiday_rows_candidate_full_year_grid_schedule_unverified",
    candidateEvidenceRoles: ["holiday_rows"],
    calendarGridCoverageStartDate: "2014-01-01",
    calendarGridCoverageEndDate: "2014-12-31",
    scheduleCoverageIntervals: [],
    acceptanceBlockers: [
      "derivatives_market_scope_only",
      "holiday_schedule_completeness_not_verified",
      "cross_market_completeness_not_verified",
      "raw_source_not_durable"
    ]
  });
  assert.equal(Object.isFrozen(assessment), true);
  assert.equal(Object.isFrozen(assessment.candidateEvidenceRoles), true);
  assert.equal(Object.isFrozen(assessment.scheduleCoverageIntervals), true);
  assert.equal(Object.isFrozen(assessment.acceptanceBlockers), true);
});

test("test-only identity remains uninterpreted and cannot promote calendar semantics", () => {
  assert.deepEqual(
    assessOfficialMarketCalendarKrxLegacyCandidateEvidence({
      identityVerificationAuthority: "test_only_expectation",
      targetYear: "2013",
      calendarSemantics: null
    }),
    {
      status: "not_interpreted",
      candidateEvidenceRoles: [],
      calendarGridCoverageStartDate: null,
      calendarGridCoverageEndDate: null,
      scheduleCoverageIntervals: [],
      acceptanceBlockers: ["registered_source_policy_verification_required"]
    }
  );

  assert.throws(
    () =>
      assessOfficialMarketCalendarKrxLegacyCandidateEvidence({
        identityVerificationAuthority: "test_only_expectation",
        targetYear: "2013",
        calendarSemantics: registeredSemantics("2013")
      }),
    /cannot be promoted/
  );
});

test("registered identity rejects incomplete or mismatched semantic coverage", () => {
  assert.throws(
    () =>
      assessOfficialMarketCalendarKrxLegacyCandidateEvidence({
        identityVerificationAuthority: "registered_source_policy",
        targetYear: "2015",
        calendarSemantics: {
          ...registeredSemantics("2014"),
          holidayCount: 0
        }
      }),
    /insufficient/
  );
  assert.throws(
    () =>
      assessOfficialMarketCalendarKrxLegacyCandidateEvidence({
        identityVerificationAuthority: "registered_source_policy",
        targetYear: "2016",
        calendarSemantics: registeredSemantics("2016")
      }),
    /insufficient/
  );
});

function registeredSemantics(targetYear: string) {
  return {
    targetYear,
    months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1 })),
    holidayCount: 1,
    columnSemanticsStatus:
      "calendar_grid_and_event_columns_verified" as const,
    holidaySemanticsStatus: "classified_not_accepted" as const,
    sourceRoleStatus: "candidate_not_accepted" as const
  };
}
