import { z } from "zod";

import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
  evidenceExpansionPreflightConfigSchema,
  evidenceExpansionPreflightSourceSchema,
  type EvidenceExpansionTargetMatrix,
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";

const roleRegimeSampleMinimumSchema = z.number().int().positive().nullable();

export interface EvidenceExpansionPreflightIdentityInput {
  baseline: VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  calendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  roleRegimeSampleMinimum: number | null;
}

export interface EvidenceExpansionPreflightIdentity {
  source: ValidationRoleRegimeEvidenceExpansionPreflightArtifact["source"];
  config: ValidationRoleRegimeEvidenceExpansionPreflightArtifact["config"];
  targetMatrix: EvidenceExpansionTargetMatrix;
}

export function buildEvidenceExpansionPreflightIdentity(
  input: EvidenceExpansionPreflightIdentityInput
): EvidenceExpansionPreflightIdentity {
  assertExactInputKeys(input);
  const roleRegimeSampleMinimum =
    roleRegimeSampleMinimumSchema.parse(input.roleRegimeSampleMinimum);
  assertIdentityLinks(input);

  const source = evidenceExpansionPreflightSourceSchema.parse({
    ...input.baseline.hashes,
    expansionDataSnapshotHash:
      input.expansion.hashes.expansionDataSnapshotHash,
    expansionUniverseHash: input.expansion.hashes.expansionUniverseHash,
    expansionCoverageHash: input.expansion.hashes.expansionCoverageHash,
    baselineValidationSplitHash:
      input.baseline.feasibility.provenance.validationSplitHash,
    expansionValidationSplitHash:
      input.expansion.hashes.validationSplitHash,
    calendarHash: input.calendarClassifier.hashes.calendarHash,
    officialCalendarArtifactHash:
      input.calendarClassifier.hashes.officialCalendarArtifactHash,
    marketRegimeClassifierHash:
      input.calendarClassifier.hashes.marketRegimeClassifierHash
  });
  const config = evidenceExpansionPreflightConfigSchema.parse({
    candidateStrategyBucket:
      input.baseline.feasibility.config.candidateStrategyBucket,
    targetRegimes: ["bull", "bear", "sideways", "mixed"],
    windowMonths: input.baseline.feasibility.config.windowMonths,
    timezoneOffsetMinutes:
      input.baseline.feasibility.config.timezoneOffsetMinutes,
    roleSampleMinimum: EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
    roleRegimeSampleMinimum,
    inputPolicyVersion: "result_blind_capacity_scan.v1",
    dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
  });

  return {
    source,
    config,
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: config.roleSampleMinimum,
      roleRegimeSampleMinimum: config.roleRegimeSampleMinimum
    })
  };
}

function assertIdentityLinks(
  input: EvidenceExpansionPreflightIdentityInput
): void {
  if (
    input.calendarClassifier.hashes.calendarHash !==
    input.baseline.feasibility.provenance.calendarHash
  ) {
    throw new Error("expansion calendar hash does not match baseline");
  }
  if (
    input.calendarClassifier.hashes.marketRegimeClassifierHash !==
    input.baseline.feasibility.provenance.marketRegimeClassifierHash
  ) {
    throw new Error("expansion classifier hash does not match baseline");
  }
  if (
    input.expansion.coverage.timezoneOffsetMinutes !==
    input.baseline.feasibility.config.timezoneOffsetMinutes
  ) {
    throw new Error(
      "expansion coverage timezone does not match baseline config"
    );
  }
}

function assertExactInputKeys(
  input: EvidenceExpansionPreflightIdentityInput
): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "baseline",
    "calendarClassifier",
    "expansion",
    "roleRegimeSampleMinimum"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("preflight identity input contains unknown fields");
  }
}
