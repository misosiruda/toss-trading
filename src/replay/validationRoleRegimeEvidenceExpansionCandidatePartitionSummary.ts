import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import type {
  EvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import {
  assertEvidenceExpansionCalendarRejectionAggregation
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import {
  evidenceExpansionExclusionSchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionCandidatePartitionSummary {
  structuralCandidateCount: number;
  calendarValidCandidateCount: number;
  calendarRejectedCandidateCount: number;
  acceptedCandidateCount: number;
  excludedCandidateCount: number;
  uniqueStructuralEvidenceGroupCount: number;
  uniqueAcceptedEvidenceGroupCount: number;
  uniqueExcludedEvidenceGroupCount: number;
  acceptedExcludedSharedEvidenceGroupCount: number;
}

export function buildEvidenceExpansionCandidatePartitionSummary(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionCandidatePartitionSummary {
  assertExactInputKeys(input);
  assertEvidenceExpansionCalendarRejectionAggregation(
    input.aggregation
  );
  const validCandidates = input.aggregation.assignmentCandidates.flatMap(
    ({ result }) => result.candidates
  );
  const counts = [
    input.aggregation.structuralCapacityCount,
    input.aggregation.calendarValidCandidateCount,
    input.aggregation.calendarRejectedCandidateCount,
    input.partition.consolidation.acceptedCandidateCount
  ];
  if (
    counts.some(
      (count) => !Number.isInteger(count) || count < 0
    ) ||
    validCandidates.length !==
      input.aggregation.calendarValidCandidateCount ||
    input.aggregation.calendarRejectedCandidates.length !==
      input.aggregation.calendarRejectedCandidateCount ||
    input.aggregation.structuralCapacityCount !==
      input.aggregation.calendarValidCandidateCount +
        input.aggregation.calendarRejectedCandidateCount
  ) {
    throw new Error(
      "candidate partition summary aggregation counts do not reconcile"
    );
  }

  const structuralGroups = new Set<Sha256Hash>();
  for (const candidate of validCandidates) {
    const evidenceGroupHash = evidenceGroupHashForInterval(
      candidate.startAt,
      candidate.endAt,
      input.windowMonths,
      input.timezoneOffsetMinutes
    );
    if (candidate.variant.evidenceGroupHash !== evidenceGroupHash) {
      throw new Error(
        "candidate partition summary valid group hash does not match policy"
      );
    }
    structuralGroups.add(evidenceGroupHash);
  }
  for (const { candidate } of
    input.aggregation.calendarRejectedCandidates) {
    structuralGroups.add(
      evidenceGroupHashForInterval(
        candidate.startAt,
        candidate.endAt,
        input.windowMonths,
        input.timezoneOffsetMinutes
      )
    );
  }

  const acceptedGroups = new Set(
    input.partition.consolidation.evidenceGroups.map(
      (group) => group.evidenceGroupHash
    )
  );
  if (
    acceptedGroups.size !==
      input.partition.consolidation.evidenceGroups.length ||
    acceptedGroups.size !==
      input.partition.consolidation.uniqueEvidenceGroupCount
  ) {
    throw new Error(
      "candidate partition summary accepted groups do not match unique count"
    );
  }

  const exclusions = evidenceExpansionExclusionSchema.array().parse(
    input.partition.exclusions
  );
  const excludedGroups = new Set(
    exclusions.map((exclusion) => exclusion.evidenceGroupHash)
  );
  if (excludedGroups.size !== exclusions.length) {
    throw new Error(
      "candidate partition summary exclusions contain duplicate groups"
    );
  }
  const acceptedSourceVariants = new Set(
    input.partition.consolidation.evidenceGroups.flatMap((group) =>
      group.sourceVariants.map(
        (variant) => variant.sourceVariant.sourceVariantHash
      )
    )
  );
  const excludedSourceVariants = new Set(
    exclusions.flatMap((exclusion) =>
      exclusion.sourceVariants.map(
        (variant) => variant.sourceVariantHash
      )
    )
  );
  if (
    [...acceptedSourceVariants].some((hash) =>
      excludedSourceVariants.has(hash)
    )
  ) {
    throw new Error(
      "candidate partition summary source variant has conflicting status"
    );
  }
  const validSourceVariants = new Set(
    validCandidates.map(
      (candidate) =>
        candidate.variant.sourceVariant.sourceVariantHash
    )
  );
  const partitionSourceVariants = new Set([
    ...acceptedSourceVariants,
    ...excludedSourceVariants
  ]);
  if (!sameSet(validSourceVariants, partitionSourceVariants)) {
    throw new Error(
      "candidate partition summary source variants do not cover valid candidates"
    );
  }
  let acceptedCandidateCount = 0;
  let excludedValidCandidateCount = 0;
  for (const candidate of validCandidates) {
    const sourceVariantHash =
      candidate.variant.sourceVariant.sourceVariantHash;
    if (acceptedSourceVariants.has(sourceVariantHash)) {
      acceptedCandidateCount += 1;
      continue;
    }
    if (excludedSourceVariants.has(sourceVariantHash)) {
      excludedValidCandidateCount += 1;
      continue;
    }
    throw new Error(
      "candidate partition summary valid candidate is unclassified"
    );
  }
  if (
    acceptedCandidateCount !==
    input.partition.consolidation.acceptedCandidateCount
  ) {
    throw new Error(
      "candidate partition summary accepted raw count does not match source variants"
    );
  }
  const excludedCandidateCount =
    excludedValidCandidateCount +
    input.aggregation.calendarRejectedCandidateCount;
  if (
    acceptedCandidateCount + excludedCandidateCount !==
    input.aggregation.structuralCapacityCount
  ) {
    throw new Error(
      "candidate partition summary raw candidate counts do not reconcile"
    );
  }
  if (
    structuralGroups.size >
      input.aggregation.structuralCapacityCount ||
    acceptedGroups.size > acceptedCandidateCount ||
    excludedGroups.size > excludedCandidateCount ||
    excludedCandidateCount <
      input.aggregation.calendarRejectedCandidateCount
  ) {
    throw new Error(
      "candidate partition summary unique groups exceed candidate counts"
    );
  }

  const partitionGroups = new Set([
    ...acceptedGroups,
    ...excludedGroups
  ]);
  if (!sameSet(structuralGroups, partitionGroups)) {
    throw new Error(
      "candidate partition summary groups do not cover structural evidence"
    );
  }
  const acceptedExcludedSharedEvidenceGroupCount =
    [...acceptedGroups].filter((hash) => excludedGroups.has(hash)).length;
  if (
    acceptedGroups.size +
      excludedGroups.size -
      acceptedExcludedSharedEvidenceGroupCount !==
    structuralGroups.size
  ) {
    throw new Error(
      "candidate partition summary unique group counts do not reconcile"
    );
  }

  return {
    structuralCandidateCount:
      input.aggregation.structuralCapacityCount,
    calendarValidCandidateCount:
      input.aggregation.calendarValidCandidateCount,
    calendarRejectedCandidateCount:
      input.aggregation.calendarRejectedCandidateCount,
    acceptedCandidateCount:
      acceptedCandidateCount,
    excludedCandidateCount,
    uniqueStructuralEvidenceGroupCount: structuralGroups.size,
    uniqueAcceptedEvidenceGroupCount: acceptedGroups.size,
    uniqueExcludedEvidenceGroupCount: excludedGroups.size,
    acceptedExcludedSharedEvidenceGroupCount
  };
}

function evidenceGroupHashForInterval(
  startAt: string,
  endAt: string,
  windowMonths: number,
  timezoneOffsetMinutes: number
): Sha256Hash {
  return createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: "short_term",
    windowMonths,
    timezoneOffsetMinutes
  });
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function assertExactInputKeys(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "aggregation",
    "partition",
    "timezoneOffsetMinutes",
    "windowMonths"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "candidate partition summary input contains unknown fields"
    );
  }
}
