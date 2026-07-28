import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  type EvidenceExpansionExclusion,
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact,
  validationRoleRegimeEvidenceExpansionPreflightArtifactSchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  compareEvidenceExpansionPreflightBlockers
} from "./validationRoleRegimeEvidenceExpansionPreflightBlockerOrder.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";

const EMPTY_SHA256_HASH =
  `sha256:${"0".repeat(64)}` as Sha256Hash;

export type ValidationRoleRegimeEvidenceExpansionPreflightPayload = Omit<
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact,
  "preflightHash"
>;

export function createValidationRoleRegimeEvidenceExpansionPreflightHash(
  value: unknown
): Sha256Hash {
  const payload = parsePreflightPayload(value);
  return createReplayResearchHash(payload);
}

export function bindValidationRoleRegimeEvidenceExpansionPreflightHash(
  value: unknown
): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  const payload = parsePreflightPayload(value);
  return validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
    ...payload,
    preflightHash: createReplayResearchHash(payload)
  });
}

export function parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
  value: unknown
): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  const artifact =
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(value);
  const { preflightHash, ...payload } = artifact;
  assertCanonicalCollections(payload);
  if (preflightHash !== createReplayResearchHash(payload)) {
    throw new Error("evidence expansion preflight hash mismatch");
  }
  return artifact;
}

function parsePreflightPayload(
  value: unknown
): ValidationRoleRegimeEvidenceExpansionPreflightPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    "preflightHash" in value
  ) {
    throw new Error(
      "evidence expansion preflight hash input must exclude preflightHash"
    );
  }
  const artifact =
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...value,
      preflightHash: EMPTY_SHA256_HASH
    });
  const { preflightHash: _preflightHash, ...payload } = artifact;
  assertCanonicalCollections(payload);
  return payload;
}

function assertCanonicalCollections(
  payload: ValidationRoleRegimeEvidenceExpansionPreflightPayload
): void {
  assertCanonicalOrder(
    payload.exclusions,
    compareExclusions,
    "preflight exclusions"
  );
  assertCanonicalOrder(
    payload.blockers,
    compareEvidenceExpansionPreflightBlockers,
    "preflight blockers"
  );
}

function assertCanonicalOrder<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
  label: string
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) >= 0) {
      throw new Error(`${label} must use canonical order`);
    }
  }
}

function compareExclusions(
  left: EvidenceExpansionExclusion,
  right: EvidenceExpansionExclusion
): number {
  return (
    compareStrings(left.reason, right.reason) ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    regimeIndex(left.targetRegime) - regimeIndex(right.targetRegime) ||
    compareStrings(left.evidenceGroupHash, right.evidenceGroupHash) ||
    compareSourceVariantLists(left.sourceVariants, right.sourceVariants)
  );
}

function compareSourceVariantLists(
  left: EvidenceExpansionExclusion["sourceVariants"],
  right: EvidenceExpansionExclusion["sourceVariants"]
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
