import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionPreflightBlocker,
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  bindValidationRoleRegimeEvidenceExpansionPreflightHash,
  type ValidationRoleRegimeEvidenceExpansionPreflightPayload
} from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";

export function createEvidenceExpansionPreflightTestArtifact(): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  const emptyRoleCapacity = {
    roleLocalUniqueEvidenceGroupCount: 0,
    roleExclusiveEvidenceGroupCount: 0,
    byRegime: {
      bull: 0,
      bear: 0,
      sideways: 0,
      mixed: 0
    }
  };
  const emptyCapacity = {
    globalUniqueEvidenceGroupCount: 0,
    crossRoleSharedEvidenceGroupCount: 0,
    byRole: {
      train: structuredClone(emptyRoleCapacity),
      validation: structuredClone(emptyRoleCapacity),
      test: structuredClone(emptyRoleCapacity)
    }
  };
  const roleTarget = {
    roleLocalUniqueMinimum: 30 as const,
    roleExclusiveMinimum: 30 as const,
    byRegime: {
      bull: null,
      bear: null,
      sideways: null,
      mixed: null
    }
  };
  const payload: ValidationRoleRegimeEvidenceExpansionPreflightPayload = {
    schemaVersion:
      "validation_role_regime_evidence_expansion_preflight.v1",
    mode: "paper_only",
    purpose: "evidence_expansion_preflight",
    status: "inconclusive",
    generatedAt: "2026-07-28T00:00:00.000Z",
    source: {
      baselineFeasibilityArtifactHash: hash("1"),
      baselinePlanHash: hash("2"),
      baselineReadinessArtifactHash: hash("3"),
      expansionDataSnapshotHash: hash("4"),
      expansionUniverseHash: hash("5"),
      expansionCoverageHash: hash("6"),
      baselineValidationSplitHash: hash("7"),
      expansionValidationSplitHash: hash("7"),
      calendarHash: hash("8"),
      officialCalendarArtifactHash: null,
      marketRegimeClassifierHash: hash("9")
    },
    config: {
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull", "bear", "sideways", "mixed"],
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null,
      inputPolicyVersion: "result_blind_capacity_scan.v1",
      dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
    },
    targetMatrix: {
      byRole: {
        train: structuredClone(roleTarget),
        validation: structuredClone(roleTarget),
        test: structuredClone(roleTarget)
      }
    },
    capacity: {
      baseline: structuredClone(emptyCapacity),
      expansion: structuredClone(emptyCapacity),
      combined: structuredClone(emptyCapacity),
      incremental: structuredClone(emptyCapacity)
    },
    dependencyInputs: {
      candidateIntervals: [],
      pairwise: []
    },
    exclusions: [],
    blockers: [
      blocker("DEPENDENCY_INPUT_INCOMPLETE"),
      blocker("OFFICIAL_CALENDAR_EVIDENCE_MISSING"),
      blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "train"),
      blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "validation"),
      blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "test"),
      blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "train"),
      blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "validation"),
      blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "test"),
      blocker("ROLE_REGIME_TARGET_UNDEFINED")
    ]
  };
  return bindValidationRoleRegimeEvidenceExpansionPreflightHash(payload);
}

function blocker(
  code: EvidenceExpansionPreflightBlocker["code"],
  splitRole: EvidenceExpansionPreflightBlocker["splitRole"] = null
): EvidenceExpansionPreflightBlocker {
  return {
    code,
    splitRole,
    targetRegime: null,
    message: `${code} fixture`
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
