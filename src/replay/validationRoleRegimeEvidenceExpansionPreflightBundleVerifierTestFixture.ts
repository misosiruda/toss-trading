import { DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG } from "../analytics/marketRegimeClassifier.js";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  assessHistoricalUniverseCoverage,
  historicalUniverseManifestSchema
} from "./historicalUniverseCoverage.js";
import { parseMarketCalendarFixture } from "./marketCalendar.js";
import type { EvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";
import {
  buildValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import {
  buildValidationRoleRegimeStatisticalReadinessArtifact
} from "./validationRoleRegimeStatisticalReadiness.js";
import {
  buildValidationSplitRegimeFeasibilityArtifact,
  type BuildValidationSplitRegimeFeasibilityArtifactOptions
} from "./validationSplitRegimeFeasibility.js";

type SourceOptions = Pick<
  BuildValidationSplitRegimeFeasibilityArtifactOptions,
  "snapshots" | "universe" | "coverage" | "validationSplit"
>;

export interface EvidenceExpansionPreflightBundleTestFixture {
  baseline: {
    feasibilityArtifact: object;
    planArtifact: object;
    readinessArtifact: object;
    snapshots: SourceOptions["snapshots"];
    universe: SourceOptions["universe"];
    coverage: SourceOptions["coverage"];
    validationSplitSource: SourceOptions["validationSplit"];
  };
  expansion: {
    snapshots: SourceOptions["snapshots"];
    universe: SourceOptions["universe"];
    coverage: SourceOptions["coverage"];
    validationSplitSource: SourceOptions["validationSplit"];
  };
  calendarValidation: object;
  marketRegimeClassifier: object;
  targetMatrix: EvidenceExpansionTargetMatrix;
  dependencyDiagnosticPolicy: {
    version: "overlap_adjacency_inputs.v1";
  };
}

export function createEvidenceExpansionPreflightBundleTestFixture(): EvidenceExpansionPreflightBundleTestFixture {
  const options = feasibilityBuilderOptions();
  const feasibilityArtifact =
    buildValidationSplitRegimeFeasibilityArtifact(options);
  const planArtifact = buildValidationRoleRegimeReplayPlan({
    feasibilityArtifact,
    validationAssignments: options.assignments,
    generatedAt: "2026-07-22T00:00:00.000Z",
    calendarEvidenceClass: "observed_session_only"
  });
  const readinessArtifact =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: "2026-07-23T00:00:00.000Z",
      planHash: planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: planArtifact.summary.plannedRunCount,
        globalUniqueEvidenceGroupCount:
          planArtifact.summary.globalUniqueEvidenceGroupCount,
        crossRoleSharedEvidenceGroupCount:
          planArtifact.summary.crossRoleSharedEvidenceGroupCount
      },
      evidenceRows: planArtifact.runs.map((run) => ({
        splitRole: run.splitRole,
        targetRegime: run.targetRegime,
        evidenceGroupHash: run.evidenceGroupHash
      }))
    });
  const source = {
    snapshots: options.snapshots,
    universe: options.universe,
    coverage: options.coverage,
    validationSplitSource: options.validationSplit
  };

  return {
    baseline: {
      feasibilityArtifact,
      planArtifact,
      readinessArtifact,
      ...structuredClone(source)
    },
    expansion: structuredClone(source),
    calendarValidation: structuredClone(options.calendarValidation),
    marketRegimeClassifier: {
      version: "market_regime_classifier.v1",
      ...DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG
    },
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null
    }),
    dependencyDiagnosticPolicy: {
      version: "overlap_adjacency_inputs.v1"
    }
  };
}

function feasibilityBuilderOptions(): BuildValidationSplitRegimeFeasibilityArtifactOptions {
  const baseAssignment = {
    validationProtocol: "walk_forward" as const,
    splitId: "split-0",
    splitIndex: 0,
    trainStart: "2025-01-01T00:00:00+09:00",
    trainEnd: "2025-01-31T23:59:59.999+09:00",
    validationStart: "2025-02-01T00:00:00+09:00",
    validationEnd: "2025-02-28T23:59:59.999+09:00",
    testStart: "2025-03-01T00:00:00+09:00",
    testEnd: "2025-03-31T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
  const sessionDates = [
    "2025-01-02",
    "2025-01-31",
    "2025-02-03",
    "2025-02-28",
    "2025-03-04",
    "2025-03-31"
  ];
  const snapshots = sessionDates.map((sessionDate, index) =>
    snapshot({
      snapshotId: `bundle-snapshot-${index}`,
      observedAt: `${sessionDate}T00:00:00.000Z`,
      lastPriceKrw: index % 2 === 0 ? 100 : 105
    })
  );
  const calendarFixtures = sessionDates.map((sessionDate) =>
    parseMarketCalendarFixture({
      calendarId: `calendar.krx.${sessionDate}`,
      exchange: "KRX",
      market: "KR",
      timezone: "Asia/Seoul",
      sessionDate,
      marketOpen: `${sessionDate}T00:00:00.000Z`,
      marketClose: `${sessionDate}T06:30:00.000Z`,
      isHoliday: false,
      sourceRefs: [`fixture:calendar.krx.${sessionDate}`],
      createdAt: "2026-07-20T00:00:00.000Z"
    })
  );
  const assignments = (["train", "validation", "test"] as const).map(
    (splitRole) => ({ ...baseAssignment, splitRole })
  );
  const universeSource = {
    mode: "paper_only_historical_universe",
    universeId: "bundle-universe",
    snapshotDate: "2025-01-01",
    symbols: [
      {
        market: "KR",
        symbol: "TEST",
        strategyBucket: "short_term",
        required: true
      }
    ],
    disclaimer: "Paper-only preflight bundle fixture."
  } as const;
  const universe = historicalUniverseManifestSchema.parse(universeSource);
  const coverage = assessHistoricalUniverseCoverage({
    snapshots,
    universe,
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

  return {
    generatedAt: "2026-07-20T00:00:00.000Z",
    assignments,
    snapshots,
    universe: universeSource,
    coverage,
    validationSplit: { assignments },
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "KRX",
          timezone: "Asia/Seoul"
        }
      ],
      fixtures: calendarFixtures
    },
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    targetRegimes: ["bull"],
    candidateStrategyBucket: "short_term",
    minimumCandidatesPerRoleRegime: 1
  };
}

function snapshot(input: {
  snapshotId: string;
  observedAt: string;
  lastPriceKrw: number;
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: "TEST",
    observedAt: input.observedAt,
    interval: "1d",
    lastPriceKrw: input.lastPriceKrw,
    volume: 1_000,
    strategyBucket: "short_term",
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: input.observedAt
  };
}
