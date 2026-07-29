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
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  classifyEvidenceExpansionCandidateEligibility
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import type {
  EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionPreflightEvidenceState,
  type EvidenceExpansionPreflightDependencySource
} from "./validationRoleRegimeEvidenceExpansionPreflightEvidenceState.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  buildEvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";
import type {
  ValidationSplitAssignment
} from "./validationProtocol.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

const policy: EvidenceExpansionGroupWindowPolicy = {
  candidateStrategyBucket: "short_term",
  windowMonths: 1,
  timezoneOffsetMinutes: 0
};

test("preflight evidence state connects candidate capacity and dependency blockers", () => {
  const state = buildEvidenceExpansionPreflightEvidenceState(stateInput());

  assert.deepEqual(state.partitionSummary, {
    structuralCandidateCount: 1,
    calendarValidCandidateCount: 1,
    calendarRejectedCandidateCount: 0,
    acceptedCandidateCount: 1,
    excludedCandidateCount: 0,
    uniqueStructuralEvidenceGroupCount: 1,
    uniqueAcceptedEvidenceGroupCount: 1,
    uniqueExcludedEvidenceGroupCount: 0,
    acceptedExcludedSharedEvidenceGroupCount: 0
  });
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 2);
  assert.deepEqual(state.dependencyInputs, {
    candidateIntervals: [],
    pairwise: []
  });
  assert.deepEqual(state.exclusions, []);
  assert.deepEqual(
    state.blockers.map(
      ({ code, splitRole }) => `${code}:${splitRole ?? "*"}`
    ),
    [
      "DEPENDENCY_INPUT_INCOMPLETE:*",
      "OFFICIAL_CALENDAR_EVIDENCE_MISSING:*",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:train",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:validation",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:test",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:train",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:validation",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:test",
      "ROLE_REGIME_TARGET_UNDEFINED:*"
    ]
  );
});

test("preflight evidence state builds dependencies from the combined accepted union", () => {
  const input = stateInput();
  input.dependencySource = dependencySource(true);

  const state = buildEvidenceExpansionPreflightEvidenceState(input);

  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 2);
  assert.deepEqual(
    state.dependencyInputs.candidateIntervals.map(
      ({ targetRegime }) => targetRegime
    ),
    ["bull", "bear"]
  );
  assert.equal(state.dependencyInputs.pairwise.length, 1);
  assert.equal(
    state.blockers.some(
      ({ code }) => code === "DEPENDENCY_INPUT_INCOMPLETE"
    ),
    false
  );
});

test("preflight evidence state rejects caller-provided dependency groups", () => {
  const input = stateInput();
  input.dependencySource = {
    ...input.dependencySource,
    groups: []
  } as unknown as EvidenceExpansionPreflightDependencySource;

  assert.throws(
    () => buildEvidenceExpansionPreflightEvidenceState(input),
    /dependency source contains unknown fields/
  );
});

test("preflight evidence state rejects caller-provided capacity", () => {
  const input = {
    ...stateInput(),
    capacity: {}
  } as unknown as Parameters<
    typeof buildEvidenceExpansionPreflightEvidenceState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionPreflightEvidenceState(input),
    /evidence state input contains unknown fields/
  );
});

function stateInput(): Parameters<
  typeof buildEvidenceExpansionPreflightEvidenceState
>[0] {
  const aggregation = candidateAggregation();
  const partition = buildEvidenceExpansionCandidatePartition({
    aggregation,
    eligibility:
      classifyEvidenceExpansionCandidateEligibility(aggregation),
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  return {
    aggregation,
    partition,
    baseline: baselineConsolidation(),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy,
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null
    }),
    dependencySource: dependencySource()
  };
}

function candidateAggregation(): EvidenceExpansionAssignmentCandidateAggregation {
  const assignment = validationAssignment();
  const startAt = "2025-02-01T00:00:00.000Z";
  const endAt = "2025-02-28T23:59:59.999Z";
  const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: policy.candidateStrategyBucket,
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: "2025-02-03" }
  ];
  const universeMembership = [
    { market: "KR" as const, symbol: "000660" }
  ];
  const candidate = {
    startAt,
    endAt,
    regime: "bear" as const,
    scopeAvailable: true,
    variant: {
      evidenceGroupHash,
      sourceVariant: {
        feasibilityCandidateHash: hash("6"),
        legacyReplayPlanEvidenceGroupHash: null,
        sourceVariantHashVersion:
          "evidence_expansion_source_variant.v1" as const,
        sourceVariantHash: hash("7"),
        observedTradingDatesHash: createReplayResearchHash({
          version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
          sessions: observedTradingDates
        }),
        universeMembershipHash: createReplayResearchHash({
          version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
          members: universeMembership
        })
      },
      observedTradingDates,
      universeMembership
    }
  };
  return {
    assignmentCandidates: [
      {
        assignment,
        result: {
          roleWindow: validationRoleWindow(assignment),
          structuralCapacityCount: 1,
          candidates: [candidate],
          calendarRejectedCandidates: [],
          calendarRejectedCandidateCount: 0,
          scopeUnavailableCandidateCount: 0,
          warnings: []
        }
      }
    ],
    calendarRejectedCandidates: [],
    structuralCapacityCount: 1,
    calendarValidCandidateCount: 1,
    calendarRejectedCandidateCount: 0,
    scopeUnavailableCandidateCount: 0
  };
}

function validationAssignment(): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-validation",
    splitIndex: 0,
    splitRole: "validation",
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: "2025-03-01T00:00:00.000Z",
    testEnd: "2025-03-31T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function baselineConsolidation(): Parameters<
  typeof buildEvidenceExpansionPreflightEvidenceState
>[0]["baseline"] {
  const feasibilityCandidateHash = hash("1");
  const startAt = "2025-01-01T00:00:00.000Z";
  const endAt = "2025-01-31T23:59:59.999Z";
  const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: policy.candidateStrategyBucket,
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: "2025-01-02" }
  ];
  const universeMembership = [
    { market: "KR" as const, symbol: "005930" }
  ];
  return {
    evidenceGroups: [
      {
        evidenceGroupHash,
        startAt,
        endAt,
        targetRegime: "bull",
        splitRoles: ["train"],
        sourceVariants: [
          {
            evidenceGroupHash,
            sourceVariant: {
              feasibilityCandidateHash,
              legacyReplayPlanEvidenceGroupHash:
                feasibilityCandidateHash,
              sourceVariantHashVersion:
                "evidence_expansion_source_variant.v1",
              sourceVariantHash: hash("3"),
              observedTradingDatesHash: createReplayResearchHash({
                version:
                  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
                sessions: observedTradingDates
              }),
              universeMembershipHash: createReplayResearchHash({
                version:
                  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
                members: universeMembership
              })
            },
            observedTradingDates,
            universeMembership
          }
        ]
      }
    ],
    acceptedCandidateCount: 1,
    uniqueEvidenceGroupCount: 1
  };
}

function dependencySource(
  includeOfficialCalendar = false
): EvidenceExpansionPreflightDependencySource {
  const coverage = {
    mode: "paper_only" as const,
    universeId: "fixture-universe",
    status: "available" as const,
    rangeStart: "2025-01-01T00:00:00.000Z",
    rangeEnd: "2025-02-28T23:59:59.999Z",
    timezoneOffsetMinutes: 0,
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
  const source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "coverage" | "hashes"
  > = {
    coverage,
    hashes: {
      expansionDataSnapshotHash: hash("a"),
      expansionUniverseHash: hash("b"),
      expansionCoverageHash: createReplayResearchHash(coverage),
      validationSplitHash: hash("c")
    }
  };
  const officialCalendarArtifact = includeOfficialCalendar
    ? officialArtifact()
    : null;
  const calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "officialCalendarArtifact" | "hashes"
  > = {
    officialCalendarArtifact,
    hashes: {
      calendarHash: hash("d"),
      officialCalendarArtifactHash:
        officialCalendarArtifact?.artifactHash ?? null,
      marketRegimeClassifierHash: hash("e")
    }
  };
  return { source, calendarClassifier };
}

function officialArtifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload: OfficialMarketCalendarEvidencePayload = {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-03-01T00:00:00.000Z",
    coverage: {
      startDate: "2025-01-01",
      endDate: "2025-03-01",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      officialSource("KR"),
      officialSource("US")
    ],
    sessions: (["KR", "US"] as Market[]).flatMap((market) =>
      calendarDates().map((sessionDate) =>
        officialSession(
          market,
          sessionDate,
          market === "KR" &&
            (sessionDate === "2025-01-02" ||
              sessionDate === "2025-02-03")
            ? "regular"
            : isWeekend(sessionDate)
              ? "weekend"
              : "holiday"
        )
      )
    )
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
    publisher: korean
      ? "synthetic KRX fixture"
      : "synthetic NYSE fixture",
    sourceUrl: korean
      ? "https://example.com/krx"
      : "https://example.com/nyse",
    sourceDocumentHash: hash(korean ? "8" : "9"),
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
  sessionType: "regular" | "holiday" | "weekend" = "regular"
): OfficialMarketCalendarEvidencePayload["sessions"][number] {
  const korean = market === "KR";
  const closed = sessionType !== "regular";
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
    exceptionName:
      sessionType === "holiday" ? "fixture holiday" : null
  };
}

function calendarDates(): string[] {
  const dates: string[] = [];
  const end = Date.parse("2025-03-01T00:00:00.000Z");
  for (
    let current = Date.parse("2025-01-01T00:00:00.000Z");
    current <= end;
    current += 24 * 60 * 60 * 1000
  ) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

function isWeekend(sessionDate: string): boolean {
  const day = new Date(`${sessionDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
