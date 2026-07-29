import type {
  EvidenceExpansionExclusion,
  EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";

export function compareEvidenceExpansionPreflightExclusions(
  left: EvidenceExpansionExclusion,
  right: EvidenceExpansionExclusion
): number {
  return (
    compareStrings(left.reason, right.reason) ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    regimeIndex(left.targetRegime) - regimeIndex(right.targetRegime) ||
    compareStrings(left.evidenceGroupHash, right.evidenceGroupHash) ||
    compareSourceVariantLists(
      left.sourceVariants,
      right.sourceVariants
    )
  );
}

function compareSourceVariantLists(
  left: readonly EvidenceExpansionSourceVariantReference[],
  right: readonly EvidenceExpansionSourceVariantReference[]
): number {
  const comparableLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const difference =
      compareStrings(
        left[index]!.sourceVariantHash,
        right[index]!.sourceVariantHash
      ) ||
      compareStrings(
        left[index]!.feasibilityCandidateHash,
        right[index]!.feasibilityCandidateHash
      );
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function roleIndex(
  role: EvidenceExpansionExclusion["splitRole"]
): number {
  return role === null
    ? VALIDATION_ROLE_ORDER.length
    : VALIDATION_ROLE_ORDER.indexOf(role);
}

function regimeIndex(
  regime: EvidenceExpansionExclusion["targetRegime"]
): number {
  return regime === null
    ? VALIDATION_TARGET_REGIME_ORDER.length
    : VALIDATION_TARGET_REGIME_ORDER.indexOf(regime);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
