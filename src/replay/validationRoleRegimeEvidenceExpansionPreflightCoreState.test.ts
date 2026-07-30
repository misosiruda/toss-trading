import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  Market,
  Sha256Hash
} from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions
} from "./historicalDataAvailability.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflightArtifactBuilder.js";
import {
  buildAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflightArtifactWriter.js";
import {
  buildEvidenceExpansionPreflightCoreState
} from "./validationRoleRegimeEvidenceExpansionPreflightCoreState.js";
import {
  parseValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";
import {
  buildEvidenceExpansionPreflightStatusState
} from "./validationRoleRegimeEvidenceExpansionPreflightStatusState.js";
import {
  createValidationFeasibilityCandidateHash,
  createValidationFeasibilityClassifierHash,
  defaultMarketRegimeClassifierConfig
} from "./validationSplitRegimeFeasibility.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import type {
  ValidationRoleRegimeReplayPlan,
  ValidationRoleRegimeReplayPlanRun
} from "./validationRoleRegimeReplayPlan.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";

test("preflight core state derives identity and evidence inputs from verified sources", () => {
  const state = buildEvidenceExpansionPreflightCoreState(coreInput());

  assert.deepEqual(state.config, {
    candidateStrategyBucket: "short_term",
    targetRegimes: ["bull", "bear", "sideways", "mixed"],
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: null,
    inputPolicyVersion: "result_blind_capacity_scan.v1",
    dependencyDiagnosticPolicyVersion:
      "overlap_adjacency_inputs.v1"
  });
  assert.equal(state.source.validationSplitHash, hash("c"));
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 2);
  assert.equal(state.targetMatrix.byRole.train.byRegime.bull, null);
  assert.deepEqual(state.partitionSummary, {
    structuralCandidateCount: 3,
    calendarValidCandidateCount: 3,
    calendarRejectedCandidateCount: 0,
    acceptedCandidateCount: 1,
    excludedCandidateCount: 2,
    uniqueStructuralEvidenceGroupCount: 3,
    uniqueAcceptedEvidenceGroupCount: 1,
    uniqueExcludedEvidenceGroupCount: 2,
    acceptedExcludedSharedEvidenceGroupCount: 0
  });
});

test("preflight status state derives status from verified core blockers", () => {
  const state = buildEvidenceExpansionPreflightStatusState(coreInput());

  assert.equal(state.status, "inconclusive");
  assert.ok(
    state.blockers.some(
      (blocker) =>
        blocker.code === "OFFICIAL_CALENDAR_EVIDENCE_MISSING"
    )
  );
  assert.ok(
    state.blockers.some(
      (blocker) => blocker.code === "ROLE_REGIME_TARGET_UNDEFINED"
    )
  );
});

test("preflight artifact builder binds verified status state and hash", () => {
  const artifact = buildEvidenceExpansionPreflightArtifact({
    ...coreInput(),
    generatedAt: "2026-07-29T00:00:00.000Z"
  });

  assert.equal(
    artifact.schemaVersion,
    "validation_role_regime_evidence_expansion_preflight.v1"
  );
  assert.equal(artifact.mode, "paper_only");
  assert.equal(artifact.purpose, "evidence_expansion_preflight");
  assert.equal(artifact.status, "inconclusive");
  assert.deepEqual(
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      artifact
    ),
    artifact
  );
});

test("preflight artifact builder rejects caller-provided derived fields", () => {
  for (const field of ["status", "blockers", "preflightHash"]) {
    const input = {
      ...coreInput(),
      generatedAt: "2026-07-29T00:00:00.000Z",
      [field]: field === "blockers" ? [] : "caller-value"
    } as unknown as Parameters<
      typeof buildEvidenceExpansionPreflightArtifact
    >[0];

    assert.throws(
      () => buildEvidenceExpansionPreflightArtifact(input),
      /artifact builder input contains unknown fields/
    );
  }
});

test("preflight artifact builder rejects non-canonical generatedAt", () => {
  for (const generatedAt of [
    "not-an-iso-date",
    "2026-07-29",
    "July 29, 2026",
    "2026-07-29T09:00:00.000+09:00",
    "2026-07-29T00:00:00Z"
  ]) {
    assert.throws(
      () =>
        buildEvidenceExpansionPreflightArtifact({
          ...coreInput(),
          generatedAt
        }),
      /generatedAt must use canonical UTC ISO datetime/
    );
  }
});

test("preflight build-and-write creates one strict artifact", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-build-")
  );
  const outputPath = join(directory, "nested", "preflight.json");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const artifact =
    await buildAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact({
      ...coreInput(),
      generatedAt: "2026-07-29T00:00:00.000Z",
      outputPath
    });
  const written = JSON.parse(await readFile(outputPath, "utf8"));

  assert.deepEqual(
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      written
    ),
    artifact
  );
  await assert.rejects(
    buildAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact({
      ...coreInput(),
      generatedAt: "2026-07-29T00:00:00.000Z",
      outputPath
    }),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST"
  );
});

test("preflight build-and-write rejects derived fields before filesystem mutation", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-build-")
  );
  const outputDirectory = join(directory, "nested");
  const outputPath = join(outputDirectory, "preflight.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = {
    ...coreInput(),
    generatedAt: "2026-07-29T00:00:00.000Z",
    outputPath,
    status: "caller-value"
  } as unknown as Parameters<
    typeof buildAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact
  >[0];

  await assert.rejects(
    buildAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      input
    ),
    /build-and-write input contains unknown fields/
  );
  await assert.rejects(access(outputDirectory));
});

test("preflight core state preserves an insufficient baseline as empty evidence", () => {
  const input = coreInput();
  input.baselineIdentity = insufficientBaselineIdentity(
    input.baselineIdentity
  );

  const state = buildEvidenceExpansionPreflightCoreState(input);

  assert.equal(state.capacity.baseline.globalUniqueEvidenceGroupCount, 0);
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 1);
});

test("preflight core state rejects baseline source drift for an insufficient baseline", () => {
  const input = coreInput();
  input.baselineIdentity = insufficientBaselineIdentity(
    input.baselineIdentity
  );
  input.baselineSource.baselineProvenanceHashes.universeHash = hash("f");

  assert.throws(
    () => buildEvidenceExpansionPreflightCoreState(input),
    /baseline raw source hash mismatch: universeHash/
  );
});

test("preflight core state rejects caller-provided derived inputs", () => {
  for (const field of [
    "targetMatrix",
    "capacity",
    "aggregation",
    "partition",
    "baselineEvidence",
    "dependencySource",
    "windowPolicy"
  ]) {
    const input = {
      ...coreInput(),
      [field]: {}
    } as unknown as Parameters<
      typeof buildEvidenceExpansionPreflightCoreState
    >[0];

    assert.throws(
      () => buildEvidenceExpansionPreflightCoreState(input),
      /core state input contains unknown fields/
    );
  }
});

function insufficientBaselineIdentity(
  baseline: VerifiedValidationRoleRegimeEvidenceExpansionBaseline
): VerifiedValidationRoleRegimeEvidenceExpansionBaseline {
  return {
    ...baseline,
    plan: {
      ...baseline.plan,
      status: "insufficient",
      source: {
        ...baseline.plan.source,
        feasibilityStatus: "insufficient"
      },
      runs: [],
      summary: {
        ...baseline.plan.summary,
        plannedRunCount: 0,
        globalUniqueEvidenceGroupCount: 0,
        crossRoleSharedEvidenceGroupCount: 0
      }
    }
  };
}

function coreInput(): Parameters<
  typeof buildEvidenceExpansionPreflightCoreState
>[0] {
  return {
    baselineIdentity: baselineIdentity(),
    baselineSource: expansionSource(),
    expansion: expansionSource(),
    calendarClassifier: calendarClassifier(),
    roleRegimeSampleMinimum: null
  };
}

function baselineIdentity(): VerifiedValidationRoleRegimeEvidenceExpansionBaseline {
  const marketRegimeClassifier =
    defaultMarketRegimeClassifierConfig();
  const marketRegimeClassifierHash =
    createValidationFeasibilityClassifierHash(
      marketRegimeClassifier
    );
  const source = baselineProvenance();
  const calendarHash = hash("d");
  const startAt = "2025-01-02T00:00:00.000Z";
  const endAt = "2025-01-03T00:00:00.000Z";
  const candidateHash = createValidationFeasibilityCandidateHash({
    startAt,
    endAt,
    timezoneOffsetMinutes: 540,
    windowMonths: 1,
    calendarHash,
    marketRegimeClassifierHash,
    candidateStrategyBucket: "short_term",
    scopeAvailable: true,
    dataSnapshotHash: source.dataSnapshotHash,
    universeHash: source.universeHash,
    coverageHash: source.coverageHash
  });
  const run = baselineRun(candidateHash, startAt, endAt);
  const plan: Pick<
    ValidationRoleRegimeReplayPlan,
    "status" | "source" | "config" | "runs"
  > = {
    status: "ready_for_paper_diagnostic",
    source: {
      feasibilitySchemaVersion:
        "validation_split_regime_feasibility.v1",
      feasibilityArtifactHash: hash("f"),
      feasibilityStatus: "available",
      ...source,
      calendarHash,
      marketRegimeClassifierHash
    },
    config: {
      selectionPolicyVersion:
        "exhaustive_role_regime_candidates.v1",
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull"],
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    runs: [run]
  };
  return {
    feasibility: {
      config: {
        candidateStrategyBucket: "short_term",
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      },
      provenance: {
        validationSplitHash: hash("c"),
        calendarHash,
        marketRegimeClassifierHash
      }
    },
    plan,
    hashes: {
      baselineFeasibilityArtifactHash: hash("f"),
      baselinePlanHash: hash("0"),
      baselineReadinessArtifactHash: hash("a")
    }
  } as VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
}

function expansionSource(): VerifiedValidationRoleRegimeEvidenceExpansionSource {
  const coverage = {
    mode: "paper_only" as const,
    universeId: "fixture-universe",
    status: "available" as const,
    rangeStart: "2025-01-01T00:00:00.000Z",
    rangeEnd: "2025-01-31T23:59:59.999Z",
    timezoneOffsetMinutes: 540,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableMarketSymbolCounts: {},
    minAvailableAssetTypeSymbolCounts: {},
    minAvailableStrategyBucketSymbolCounts: {},
    requireOptionalSymbols: false,
    requiredMarkets: ["KR"] as Market[],
    requiredAssetTypes: [],
    requiredStrategyBuckets: ["short_term" as const],
    corruptLineCount: 0 as const,
    availableStrategyBuckets: ["short_term" as const]
  };
  return {
    snapshots: snapshots(),
    assignments: [
      assignment("test"),
      assignment("train"),
      assignment("validation")
    ],
    coverage,
    baselineProvenanceHashes: baselineProvenance(),
    hashes: {
      expansionDataSnapshotHash: hash("1"),
      expansionUniverseHash: hash("2"),
      expansionCoverageHash: createReplayResearchHash(coverage),
      validationSplitHash: hash("c")
    }
  } as unknown as VerifiedValidationRoleRegimeEvidenceExpansionSource;
}

function calendarClassifier(): VerifiedEvidenceExpansionCalendarClassifier {
  const marketRegimeClassifier =
    defaultMarketRegimeClassifierConfig();
  return {
    calendarValidation: calendar(),
    marketRegimeClassifier,
    officialCalendarArtifact: null,
    hashes: {
      calendarHash: hash("d"),
      officialCalendarArtifactHash: null,
      marketRegimeClassifierHash:
        createValidationFeasibilityClassifierHash(
          marketRegimeClassifier
        )
    }
  } as VerifiedEvidenceExpansionCalendarClassifier;
}

function baselineRun(
  candidateHash: Sha256Hash,
  startAt: string,
  endAt: string
): ValidationRoleRegimeReplayPlanRun {
  const executionAssignment = assignment("train");
  return {
    planIndex: 0,
    runKey: "baseline-train-bull-0",
    splitRole: "train",
    targetRegime: "bull",
    candidateOrdinalWithinRoleRegime: 0,
    candidateHash,
    startAt,
    endAt,
    sourceAssignments: [executionAssignment],
    executionAssignment,
    evidenceGroupHash: candidateHash,
    sharedAcrossRoles: false,
    sharedRoles: ["train"]
  };
}

function baselineProvenance() {
  return {
    dataSnapshotHash: hash("3"),
    universeHash: hash("4"),
    coverageHash: hash("5"),
    validationSplitHash: hash("c")
  };
}

function assignment(
  splitRole: ValidationSplitRole
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole,
    trainStart: "2025-01-01T00:00:00+09:00",
    trainEnd: "2025-01-31T23:59:59.999+09:00",
    validationStart: "2025-02-01T00:00:00+09:00",
    validationEnd: "2025-02-28T23:59:59.999+09:00",
    testStart: "2025-03-01T00:00:00+09:00",
    testEnd: "2025-03-31T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function snapshots(): HistoricalMarketSnapshot[] {
  return [
    snapshot("baseline-start", "2025-01-02T00:00:00.000Z", 10_000),
    snapshot("baseline-end", "2025-01-03T00:00:00.000Z", 10_500),
    snapshot("validation-session", "2025-02-03T00:00:00.000Z", 10_000),
    snapshot("test-session", "2025-03-04T00:00:00.000Z", 10_000)
  ];
}

function snapshot(
  snapshotId: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol: "005930",
    strategyBucket: "short_term",
    observedAt,
    interval: "1d",
    lastPriceKrw,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function calendar(): HistoricalDataAvailabilityCalendarOptions {
  return {
    rules: [
      { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }
    ],
    fixtures: [
      fixture("2025-01-02", "2025-01-02T00:00:00.000Z"),
      fixture("2025-01-03", "2025-01-03T00:00:00.000Z"),
      fixture("2025-02-03", "2025-02-03T00:00:00.000Z"),
      fixture("2025-03-04", "2025-03-04T00:00:00.000Z")
    ]
  };
}

function fixture(
  sessionDate: string,
  marketOpen: string
): HistoricalDataAvailabilityCalendarOptions["fixtures"][number] {
  return {
    calendarId: `calendar.krx.${sessionDate}`,
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate,
    marketOpen,
    marketClose: new Date(
      Date.parse(marketOpen) + 6.5 * 60 * 60 * 1_000
    ).toISOString(),
    isHoliday: false,
    sourceRefs: [`fixture:calendar.krx.${sessionDate}`],
    createdAt: "2026-07-27T00:00:00.000Z"
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
