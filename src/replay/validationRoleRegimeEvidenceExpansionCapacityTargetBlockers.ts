import { z } from "zod";

import {
  evidenceExpansionCapacitySummarySchema,
  evidenceExpansionPreflightBlockerSchema,
  evidenceExpansionTargetMatrixSchema,
  type EvidenceExpansionCapacitySummary,
  type EvidenceExpansionPreflightBlocker,
  type EvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";

const capacityTargetBlockerInputSchema = z
  .object({
    targetMatrix: evidenceExpansionTargetMatrixSchema,
    capacity: evidenceExpansionCapacitySummarySchema
  })
  .strict();

export function buildEvidenceExpansionCapacityTargetBlockers(
  input: unknown
): EvidenceExpansionPreflightBlocker[] {
  const parsed = capacityTargetBlockerInputSchema.parse(input);
  const targetMatrix: EvidenceExpansionTargetMatrix =
    parsed.targetMatrix;
  const capacity: EvidenceExpansionCapacitySummary["combined"] =
    parsed.capacity.combined;
  const blockers: EvidenceExpansionPreflightBlocker[] = [];
  let hasUndefinedRegimeTarget = false;

  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const target = targetMatrix.byRole[splitRole];
    const actual = capacity.byRole[splitRole];
    if (
      actual.roleLocalUniqueEvidenceGroupCount <
      target.roleLocalUniqueMinimum
    ) {
      blockers.push({
        code: "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
        splitRole,
        targetRegime: null,
        message:
          `${splitRole} role-local capacity ` +
          `${actual.roleLocalUniqueEvidenceGroupCount} is below target ` +
          `${target.roleLocalUniqueMinimum}`
      });
    }
    if (
      actual.roleExclusiveEvidenceGroupCount <
      target.roleExclusiveMinimum
    ) {
      blockers.push({
        code: "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET",
        splitRole,
        targetRegime: null,
        message:
          `${splitRole} role-exclusive capacity ` +
          `${actual.roleExclusiveEvidenceGroupCount} is below target ` +
          `${target.roleExclusiveMinimum}`
      });
    }
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      const regimeTarget = target.byRegime[targetRegime];
      if (regimeTarget === null) {
        hasUndefinedRegimeTarget = true;
        continue;
      }
      const regimeCapacity = actual.byRegime[targetRegime];
      if (regimeCapacity < regimeTarget) {
        blockers.push({
          code: "ROLE_REGIME_CAPACITY_BELOW_TARGET",
          splitRole,
          targetRegime,
          message:
            `${splitRole}/${targetRegime} capacity ${regimeCapacity} ` +
            `is below target ${regimeTarget}`
        });
      }
    }
  }

  if (hasUndefinedRegimeTarget) {
    blockers.push({
      code: "ROLE_REGIME_TARGET_UNDEFINED",
      splitRole: null,
      targetRegime: null,
      message: "role-regime sample minimum is undefined"
    });
  }

  return evidenceExpansionPreflightBlockerSchema
    .array()
    .parse(blockers.sort(compareBlockers));
}

function compareBlockers(
  left: EvidenceExpansionPreflightBlocker,
  right: EvidenceExpansionPreflightBlocker
): number {
  return (
    compareStrings(left.code, right.code) ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    regimeIndex(left.targetRegime) - regimeIndex(right.targetRegime) ||
    compareStrings(left.message, right.message)
  );
}

function roleIndex(
  role: EvidenceExpansionPreflightBlocker["splitRole"]
): number {
  return role === null
    ? VALIDATION_ROLE_ORDER.length
    : VALIDATION_ROLE_ORDER.indexOf(role);
}

function regimeIndex(
  regime: EvidenceExpansionPreflightBlocker["targetRegime"]
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
