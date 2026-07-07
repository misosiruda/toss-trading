import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualDecision
} from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "../replay/validationProtocol.js";
import { parseMarketCalendarFixture } from "../replay/marketCalendar.js";
import { parseFxRateSnapshotFixture } from "../replay/fxSnapshotFreshness.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { runHistoricalBatchReplay } from "./historicalBatchReplayWorkflow.js";

test("historical batch replay runner clears stale derived artifacts", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_stale", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );

  const outputDir = join(outputBaseDir, "batch-stale-artifacts");
  const tripleBarrierLabelPath = join(
    outputDir,
    "triple-barrier-label-report.json"
  );
  const metaLabelEvaluationPath = join(
    outputDir,
    "meta-label-evaluation-report.json"
  );
  await mkdir(outputDir, { recursive: true });
  await writeFile(tripleBarrierLabelPath, "{}\n", "utf8");
  await writeFile(metaLabelEvaluationPath, "{}\n", "utf8");

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-stale-artifacts",
    seed: "seed-stale",
    runCount: 1,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1
  });

  assert.equal(result.status, "completed");
  await assert.rejects(
    () => readFile(tripleBarrierLabelPath, "utf8"),
    isFileNotFoundError
  );
  await assert.rejects(
    () => readFile(metaLabelEvaluationPath, "utf8"),
    isFileNotFoundError
  );
});

test("historical batch replay runner writes manifest and per-run records", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-smoke",
    seed: "seed-001",
    runCount: 2,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const trialRecords = await readJsonl(result.selectionTrialsPath);
  const firstRecord = runRecords[0]!;
  const firstReport = JSON.parse(
    await readFile(String(firstRecord["reportPath"]), "utf8")
  ) as Record<string, unknown>;
  const firstSummary = firstRecord["summary"] as Record<string, unknown>;
  const firstSummaryCost = firstSummary["costSummary"] as Record<string, unknown>;
  const firstReportCost = firstReport["costSummary"] as Record<string, unknown>;
  const firstAdvancedPerformance = firstReport[
    "advancedPerformance"
  ] as Record<string, unknown>;
  const firstMetadata = JSON.parse(
    await readFile(
      join(
        String(firstRecord["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const firstResearchManifest = JSON.parse(
    await readFile(
      join(
        String(firstRecord["storageBaseDir"]),
        "historical-replay-research-manifest.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const firstIdentity = firstMetadata["identity"] as Record<string, unknown>;
  const firstWindow = firstMetadata["window"] as Record<string, unknown>;
  const firstRecordResearchManifest = firstRecord["researchManifest"] as Record<
    string,
    unknown
  >;
  const firstMetadataResearchManifest = firstMetadata[
    "researchManifest"
  ] as Record<string, unknown>;

  assert.equal(result.status, "completed");
  assert.equal(result.runCount, 2);
  assert.equal(result.completedCount, 2);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(manifest["status"], "completed");
  assert.equal(manifest["completedCount"], 2);
  assert.equal(manifest["riskProfile"], null);
  assert.equal(manifest["paperExitPolicy"], null);
  assert.equal(
    (manifest["windowSampling"] as Record<string, unknown>)["mode"],
    "random"
  );
  assert.equal(manifest["validationProtocol"], null);
  assert.equal(runRecords.length, 2);
  assert.equal(trialRecords.length, 2);
  assert.equal(firstRecord["status"], "completed");
  assert.equal(trialRecords[0]?.["status"], "completed");
  assert.equal(trialRecords[0]?.["trialSchemaVersion"], "selection_trial.v1");
  assert.equal(
    (firstRecord["windowSampling"] as Record<string, unknown>)["mode"],
    "random"
  );
  assert.equal(firstRecord["validationSplit"], null);
  assert.equal(
    (firstRecord["window"] as Record<string, unknown>)["selectedMonth"],
    "2025-02"
  );
  assert.equal(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["status"],
    "available"
  );
  assert.equal(
    (firstRecord["marketRegime"] as Record<string, unknown>)["label"],
    "bull"
  );
  assert.ok(firstRecord["summary"]);
  assert.equal(
    firstSummary["totalReturnRatio"],
    firstAdvancedPerformance["totalReturnRatio"]
  );
  assert.equal(firstSummaryCost["totalCostKrw"], firstReportCost["totalCostKrw"]);
  assert.deepEqual(
    firstSummaryCost["costModelVersions"],
    firstReportCost["costModelVersions"]
  );
  assert.equal(firstRecordResearchManifest["status"], "available");
  assert.match(
    String(firstRecordResearchManifest["manifestPath"]),
    /historical-replay-research-manifest\.json$/
  );
  assert.equal(
    firstRecordResearchManifest["configHash"],
    firstResearchManifest["configHash"]
  );
  assert.equal(
    firstMetadataResearchManifest["configHash"],
    firstResearchManifest["configHash"]
  );
  assert.equal(
    (
      trialRecords[0]?.["decisionProvider"] as Record<string, unknown>
    )["mode"],
    "deterministic_fixture"
  );
  assert.equal(
    (
      trialRecords[0]?.["decisionProvider"] as Record<string, unknown>
    )["promptHash"],
    firstResearchManifest["promptHash"]
  );
  assert.equal(
    (trialRecords[0]?.["config"] as Record<string, unknown>)["configHash"],
    firstResearchManifest["configHash"]
  );
  assert.equal(
    (trialRecords[0]?.["selection"] as Record<string, unknown>)["selected"],
    false
  );
  assert.equal(firstIdentity["batchId"], "batch-smoke");
  assert.equal(firstIdentity["runIndex"], 0);
  assert.equal(firstWindow["source"], "random_window");
  assert.equal(firstWindow["selectedMonth"], "2025-02");
});

test("historical batch replay runner records validation split assignments", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-split-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-split-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_train", "005930", "2025-01-10T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot(
      "hist_005930_validation",
      "005930",
      "2025-02-10T09:00:00+09:00",
      74_000
    )
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-split",
    seed: "seed-split",
    runCount: 2,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    validationSplitAssignments: [
      validationAssignment("train", 5),
      validationAssignment("validation")
    ]
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const manifestValidation = manifest["validationProtocol"] as Record<
    string,
    unknown
  >;

  assert.equal(result.status, "completed");
  assert.deepEqual(manifestValidation, {
    validationProtocol: "walk_forward",
    assignmentCount: 2,
    roleCounts: {
      train: 1,
      validation: 1
    }
  });
  assert.equal(
    (manifest["windowSampling"] as Record<string, unknown>)["mode"],
    "fixed_range"
  );
  assert.equal(
    (runRecords[0]?.["validationSplit"] as Record<string, unknown>)["splitRole"],
    "train"
  );
  assert.equal(
    (runRecords[0]?.["window"] as Record<string, unknown>)["startAt"],
    "2024-12-31T15:00:00.000Z"
  );
  assert.equal(
    (runRecords[0]?.["window"] as Record<string, unknown>)["endAt"],
    "2025-01-26T14:59:59.999Z"
  );
  assert.equal(
    (runRecords[0]?.["window"] as Record<string, unknown>)["localStartDate"],
    "2025-01-01"
  );
  assert.equal(
    (runRecords[0]?.["window"] as Record<string, unknown>)["localEndDate"],
    "2025-01-26"
  );
  assert.equal(
    (runRecords[1]?.["validationSplit"] as Record<string, unknown>)["splitRole"],
    "validation"
  );
  assert.equal(
    (runRecords[1]?.["window"] as Record<string, unknown>)["startAt"],
    "2025-01-31T15:00:00.000Z"
  );
  assert.equal(
    (runRecords[1]?.["window"] as Record<string, unknown>)["localStartDate"],
    "2025-02-01"
  );
});

test("historical batch replay runner skips insufficient windows", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-skip",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1
  });
  const runRecords = await readJsonl(result.runsPath);
  const trialRecords = await readJsonl(result.selectionTrialsPath);
  const firstRecord = runRecords[0]!;
  const firstTrial = trialRecords[0]!;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(firstRecord["status"], "skipped");
  assert.equal(firstTrial["status"], "skipped");
  assert.equal(
    (firstTrial["outcome"] as Record<string, unknown>)["skipReason"],
    "DATA_INSUFFICIENT"
  );
  assert.equal(
    (firstRecord["researchManifest"] as Record<string, unknown>)["status"],
    "partial"
  );
  assert.equal(
    (firstTrial["researchManifest"] as Record<string, unknown>)["status"],
    "partial"
  );
  assert.equal(firstRecord["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(firstRecord["reportPath"], null);
  assert.equal(
    (firstRecord["marketRegime"] as Record<string, unknown>)["label"],
    "insufficient_data"
  );
  assert.deepEqual(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["issues"],
    ["WINDOW_SNAPSHOT_MISSING", "WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM"]
  );
});

test("historical batch replay runner skips windows rejected by calendar validation", async () => {
  const sourceDataDir = await mkdtemp(
    join(tmpdir(), "batch-replay-calendar-source-")
  );
  const outputBaseDir = await mkdtemp(
    join(tmpdir(), "batch-replay-calendar-output-")
  );
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot(
      "hist_005930_holiday",
      "005930",
      "2025-02-03T09:00:00+09:00",
      70_000
    )
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-calendar-skip",
    seed: "seed-calendar",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1,
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "KRX",
          timezone: "Asia/Seoul"
        }
      ],
      fixtures: [
        parseMarketCalendarFixture({
          calendarId: "calendar.krx.2025-02-03",
          exchange: "KRX",
          market: "KR",
          timezone: "Asia/Seoul",
          sessionDate: "2025-02-03",
          marketOpen: null,
          marketClose: null,
          isHoliday: true,
          holidayName: "KRX holiday fixture",
          sourceRefs: ["manual_calendar_fixture:KRX:2025-02-03"],
          createdAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    }
  });
  const runRecords = await readJsonl(result.runsPath);
  const trialRecords = await readJsonl(result.selectionTrialsPath);
  const firstRecord = runRecords[0]!;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(firstRecord["status"], "skipped");
  assert.equal(trialRecords[0]?.["status"], "skipped");
  assert.equal(firstRecord["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(firstRecord["reportPath"], null);
  assert.deepEqual(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["issues"],
    ["CALENDAR_HOLIDAY_SAMPLE"]
  );
});

test("historical batch replay runner skips windows rejected by FX validation", async () => {
  const sourceDataDir = await mkdtemp(
    join(tmpdir(), "batch-replay-fx-source-")
  );
  const outputBaseDir = await mkdtemp(
    join(tmpdir(), "batch-replay-fx-output-")
  );
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot(
      "hist_spy_stale_fx",
      "SPY",
      "2025-02-03T14:30:00.000Z",
      70_000,
      {
        market: "US",
        sourceRefs: [
          "fixture:hist_spy_stale_fx",
          "yahoo_fx:KRW=X:2025-02-02"
        ]
      }
    )
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-fx-skip",
    seed: "seed-fx",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00.000Z"),
    rangeEnd: new Date("2025-02-28T23:59:59.999Z"),
    fixedWindow: {
      seed: "seed-fx",
      rangeStart: "2025-02-01T00:00:00.000Z",
      rangeEnd: "2025-02-28T23:59:59.999Z",
      windowMonths: 1,
      timezoneOffsetMinutes: 0,
      candidateCount: 1,
      selectedCandidateIndex: 0,
      selectedMonth: "2025-02",
      localStartDate: "2025-02-01",
      localEndDate: "2025-02-28",
      startAt: "2025-02-01T00:00:00.000Z",
      endAt: "2025-02-28T23:59:59.999Z"
    },
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1,
    fxValidation: {
      fixtures: [
        parseFxRateSnapshotFixture({
          fxId: "fx.usdkrw.2025-02-02",
          pair: "USD/KRW",
          sourceSymbol: "KRW=X",
          observedAt: "2025-02-02T00:00:00.000Z",
          rate: 1460.25,
          staleAfter: "2025-02-03T00:00:00.000Z",
          sourceRefs: ["yahoo_fx:KRW=X:2025-02-02"],
          createdAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    }
  });
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;
  const audit = await new FileAuditLog(
    createStoragePaths(String(firstRecord["storageBaseDir"])).auditLogPath
  ).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(firstRecord["status"], "skipped");
  assert.equal(firstRecord["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(
    audit.records[0]?.eventType,
    "HISTORICAL_DATA_AVAILABILITY_REJECTED"
  );
  assert.match(audit.records[0]?.summary ?? "", /VIRTUAL_FX_STALE/);
  assert.deepEqual(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["issues"],
    ["VIRTUAL_FX_STALE"]
  );
});

test("historical batch replay runner filters calendar-invalid window candidates", async () => {
  const sourceDataDir = await mkdtemp(
    join(tmpdir(), "batch-replay-calendar-filter-source-")
  );
  const outputBaseDir = await mkdtemp(
    join(tmpdir(), "batch-replay-calendar-filter-output-")
  );
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot(
      "hist_005930_202501_holiday",
      "005930",
      "2025-01-03T09:00:00+09:00",
      70_000
    )
  );
  await snapshotStore.append(
    snapshot(
      "hist_005930_202502_session",
      "005930",
      "2025-02-03T09:00:00+09:00",
      72_000
    )
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-calendar-filter",
    seed: "seed-calendar-filter",
    runCount: 1,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    minWindowSnapshots: 1,
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "KRX",
          timezone: "Asia/Seoul"
        }
      ],
      fixtures: [
        parseMarketCalendarFixture({
          calendarId: "calendar.krx.2025-01-03",
          exchange: "KRX",
          market: "KR",
          timezone: "Asia/Seoul",
          sessionDate: "2025-01-03",
          marketOpen: null,
          marketClose: null,
          isHoliday: true,
          holidayName: "KRX holiday fixture",
          sourceRefs: ["manual_calendar_fixture:KRX:2025-01-03"],
          createdAt: "2026-07-01T00:00:00.000Z"
        }),
        parseMarketCalendarFixture({
          calendarId: "calendar.krx.2025-02-03",
          exchange: "KRX",
          market: "KR",
          timezone: "Asia/Seoul",
          sessionDate: "2025-02-03",
          marketOpen: "2025-02-03T00:00:00.000Z",
          marketClose: "2025-02-03T06:30:00.000Z",
          isHoliday: false,
          sourceRefs: ["manual_calendar_fixture:KRX:2025-02-03"],
          createdAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    }
  });
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;
  const window = firstRecord["window"] as Record<string, unknown>;
  const availability = firstRecord["dataAvailability"] as Record<
    string,
    unknown
  >;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(firstRecord["status"], "completed");
  assert.equal(window["selectedMonth"], "2025-02");
  assert.equal(window["candidateCount"], 1);
  assert.deepEqual(availability["issues"], []);
});

test("historical batch replay runner preserves balanced skip when filtered targets disappear", async () => {
  const sourceDataDir = await mkdtemp(
    join(tmpdir(), "batch-replay-calendar-balanced-source-")
  );
  const outputBaseDir = await mkdtemp(
    join(tmpdir(), "batch-replay-calendar-balanced-output-")
  );
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot(
      "hist_005930_202501_bull_start",
      "005930",
      "2025-01-03T09:00:00+09:00",
      100
    )
  );
  await snapshotStore.append(
    snapshot(
      "hist_005930_202501_bull_end",
      "005930",
      "2025-01-28T09:00:00+09:00",
      106
    )
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-calendar-balanced-fallback",
    seed: "seed-calendar-balanced",
    runCount: 1,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1,
    windowSamplingMode: "balanced_regime",
    targetRegimes: ["bull"],
    calendarValidation: {
      rules: [
        {
          market: "KR",
          exchange: "KRX",
          timezone: "Asia/Seoul"
        }
      ],
      fixtures: [
        parseMarketCalendarFixture({
          calendarId: "calendar.krx.2025-01-03",
          exchange: "KRX",
          market: "KR",
          timezone: "Asia/Seoul",
          sessionDate: "2025-01-03",
          marketOpen: null,
          marketClose: null,
          isHoliday: true,
          holidayName: "KRX holiday fixture",
          sourceRefs: ["manual_calendar_fixture:KRX:2025-01-03"],
          createdAt: "2026-07-01T00:00:00.000Z"
        }),
        parseMarketCalendarFixture({
          calendarId: "calendar.krx.2025-01-28",
          exchange: "KRX",
          market: "KR",
          timezone: "Asia/Seoul",
          sessionDate: "2025-01-28",
          marketOpen: null,
          marketClose: null,
          isHoliday: true,
          holidayName: "KRX holiday fixture",
          sourceRefs: ["manual_calendar_fixture:KRX:2025-01-28"],
          createdAt: "2026-07-01T00:00:00.000Z"
        })
      ]
    }
  });
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;
  const window = firstRecord["window"] as Record<string, unknown>;
  const availability = firstRecord["dataAvailability"] as Record<
    string,
    unknown
  >;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(firstRecord["status"], "skipped");
  assert.equal(firstRecord["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(window["selectedMonth"], "2025-01");
  assert.deepEqual(availability["issues"], ["CALENDAR_HOLIDAY_SAMPLE"]);
});

test("historical batch replay runner balances windows by market regime", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  for (const item of [
    snapshot("hist_005930_202501_001", "005930", "2025-01-03T09:00:00+09:00", 100),
    snapshot("hist_005930_202501_002", "005930", "2025-01-28T09:00:00+09:00", 106),
    snapshot("hist_005930_202502_001", "005930", "2025-02-03T09:00:00+09:00", 100),
    snapshot("hist_005930_202502_002", "005930", "2025-02-28T09:00:00+09:00", 94),
    snapshot("hist_005930_202503_001", "005930", "2025-03-03T09:00:00+09:00", 10_000),
    snapshot("hist_005930_202503_002", "005930", "2025-03-28T09:00:00+09:00", 10_050)
  ]) {
    await snapshotStore.append(item);
  }

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-balanced-regime",
    seed: "seed-001",
    runCount: 3,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    windowSamplingMode: "balanced_regime",
    targetRegimes: ["bull", "bear", "sideways"]
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const manifestWindowSampling = manifest["windowSampling"] as Record<
    string,
    unknown
  >;

  assert.equal(result.completedCount, 3);
  assert.equal(manifestWindowSampling["mode"], "balanced_regime");
  assert.deepEqual(manifestWindowSampling["activeTargetRegimes"], [
    "bull",
    "bear",
    "sideways"
  ]);
  assert.deepEqual(
    runRecords.map(
      (record) =>
        (record["windowSampling"] as Record<string, unknown>)["targetRegime"]
    ),
    ["bull", "bear", "sideways"]
  );
  assert.deepEqual(
    runRecords.map(
      (record) => (record["marketRegime"] as Record<string, unknown>)["label"]
    ),
    ["bull", "bear", "sideways"]
  );
  assert.deepEqual(
    runRecords.map(
      (record) =>
        (
          (record["marketRegimesByMarket"] as Record<string, unknown>)[
            "KR"
          ] as Record<string, unknown>
        )["label"]
    ),
    ["bull", "bear", "sideways"]
  );
});

test("historical batch replay runner can inject Codex-style provider per run", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );
  const factoryContexts: Array<Record<string, unknown>> = [];

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-codex",
    seed: "seed-001",
    runCount: 2,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxDecisionCalls: 1,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    decisionProviderFactory: (context) => {
      factoryContexts.push({
        batchId: context.batchId,
        runId: context.runId,
        runIndex: context.runIndex,
        runSeed: context.runSeed,
        selectedMonth: context.window.selectedMonth
      });
      return new FakeCodexBatchProvider();
    },
    decisionProviderMetadata: {
      mode: "codex_cli",
      maxCallsPerRun: 1,
      sandbox: "read-only",
      allowWebSearch: false,
      promptPolicy: "aggressive_paper",
      promptVersion: "paper-v12-historical-replay-aggressive-paper-v1"
    }
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const manifestProvider = manifest["decisionProvider"] as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);

  assert.equal(result.completedCount, 2);
  assert.equal(factoryContexts.length, 2);
  assert.deepEqual(
    factoryContexts.map((context) => context["runIndex"]),
    [0, 1]
  );
  assert.equal(manifestProvider["mode"], "codex_cli");
  assert.equal(manifestProvider["maxCallsPerRun"], 1);
  assert.equal(manifestProvider["promptPolicy"], "aggressive_paper");
  assert.equal(
    manifestProvider["promptVersion"],
    "paper-v12-historical-replay-aggressive-paper-v1"
  );
  assert.equal(
    (runRecords[0]?.["summary"] as Record<string, unknown>)["decisionProviderCallCount"],
    1
  );
});

test("historical batch replay runner preserves unknown metadata for custom provider", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-custom-provider",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxDecisionCalls: 1,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    decisionProviderFactory: () => new FakeCodexBatchProvider()
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const manifestProvider = manifest["decisionProvider"] as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const trialRecords = await readJsonl(result.selectionTrialsPath);
  const firstRecord = runRecords[0]!;
  const firstTrial = trialRecords[0]!;
  const researchManifest = JSON.parse(
    await readFile(
      join(
        String(firstRecord["storageBaseDir"]),
        "historical-replay-research-manifest.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;

  assert.equal(result.completedCount, 1);
  assert.equal(manifestProvider["mode"], "unknown_provider");
  assert.equal(
    (firstTrial["decisionProvider"] as Record<string, unknown>)["mode"],
    "unknown_provider"
  );
  assert.deepEqual(researchManifest["warnings"], [
    "DECISION_PROVIDER_METADATA_MISSING"
  ]);
  assert.equal(
    researchManifest["promptHash"],
    createReplayResearchHash({
      mode: "unknown_provider",
      promptPolicy: null,
      promptVersion: null
    })
  );
  assert.equal(
    (firstTrial["decisionProvider"] as Record<string, unknown>)["promptHash"],
    researchManifest["promptHash"]
  );
  assert.notEqual(
    researchManifest["promptHash"],
    createReplayResearchHash({
      mode: "deterministic_fixture",
      maxCallsPerRun: null,
      sandbox: null,
      allowWebSearch: false,
      promptPolicy: null,
      promptVersion: null
    })
  );
});

test("historical batch replay runner marks AI provider failures in completed replay", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-codex-provider-failure",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxDecisionCalls: 1,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    decisionProviderFactory: () => new FailingCodexBatchProvider()
  });
  const runRecords = await readJsonl(result.runsPath);
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const firstSummary = runRecords[0]?.["summary"] as Record<string, unknown>;

  assert.equal(result.status, "completed_with_failures");
  assert.equal(manifest["status"], "completed_with_failures");
  assert.equal(result.completedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(runRecords[0]?.["status"], "completed_with_failures");
  assert.equal(runRecords[0]?.["error"], null);
  assert.equal(firstSummary["decisionProviderCallCount"], 1);
  assert.equal(firstSummary["aiDecisionFailureCount"], 1);
  assert.deepEqual(firstSummary["aiDecisionFailureReasons"], [
    "fixture provider failure"
  ]);
  assert.equal(
    firstSummary["lastAiDecisionFailureSummary"],
    "fixture provider failure"
  );
  assert.equal(firstSummary["tradeCount"], 0);
  assert.match(String(runRecords[0]?.["reportPath"]), /historical-replay-report\.json$/);
});

test("historical batch replay runner preserves failed run manifest references", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-provider-throw",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxDecisionCalls: 1,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    decisionProviderFactory: () => new ThrowingCodexBatchProvider()
  });
  const runRecords = await readJsonl(result.runsPath);
  const trialRecords = await readJsonl(result.selectionTrialsPath);
  const failedRecord = runRecords[0]!;
  const failedTrial = trialRecords[0]!;
  const failedResearchManifest = failedRecord[
    "researchManifest"
  ] as Record<string, unknown>;
  const storedResearchManifest = JSON.parse(
    await readFile(
      join(
        String(failedRecord["storageBaseDir"]),
        "historical-replay-research-manifest.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;

  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.failedCount, 1);
  assert.equal(failedRecord["status"], "failed");
  assert.equal(failedTrial["status"], "failed");
  assert.match(String(failedRecord["error"]), /fixture provider threw/);
  assert.match(
    String((failedTrial["outcome"] as Record<string, unknown>)["error"]),
    /fixture provider threw/
  );
  assert.equal(failedResearchManifest["status"], "available");
  assert.match(
    String(failedResearchManifest["manifestPath"]),
    /historical-replay-research-manifest\.json$/
  );
  assert.equal(
    failedResearchManifest["configHash"],
    storedResearchManifest["configHash"]
  );
});

test("historical batch replay runner records selected risk profile", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-aggressive-profile",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60,
    riskProfile: "aggressive_paper",
    constraints: {
      maxNewPositions: 5,
      maxBudgetPerSymbolKrw: 400_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    riskPolicy: {
      maxBudgetPerDecisionKrw: 400_000,
      maxSymbolExposureKrw: 600_000,
      targetExposureRatio: 0.85,
      maxPositionWeightRatio: 0.65,
      maxStrategyBucketExposureRatio: { long_term: 0.6 },
      maxBucketTurnoverKrw: { intraday: 50_000 },
      maxSectorExposureRatio: 0.45,
      maxCountryExposureRatio: 0.7,
      maxCurrencyExposureRatio: 0.4,
      maxUnknownMetadataExposureRatio: 0.1,
      minCashReserveRatio: 0.05,
      minCashReserveKrw: 0
    },
    allocationPolicy: {
      policyName: "aggressive_paper_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3
    },
    paperExitPolicy: {
      takeProfitRatio: 0.15,
      stopLossRatio: 0.08,
      rebalanceMaxPositionWeightRatio: 0.55
    }
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const metadata = JSON.parse(
    await readFile(
      join(
        String(runRecords[0]?.["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const configuration = metadata["configuration"] as Record<string, unknown>;
  const constraints = configuration["constraints"] as Record<string, unknown>;
  const riskPolicy = configuration["riskPolicy"] as Record<string, unknown>;
  const manifestAllocationPolicy = manifest["allocationPolicy"] as Record<
    string,
    unknown
  >;
  const allocationPolicy = configuration["allocationPolicy"] as Record<
    string,
    unknown
  >;
  const paperExitPolicy = configuration["paperExitPolicy"] as Record<
    string,
    unknown
  >;

  assert.equal(manifest["riskProfile"], "aggressive_paper");
  assert.deepEqual(manifest["paperExitPolicy"], {
    takeProfitMode: "full_exit",
    takeProfitRatio: 0.15,
    stopLossRatio: 0.08,
    rebalanceMaxPositionWeightRatio: 0.55
  });
  assert.equal(configuration["riskProfile"], "aggressive_paper");
  assert.equal(manifestAllocationPolicy["targetExposureRatio"], 0.85);
  assert.equal(allocationPolicy["policyName"], "aggressive_paper_allocation");
  assert.equal(allocationPolicy["targetExposureRatio"], 0.85);
  assert.equal(allocationPolicy["maxBudgetPerDecisionRatio"], 0.2);
  assert.equal(paperExitPolicy["takeProfitMode"], "full_exit");
  assert.equal(paperExitPolicy["takeProfitRatio"], 0.15);
  assert.equal(paperExitPolicy["stopLossRatio"], 0.08);
  assert.equal(paperExitPolicy["rebalanceMaxPositionWeightRatio"], 0.55);
  assert.equal(constraints["maxNewPositions"], 5);
  assert.equal(constraints["maxBudgetPerSymbolKrw"], 400_000);
  assert.equal(riskPolicy["maxBudgetPerDecisionKrw"], 400_000);
  assert.equal(riskPolicy["maxSymbolExposureKrw"], 600_000);
  assert.equal(riskPolicy["targetExposureRatio"], 0.85);
  assert.equal(riskPolicy["maxPositionWeightRatio"], 0.65);
  assert.deepEqual(riskPolicy["maxStrategyBucketExposureRatio"], {
    long_term: 0.6
  });
  assert.deepEqual(riskPolicy["maxBucketTurnoverKrw"], { intraday: 50_000 });
  assert.equal(riskPolicy["maxSectorExposureRatio"], 0.45);
  assert.equal(riskPolicy["maxCountryExposureRatio"], 0.7);
  assert.equal(riskPolicy["maxCurrencyExposureRatio"], 0.4);
  assert.equal(riskPolicy["maxUnknownMetadataExposureRatio"], 0.1);
  assert.equal(riskPolicy["minCashReserveRatio"], 0.05);
});

class FakeCodexBatchProvider {
  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    return {
      attempted: true,
      decision: decision(packet),
      failure: null,
      command: null
    };
  }
}

class FailingCodexBatchProvider {
  async decide(_packet: MarketPacket): Promise<CodexCliDecisionResult> {
    return {
      attempted: true,
      decision: null,
      failure: {
        code: "AI_DECISION_FAILED",
        reason: "fixture provider failure"
      },
      command: null
    };
  }
}

class ThrowingCodexBatchProvider {
  async decide(_packet: MarketPacket): Promise<CodexCliDecisionResult> {
    throw new Error("fixture provider threw after manifest write");
  }
}

function decision(packet: MarketPacket): VirtualDecision {
  const candidate = packet.candidates[0];
  const symbol = candidate?.symbol ?? "005930";
  const dataRef = candidate?.sourceRefs[0] ?? `historical_snapshot:${symbol}`;

  return {
    packetId: packet.packetId,
    summary: "Injected Codex-style batch replay fixture.",
    decisions: [
      {
        market: "KR",
        symbol,
        action: "VIRTUAL_BUY",
        confidence: 0.6,
        budgetKrw: 70_000,
        thesis: "Fixture uses only the simulated historical packet.",
        riskFactors: ["Historical replay remains paper-only."],
        dataRefs: [dataRef],
        claimSupport: [
          {
            claim: "Fixture uses only the simulated historical packet.",
            dataRefs: [dataRef]
          }
        ],
        expiresAt: packet.expiresAt
      }
    ]
  };
}

function snapshot(
  snapshotId: string,
  symbol: string,
  observedAt: string,
  lastPriceKrw: number,
  options: {
    market?: HistoricalMarketSnapshot["market"];
    sourceRefs?: string[];
  } = {}
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: options.market ?? "KR",
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    volume: 100_000,
    sourceRefs: options.sourceRefs ?? [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

function validationAssignment(
  splitRole: ValidationSplitRole,
  embargoDurationDays = 0
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "wf_test",
    splitIndex: 0,
    trainStart: "2024-12-31T15:00:00.000Z",
    trainEnd: "2025-01-31T14:59:59.999Z",
    validationStart: "2025-01-31T15:00:00.000Z",
    validationEnd: "2025-02-28T14:59:59.999Z",
    testStart:
      splitRole === "test" ? "2025-02-28T15:00:00.000Z" : null,
    testEnd:
      splitRole === "test" ? "2025-03-31T14:59:59.999Z" : null,
    purgeDurationDays: 0,
    embargoDurationDays,
    splitRole
  };
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
