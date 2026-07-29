import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import type {
  EvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import type {
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
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
  baselineEvidence: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  roleRegimeSampleMinimum: number | null;
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
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
  const evidenceState =
    buildEvidenceExpansionPreflightEvidenceState({
      aggregation: input.aggregation,
      partition: input.partition,
      baseline: input.baselineEvidence,
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

function assertExactInputKeys(input: {
  baselineIdentity:
    VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  baselineEvidence: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  roleRegimeSampleMinimum: number | null;
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "aggregation",
    "baselineEvidence",
    "baselineIdentity",
    "calendarClassifier",
    "expansion",
    "partition",
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
