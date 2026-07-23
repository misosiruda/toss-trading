import assert from "node:assert/strict";
import test from "node:test";

import {
  type EvidenceExpansionPreflightBlocker,
  type ValidationRoleRegimeEvidenceExpansionPreflightArtifact,
  validationRoleRegimeEvidenceExpansionPreflightArtifactSchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

test("strict preflight schema accepts a synthetic ready fixture", () => {
  const artifact = readyArtifact();

  const parsed =
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    );

  assert.equal(parsed.status, "ready_for_expansion_replay");
  assert.equal(parsed.mode, "paper_only");
  assert.equal(parsed.blockers.length, 0);
});

test("strict preflight schema rejects unknown fields and non-paper mode", () => {
  const artifact = readyArtifact() as ValidationRoleRegimeEvidenceExpansionPreflightArtifact & {
    resultMetrics?: { sharpe: number };
  };
  artifact.resultMetrics = { sharpe: 9 };

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      mode: "live"
    })
  );
});

test("preflight status fails closed for an invalid blocker", () => {
  const invalidBlocker = blocker("SOURCE_PROVENANCE_INVALID");
  const artifact = {
    ...readyArtifact(),
    status: "invalid",
    blockers: [invalidBlocker]
  };

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "invalid"
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "inconclusive"
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "ready_for_expansion_replay"
    })
  );
});

test("preflight status requires inconclusive for non-integrity blockers", () => {
  const artifact = readyArtifact();
  artifact.dependencyInputs.pairwise.pop();
  artifact.status = "inconclusive";
  artifact.blockers = [blocker("DEPENDENCY_INPUT_INCOMPLETE")];

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "ready_for_expansion_replay"
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "invalid"
    })
  );
});

test("missing expansion coverage is an invalid source condition", () => {
  const artifact = {
    ...readyArtifact(),
    status: "invalid",
    blockers: [blocker("EXPANSION_SOURCE_COVERAGE_MISSING")]
  };

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "invalid"
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...artifact,
      status: "inconclusive"
    })
  );
});

test("missing official calendar evidence requires its blocker", () => {
  const artifact = readyArtifact();
  artifact.source.officialCalendarArtifactHash = null;

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  artifact.status = "inconclusive";
  artifact.blockers = [
    blocker("OFFICIAL_CALENDAR_EVIDENCE_MISSING"),
    blocker("DEPENDENCY_INPUT_INCOMPLETE")
  ];
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
  artifact.dependencyInputs.pairwise = [];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );
});

test("undefined role-regime target requires null targets and blocker", () => {
  const artifact = readyArtifact();
  artifact.config.roleRegimeSampleMinimum = null;
  for (const role of ["train", "validation", "test"] as const) {
    for (const regime of ["bull", "bear", "sideways", "mixed"] as const) {
      artifact.targetMatrix.byRole[role].byRegime[regime] = null;
    }
  }

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  artifact.status = "inconclusive";
  artifact.blockers = [blocker("ROLE_REGIME_TARGET_UNDEFINED")];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );
});

test("combined capacity below target requires scoped blockers", () => {
  const artifact = readyArtifact();
  artifact.dependencyInputs.candidateIntervals =
    artifact.dependencyInputs.candidateIntervals.filter(
      (interval) =>
        !(
          interval.splitRoles.length === 1 &&
          interval.splitRoles[0] === "validation" &&
          interval.targetRegime === "bull"
        ) ||
        Number.parseInt(interval.evidenceGroupHash.slice(-2), 16) % 8 >= 3
    );
  artifact.config.roleRegimeSampleMinimum = 6;
  for (const role of ["train", "validation", "test"] as const) {
    for (const regime of ["bull", "bear", "sideways", "mixed"] as const) {
      artifact.targetMatrix.byRole[role].byRegime[regime] = 6;
    }
  }
  rebuildCombinedEvidence(artifact);
  artifact.capacity.baseline = structuredClone(artifact.capacity.combined);
  artifact.capacity.expansion = structuredClone(artifact.capacity.combined);
  artifact.capacity.incremental = emptyCapacityView();
  artifact.status = "inconclusive";
  artifact.blockers = [
    blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "validation"),
    blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "validation"),
    blocker(
      "ROLE_REGIME_CAPACITY_BELOW_TARGET",
      "validation",
      "bull"
    )
  ];

  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "inconclusive"
  );

  artifact.blockers = artifact.blockers.slice(1);
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
});

test("capacity views reject global and role count conflicts", () => {
  const artifact = readyArtifact();
  artifact.capacity.baseline.globalUniqueEvidenceGroupCount = 90;

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  const roleConflict = readyArtifact();
  roleConflict.capacity.expansion.byRole.train.byRegime.bull = 7;
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      roleConflict
    )
  );
});

test("capacity summary views reject impossible incremental evidence", () => {
  const artifact = readyArtifact();
  artifact.capacity.incremental = structuredClone(
    artifact.capacity.expansion
  );

  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
});

test("strict preflight schema rejects duplicate and incorrectly scoped blockers", () => {
  const dependencyBlocker = blocker("DEPENDENCY_INPUT_INCOMPLETE");
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "inconclusive",
      blockers: [dependencyBlocker, dependencyBlocker]
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "inconclusive",
      blockers: [
        blocker(
          "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
          "train",
          "bull"
        )
      ]
    })
  );
});

test("dependency contract rejects overwritten or inconsistent date diagnostics", () => {
  const artifact = readyArtifact();
  artifact.dependencyInputs.candidateIntervals[0]!.sourceVariants[0] = {
    ...artifact.dependencyInputs.candidateIntervals[0]!.sourceVariants[0]!,
    observedTradingDatesHash: hash("b")
  };
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );

  artifact.status = "invalid";
  artifact.blockers = [blocker("TRADING_DATE_SET_CONFLICT")];
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    )
  );
  artifact.dependencyInputs.pairwise = [];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      artifact
    ).status,
    "invalid"
  );

  const invalidPairwise = readyArtifact();
  invalidPairwise.dependencyInputs.pairwise[0] = {
    ...invalidPairwise.dependencyInputs.pairwise[0]!,
    tradingDateOverlapCount: 2,
    tradingDateUnionCount: 4,
    tradingDateOverlapRatio: 0.75,
    adjacencyTradingDayGap: 1
  };
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      invalidPairwise
    )
  );
});

test("pairwise flags must match accepted interval regime and roles", () => {
  const sameRegimeConflict = readyArtifact();
  sameRegimeConflict.dependencyInputs.pairwise[0]!.sameRegime =
    !sameRegimeConflict.dependencyInputs.pairwise[0]!.sameRegime;
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      sameRegimeConflict
    )
  );

  const crossRoleConflict = readyArtifact();
  crossRoleConflict.dependencyInputs.pairwise[0]!.crossRole =
    !crossRoleConflict.dependencyInputs.pairwise[0]!.crossRole;
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      crossRoleConflict
    )
  );
});

test("dependency arrays require canonical ordering", () => {
  const intervalOrderConflict = readyArtifact();
  [
    intervalOrderConflict.dependencyInputs.candidateIntervals[0],
    intervalOrderConflict.dependencyInputs.candidateIntervals[1]
  ] = [
    intervalOrderConflict.dependencyInputs.candidateIntervals[1]!,
    intervalOrderConflict.dependencyInputs.candidateIntervals[0]!
  ];
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      intervalOrderConflict
    )
  );

  const pairOrderConflict = readyArtifact();
  [
    pairOrderConflict.dependencyInputs.pairwise[0],
    pairOrderConflict.dependencyInputs.pairwise[1]
  ] = [
    pairOrderConflict.dependencyInputs.pairwise[1]!,
    pairOrderConflict.dependencyInputs.pairwise[0]!
  ];
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      pairOrderConflict
    )
  );

  const roleOrderConflict = readyArtifact();
  const sharedInterval =
    roleOrderConflict.dependencyInputs.candidateIntervals.find(
      (interval) => interval.splitRoles.length > 1
    )!;
  sharedInterval.splitRoles.reverse();
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      roleOrderConflict
    )
  );

  const variantOrderConflict = readyArtifact();
  const variants =
    variantOrderConflict.dependencyInputs.candidateIntervals[0]!
      .sourceVariants;
  variants.push({
    ...variants[0]!,
    feasibilityCandidateHash: indexedHash(4_001),
    sourceVariantHash: indexedHash(4_002)
  });
  variants.reverse();
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      variantOrderConflict
    )
  );
});

test("ready status requires complete accepted intervals and pairwise inputs", () => {
  const missingInterval = readyArtifact();
  missingInterval.dependencyInputs.candidateIntervals.pop();
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      missingInterval
    )
  );

  const missingPair = readyArtifact();
  missingPair.dependencyInputs.pairwise.pop();
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      missingPair
    )
  );

  missingPair.status = "inconclusive";
  missingPair.blockers = [blocker("DEPENDENCY_INPUT_INCOMPLETE")];
  assert.equal(
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse(
      missingPair
    ).status,
    "inconclusive"
  );
});

test("strict preflight schema rejects stale derived blockers", () => {
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "inconclusive",
      blockers: [blocker("OFFICIAL_CALENDAR_EVIDENCE_MISSING")]
    })
  );
  assert.throws(() =>
    validationRoleRegimeEvidenceExpansionPreflightArtifactSchema.parse({
      ...readyArtifact(),
      status: "invalid",
      blockers: [blocker("TRADING_DATE_SET_CONFLICT")]
    })
  );
});

function readyArtifact(): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  const capacityRole = {
    roleLocalUniqueEvidenceGroupCount: 32,
    roleExclusiveEvidenceGroupCount: 30,
    byRegime: {
      bull: 8,
      bear: 8,
      sideways: 8,
      mixed: 8
    }
  };
  const capacityView = {
    globalUniqueEvidenceGroupCount: 93,
    crossRoleSharedEvidenceGroupCount: 3,
    byRole: {
      train: capacityRole,
      validation: capacityRole,
      test: capacityRole
    }
  };
  const roleTarget = {
    roleLocalUniqueMinimum: 30 as const,
    roleExclusiveMinimum: 30 as const,
    byRegime: {
      bull: 2,
      bear: 2,
      sideways: 2,
      mixed: 2
    }
  };
  const candidateIntervals = readyCandidateIntervals();

  return {
    schemaVersion:
      "validation_role_regime_evidence_expansion_preflight.v1",
    mode: "paper_only",
    purpose: "evidence_expansion_preflight",
    status: "ready_for_expansion_replay",
    generatedAt: "2026-07-23T00:00:00.000Z",
    source: {
      baselineFeasibilityArtifactHash: hash("a"),
      baselinePlanHash: hash("b"),
      baselineReadinessArtifactHash: hash("c"),
      expansionDataSnapshotHash: hash("d"),
      expansionUniverseHash: hash("e"),
      expansionCoverageHash: hash("f"),
      validationSplitHash: hash("6"),
      calendarHash: hash("7"),
      officialCalendarArtifactHash: hash("8"),
      marketRegimeClassifierHash: hash("9")
    },
    config: {
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull", "bear", "sideways", "mixed"],
      windowMonths: 12,
      timezoneOffsetMinutes: 540,
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 2,
      inputPolicyVersion: "result_blind_capacity_scan.v1",
      dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
    },
    targetMatrix: {
      byRole: {
        train: roleTarget,
        validation: roleTarget,
        test: roleTarget
      }
    },
    capacity: {
      baseline: structuredClone(capacityView),
      expansion: structuredClone(capacityView),
      combined: structuredClone(capacityView),
      incremental: emptyCapacityView()
    },
    dependencyInputs: {
      candidateIntervals,
      pairwise: createPairwiseDependencies(candidateIntervals)
    },
    exclusions: [],
    blockers: [],
    preflightHash: hash("f")
  };
}

function readyCandidateIntervals(): ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
  "dependencyInputs"
]["candidateIntervals"] {
  const intervals: ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
    "dependencyInputs"
  ]["candidateIntervals"] = [];
  const exclusiveCounts = {
    train: { bull: 7, bear: 8, sideways: 7, mixed: 8 },
    validation: { bull: 7, bear: 7, sideways: 8, mixed: 8 },
    test: { bull: 8, bear: 7, sideways: 7, mixed: 8 }
  } as const;

  for (const role of ["train", "validation", "test"] as const) {
    for (const regime of ["bull", "bear", "sideways", "mixed"] as const) {
      for (let count = 0; count < exclusiveCounts[role][regime]; count += 1) {
        intervals.push(candidateInterval(intervals.length, [role], regime));
      }
    }
  }
  intervals.push(
    candidateInterval(intervals.length, ["train", "validation"], "bull")
  );
  intervals.push(
    candidateInterval(intervals.length, ["validation", "test"], "bear")
  );
  intervals.push(
    candidateInterval(intervals.length, ["train", "test"], "sideways")
  );
  return intervals.sort(compareFixtureIntervals);
}

function candidateInterval(
  index: number,
  splitRoles: Array<"train" | "validation" | "test">,
  targetRegime: "bull" | "bear" | "sideways" | "mixed"
): ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
  "dependencyInputs"
]["candidateIntervals"][number] {
  const start = new Date(Date.UTC(2010, 0, 1 + index));
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return {
    evidenceGroupHash: indexedHash(index),
    sourceVariants: [
      {
        feasibilityCandidateHash: indexedHash(1_000 + index),
        legacyReplayPlanEvidenceGroupHash: indexedHash(2_000 + index),
        sourceVariantHashVersion: "evidence_expansion_source_variant.v1",
        sourceVariantHash: indexedHash(3_000 + index),
        observedTradingDatesHash: hash("4"),
        universeMembershipHash: hash("5")
      }
    ],
    splitRoles,
    targetRegime,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    canonicalTradingDatesHash: hash("4"),
    combinedUniverseMembershipHash: hash("5")
  };
}

function createPairwiseDependencies(
  intervals: ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
    "dependencyInputs"
  ]["candidateIntervals"]
): ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
  "dependencyInputs"
]["pairwise"] {
  const ordered = [...intervals].sort((left, right) =>
    left.evidenceGroupHash.localeCompare(right.evidenceGroupHash)
  );
  const pairs: ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
    "dependencyInputs"
  ]["pairwise"] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < ordered.length;
      rightIndex += 1
    ) {
      const left = ordered[leftIndex]!;
      const right = ordered[rightIndex]!;
      pairs.push({
        leftEvidenceGroupHash: left.evidenceGroupHash,
        rightEvidenceGroupHash: right.evidenceGroupHash,
        tradingDateOverlapCount: 1,
        tradingDateUnionCount: 2,
        tradingDateOverlapRatio: 0.5,
        adjacencyTradingDayGap: null,
        sharedUniverse: true,
        sameRegime: left.targetRegime === right.targetRegime,
        crossRole:
          new Set([...left.splitRoles, ...right.splitRoles]).size > 1
      });
    }
  }
  return pairs;
}

function compareFixtureIntervals(
  left: ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
    "dependencyInputs"
  ]["candidateIntervals"][number],
  right: ValidationRoleRegimeEvidenceExpansionPreflightArtifact[
    "dependencyInputs"
  ]["candidateIntervals"][number]
): number {
  const roleDifference = compareFixtureRoles(
    left.splitRoles,
    right.splitRoles
  );
  const regimes = ["bull", "bear", "sideways", "mixed"] as const;
  return (
    roleDifference ||
    regimes.indexOf(left.targetRegime) - regimes.indexOf(right.targetRegime) ||
    left.startAt.localeCompare(right.startAt) ||
    left.endAt.localeCompare(right.endAt) ||
    left.evidenceGroupHash.localeCompare(right.evidenceGroupHash)
  );
}

function compareFixtureRoles(
  left: ReadonlyArray<"train" | "validation" | "test">,
  right: ReadonlyArray<"train" | "validation" | "test">
): number {
  const roles = ["train", "validation", "test"] as const;
  const comparableLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const difference =
      roles.indexOf(left[index]!) - roles.indexOf(right[index]!);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function rebuildCombinedEvidence(
  artifact: ValidationRoleRegimeEvidenceExpansionPreflightArtifact
): void {
  const intervals = artifact.dependencyInputs.candidateIntervals;
  const byRole = {
    train: emptyCapacityRole(),
    validation: emptyCapacityRole(),
    test: emptyCapacityRole()
  };
  let sharedCount = 0;
  for (const interval of intervals) {
    if (interval.splitRoles.length > 1) {
      sharedCount += 1;
    }
    for (const role of interval.splitRoles) {
      byRole[role].roleLocalUniqueEvidenceGroupCount += 1;
      byRole[role].byRegime[interval.targetRegime] += 1;
      if (interval.splitRoles.length === 1) {
        byRole[role].roleExclusiveEvidenceGroupCount += 1;
      }
    }
  }
  artifact.capacity.combined = {
    globalUniqueEvidenceGroupCount: intervals.length,
    crossRoleSharedEvidenceGroupCount: sharedCount,
    byRole
  };
  artifact.dependencyInputs.pairwise = createPairwiseDependencies(intervals);
}

function emptyCapacityRole() {
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

function emptyCapacityView() {
  return {
    globalUniqueEvidenceGroupCount: 0,
    crossRoleSharedEvidenceGroupCount: 0,
    byRole: {
      train: emptyCapacityRole(),
      validation: emptyCapacityRole(),
      test: emptyCapacityRole()
    }
  };
}

function blocker(
  code: EvidenceExpansionPreflightBlocker["code"],
  splitRole: EvidenceExpansionPreflightBlocker["splitRole"] = null,
  targetRegime: EvidenceExpansionPreflightBlocker["targetRegime"] = null
): EvidenceExpansionPreflightBlocker {
  return {
    code,
    message: `${code} fixture`,
    splitRole,
    targetRegime
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function indexedHash(index: number): `sha256:${string}` {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}
