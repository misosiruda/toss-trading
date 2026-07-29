import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact,
  validationRoleRegimeEvidenceExpansionPreflightArtifactSchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  compareEvidenceExpansionPreflightBlockers
} from "./validationRoleRegimeEvidenceExpansionPreflightBlockerOrder.js";
import {
  compareEvidenceExpansionPreflightExclusions
} from "./validationRoleRegimeEvidenceExpansionPreflightExclusionOrder.js";

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
    compareEvidenceExpansionPreflightExclusions,
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
