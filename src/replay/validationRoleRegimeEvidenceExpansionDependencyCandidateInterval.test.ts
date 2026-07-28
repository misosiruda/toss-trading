import assert from "node:assert/strict";
import test from "node:test";

import type { Market, Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  parseOfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionDependencyCandidateInterval
} from "./validationRoleRegimeEvidenceExpansionDependencyCandidateInterval.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
  type EvidenceExpansionObservedTradingDate
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
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

test("dependency candidate interval joins canonical group evidence", () => {
  const dates = canonicalTradingDates();
  const group = evidenceGroup([
    variant("2", dates.sessions, [
      { market: "US", symbol: "AAPL" }
    ]),
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);

  const result =
    buildEvidenceExpansionDependencyCandidateInterval({
      group,
      ...verifiedDependencies()
    });

  assert.deepEqual(
    result.sourceVariants.map(
      (variantReference) => variantReference.sourceVariantHash
    ),
    [hash("1"), hash("2")]
  );
  assert.deepEqual(result.splitRoles, ["train", "validation"]);
  assert.equal(
    result.canonicalTradingDatesHash,
    dates.canonicalTradingDatesHash
  );
  assert.equal(
    result.combinedUniverseMembershipHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: [
        { market: "KR", symbol: "005930" },
        { market: "US", symbol: "AAPL" }
      ]
    })
  );
});

test("dependency candidate interval rejects trading-date conflicts", () => {
  const dates = canonicalTradingDates();
  const staleReference = evidenceGroup([
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);
  staleReference.sourceVariants[0]!.sourceVariant
    .observedTradingDatesHash = hash("f");
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group: staleReference,
        ...verifiedDependencies()
      }),
    /trading-date set conflict/
  );

  const differentSet = evidenceGroup([
    variant(
      "1",
      [{ market: "KR", sessionDate: "2025-01-03" }],
      [{ market: "KR", symbol: "005930" }]
    )
  ]);
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group: differentSet,
        ...verifiedDependencies()
      }),
    /trading-date set conflict/
  );
});

test("dependency candidate interval rejects unverified dependencies", () => {
  const dates = canonicalTradingDates();
  const group = evidenceGroup([
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);
  const dependencies = verifiedDependencies();
  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        ...dependencies,
        calendarClassifier: {
          ...dependencies.calendarClassifier,
          officialCalendarArtifact: null
        }
      }),
    /requires official calendar evidence/
  );

  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        ...dependencies,
        source: {
          ...dependencies.source,
          hashes: {
            ...dependencies.source.hashes,
            expansionCoverageHash: hash("f")
          }
        }
      }),
    /coverage hash mismatch/
  );

  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        ...dependencies,
        calendarClassifier: {
          ...dependencies.calendarClassifier,
          hashes: {
            ...dependencies.calendarClassifier.hashes,
            officialCalendarArtifactHash: hash("f")
          }
        }
      }),
    /official calendar hash mismatch/
  );

  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        ...dependencies,
        calendarClassifier: {
          ...dependencies.calendarClassifier,
          officialCalendarArtifact: {
            ...dependencies.calendarClassifier.officialCalendarArtifact!,
            generatedAt: "2025-01-01T13:00:00.000Z"
          }
        }
      }),
    /official calendar hash mismatch/
  );
});

test("dependency candidate interval preserves upstream membership gates", () => {
  const dates = canonicalTradingDates();
  const group = evidenceGroup([
    variant("1", dates.sessions, [
      { market: "KR", symbol: "005930" }
    ])
  ]);
  group.sourceVariants[0]!.sourceVariant.universeMembershipHash =
    hash("f");

  assert.throws(
    () =>
      buildEvidenceExpansionDependencyCandidateInterval({
        group,
        ...verifiedDependencies()
      }),
    /membership hash mismatch/
  );
});

function evidenceGroup(
  sourceVariants: EvidenceExpansionSourceCandidateVariant[]
): EvidenceExpansionAcceptedEvidenceGroup {
  return {
    evidenceGroupHash: hash("a"),
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T14:30:00.000Z",
    targetRegime: "bull",
    splitRoles: ["train", "validation"],
    sourceVariants
  };
}

function canonicalTradingDates(
  sessions: EvidenceExpansionObservedTradingDate[] = [
    { market: "KR", sessionDate: "2025-01-02" },
    { market: "US", sessionDate: "2025-01-03" }
  ]
): {
  sessions: EvidenceExpansionObservedTradingDate[];
  canonicalTradingDatesHash: Sha256Hash;
} {
  return {
    sessions,
    canonicalTradingDatesHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions
    })
  };
}

function verifiedDependencies(requiredMarkets: Market[] = ["KR", "US"]): {
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
    rangeEnd: "2025-01-31T23:59:59.999Z",
    timezoneOffsetMinutes: 0,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableMarketSymbolCounts: {},
    minAvailableAssetTypeSymbolCounts: {},
    minAvailableStrategyBucketSymbolCounts: {},
    requireOptionalSymbols: false,
    requiredMarkets,
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

function officialArtifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload: OfficialMarketCalendarEvidencePayload = {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-01-01T12:00:00.000Z",
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
  return parseOfficialMarketCalendarEvidenceArtifact(
    {
      ...payload,
      artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
    },
    { asOf: "2025-01-02T00:00:00.000Z" }
  );
}

function officialSource(
  market: Market
): OfficialMarketCalendarEvidencePayload["sources"][number] {
  const kr = market === "KR";
  return {
    sourceId: kr ? "official.krx" : "official.nyse",
    evidenceClass: "official_exchange",
    exchange: kr ? "KRX" : "NYSE",
    market,
    timezone: kr ? "Asia/Seoul" : "America/New_York",
    publisher: kr ? "KRX" : "NYSE",
    sourceUrl: kr
      ? "https://example.com/krx"
      : "https://example.com/nyse",
    sourceDocumentHash: hash(kr ? "a" : "b"),
    retrievedAt: "2025-01-01T00:00:00.000Z",
    staleAfter: "2025-02-01T00:00:00.000Z",
    regularSession: {
      openLocalTime: kr ? "09:00" : "09:30",
      closeLocalTime: kr ? "15:30" : "16:00"
    }
  };
}

function officialSession(
  market: Market,
  sessionDate: string,
  sessionType: "regular" | "holiday" = "regular"
): OfficialMarketCalendarEvidencePayload["sessions"][number] {
  const kr = market === "KR";
  const closed = sessionType === "holiday";
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
    exceptionName: closed ? "fixture holiday" : null
  };
}

function variant(
  sourceCharacter: string,
  observedTradingDates: EvidenceExpansionObservedTradingDate[],
  universeMembership: EvidenceExpansionUniverseMember[]
): EvidenceExpansionSourceCandidateVariant {
  return {
    evidenceGroupHash: hash("a"),
    sourceVariant: {
      feasibilityCandidateHash: hash(sourceCharacter),
      legacyReplayPlanEvidenceGroupHash: null,
      sourceVariantHashVersion:
        "evidence_expansion_source_variant.v1",
      sourceVariantHash: hash(sourceCharacter),
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
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
