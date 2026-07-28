import type {
  EvidenceExpansionPreflightBlocker
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";

export function compareEvidenceExpansionPreflightBlockers(
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
