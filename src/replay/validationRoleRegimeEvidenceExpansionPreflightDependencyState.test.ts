import assert from "node:assert/strict";
import test from "node:test";

import type { Market, Sha256Hash } from "../domain/schemas.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import type {
  EvidenceExpansionCapacitySummary
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  buildEvidenceExpansionPreflightDerivedState
} from "./validationRoleRegimeEvidenceExpansionPreflightDerivedState.js";
import {
  buildEvidenceExpansionPreflightDependencyState
} from "./validationRoleRegimeEvidenceExpansionPreflightDependencyState.js";
import {
  buildEvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";

test("dependency state fails closed when official calendar evidence is unavailable", () => {
  const input = dependencyInput();
  input.calendarClassifier.officialCalendarArtifact = null;
  input.calendarClassifier.hashes.officialCalendarArtifactHash = null;

  const state = buildEvidenceExpansionPreflightDependencyState(input);

  assert.deepEqual(state.dependencyInputs, {
    candidateIntervals: [],
    pairwise: []
  });
  assert.deepEqual(
    state.blockers.map(({ code }) => code),
    [
      "DEPENDENCY_INPUT_INCOMPLETE",
      "OFFICIAL_CALENDAR_EVIDENCE_MISSING"
    ]
  );
});

test("dependency state delegates complete inputs when official evidence is verified", () => {
  const state = buildEvidenceExpansionPreflightDependencyState(
    dependencyInput()
  );

  assert.deepEqual(state, {
    dependencyInputs: {
      candidateIntervals: [],
      pairwise: []
    },
    blockers: []
  });
});

test("dependency state rejects official artifact hash mismatches", () => {
  const missingHash = dependencyInput();
  missingHash.calendarClassifier.hashes.officialCalendarArtifactHash = null;
  assert.throws(
    () => buildEvidenceExpansionPreflightDependencyState(missingHash),
    /official calendar artifact does not match verified hash/
  );

  const wrongHash = dependencyInput();
  wrongHash.calendarClassifier.hashes.officialCalendarArtifactHash = hash("f");
  assert.throws(
    () => buildEvidenceExpansionPreflightDependencyState(wrongHash),
    /official calendar artifact does not match verified hash/
  );
});

test("dependency state recomputes the official artifact payload hash", () => {
  const mutated = dependencyInput();
  mutated.calendarClassifier.officialCalendarArtifact!.sources[0]!.publisher =
    "mutated KRX fixture";

  assert.throws(
    () => buildEvidenceExpansionPreflightDependencyState(mutated),
    /official calendar artifact does not match verified hash/
  );
});

test("dependency state rejects unrecognized root fields", () => {
  const input = {
    ...dependencyInput(),
    resultMetrics: {}
  } as unknown as Parameters<
    typeof buildEvidenceExpansionPreflightDependencyState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionPreflightDependencyState(input),
    /preflight dependency state input contains unknown fields/
  );
});

test("derived state unions dependency and capacity blockers canonically", () => {
  const dependency = dependencyInput();
  dependency.calendarClassifier.officialCalendarArtifact = null;
  dependency.calendarClassifier.hashes.officialCalendarArtifactHash = null;
  const capacity = capacitySummary();
  capacity.combined.byRole.validation.roleLocalUniqueEvidenceGroupCount = 29;
  capacity.combined.byRole.validation.roleExclusiveEvidenceGroupCount = 29;
  capacity.combined.byRole.validation.byRegime.mixed = 6;
  capacity.combined.globalUniqueEvidenceGroupCount = 89;
  capacity.baseline = structuredClone(capacity.combined);
  capacity.expansion = structuredClone(capacity.combined);

  const state = buildEvidenceExpansionPreflightDerivedState({
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 7
    }),
    capacity,
    dependency
  });

  assert.deepEqual(
    state.blockers.map(
      ({ code, splitRole }) => `${code}:${splitRole ?? "*"}`
    ),
    [
      "DEPENDENCY_INPUT_INCOMPLETE:*",
      "OFFICIAL_CALENDAR_EVIDENCE_MISSING:*",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:validation",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:validation",
      "ROLE_REGIME_CAPACITY_BELOW_TARGET:validation"
    ]
  );
  assert.deepEqual(state.dependencyInputs, {
    candidateIntervals: [],
    pairwise: []
  });
});

test("derived state remains blocker-free when its implemented gates pass", () => {
  const state = buildEvidenceExpansionPreflightDerivedState({
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 7
    }),
    capacity: capacitySummary(),
    dependency: dependencyInput()
  });

  assert.deepEqual(state.blockers, []);
  assert.deepEqual(state.dependencyInputs, {
    candidateIntervals: [],
    pairwise: []
  });
});

test("derived state rejects unrecognized root fields", () => {
  const input = {
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 7
    }),
    capacity: capacitySummary(),
    dependency: dependencyInput(),
    status: "ready_for_expansion_replay"
  } as unknown as Parameters<
    typeof buildEvidenceExpansionPreflightDerivedState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionPreflightDerivedState(input),
    /preflight derived state input contains unknown fields/
  );
});

function dependencyInput(): {
  groups: [];
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "coverage" | "hashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "officialCalendarArtifact" | "hashes"
  >;
} {
  const coverage = {
    mode: "paper_only" as const,
    universeId: "fixture-universe",
    status: "available" as const,
    rangeStart: "2025-01-01T00:00:00.000Z",
    rangeEnd: "2025-01-03T23:59:59.999Z",
    timezoneOffsetMinutes: 0,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableMarketSymbolCounts: {},
    minAvailableAssetTypeSymbolCounts: {},
    minAvailableStrategyBucketSymbolCounts: {},
    requireOptionalSymbols: false,
    requiredMarkets: ["KR", "US"] as Market[],
    requiredAssetTypes: [],
    requiredStrategyBuckets: ["short_term" as const],
    corruptLineCount: 0 as const,
    availableStrategyBuckets: ["short_term" as const]
  };
  const officialCalendarArtifact = officialArtifact();
  return {
    groups: [],
    source: {
      coverage,
      hashes: {
        expansionDataSnapshotHash: hash("a"),
        expansionUniverseHash: hash("b"),
        expansionCoverageHash: createReplayResearchHash(coverage),
        validationSplitHash: hash("c")
      }
    },
    calendarClassifier: {
      officialCalendarArtifact,
      hashes: {
        calendarHash: hash("d"),
        officialCalendarArtifactHash:
          officialCalendarArtifact.artifactHash,
        marketRegimeClassifierHash: hash("e")
      }
    }
  };
}

function capacitySummary(): EvidenceExpansionCapacitySummary {
  const view = {
    globalUniqueEvidenceGroupCount: 90,
    crossRoleSharedEvidenceGroupCount: 0,
    byRole: {
      train: capacityRole(),
      validation: capacityRole(),
      test: capacityRole()
    }
  };
  return {
    baseline: structuredClone(view),
    expansion: structuredClone(view),
    combined: structuredClone(view),
    incremental: {
      globalUniqueEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 0,
      byRole: {
        train: emptyCapacityRole(),
        validation: emptyCapacityRole(),
        test: emptyCapacityRole()
      }
    }
  };
}

function capacityRole() {
  return {
    roleLocalUniqueEvidenceGroupCount: 30,
    roleExclusiveEvidenceGroupCount: 30,
    byRegime: {
      bull: 8,
      bear: 8,
      sideways: 7,
      mixed: 7
    }
  };
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

function officialArtifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload: OfficialMarketCalendarEvidencePayload = {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-01-03T22:00:00.000Z",
    coverage: {
      startDate: "2025-01-01",
      endDate: "2025-01-03",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      officialSource("KR"),
      officialSource("US")
    ],
    sessions: [
      officialSession("KR", "2025-01-01", "holiday"),
      officialSession("KR", "2025-01-02"),
      officialSession("KR", "2025-01-03", "holiday"),
      officialSession("US", "2025-01-01", "holiday"),
      officialSession("US", "2025-01-02", "holiday"),
      officialSession("US", "2025-01-03")
    ]
  };
  return {
    ...payload,
    artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
  };
}

function officialSource(
  market: Market
): OfficialMarketCalendarEvidencePayload["sources"][number] {
  const korean = market === "KR";
  return {
    sourceId: korean ? "official.krx" : "official.nyse",
    evidenceClass: "official_exchange",
    exchange: korean ? "KRX" : "NYSE",
    market,
    timezone: korean ? "Asia/Seoul" : "America/New_York",
    publisher: korean ? "synthetic KRX fixture" : "synthetic NYSE fixture",
    sourceUrl: korean
      ? "https://example.com/krx"
      : "https://example.com/nyse",
    sourceDocumentHash: hash(korean ? "1" : "2"),
    retrievedAt: "2025-01-01T00:00:00.000Z",
    staleAfter: "2026-01-01T00:00:00.000Z",
    regularSession: {
      openLocalTime: korean ? "09:00" : "09:30",
      closeLocalTime: korean ? "15:30" : "16:00"
    }
  };
}

function officialSession(
  market: Market,
  sessionDate: string,
  sessionType: "regular" | "holiday" = "regular"
): OfficialMarketCalendarEvidencePayload["sessions"][number] {
  const korean = market === "KR";
  const closed = sessionType === "holiday";
  return {
    sessionId: `${korean ? "krx" : "nyse"}.${sessionDate}`,
    sourceId: korean ? "official.krx" : "official.nyse",
    exchange: korean ? "KRX" : "NYSE",
    market,
    timezone: korean ? "Asia/Seoul" : "America/New_York",
    sessionDate,
    sessionType,
    marketOpen: closed
      ? null
      : korean
        ? `${sessionDate}T09:00:00+09:00`
        : `${sessionDate}T09:30:00-05:00`,
    marketClose: closed
      ? null
      : korean
        ? `${sessionDate}T15:30:00+09:00`
        : `${sessionDate}T16:00:00-05:00`,
    exceptionName: closed ? "fixture holiday" : null
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
