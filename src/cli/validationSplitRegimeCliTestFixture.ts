import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  assessHistoricalUniverseCoverage,
  historicalUniverseManifestSchema
} from "../replay/historicalUniverseCoverage.js";
import type { ValidationSplitAssignment } from "../replay/validationProtocol.js";
import { createStoragePaths } from "../storage/repositories.js";

export function createValidationSplitRegimeCliFixture(
  t: TestContext,
  options: { includeUsMarket?: boolean } = {}
) {
  const directory = mkdtempSync(join(tmpdir(), "feasibility-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceDataDir = join(directory, "source");
  const universePath = join(directory, "universe.json");
  const coveragePath = join(directory, "coverage.json");
  const validationSplitsPath = join(directory, "validation-splits.json");
  const calendarFixturesPath = join(directory, "calendar.json");
  const outputPath = join(directory, "output", "feasibility.json");
  const sessionDates = [
    "2025-01-02",
    "2025-01-31",
    "2025-02-03",
    "2025-02-28",
    "2025-03-04",
    "2025-03-31"
  ];
  const krSnapshots = sessionDates.map((sessionDate, index) =>
    snapshot(
      `snapshot-${index}`,
      `${sessionDate}T0${index % 2 === 0 ? "1" : "5"}:00:00.000Z`,
      index % 2 === 0 ? 100 : 105
    )
  );
  const snapshots = options.includeUsMarket
    ? [
        ...krSnapshots,
        ...sessionDates.map((sessionDate, index) =>
          snapshot(
            `us-snapshot-${index}`,
            `${sessionDate}T1${index % 2 === 0 ? "5" : "9"}:00:00.000Z`,
            index % 2 === 0 ? 200 : 210,
            "US",
            "US-TEST"
          )
        )
      ]
    : krSnapshots;
  const universeSource = {
    mode: "paper_only_historical_universe",
    universeId: "cli-test",
    snapshotDate: "2025-01-01",
    symbols: [
      {
        market: "KR",
        symbol: "TEST",
        strategyBucket: "short_term",
        required: true
      },
      ...(options.includeUsMarket
        ? [
            {
              market: "US" as const,
              symbol: "US-TEST",
              strategyBucket: "short_term" as const,
              required: true
            }
          ]
        : [])
    ],
    disclaimer: "Paper-only CLI test universe."
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
  const assignments = validationAssignments();
  const fixtures = sessionDates.map((sessionDate) => ({
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
  }));
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    createStoragePaths(sourceDataDir).historicalMarketSnapshotsPath,
    `${snapshots.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8"
  );
  writeFileSync(universePath, `${JSON.stringify(universeSource)}\n`, "utf8");
  writeFileSync(coveragePath, `${JSON.stringify(coverage)}\n`, "utf8");
  writeFileSync(
    validationSplitsPath,
    `${JSON.stringify({ assignments })}\n`,
    "utf8"
  );
  writeFileSync(
    calendarFixturesPath,
    `${JSON.stringify(fixtures)}\n`,
    "utf8"
  );

  return {
    directory,
    sourceDataDir,
    universePath,
    coveragePath,
    validationSplitsPath,
    calendarFixturesPath,
    outputPath,
    args: [
      "--source-data-dir",
      sourceDataDir,
      "--universe-path",
      universePath,
      "--coverage-path",
      coveragePath,
      "--validation-splits-path",
      validationSplitsPath,
      "--calendar-fixtures-path",
      calendarFixturesPath,
      "--calendar-rule",
      "KR:KRX:Asia/Seoul",
      "--candidate-strategy-bucket",
      "short_term",
      "--window-months",
      "1",
      "--timezone-offset-minutes",
      "540",
      "--target-regimes",
      "bull",
      "--min-candidates-per-role-regime",
      "1",
      "--output-path",
      outputPath
    ]
  };
}

function snapshot(
  snapshotId: string,
  observedAt: string,
  lastPriceKrw: number,
  market: "KR" | "US" = "KR",
  symbol = "TEST"
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market,
    symbol,
    observedAt,
    interval: "1m",
    strategyBucket: "short_term",
    lastPriceKrw,
    volume: 1_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function validationAssignments(): ValidationSplitAssignment[] {
  const base = {
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
  return (["train", "validation", "test"] as const).map((splitRole) => ({
    ...base,
    splitRole
  }));
}
