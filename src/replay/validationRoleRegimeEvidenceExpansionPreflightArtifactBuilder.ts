import {
  VALIDATION_ROLE_REGIME_EVIDENCE_EXPANSION_PREFLIGHT_SCHEMA_VERSION,
  type EvidenceExpansionPreflightStatus,
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  EvidenceExpansionPreflightCoreState,
  EvidenceExpansionPreflightCoreStateInput
} from "./validationRoleRegimeEvidenceExpansionPreflightCoreState.js";
import {
  bindValidationRoleRegimeEvidenceExpansionPreflightHash
} from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";
import {
  buildEvidenceExpansionPreflightStatusState
} from "./validationRoleRegimeEvidenceExpansionPreflightStatusState.js";

export interface EvidenceExpansionPreflightArtifactBuilderInput
  extends EvidenceExpansionPreflightCoreStateInput {
  generatedAt: string;
}

export interface EvidenceExpansionPreflightArtifactBuildState {
  artifact: ValidationRoleRegimeEvidenceExpansionPreflightArtifact;
  coreState: EvidenceExpansionPreflightCoreState;
  status: EvidenceExpansionPreflightStatus;
}

export function buildEvidenceExpansionPreflightArtifact(
  input: EvidenceExpansionPreflightArtifactBuilderInput
): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  return buildEvidenceExpansionPreflightArtifactState(input).artifact;
}

export function buildEvidenceExpansionPreflightArtifactState(
  input: EvidenceExpansionPreflightArtifactBuilderInput
): EvidenceExpansionPreflightArtifactBuildState {
  assertExactInputKeys(input);
  assertCanonicalGeneratedAt(input.generatedAt);
  const state = buildEvidenceExpansionPreflightStatusState({
    baselineIdentity: input.baselineIdentity,
    baselineSource: input.baselineSource,
    expansion: input.expansion,
    calendarClassifier: input.calendarClassifier,
    roleRegimeSampleMinimum: input.roleRegimeSampleMinimum
  });
  const { status, ...coreState } = state;

  const artifact = bindValidationRoleRegimeEvidenceExpansionPreflightHash({
    schemaVersion:
      VALIDATION_ROLE_REGIME_EVIDENCE_EXPANSION_PREFLIGHT_SCHEMA_VERSION,
    mode: "paper_only",
    purpose: "evidence_expansion_preflight",
    generatedAt: input.generatedAt,
    status,
    source: state.source,
    config: state.config,
    targetMatrix: state.targetMatrix,
    capacity: state.capacity,
    dependencyInputs: state.dependencyInputs,
    exclusions: state.exclusions,
    blockers: state.blockers
  });

  return {
    artifact,
    coreState,
    status
  };
}

function assertCanonicalGeneratedAt(value: string): void {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(
      "preflight artifact generatedAt must use canonical UTC ISO datetime"
    );
  }
}

function assertExactInputKeys(
  input: EvidenceExpansionPreflightArtifactBuilderInput
): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "baselineIdentity",
    "baselineSource",
    "calendarClassifier",
    "expansion",
    "generatedAt",
    "roleRegimeSampleMinimum"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight artifact builder input contains unknown fields"
    );
  }
}
