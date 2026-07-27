import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  VALIDATION_ROLE_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

export function mergeEvidenceExpansionOverlappingGroup(input: {
  baseline: EvidenceExpansionAcceptedEvidenceGroup;
  expansion: EvidenceExpansionAcceptedEvidenceGroup;
}): EvidenceExpansionAcceptedEvidenceGroup {
  assertSameGroupPayload(input.baseline, input.expansion);
  assertCanonicalRoles(input.baseline.splitRoles, "baseline");
  assertCanonicalRoles(input.expansion.splitRoles, "expansion");
  if (input.baseline.sourceVariants.length !== 1) {
    throw new Error(
      "overlapping group requires one baseline source variant"
    );
  }
  if (input.expansion.sourceVariants.length === 0) {
    throw new Error(
      "overlapping group requires expansion source variants"
    );
  }

  const sourceVariants = new Map<
    string,
    EvidenceExpansionSourceCandidateVariant
  >();
  addSourceVariants(
    sourceVariants,
    input.baseline,
    "baseline"
  );
  addSourceVariants(
    sourceVariants,
    input.expansion,
    "expansion"
  );

  return {
    evidenceGroupHash: input.baseline.evidenceGroupHash,
    startAt: input.baseline.startAt,
    endAt: input.baseline.endAt,
    targetRegime: input.baseline.targetRegime,
    splitRoles: Array.from(
      new Set([
        ...input.baseline.splitRoles,
        ...input.expansion.splitRoles
      ])
    ).sort(compareRoles),
    sourceVariants: [...sourceVariants.values()].sort(
      compareSourceVariants
    )
  };
}

function assertSameGroupPayload(
  baseline: EvidenceExpansionAcceptedEvidenceGroup,
  expansion: EvidenceExpansionAcceptedEvidenceGroup
): void {
  if (baseline.evidenceGroupHash !== expansion.evidenceGroupHash) {
    throw new Error(
      "overlapping groups must use the same evidenceGroupHash"
    );
  }
  if (
    baseline.startAt !== expansion.startAt ||
    baseline.endAt !== expansion.endAt
  ) {
    throw new Error(
      "overlapping groups have conflicting interval payload"
    );
  }
  if (baseline.targetRegime !== expansion.targetRegime) {
    throw new Error(
      "overlapping groups have conflicting regime labels"
    );
  }
}

function assertCanonicalRoles(
  roles: readonly ValidationSplitRole[],
  sourceName: "baseline" | "expansion"
): void {
  if (roles.length === 0) {
    throw new Error(
      `${sourceName} overlapping group requires validation roles`
    );
  }
  const seen = new Set<ValidationSplitRole>();
  for (let index = 0; index < roles.length; index += 1) {
    const role = roles[index]!;
    const roleIndex = VALIDATION_ROLE_ORDER.indexOf(role);
    if (roleIndex < 0 || seen.has(role)) {
      throw new Error(
        `${sourceName} overlapping group roles are invalid`
      );
    }
    if (
      index > 0 &&
      VALIDATION_ROLE_ORDER.indexOf(roles[index - 1]!) >= roleIndex
    ) {
      throw new Error(
        `${sourceName} overlapping group roles must use canonical order`
      );
    }
    seen.add(role);
  }
}

function addSourceVariants(
  variants: Map<string, EvidenceExpansionSourceCandidateVariant>,
  group: EvidenceExpansionAcceptedEvidenceGroup,
  sourceIdentity: "baseline" | "expansion"
): void {
  for (const variant of group.sourceVariants) {
    if (variant.evidenceGroupHash !== group.evidenceGroupHash) {
      throw new Error(
        `${sourceIdentity} source variant does not match evidence group hash`
      );
    }
    const reference = variant.sourceVariant;
    if (sourceIdentity === "baseline") {
      if (
        reference.legacyReplayPlanEvidenceGroupHash === null ||
        reference.legacyReplayPlanEvidenceGroupHash !==
          reference.feasibilityCandidateHash
      ) {
        throw new Error(
          "baseline source variant must preserve legacy identity"
        );
      }
    } else if (
      reference.legacyReplayPlanEvidenceGroupHash !== null
    ) {
      throw new Error(
        "expansion source variant must not carry legacy identity"
      );
    }

    const existing = variants.get(reference.sourceVariantHash);
    if (
      existing !== undefined &&
      canonicalVariantHash(existing) !== canonicalVariantHash(variant)
    ) {
      throw new Error(
        "cross-source variant hash has conflicting canonical payload"
      );
    }
    if (existing === undefined) {
      variants.set(reference.sourceVariantHash, variant);
    }
  }
}

function canonicalVariantHash(
  variant: EvidenceExpansionSourceCandidateVariant
): string {
  const {
    legacyReplayPlanEvidenceGroupHash: _legacyIdentity,
    ...sourceVariant
  } = variant.sourceVariant;
  return createReplayResearchHash({
    evidenceGroupHash: variant.evidenceGroupHash,
    sourceVariant,
    observedTradingDates: variant.observedTradingDates,
    universeMembership: variant.universeMembership
  });
}

function compareRoles(
  left: ValidationSplitRole,
  right: ValidationSplitRole
): number {
  return (
    VALIDATION_ROLE_ORDER.indexOf(left) -
    VALIDATION_ROLE_ORDER.indexOf(right)
  );
}

function compareSourceVariants(
  left: EvidenceExpansionSourceCandidateVariant,
  right: EvidenceExpansionSourceCandidateVariant
): number {
  return (
    compareStrings(
      left.sourceVariant.sourceVariantHash,
      right.sourceVariant.sourceVariantHash
    ) ||
    compareStrings(
      left.sourceVariant.feasibilityCandidateHash,
      right.sourceVariant.feasibilityCandidateHash
    )
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
