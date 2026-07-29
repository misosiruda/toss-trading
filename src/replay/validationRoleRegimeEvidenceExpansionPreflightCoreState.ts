import {
  aggregateEvidenceExpansionAssignmentCandidates
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import {
  consolidateEvidenceExpansionBaselineEvidenceGroups
} from "./validationRoleRegimeEvidenceExpansionBaselineEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  aggregateEvidenceExpansionBaselineRunVariants
} from "./validationRoleRegimeEvidenceExpansionBaselineRunVariantAggregation.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  classifyEvidenceExpansionCandidateEligibility
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import {
  buildEvidenceExpansionPreflightEvidenceState,
  type EvidenceExpansionPreflightEvidenceState
} from "./validationRoleRegimeEvidenceExpansionPreflightEvidenceState.js";
import {
  buildEvidenceExpansionPreflightIdentity,
  type EvidenceExpansionPreflightIdentity
} from "./validationRoleRegimeEvidenceExpansionPreflightIdentity.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";

export interface EvidenceExpansionPreflightCoreState
  extends EvidenceExpansionPreflightIdentity,
    EvidenceExpansionPreflightEvidenceState {}

export function buildEvidenceExpansionPreflightCoreState(input: {
  baselineIdentity:
    VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  roleRegimeSampleMinimum: number | null;
}): EvidenceExpansionPreflightCoreState {
  assertExactInputKeys(input);
  const identity = buildEvidenceExpansionPreflightIdentity({
    baseline: input.baselineIdentity,
    expansion: input.expansion,
    calendarClassifier: input.calendarClassifier,
    roleRegimeSampleMinimum: input.roleRegimeSampleMinimum
  });
  const windowPolicy = {
    candidateStrategyBucket: identity.config.candidateStrategyBucket,
    windowMonths: identity.config.windowMonths,
    timezoneOffsetMinutes: identity.config.timezoneOffsetMinutes
  };
  const baselineEvidence = deriveBaselineEvidence(input);
  const aggregation = aggregateEvidenceExpansionAssignmentCandidates({
    source: input.expansion,
    calendarClassifier: input.calendarClassifier,
    windowMonths: windowPolicy.windowMonths,
    timezoneOffsetMinutes: windowPolicy.timezoneOffsetMinutes
  });
  const partition = buildEvidenceExpansionCandidatePartition({
    aggregation,
    eligibility:
      classifyEvidenceExpansionCandidateEligibility(aggregation),
    windowMonths: windowPolicy.windowMonths,
    timezoneOffsetMinutes: windowPolicy.timezoneOffsetMinutes
  });
  const evidenceState =
    buildEvidenceExpansionPreflightEvidenceState({
      aggregation,
      partition,
      baseline: baselineEvidence,
      baselineWindowPolicy: windowPolicy,
      expansionWindowPolicy: windowPolicy,
      targetMatrix: identity.targetMatrix,
      dependencySource: {
        source: input.expansion,
        calendarClassifier: input.calendarClassifier
      }
    });

  return {
    ...identity,
    ...evidenceState
  };
}

function deriveBaselineEvidence(input: {
  baselineIdentity:
    VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
}): EvidenceExpansionEvidenceGroupConsolidationResult {
  if (
    input.baselineIdentity.plan.status !==
    "ready_for_paper_diagnostic"
  ) {
    return {
      evidenceGroups: [],
      acceptedCandidateCount: 0,
      uniqueEvidenceGroupCount: 0
    };
  }

  return consolidateEvidenceExpansionBaselineEvidenceGroups(
    aggregateEvidenceExpansionBaselineRunVariants({
      plan: input.baselineIdentity.plan,
      source: input.expansion,
      calendarClassifier: input.calendarClassifier
    })
  );
}

function assertExactInputKeys(input: {
  baselineIdentity:
    VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  roleRegimeSampleMinimum: number | null;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "baselineIdentity",
    "calendarClassifier",
    "expansion",
    "roleRegimeSampleMinimum"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight core state input contains unknown fields"
    );
  }
}
