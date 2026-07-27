import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

export type EvidenceExpansionCapacityView =
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact["capacity"]["expansion"];

export function buildEvidenceExpansionCapacityView(
  consolidation: EvidenceExpansionEvidenceGroupConsolidationResult
): EvidenceExpansionCapacityView {
  if (
    consolidation.evidenceGroups.length !==
    consolidation.uniqueEvidenceGroupCount
  ) {
    throw new Error(
      "capacity evidence groups do not match consolidation unique count"
    );
  }

  const capacity = emptyCapacityView();
  const evidenceGroupHashes = new Set<string>();
  for (const group of consolidation.evidenceGroups) {
    assertValidEvidenceGroup(group, evidenceGroupHashes);
    evidenceGroupHashes.add(group.evidenceGroupHash);
    capacity.globalUniqueEvidenceGroupCount += 1;

    const shared = group.splitRoles.length > 1;
    if (shared) {
      capacity.crossRoleSharedEvidenceGroupCount += 1;
    }
    for (const splitRole of group.splitRoles) {
      const roleCapacity = capacity.byRole[splitRole];
      roleCapacity.roleLocalUniqueEvidenceGroupCount += 1;
      roleCapacity.byRegime[group.targetRegime] += 1;
      if (!shared) {
        roleCapacity.roleExclusiveEvidenceGroupCount += 1;
      }
    }
  }

  assertCapacityConservation(capacity);
  return capacity;
}

function emptyCapacityView(): EvidenceExpansionCapacityView {
  return {
    globalUniqueEvidenceGroupCount: 0,
    crossRoleSharedEvidenceGroupCount: 0,
    byRole: {
      train: emptyRoleCapacity(),
      validation: emptyRoleCapacity(),
      test: emptyRoleCapacity()
    }
  };
}

function emptyRoleCapacity(): EvidenceExpansionCapacityView["byRole"]["train"] {
  return {
    roleLocalUniqueEvidenceGroupCount: 0,
    roleExclusiveEvidenceGroupCount: 0,
    byRegime: {
      bull: 0,
      bear: 0,
      sideways: 0,
      mixed: 0
    }
  };
}

function assertValidEvidenceGroup(
  group: EvidenceExpansionAcceptedEvidenceGroup,
  existingHashes: ReadonlySet<string>
): void {
  if (existingHashes.has(group.evidenceGroupHash)) {
    throw new Error(
      "capacity evidence groups contain duplicate evidenceGroupHash"
    );
  }
  if (group.sourceVariants.length === 0) {
    throw new Error(
      "capacity evidence group must include a source variant"
    );
  }
  if (
    group.sourceVariants.some(
      (variant) =>
        variant.evidenceGroupHash !== group.evidenceGroupHash
    )
  ) {
    throw new Error(
      "capacity source variant does not match evidence group hash"
    );
  }
  if (group.splitRoles.length === 0) {
    throw new Error(
      "capacity evidence group must include a validation role"
    );
  }
  const roles = new Set<ValidationSplitRole>();
  for (let index = 0; index < group.splitRoles.length; index += 1) {
    const splitRole = group.splitRoles[index]!;
    if (roleOrder(splitRole) < 0) {
      throw new Error(
        "capacity evidence group contains an unknown validation role"
      );
    }
    if (roles.has(splitRole)) {
      throw new Error(
        "capacity evidence group roles must be unique"
      );
    }
    roles.add(splitRole);
    if (
      index > 0 &&
      roleOrder(group.splitRoles[index - 1]!) >= roleOrder(splitRole)
    ) {
      throw new Error(
        "capacity evidence group roles must use canonical order"
      );
    }
  }
  if (!VALIDATION_TARGET_REGIME_ORDER.includes(group.targetRegime)) {
    throw new Error(
      "capacity evidence group must use a target regime"
    );
  }
}

function assertCapacityConservation(
  capacity: EvidenceExpansionCapacityView
): void {
  let exclusiveCount = 0;
  let sharedMembershipCount = 0;
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const role = capacity.byRole[splitRole];
    const regimeCount = VALIDATION_TARGET_REGIME_ORDER.reduce(
      (total, targetRegime) =>
        total + role.byRegime[targetRegime],
      0
    );
    if (regimeCount !== role.roleLocalUniqueEvidenceGroupCount) {
      throw new Error(
        "capacity role-regime count does not match role-local count"
      );
    }
    exclusiveCount += role.roleExclusiveEvidenceGroupCount;
    sharedMembershipCount +=
      role.roleLocalUniqueEvidenceGroupCount -
      role.roleExclusiveEvidenceGroupCount;
  }
  if (
    exclusiveCount + capacity.crossRoleSharedEvidenceGroupCount !==
    capacity.globalUniqueEvidenceGroupCount
  ) {
    throw new Error(
      "capacity global count does not match exclusive and shared groups"
    );
  }
  if (
    sharedMembershipCount <
      capacity.crossRoleSharedEvidenceGroupCount * 2 ||
    sharedMembershipCount >
      capacity.crossRoleSharedEvidenceGroupCount *
        VALIDATION_ROLE_ORDER.length
  ) {
    throw new Error(
      "capacity shared groups do not match role memberships"
    );
  }
}

function roleOrder(splitRole: ValidationSplitRole): number {
  return VALIDATION_ROLE_ORDER.indexOf(splitRole);
}
