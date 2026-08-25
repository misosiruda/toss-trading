export type OfficialMarketCalendarKrxLegacyCandidateEvidenceAssessment =
  | {
      status: "not_interpreted";
      candidateEvidenceRoles: readonly [];
      calendarGridCoverageStartDate: null;
      calendarGridCoverageEndDate: null;
      scheduleCoverageIntervals: readonly [];
      acceptanceBlockers: readonly [
        "registered_source_policy_verification_required"
      ];
    }
  | {
      status: "holiday_rows_candidate_full_year_grid_schedule_unverified";
      candidateEvidenceRoles: readonly ["holiday_rows"];
      calendarGridCoverageStartDate: string;
      calendarGridCoverageEndDate: string;
      scheduleCoverageIntervals: readonly [];
      acceptanceBlockers: readonly [
        "derivatives_market_scope_only",
        "holiday_schedule_completeness_not_verified",
        "cross_market_completeness_not_verified",
        "raw_source_not_durable"
      ];
    };

interface CandidateEvidenceAssessmentInput {
  identityVerificationAuthority:
    | "registered_source_policy"
    | "test_only_expectation";
  targetYear: string;
  calendarSemantics: {
    targetYear: string;
    months: readonly { month: number }[];
    holidayCount: number;
    columnSemanticsStatus: "calendar_grid_and_event_columns_verified";
    holidaySemanticsStatus: "classified_not_accepted";
    sourceRoleStatus: "candidate_not_accepted";
  } | null;
}

export function assessOfficialMarketCalendarKrxLegacyCandidateEvidence(
  input: CandidateEvidenceAssessmentInput
): OfficialMarketCalendarKrxLegacyCandidateEvidenceAssessment {
  if (
    input.identityVerificationAuthority !== "registered_source_policy" &&
    input.identityVerificationAuthority !== "test_only_expectation"
  ) {
    throw new Error("KRX legacy identity verification authority is invalid");
  }
  if (input.identityVerificationAuthority === "test_only_expectation") {
    if (input.calendarSemantics !== null) {
      throw new Error(
        "test-only KRX legacy calendar semantics cannot be promoted to an evidence candidate"
      );
    }
    return Object.freeze({
      status: "not_interpreted",
      candidateEvidenceRoles: Object.freeze([] as const),
      calendarGridCoverageStartDate: null,
      calendarGridCoverageEndDate: null,
      scheduleCoverageIntervals: Object.freeze([] as const),
      acceptanceBlockers: Object.freeze(
        ["registered_source_policy_verification_required"] as const
      )
    });
  }

  const semantics = input.calendarSemantics;
  if (
    semantics === null ||
    !["2013", "2014", "2015"].includes(input.targetYear) ||
    semantics.targetYear !== input.targetYear ||
    semantics.months.length !== 12 ||
    semantics.months.some((month, index) => month.month !== index + 1) ||
    !Number.isSafeInteger(semantics.holidayCount) ||
    semantics.holidayCount < 1 ||
    semantics.columnSemanticsStatus !==
      "calendar_grid_and_event_columns_verified" ||
    semantics.holidaySemanticsStatus !== "classified_not_accepted" ||
    semantics.sourceRoleStatus !== "candidate_not_accepted"
  ) {
    throw new Error(
      "registered KRX legacy calendar semantics are insufficient for candidate evidence assessment"
    );
  }

  return Object.freeze({
    status: "holiday_rows_candidate_full_year_grid_schedule_unverified",
    candidateEvidenceRoles: Object.freeze(["holiday_rows"] as const),
    calendarGridCoverageStartDate: `${input.targetYear}-01-01`,
    calendarGridCoverageEndDate: `${input.targetYear}-12-31`,
    scheduleCoverageIntervals: Object.freeze([] as const),
    acceptanceBlockers: Object.freeze(
      [
        "derivatives_market_scope_only",
        "holiday_schedule_completeness_not_verified",
        "cross_market_completeness_not_verified",
        "raw_source_not_durable"
      ] as const
    )
  });
}
