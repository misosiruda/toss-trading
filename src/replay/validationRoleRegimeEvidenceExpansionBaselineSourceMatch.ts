import type {
  ValidationSplitRegimeFeasibilityArtifact
} from "./validationSplitRegimeFeasibility.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";

type BaselineSourceProvenance = Pick<
  ValidationSplitRegimeFeasibilityArtifact["provenance"],
  | "dataSnapshotHash"
  | "universeHash"
  | "coverageHash"
  | "validationSplitHash"
>;

type VerifiedSourceHashes =
  VerifiedValidationRoleRegimeEvidenceExpansionSource["hashes"];

export function assertEvidenceExpansionBaselineSourceMatches(input: {
  baselineProvenance: BaselineSourceProvenance;
  sourceHashes: VerifiedSourceHashes;
}): void {
  assertMatchingHash(
    "dataSnapshotHash",
    input.baselineProvenance.dataSnapshotHash,
    input.sourceHashes.expansionDataSnapshotHash
  );
  assertMatchingHash(
    "universeHash",
    input.baselineProvenance.universeHash,
    input.sourceHashes.expansionUniverseHash
  );
  assertMatchingHash(
    "coverageHash",
    input.baselineProvenance.coverageHash,
    input.sourceHashes.expansionCoverageHash
  );
  assertMatchingHash(
    "validationSplitHash",
    input.baselineProvenance.validationSplitHash,
    input.sourceHashes.validationSplitHash
  );
}

function assertMatchingHash(
  field: keyof BaselineSourceProvenance,
  expected: string,
  actual: string
): void {
  if (actual !== expected) {
    throw new Error(`baseline raw source hash mismatch: ${field}`);
  }
}
