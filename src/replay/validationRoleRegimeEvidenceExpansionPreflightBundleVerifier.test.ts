import assert from "node:assert/strict";
import test from "node:test";

import {
  assessHistoricalUniverseCoverage,
  historicalUniverseManifestSchema
} from "./historicalUniverseCoverage.js";
import { verifyEvidenceExpansionPreflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifier.js";
import { createEvidenceExpansionPreflightBundleTestFixture as preflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifierTestFixture.js";
import { parseValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";
import {
  createEvidenceExpansionSourceVerifierTestAssignments
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

const verificationOptions = {
  generatedAt: "2026-07-30T00:00:00.000Z"
} as const;

test("preflight bundle verifier composes verified sources into core state", () => {
  const input = preflightBundle();

  const verified = verifyEvidenceExpansionPreflightBundle(
    input,
    verificationOptions
  );

  assert.equal(
    verified.verifiedDeclaredPolicy.roleRegimeSampleMinimum,
    null
  );
  assert.equal(
    verified.verifiedBaseline.plan.status,
    "ready_for_paper_diagnostic"
  );
  assert.equal(
    verified.verifiedCalendarClassifier.hashes.calendarHash,
    verified.verifiedBaseline.plan.source.calendarHash
  );
  assert.equal(
    verified.verifiedCalendarClassifier.hashes
      .marketRegimeClassifierHash,
    verified.verifiedBaseline.plan.source.marketRegimeClassifierHash
  );
  assert.equal(
    verified.coreState.source.expansionDataSnapshotHash,
    verified.verifiedSourcePair.expansion.hashes
      .expansionDataSnapshotHash
  );
  assert.equal(
    verified.coreState.capacity.baseline.byRole.train.byRegime.bull,
    1
  );
  assert.equal(
    verified.coreState.capacity.expansion.byRole.train.byRegime.bull,
    1
  );
  assert.equal(verified.status, "inconclusive");
  assert.equal("status" in verified.coreState, false);
  assert.equal(
    verified.artifact.generatedAt,
    verificationOptions.generatedAt
  );
  assert.equal(verified.artifact.status, verified.status);
  assert.deepEqual(
    verified.artifact.capacity,
    verified.coreState.capacity
  );
  assert.deepEqual(
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      verified.artifact
    ),
    verified.artifact
  );
  assert.deepEqual(
    verified.verifiedSourcePair.expansion.baselineProvenanceHashes,
    verified.verifiedSourcePair.baseline.baselineProvenanceHashes
  );
  assert.equal(
    verified.verifiedSourcePair.expansion.hashes.validationSplitHash,
    verified.verifiedSourcePair.baseline.hashes.validationSplitHash
  );
  assert.equal(
    verified.acceptedInput.baseline.feasibilityArtifact,
    input.baseline.feasibilityArtifact
  );
});

test("preflight bundle verifier rejects non-canonical artifact time", () => {
  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(preflightBundle(), {
        ...verificationOptions,
        generatedAt: "2026-07-30T09:00:00+09:00"
      }),
    /generatedAt must use canonical UTC ISO datetime/
  );
});

test("preflight bundle verifier rejects an independent freshness time", () => {
  const options = {
    ...verificationOptions,
    asOf: "2025-01-01T00:00:00.000Z"
  } as unknown as Parameters<
    typeof verifyEvidenceExpansionPreflightBundle
  >[1];

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        preflightBundle(),
        options
      ),
    /bundle verification options contain unknown fields/
  );
});

test("preflight bundle verifier rejects result input before source verification", () => {
  const input = {
    ...preflightBundle(),
    historicalReplayReport: {
      status: "completed"
    }
  };

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /preflight input rejected: \$\.historicalReplayReport/
  );
});

test("preflight bundle verifier rejects source-pair split drift", () => {
  const input = preflightBundle();
  input.expansion = {
    ...input.expansion,
    validationSplitSource: {
      sourceVersion: "expanded-split-source",
      assignments:
        createEvidenceExpansionSourceVerifierTestAssignments()
    }
  };

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /baseline and expansion validation split sources must match/
  );
});

test("preflight bundle verifier rejects a non-canonical declared target", () => {
  const input = preflightBundle();
  input.targetMatrix.byRole.validation.byRegime.bear = 9;

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /target matrix must use one canonical role-regime minimum/
  );
});

test("preflight bundle verifier rejects baseline raw source provenance drift", () => {
  const input = preflightBundle();
  input.baseline.universe = {
    ...(input.baseline.universe as Record<string, unknown>),
    disclaimer: "Changed after baseline artifact generation."
  };

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /baseline raw source hash mismatch: universeHash/
  );
});

test("preflight bundle verifier rejects calendar and classifier provenance drift", () => {
  const calendarDrift = preflightBundle();
  (
    calendarDrift.calendarValidation as {
      fixtures: Array<{ sourceRefs: string[] }>;
    }
  ).fixtures[0]!.sourceRefs.push("fixture:calendar-drift");

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        calendarDrift,
        verificationOptions
      ),
    /calendar hash does not match baseline/
  );

  const classifierDrift = preflightBundle();
  (
    classifierDrift.marketRegimeClassifier as {
      bullReturnThreshold: number;
    }
  ).bullReturnThreshold = 0.04;

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        classifierDrift,
        verificationOptions
      ),
    /classifier hash does not match baseline/
  );
});

test("preflight bundle verifier rejects non-daily expansion source before returning core state", () => {
  const input = preflightBundle();
  input.expansion.snapshots[0]!.interval = "1m";

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /observed trading-date snapshot must use 1d interval/
  );
});

test("preflight bundle verifier derives baseline and expansion capacity from separate sources", () => {
  const input = preflightBundle();
  input.expansion.snapshots = input.expansion.snapshots.filter(
    (snapshot) => snapshot.snapshotId !== "bundle-snapshot-0"
  );
  input.expansion.coverage = assessHistoricalUniverseCoverage({
    snapshots: input.expansion.snapshots,
    universe: historicalUniverseManifestSchema.parse(
      input.expansion.universe
    ),
    rangeStart: new Date("2024-12-31T15:00:00.000Z"),
    rangeEnd: new Date("2025-03-31T14:59:59.999Z"),
    corruptLineCount: 0,
    timezoneOffsetMinutes: 540,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableStrategyBucketSymbolCounts: { short_term: 1 },
    requiredMarkets: ["KR"],
    requiredStrategyBuckets: ["short_term"]
  });

  const verified = verifyEvidenceExpansionPreflightBundle(
    input,
    verificationOptions
  );

  assert.equal(
    verified.coreState.capacity.baseline.byRole.train.byRegime.bull,
    1
  );
  assert.equal(
    verified.coreState.capacity.expansion.byRole.train.byRegime.bull,
    0
  );
  assert.ok(
    verified.coreState.exclusions.some(
      (exclusion) =>
        exclusion.splitRole === "train" &&
        exclusion.reason === "INSUFFICIENT_REGIME_DATA"
    )
  );
});
