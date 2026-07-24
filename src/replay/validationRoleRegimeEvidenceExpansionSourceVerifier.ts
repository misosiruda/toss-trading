import { z } from "zod";

import {
  historicalMarketSnapshotSchema,
  type HistoricalMarketSnapshot,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  assessHistoricalUniverseCoverage,
  historicalUniverseManifestSchema,
  type HistoricalUniverseManifest
} from "./historicalUniverseCoverage.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  VALIDATION_ROLE_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import {
  feasibilityCoverageSourceSchema,
  validationSplitSourceSchema
} from "./validationSplitRegimeFeasibility.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

const expansionSnapshotSourceSchema = z
  .array(historicalMarketSnapshotSchema)
  .min(1);

type FeasibilityCoverageSource = z.infer<
  typeof feasibilityCoverageSourceSchema
>;
type ValidationSplitSource = z.infer<typeof validationSplitSourceSchema>;

export interface VerifyValidationRoleRegimeEvidenceExpansionSourceOptions {
  snapshots: unknown;
  universe: unknown;
  coverage: unknown;
  validationSplitSource: unknown;
}

export interface VerifiedValidationRoleRegimeEvidenceExpansionSource {
  snapshots: HistoricalMarketSnapshot[];
  universe: HistoricalUniverseManifest;
  coverage: FeasibilityCoverageSource;
  validationSplitSource: ValidationSplitSource;
  assignments: ValidationSplitAssignment[];
  hashes: {
    expansionDataSnapshotHash: Sha256Hash;
    expansionUniverseHash: Sha256Hash;
    expansionCoverageHash: Sha256Hash;
    validationSplitHash: Sha256Hash;
  };
}

export function verifyValidationRoleRegimeEvidenceExpansionSource(
  options: VerifyValidationRoleRegimeEvidenceExpansionSourceOptions
): VerifiedValidationRoleRegimeEvidenceExpansionSource {
  const snapshots = expansionSnapshotSourceSchema
    .parse(options.snapshots)
    .sort(compareSnapshots);
  assertUniqueSnapshotIds(snapshots);

  const universe = historicalUniverseManifestSchema.parse(options.universe);
  assertSnapshotsInsideUniverse(snapshots, universe);

  const coverage = verifyCoverage({
    source: options.coverage,
    snapshots,
    universe
  });
  const validationSplitSource = normalizeValidationSplitSource(
    options.validationSplitSource
  );
  const assignments = Array.isArray(validationSplitSource)
    ? validationSplitSource
    : validationSplitSource.assignments;
  assertUniqueAssignments(assignments);

  return {
    snapshots,
    universe,
    coverage,
    validationSplitSource,
    assignments,
    hashes: {
      expansionDataSnapshotHash: createReplayResearchHash(snapshots),
      expansionUniverseHash: createReplayResearchHash(options.universe),
      expansionCoverageHash: createReplayResearchHash(coverage),
      validationSplitHash: createReplayResearchHash(validationSplitSource)
    }
  };
}

function verifyCoverage(input: {
  source: unknown;
  snapshots: HistoricalMarketSnapshot[];
  universe: HistoricalUniverseManifest;
}): FeasibilityCoverageSource {
  const coverage = feasibilityCoverageSourceSchema.parse(input.source);
  if (coverage.universeId !== input.universe.universeId) {
    throw new Error(
      `expansion coverage universeId mismatch: ${coverage.universeId}`
    );
  }

  const rangeStart = new Date(coverage.rangeStart);
  const rangeEnd = new Date(coverage.rangeEnd);
  for (const snapshot of input.snapshots) {
    const observedAt = Date.parse(snapshot.observedAt);
    if (
      observedAt < rangeStart.getTime() ||
      observedAt > rangeEnd.getTime()
    ) {
      throw new Error(
        `expansion snapshot is outside coverage range: ${snapshot.snapshotId}`
      );
    }
  }

  const recomputed = assessHistoricalUniverseCoverage({
    snapshots: input.snapshots,
    universe: input.universe,
    rangeStart,
    rangeEnd,
    corruptLineCount: coverage.corruptLineCount,
    timezoneOffsetMinutes: coverage.timezoneOffsetMinutes,
    minMonthlyCoverageRatio: coverage.minMonthlyCoverageRatio,
    minSnapshotsPerSymbol: coverage.minSnapshotsPerSymbol,
    minAvailableSymbolCount: coverage.minAvailableSymbolCount,
    minAvailableMarketSymbolCounts:
      coverage.minAvailableMarketSymbolCounts,
    minAvailableAssetTypeSymbolCounts:
      coverage.minAvailableAssetTypeSymbolCounts,
    minAvailableStrategyBucketSymbolCounts:
      coverage.minAvailableStrategyBucketSymbolCounts,
    requireOptionalSymbols: coverage.requireOptionalSymbols,
    requiredMarkets: coverage.requiredMarkets,
    requiredAssetTypes: coverage.requiredAssetTypes,
    requiredStrategyBuckets: coverage.requiredStrategyBuckets
  });
  if (
    createReplayResearchHash(coverage) !==
    createReplayResearchHash(recomputed)
  ) {
    throw new Error(
      "expansion coverage does not match snapshots and universe"
    );
  }
  return coverage;
}

function normalizeValidationSplitSource(
  value: unknown
): ValidationSplitSource {
  const parsed = validationSplitSourceSchema.parse(value);
  const assignments = [
    ...(Array.isArray(parsed) ? parsed : parsed.assignments)
  ].sort(compareAssignments);
  return Array.isArray(parsed)
    ? assignments
    : { ...parsed, assignments };
}

function assertUniqueSnapshotIds(
  snapshots: readonly HistoricalMarketSnapshot[]
): void {
  const snapshotIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.snapshotId)) {
      throw new Error(
        `duplicate expansion historical snapshotId: ${snapshot.snapshotId}`
      );
    }
    snapshotIds.add(snapshot.snapshotId);
  }
}

function assertSnapshotsInsideUniverse(
  snapshots: readonly HistoricalMarketSnapshot[],
  universe: HistoricalUniverseManifest
): void {
  const universeSymbols = new Set(
    universe.symbols.map((member) => `${member.market}:${member.symbol}`)
  );
  for (const snapshot of snapshots) {
    const key = `${snapshot.market}:${snapshot.symbol}`;
    if (!universeSymbols.has(key)) {
      throw new Error(`expansion snapshot is outside universe: ${key}`);
    }
  }
}

function assertUniqueAssignments(
  assignments: readonly ValidationSplitAssignment[]
): void {
  const assignmentKeys = new Set<string>();
  for (const assignment of assignments) {
    const key = [
      assignment.splitIndex,
      assignment.splitId,
      assignment.splitRole
    ].join(":");
    if (assignmentKeys.has(key)) {
      throw new Error(`duplicate expansion validation assignment: ${key}`);
    }
    assignmentKeys.add(key);
  }
}

function compareSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  return (
    Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
    compareStrings(left.market, right.market) ||
    compareStrings(left.symbol, right.symbol) ||
    compareStrings(left.snapshotId, right.snapshotId)
  );
}

function compareAssignments(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): number {
  return (
    left.splitIndex - right.splitIndex ||
    compareStrings(left.splitId, right.splitId) ||
    VALIDATION_ROLE_ORDER.indexOf(left.splitRole) -
      VALIDATION_ROLE_ORDER.indexOf(right.splitRole)
  );
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
