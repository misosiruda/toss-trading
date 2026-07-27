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

type VerifiedBaselineProvenanceHashes =
  VerifiedValidationRoleRegimeEvidenceExpansionSource[
    "baselineProvenanceHashes"
  ];

export function assertEvidenceExpansionBaselineSourceMatches(input: {
  baselineProvenance: BaselineSourceProvenance;
  verifiedSourceProvenance: VerifiedBaselineProvenanceHashes;
}): void {
  assertMatchingHash(
    "dataSnapshotHash",
    input.baselineProvenance.dataSnapshotHash,
    input.verifiedSourceProvenance.dataSnapshotHash
  );
  assertMatchingHash(
    "universeHash",
    input.baselineProvenance.universeHash,
    input.verifiedSourceProvenance.universeHash
  );
  assertMatchingHash(
    "coverageHash",
    input.baselineProvenance.coverageHash,
    input.verifiedSourceProvenance.coverageHash
  );
  assertMatchingHash(
    "validationSplitHash",
    input.baselineProvenance.validationSplitHash,
    input.verifiedSourceProvenance.validationSplitHash
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
