import {
  aggregateEvidenceExpansionAssignmentCandidates
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import {
  consolidateEvidenceExpansionBaselineEvidenceGroups
} from "./validationRoleRegimeEvidenceExpansionBaselineEvidenceGroupConsolidation.js";
import {
  assertEvidenceExpansionBaselineSourceMatches
} from "./validationRoleRegimeEvidenceExpansionBaselineSourceMatch.js";
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
import {
  assertCompatibleEvidenceExpansionValidationSplits
} from "./validationRoleRegimeEvidenceExpansionSplitCompatibility.js";

export interface EvidenceExpansionPreflightCoreState
  extends EvidenceExpansionPreflightIdentity,
    EvidenceExpansionPreflightEvidenceState {}

export interface EvidenceExpansionPreflightCoreStateInput {
  baselineIdentity:
    VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  baselineSource: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  roleRegimeSampleMinimum: number | null;
}

export function buildEvidenceExpansionPreflightCoreState(
  input: EvidenceExpansionPreflightCoreStateInput
): EvidenceExpansionPreflightCoreState {
  assertExactInputKeys(input);
  assertCompatibleEvidenceExpansionValidationSplits({
    baselineAssignments: input.baselineSource.assignments,
    expansionAssignments: input.expansion.assignments
  });
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
  baselineSource: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
}): EvidenceExpansionEvidenceGroupConsolidationResult {
  assertEvidenceExpansionBaselineSourceMatches({
    baselineProvenance: input.baselineIdentity.plan.source,
    verifiedSourceProvenance:
      input.baselineSource.baselineProvenanceHashes
  });
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
      source: input.baselineSource,
      calendarClassifier: input.calendarClassifier
    })
  );
}

function assertExactInputKeys(
  input: EvidenceExpansionPreflightCoreStateInput
): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "baselineIdentity",
    "baselineSource",
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
