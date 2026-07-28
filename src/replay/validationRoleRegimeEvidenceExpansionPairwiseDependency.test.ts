import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  parseOfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
  type EvidenceExpansionObservedTradingDate
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import {
  buildEvidenceExpansionDependencyCandidateEvidence
} from "./validationRoleRegimeEvidenceExpansionDependencyCandidateInterval.js";
import {
  buildEvidenceExpansionDependencyInputs
} from "./validationRoleRegimeEvidenceExpansionDependencyInputs.js";
import {
  buildEvidenceExpansionPairwiseDependency,
  buildEvidenceExpansionPairwiseDependencyFromEvidence
} from "./validationRoleRegimeEvidenceExpansionPairwiseDependency.js";
import {
  evidenceExpansionCompleteDependencyInputsSchema,
  evidenceExpansionPairwiseDependencySchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
  type EvidenceExpansionUniverseMember
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

test("pairwise dependency counts official trading-session adjacency", () => {
  const dependencies = verifiedDependencies();
  const earlier = evidenceGroup({
    hashCharacter: "b",
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-02")],
    splitRoles: ["train"],
    targetRegime: "bull",
    symbol: "SAME"
  });
  const later = evidenceGroup({
    hashCharacter: "a",
    startAt: "2025-01-06T00:00:00.000Z",
    endAt: "2025-01-06T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-06")],
    splitRoles: ["validation"],
    targetRegime: "bull",
    symbol: "SAME"
  });

  const result = buildEvidenceExpansionPairwiseDependency({
    leftGroup: earlier,
    rightGroup: later,
    ...dependencies
  });

  assert.equal(result.leftEvidenceGroupHash, hash("a"));
  assert.equal(result.rightEvidenceGroupHash, hash("b"));
  assert.equal(result.tradingDateOverlapCount, 0);
  assert.equal(result.tradingDateUnionCount, 2);
  assert.equal(result.tradingDateOverlapRatio, 0);
  assert.equal(result.adjacencyTradingDayGap, 1);
  assert.equal(result.sharedUniverse, true);
  assert.equal(result.sameRegime, true);
  assert.equal(result.crossRole, true);
});

test("pairwise dependency derives overlap and interval flags", () => {
  const dependencies = verifiedDependencies();
  const left = evidenceGroup({
    hashCharacter: "c",
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T06:30:00.000Z",
    observedTradingDates: [
      tradingDate("2025-01-02"),
      tradingDate("2025-01-03")
    ],
    splitRoles: ["train"],
    targetRegime: "bull",
    symbol: "LEFT"
  });
  const right = evidenceGroup({
    hashCharacter: "d",
    startAt: "2025-01-03T00:00:00.000Z",
    endAt: "2025-01-06T06:30:00.000Z",
    observedTradingDates: [
      tradingDate("2025-01-03"),
      tradingDate("2025-01-06")
    ],
    splitRoles: ["train"],
    targetRegime: "bear",
    symbol: "RIGHT"
  });

  const result = buildEvidenceExpansionPairwiseDependency({
    leftGroup: left,
    rightGroup: right,
    ...dependencies
  });

  assert.equal(result.tradingDateOverlapCount, 1);
  assert.equal(result.tradingDateUnionCount, 3);
  assert.equal(result.tradingDateOverlapRatio, 1 / 3);
  assert.equal(result.adjacencyTradingDayGap, null);
  assert.equal(result.sharedUniverse, false);
  assert.equal(result.sameRegime, false);
  assert.equal(result.crossRole, false);
});

test("pairwise dependency preserves candidate fail-closed gates", () => {
  const dependencies = verifiedDependencies();
  const left = evidenceGroup({
    hashCharacter: "e",
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-02")],
    splitRoles: ["train"],
    targetRegime: "bull",
    symbol: "LEFT"
  });
  const sameIdentity = evidenceGroup({
    hashCharacter: "e",
    startAt: "2025-01-06T00:00:00.000Z",
    endAt: "2025-01-06T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-06")],
    splitRoles: ["validation"],
    targetRegime: "bull",
    symbol: "RIGHT"
  });
  assert.throws(
    () =>
      buildEvidenceExpansionPairwiseDependency({
        leftGroup: left,
        rightGroup: sameIdentity,
        ...dependencies
      }),
    /must not compare an interval to itself/
  );

  const staleObservedHash = evidenceGroup({
    hashCharacter: "f",
    startAt: "2025-01-06T00:00:00.000Z",
    endAt: "2025-01-06T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-06")],
    splitRoles: ["validation"],
    targetRegime: "bull",
    symbol: "RIGHT"
  });
  staleObservedHash.sourceVariants[0]!.sourceVariant
    .observedTradingDatesHash = hash("9");
  assert.throws(
    () =>
      buildEvidenceExpansionPairwiseDependency({
        leftGroup: left,
        rightGroup: staleObservedHash,
        ...dependencies
      }),
    /trading-date set conflict/
  );

  const verifiedLeft =
    buildEvidenceExpansionDependencyCandidateEvidence({
      group: left,
      ...dependencies
    });
  const verifiedRight =
    buildEvidenceExpansionDependencyCandidateEvidence({
      group: evidenceGroup({
        hashCharacter: "7",
        startAt: "2025-01-06T00:00:00.000Z",
        endAt: "2025-01-06T06:30:00.000Z",
        observedTradingDates: [tradingDate("2025-01-06")],
        splitRoles: ["validation"],
        targetRegime: "bull",
        symbol: "RIGHT"
      }),
      ...dependencies
    });
  assert.throws(() => {
    verifiedLeft.interval.targetRegime = "bear";
  }, TypeError);
  assert.throws(
    () =>
      buildEvidenceExpansionPairwiseDependencyFromEvidence({
        left: { ...verifiedLeft },
        right: verifiedRight
      }),
    /must come from the verified builder/
  );
});

test("pairwise dependency schema rejects reversed evidence hashes", () => {
  assert.throws(
    () =>
      evidenceExpansionPairwiseDependencySchema.parse({
        leftEvidenceGroupHash: hash("b"),
        rightEvidenceGroupHash: hash("a"),
        tradingDateOverlapCount: 0,
        tradingDateUnionCount: 2,
        tradingDateOverlapRatio: 0,
        adjacencyTradingDayGap: 1,
        sharedUniverse: false,
        sameRegime: false,
        crossRole: true
      }),
    /hashes must use canonical order/
  );
});

test("dependency inputs build canonical intervals and every pair", () => {
  const dependencies = verifiedDependencies();
  const earlier = evidenceGroup({
    hashCharacter: "b",
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-02")],
    splitRoles: ["train"],
    targetRegime: "bull",
    symbol: "EARLIER"
  });
  const middle = evidenceGroup({
    hashCharacter: "c",
    startAt: "2025-01-03T00:00:00.000Z",
    endAt: "2025-01-03T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-03")],
    splitRoles: ["train"],
    targetRegime: "bear",
    symbol: "MIDDLE"
  });
  const later = evidenceGroup({
    hashCharacter: "a",
    startAt: "2025-01-06T00:00:00.000Z",
    endAt: "2025-01-06T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-06")],
    splitRoles: ["validation"],
    targetRegime: "bull",
    symbol: "LATER"
  });

  const result = buildEvidenceExpansionDependencyInputs({
    groups: [later, middle, earlier],
    ...dependencies
  });

  assert.deepEqual(
    result.candidateIntervals.map((interval) => interval.evidenceGroupHash),
    [hash("b"), hash("c"), hash("a")]
  );
  assert.deepEqual(
    result.pairwise.map((pair) => [
      pair.leftEvidenceGroupHash,
      pair.rightEvidenceGroupHash
    ]),
    [
      [hash("a"), hash("b")],
      [hash("a"), hash("c")],
      [hash("b"), hash("c")]
    ]
  );
  assert.throws(
    () =>
      evidenceExpansionCompleteDependencyInputsSchema.parse({
        ...result,
        pairwise: result.pairwise.slice(1)
      }),
    /must cover every candidate interval pair/
  );
});

test("dependency inputs reject duplicate evidence groups", () => {
  const dependencies = verifiedDependencies();
  const group = evidenceGroup({
    hashCharacter: "a",
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-02T06:30:00.000Z",
    observedTradingDates: [tradingDate("2025-01-02")],
    splitRoles: ["train"],
    targetRegime: "bull",
    symbol: "DUPLICATE"
  });

  assert.throws(
    () =>
      buildEvidenceExpansionDependencyInputs({
        groups: [group, group],
        ...dependencies
      }),
    /require unique evidence groups/
  );
});

function evidenceGroup(input: {
  hashCharacter: string;
  startAt: string;
  endAt: string;
  observedTradingDates: EvidenceExpansionObservedTradingDate[];
  splitRoles: EvidenceExpansionAcceptedEvidenceGroup["splitRoles"];
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"];
  symbol: string;
}): EvidenceExpansionAcceptedEvidenceGroup {
  const evidenceGroupHash = hash(input.hashCharacter);
  const universeMembership = [
    { market: "KR" as const, symbol: input.symbol }
  ];
  return {
    evidenceGroupHash,
    startAt: input.startAt,
    endAt: input.endAt,
    targetRegime: input.targetRegime,
    splitRoles: input.splitRoles,
    sourceVariants: [
      variant({
        evidenceGroupHash,
        sourceCharacter: input.hashCharacter,
        observedTradingDates: input.observedTradingDates,
        universeMembership
      })
    ]
  };
}

function variant(input: {
  evidenceGroupHash: Sha256Hash;
  sourceCharacter: string;
  observedTradingDates: EvidenceExpansionObservedTradingDate[];
  universeMembership: EvidenceExpansionUniverseMember[];
}): EvidenceExpansionSourceCandidateVariant {
  return {
    evidenceGroupHash: input.evidenceGroupHash,
    sourceVariant: {
      feasibilityCandidateHash: hash(input.sourceCharacter),
      legacyReplayPlanEvidenceGroupHash: null,
      sourceVariantHashVersion:
        "evidence_expansion_source_variant.v1",
      sourceVariantHash: hash(input.sourceCharacter),
      observedTradingDatesHash: createReplayResearchHash({
        version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
        sessions: input.observedTradingDates
      }),
      universeMembershipHash: createReplayResearchHash({
        version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
        members: input.universeMembership
      })
    },
    observedTradingDates: input.observedTradingDates,
    universeMembership: input.universeMembership
  };
}

function verifiedDependencies(): {
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
    rangeEnd: "2025-01-06T23:59:59.999Z",
    timezoneOffsetMinutes: 0,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableMarketSymbolCounts: {},
    minAvailableAssetTypeSymbolCounts: {},
    minAvailableStrategyBucketSymbolCounts: {},
    requireOptionalSymbols: false,
    requiredMarkets: ["KR" as const],
    requiredAssetTypes: [],
    requiredStrategyBuckets: ["short_term" as const],
    corruptLineCount: 0 as const,
    availableStrategyBuckets: ["short_term" as const]
  };
  const officialCalendarArtifact = officialArtifact();
  return {
    source: {
      coverage,
      hashes: {
        expansionDataSnapshotHash: hash("1"),
        expansionUniverseHash: hash("2"),
        expansionCoverageHash: createReplayResearchHash(coverage),
        validationSplitHash: hash("3")
      }
    },
    calendarClassifier: {
      officialCalendarArtifact,
      hashes: {
        calendarHash: hash("4"),
        officialCalendarArtifactHash:
          officialCalendarArtifact.artifactHash,
        marketRegimeClassifierHash: hash("5")
      }
    }
  };
}

function officialArtifact() {
  const payload: OfficialMarketCalendarEvidencePayload = {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-01-01T12:00:00.000Z",
    coverage: {
      startDate: "2025-01-01",
      endDate: "2025-01-06",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      {
        sourceId: "official.krx",
        evidenceClass: "official_exchange",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        publisher: "KRX",
        sourceUrl: "https://example.com/krx",
        sourceDocumentHash: hash("8"),
        retrievedAt: "2025-01-01T00:00:00.000Z",
        staleAfter: "2025-02-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:00",
          closeLocalTime: "15:30"
        }
      },
      {
        sourceId: "official.nyse",
        evidenceClass: "official_exchange",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        publisher: "NYSE",
        sourceUrl: "https://example.com/nyse",
        sourceDocumentHash: hash("7"),
        retrievedAt: "2025-01-01T00:00:00.000Z",
        staleAfter: "2025-02-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:30",
          closeLocalTime: "16:00"
        }
      }
    ],
    sessions: [
      officialSession("KR", "2025-01-01", "holiday"),
      officialSession("KR", "2025-01-02", "regular"),
      officialSession("KR", "2025-01-03", "regular"),
      officialSession("KR", "2025-01-04", "weekend"),
      officialSession("KR", "2025-01-05", "weekend"),
      officialSession("KR", "2025-01-06", "regular"),
      officialSession("US", "2025-01-01", "holiday"),
      officialSession("US", "2025-01-02", "holiday"),
      officialSession("US", "2025-01-03", "holiday"),
      officialSession("US", "2025-01-04", "weekend"),
      officialSession("US", "2025-01-05", "weekend"),
      officialSession("US", "2025-01-06", "holiday")
    ]
  };
  return parseOfficialMarketCalendarEvidenceArtifact(
    {
      ...payload,
      artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
    },
    { asOf: "2025-01-02T00:00:00.000Z" }
  );
}

function officialSession(
  market: "KR" | "US",
  sessionDate: string,
  sessionType: "regular" | "holiday" | "weekend"
): OfficialMarketCalendarEvidencePayload["sessions"][number] {
  const closed = sessionType !== "regular";
  const kr = market === "KR";
  return {
    sessionId: `${kr ? "krx" : "nyse"}.${sessionDate}`,
    sourceId: kr ? "official.krx" : "official.nyse",
    exchange: kr ? "KRX" : "NYSE",
    market,
    timezone: kr ? "Asia/Seoul" : "America/New_York",
    sessionDate,
    sessionType,
    marketOpen: closed
      ? null
      : kr
        ? `${sessionDate}T09:00:00+09:00`
        : `${sessionDate}T09:30:00-05:00`,
    marketClose: closed
      ? null
      : kr
        ? `${sessionDate}T15:30:00+09:00`
        : `${sessionDate}T16:00:00-05:00`,
    exceptionName:
      sessionType === "holiday" ? "fixture holiday" : null
  };
}

function tradingDate(
  sessionDate: string
): EvidenceExpansionObservedTradingDate {
  return { market: "KR", sessionDate };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
