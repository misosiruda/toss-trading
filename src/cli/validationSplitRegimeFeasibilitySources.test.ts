import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  assessHistoricalUniverseCoverage,
  historicalUniverseManifestSchema
} from "../replay/historicalUniverseCoverage.js";
import type { ValidationSplitAssignment } from "../replay/validationProtocol.js";
import { createStoragePaths } from "../storage/repositories.js";
import { readValidationSplitRegimeFeasibilitySources } from "./validationSplitRegimeFeasibilitySources.js";

test("feasibility source parser loads schema-valid read-only inputs", async (t) => {
  const fixture = await createSourceFixture(t);

  const sources = await readValidationSplitRegimeFeasibilitySources(
    fixture.paths
  );

  assert.equal(sources.snapshots.length, 1);
  assert.deepEqual(sources.universeSource, fixture.universeSource);
  assert.equal(sources.universe.universeId, "parser-test");
  assert.equal(sources.coverage.status, "available");
  assert.equal(sources.assignments.length, 3);
  assert.deepEqual(
    sources.assignments.map((assignment) => assignment.splitRole),
    ["train", "validation", "test"]
  );
  assert.equal(sources.calendarFixtures[0]?.calendarId, "krx-2025-01-02");
});

test("feasibility source parser rejects corrupt snapshot JSONL", async (t) => {
  const fixture = await createSourceFixture(t);
  const snapshotPath = createStoragePaths(
    fixture.paths.sourceDataDir
  ).historicalMarketSnapshotsPath;
  await writeFile(snapshotPath, `${JSON.stringify(fixture.snapshot)}\nnot-json\n`);

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    /historical snapshot source contains 1 corrupt line/
  );
});

test("feasibility source parser rejects missing snapshot source", async (t) => {
  const fixture = await createSourceFixture(t);
  const snapshotPath = createStoragePaths(
    fixture.paths.sourceDataDir
  ).historicalMarketSnapshotsPath;
  await rm(snapshotPath);

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );
});

test("feasibility source parser rejects empty snapshot source", async (t) => {
  const fixture = await createSourceFixture(t);
  const snapshotPath = createStoragePaths(
    fixture.paths.sourceDataDir
  ).historicalMarketSnapshotsPath;
  await writeFile(snapshotPath, "", "utf8");

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    /historical snapshot source must not be empty/
  );
});

test("feasibility source parser rejects malformed coverage", async (t) => {
  const fixture = await createSourceFixture(t);
  await writeFile(fixture.paths.coveragePath, "{}\n", "utf8");

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    /historical coverage source/
  );
});

test("feasibility source parser rejects malformed calendar JSONL", async (t) => {
  const fixture = await createSourceFixture(t);
  await writeFile(
    fixture.paths.calendarFixturesPath,
    `${JSON.stringify(calendarFixture())}\nnot-json\n`,
    "utf8"
  );

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    /calendar fixture JSONL line 2 must contain valid JSON/
  );
});

test("feasibility source parser rejects malformed universe", async (t) => {
  const fixture = await createSourceFixture(t);
  await writeFile(fixture.paths.universePath, "{}\n", "utf8");

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    /historical universe source/
  );
});

test("feasibility source parser rejects malformed validation split", async (t) => {
  const fixture = await createSourceFixture(t);
  await writeFile(
    fixture.paths.validationSplitsPath,
    '{"assignments":[{}]}\n',
    "utf8"
  );

  await assert.rejects(
    readValidationSplitRegimeFeasibilitySources(fixture.paths),
    /validation split source/
  );
});

async function createSourceFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "feasibility-sources-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceDataDir = join(directory, "source");
  const paths = {
    sourceDataDir,
    universePath: join(directory, "universe.json"),
    coveragePath: join(directory, "coverage.json"),
    validationSplitsPath: join(directory, "validation-splits.json"),
    calendarFixturesPath: join(directory, "calendar.json")
  };
  const snapshot = historicalSnapshot();
  const universeSource = {
    mode: "paper_only_historical_universe",
    universeId: "parser-test",
    snapshotDate: "2025-01-01",
    symbols: [
      {
        market: "KR",
        symbol: "TEST",
        strategyBucket: "short_term",
        required: true
      }
    ],
    disclaimer: "Paper-only parser test universe."
  } as const;
  const universe = historicalUniverseManifestSchema.parse(universeSource);
  const coverage = assessHistoricalUniverseCoverage({
    snapshots: [snapshot],
    universe,
    rangeStart: new Date(snapshot.observedAt),
    rangeEnd: new Date(snapshot.observedAt),
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
  const snapshotPath = createStoragePaths(sourceDataDir)
    .historicalMarketSnapshotsPath;

  await mkdir(sourceDataDir, { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  await Promise.all([
    writeFile(paths.universePath, `${JSON.stringify(universeSource)}\n`, "utf8"),
    writeFile(paths.coveragePath, `${JSON.stringify(coverage)}\n`, "utf8"),
    writeFile(
      paths.validationSplitsPath,
      `${JSON.stringify({ assignments })}\n`,
      "utf8"
    ),
    writeFile(
      paths.calendarFixturesPath,
      `${JSON.stringify([calendarFixture()])}\n`,
      "utf8"
    )
  ]);
  return { paths, snapshot, universeSource };
}

function historicalSnapshot(): HistoricalMarketSnapshot {
  return {
    snapshotId: "snapshot-1",
    market: "KR",
    symbol: "TEST",
    observedAt: "2025-01-02T06:30:00.000Z",
    interval: "1d",
    strategyBucket: "short_term",
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: ["fixture:snapshot-1"],
    createdAt: "2025-01-02T06:30:00.000Z"
  };
}

function validationAssignments(): ValidationSplitAssignment[] {
  return (["train", "validation", "test"] as const).map((splitRole) => ({
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole,
    trainStart: "2024-01-01T00:00:00.000Z",
    trainEnd: "2024-06-30T23:59:59.999Z",
    validationStart: "2024-07-01T00:00:00.000Z",
    validationEnd: "2024-09-30T23:59:59.999Z",
    testStart: "2024-10-01T00:00:00.000Z",
    testEnd: "2024-12-31T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  }));
}

function calendarFixture() {
  return {
    calendarId: "krx-2025-01-02",
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate: "2025-01-02",
    marketOpen: "2025-01-02T00:00:00.000Z",
    marketClose: "2025-01-02T06:30:00.000Z",
    isHoliday: false,
    sourceRefs: ["fixture:calendar"],
    createdAt: "2025-01-01T00:00:00.000Z"
  };
}
