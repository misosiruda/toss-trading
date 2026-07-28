import {
  buildEvidenceExpansionDependencyInputs,
  type EvidenceExpansionDependencyInputsInput
} from "./validationRoleRegimeEvidenceExpansionDependencyInputs.js";
import {
  evidenceExpansionCompleteDependencyInputsSchema,
  evidenceExpansionPreflightBlockerSchema,
  type EvidenceExpansionDependencyInputs,
  type EvidenceExpansionPreflightBlocker
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionPreflightDependencyState {
  dependencyInputs: EvidenceExpansionDependencyInputs;
  blockers: EvidenceExpansionPreflightBlocker[];
}

export function buildEvidenceExpansionPreflightDependencyState(
  input: EvidenceExpansionDependencyInputsInput
): EvidenceExpansionPreflightDependencyState {
  assertExactInputKeys(input);
  assertOfficialCalendarIdentity(input.calendarClassifier);

  if (input.calendarClassifier.officialCalendarArtifact === null) {
    return {
      dependencyInputs: evidenceExpansionCompleteDependencyInputsSchema.parse({
        candidateIntervals: [],
        pairwise: []
      }),
      blockers: evidenceExpansionPreflightBlockerSchema.array().parse([
        {
          code: "DEPENDENCY_INPUT_INCOMPLETE",
          splitRole: null,
          targetRegime: null,
          message: "dependency inputs require official calendar evidence"
        },
        {
          code: "OFFICIAL_CALENDAR_EVIDENCE_MISSING",
          splitRole: null,
          targetRegime: null,
          message: "official calendar evidence is unavailable"
        }
      ])
    };
  }

  return {
    dependencyInputs: buildEvidenceExpansionDependencyInputs(input),
    blockers: []
  };
}

function assertOfficialCalendarIdentity(
  calendarClassifier:
    EvidenceExpansionDependencyInputsInput["calendarClassifier"]
): void {
  const artifact = calendarClassifier.officialCalendarArtifact;
  const artifactHash =
    calendarClassifier.hashes.officialCalendarArtifactHash;
  if (
    (artifact === null) !== (artifactHash === null) ||
    (artifact !== null && artifact.artifactHash !== artifactHash)
  ) {
    throw new Error(
      "official calendar artifact does not match verified hash"
    );
  }
}

function assertExactInputKeys(
  input: EvidenceExpansionDependencyInputsInput
): void {
  const actual = Object.keys(input).sort();
  const expected = ["calendarClassifier", "groups", "source"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight dependency state input contains unknown fields"
    );
  }
}
