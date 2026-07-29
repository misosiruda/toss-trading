import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";

export interface EvidenceExpansionCrossSourceGroupClassification {
  baselineUniqueEvidenceGroupCount: number;
  expansionUniqueEvidenceGroupCount: number;
  baselineOverlapEvidenceGroupCount: number;
  incrementalUniqueEvidenceGroupCount: number;
  overlapEvidenceGroupHashes: Sha256Hash[];
  incrementalEvidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[];
}

export interface EvidenceExpansionGroupWindowPolicy {
  candidateStrategyBucket: "short_term";
  windowMonths: number;
  timezoneOffsetMinutes: number;
}

export function classifyEvidenceExpansionCrossSourceGroups(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): EvidenceExpansionCrossSourceGroupClassification {
  assertSameWindowPolicy(
    input.baselineWindowPolicy,
    input.expansionWindowPolicy
  );
  const baseline = indexEvidenceGroups(input.baseline, "baseline");
  const expansion = indexEvidenceGroups(
    input.expansion,
    "expansion"
  );
  const overlapEvidenceGroupHashes: Sha256Hash[] = [];
  const incrementalEvidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[] =
    [];

  for (const group of expansion.byHash.values()) {
    const baselineGroup = baseline.byHash.get(group.evidenceGroupHash);
    if (baselineGroup !== undefined) {
      assertSameCrossSourcePayload(baselineGroup, group);
      overlapEvidenceGroupHashes.push(group.evidenceGroupHash);
      continue;
    }

    const baselineIntervalHash = baseline.hashByInterval.get(
      intervalKey(group)
    );
    if (baselineIntervalHash !== undefined) {
      throw new Error(
        "cross-source interval payload maps to conflicting evidence group hashes"
      );
    }
    incrementalEvidenceGroups.push(group);
  }

  overlapEvidenceGroupHashes.sort(compareStrings);
  incrementalEvidenceGroups.sort((left, right) =>
    compareStrings(left.evidenceGroupHash, right.evidenceGroupHash)
  );

  return {
    baselineUniqueEvidenceGroupCount: baseline.byHash.size,
    expansionUniqueEvidenceGroupCount: expansion.byHash.size,
    baselineOverlapEvidenceGroupCount:
      overlapEvidenceGroupHashes.length,
    incrementalUniqueEvidenceGroupCount:
      incrementalEvidenceGroups.length,
    overlapEvidenceGroupHashes,
    incrementalEvidenceGroups
  };
}

function assertSameWindowPolicy(
  baseline: EvidenceExpansionGroupWindowPolicy,
  expansion: EvidenceExpansionGroupWindowPolicy
): void {
  for (const policy of [baseline, expansion]) {
    if (
      policy.candidateStrategyBucket !== "short_term" ||
      !Number.isInteger(policy.windowMonths) ||
      policy.windowMonths <= 0 ||
      !Number.isInteger(policy.timezoneOffsetMinutes)
    ) {
      throw new Error(
        "cross-source classification requires a valid window policy"
      );
    }
  }
  if (
    baseline.candidateStrategyBucket !==
      expansion.candidateStrategyBucket ||
    baseline.windowMonths !== expansion.windowMonths ||
    baseline.timezoneOffsetMinutes !==
      expansion.timezoneOffsetMinutes
  ) {
    throw new Error(
      "cross-source evidence groups require matching window policies"
    );
  }
}

function indexEvidenceGroups(
  consolidation: EvidenceExpansionEvidenceGroupConsolidationResult,
  sourceName: "baseline" | "expansion"
): {
  byHash: Map<Sha256Hash, EvidenceExpansionAcceptedEvidenceGroup>;
  hashByInterval: Map<string, Sha256Hash>;
} {
  if (
    consolidation.evidenceGroups.length !==
    consolidation.uniqueEvidenceGroupCount
  ) {
    throw new Error(
      `${sourceName} evidence groups do not match unique count`
    );
  }
  const byHash = new Map<
    Sha256Hash,
    EvidenceExpansionAcceptedEvidenceGroup
  >();
  const hashByInterval = new Map<string, Sha256Hash>();
  for (const group of consolidation.evidenceGroups) {
    if (byHash.has(group.evidenceGroupHash)) {
      throw new Error(
        `${sourceName} evidence groups contain duplicate evidenceGroupHash`
      );
    }
    byHash.set(group.evidenceGroupHash, group);

    const key = intervalKey(group);
    const existingHash = hashByInterval.get(key);
    if (
      existingHash !== undefined &&
      existingHash !== group.evidenceGroupHash
    ) {
      throw new Error(
        `${sourceName} interval payload maps to conflicting evidence group hashes`
      );
    }
    hashByInterval.set(key, group.evidenceGroupHash);
  }

  return { byHash, hashByInterval };
}

function assertSameCrossSourcePayload(
  baseline: EvidenceExpansionAcceptedEvidenceGroup,
  expansion: EvidenceExpansionAcceptedEvidenceGroup
): void {
  if (
    baseline.startAt !== expansion.startAt ||
    baseline.endAt !== expansion.endAt
  ) {
    throw new Error(
      "cross-source evidence group hash has conflicting interval payload"
    );
  }
  if (baseline.targetRegime !== expansion.targetRegime) {
    throw new Error(
      "cross-source evidence group hash has conflicting regime labels"
    );
  }
}

function intervalKey(
  group: Pick<
    EvidenceExpansionAcceptedEvidenceGroup,
    "startAt" | "endAt"
  >
): string {
  return `${group.startAt}\u0000${group.endAt}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
