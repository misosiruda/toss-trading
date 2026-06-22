import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  BATCH_REPLAY_MANIFEST_FILE_NAME,
  BATCH_REPLAY_RUNS_FILE_NAME,
  DYNAMIC_STORAGE_ARTIFACT_CONTRACTS,
  HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME,
  STORAGE_ARTIFACT_CONTRACTS,
  createBatchReplayArtifactPaths,
  createBatchReplayManifestPath,
  createBatchReplayRootDirForStorage,
  createStorageArtifactPathCatalog,
  resolveBatchReplayRunsArtifactPath
} from "./artifactPaths.js";
import { LOCAL_OPERATIONS_API_ROUTES } from "../api/localOperationsSurface.js";
import { createStoragePaths } from "./repositories.js";

test("batch replay artifact paths keep manifest and runs path in one catalog", () => {
  const paths = createBatchReplayArtifactPaths(
    "data/batch-replay",
    "batch:smoke/001"
  );

  assert.equal(paths.outputDir, join("data/batch-replay", "batch_smoke_001"));
  assert.equal(paths.runsDir, join(paths.outputDir, "runs"));
  assert.equal(
    paths.manifestPath,
    join(paths.outputDir, BATCH_REPLAY_MANIFEST_FILE_NAME)
  );
  assert.equal(
    paths.runsPath,
    join(paths.outputDir, BATCH_REPLAY_RUNS_FILE_NAME)
  );
});

test("storage artifact catalog matches repository storage paths", () => {
  const baseDir = join("data", "paper");
  const catalog = createStorageArtifactPathCatalog(baseDir);
  const paths = createStoragePaths(baseDir);

  assert.equal(catalog["auditEvents"], paths.auditLogPath);
  assert.equal(catalog["virtualPortfolio"], paths.virtualPortfolioPath);
  assert.equal(catalog["virtualDecisions"], paths.virtualDecisionsPath);
  assert.equal(catalog["virtualTrades"], paths.virtualTradesPath);
  assert.equal(catalog["tossInvestSources"], paths.tossInvestSourcesPath);
  assert.equal(catalog["marketPackets"], paths.marketPacketsPath);
  assert.equal(
    catalog["historicalMarketSnapshots"],
    paths.historicalMarketSnapshotsPath
  );
  assert.equal(
    catalog["historicalReplayReport"],
    paths.historicalReplayReportPath
  );
  assert.equal(
    catalog["historicalReplayProgress"],
    paths.historicalReplayProgressPath
  );
  assert.equal(
    catalog["historicalReplayRunMetadata"],
    paths.historicalReplayRunMetadataPath
  );
  assert.equal(
    catalog["historicalReplayResearchManifest"],
    paths.historicalReplayResearchManifestPath
  );
  assert.equal(
    catalog["historicalReplayPackets"],
    paths.historicalReplayPacketLogPath
  );
  assert.equal(
    catalog["historicalReplayDecisions"],
    paths.historicalReplayDecisionLogPath
  );
  assert.equal(
    catalog["historicalReplayRiskDecisions"],
    paths.historicalReplayRiskDecisionLogPath
  );
  assert.equal(
    catalog["historicalReplayTrades"],
    paths.historicalReplayTradeLogPath
  );
  assert.equal(
    catalog["historicalReplayPortfolioTimeline"],
    paths.historicalReplayPortfolioTimelinePath
  );
  assert.equal(
    catalog["batchReplayAggregateReport"],
    paths.batchReplayAggregateReportPath
  );
});

test("storage artifact contracts document reader and corrupt JSONL policy", () => {
  const artifactNames = new Set<string>();
  const localOperationsApiRoutes = new Set<string>(LOCAL_OPERATIONS_API_ROUTES);

  for (const contract of STORAGE_ARTIFACT_CONTRACTS) {
    assert.equal(artifactNames.has(contract.artifactName), false);
    artifactNames.add(contract.artifactName);
    assert.equal(contract.relativePath, contract.fileName);
    assert.equal(contract.failureTrace.length > 0, true);

    if (contract.format === "jsonl") {
      assert.equal(contract.corruptJsonlPolicy, "skip_line_and_count");
    } else {
      assert.equal(contract.corruptJsonlPolicy, null);
    }

    if (contract.localOperationsReader !== null) {
      assert.equal(
        localOperationsApiRoutes.has(contract.localOperationsReader),
        true,
        `${contract.artifactName} points at a registered local operations route`
      );
    }
  }

  assert.equal(artifactNames.has("batchReplayRuns"), false);
  assert.equal(
    STORAGE_ARTIFACT_CONTRACTS.some(
      (contract) =>
        contract.artifactName === "historicalReplayResearchManifest" &&
        contract.fileName === HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME &&
        contract.domainContract === "ReplayResearchManifest"
    ),
    true
  );
});

test("dynamic batch replay contracts document reader resolution", () => {
  const batchRunContract = DYNAMIC_STORAGE_ARTIFACT_CONTRACTS.find(
    (contract) => contract.artifactName === "batchReplayRuns"
  );

  assert.notEqual(batchRunContract, undefined);
  assert.equal(batchRunContract?.fileName, BATCH_REPLAY_RUNS_FILE_NAME);
  assert.equal(batchRunContract?.format, "jsonl");
  assert.equal(batchRunContract?.localOperationsReader, "/batch/replay/runs");
  assert.equal(
    LOCAL_OPERATIONS_API_ROUTES.includes("/batch/replay/runs"),
    true
  );
  assert.equal(
    batchRunContract?.pathResolver,
    "resolveBatchReplayRunsArtifactPath"
  );
  assert.equal(batchRunContract?.corruptJsonlPolicy, "skip_line_and_count");
});

test("storage base dir maps to sibling batch replay artifact root", () => {
  const cwd = resolve("fixture-root");
  const storageBaseDir = join(cwd, "data", "paper");
  const rootDir = createBatchReplayRootDirForStorage(storageBaseDir);

  assert.equal(rootDir, join(cwd, "data", "batch-replay"));
  assert.equal(
    createBatchReplayManifestPath(rootDir, "batch-smoke"),
    join(rootDir, "batch-smoke", BATCH_REPLAY_MANIFEST_FILE_NAME)
  );
});

test("batch replay runs artifact resolver accepts only runs JSONL under artifact roots", () => {
  const cwd = resolve("fixture-root");
  const storageBaseDir = join(cwd, "data", "paper");
  const validRelative = "data/batch-replay/batch-smoke/batch-replay-runs.jsonl";
  const validAbsolute = join(
    cwd,
    "data",
    "batch-replay",
    "batch-smoke",
    BATCH_REPLAY_RUNS_FILE_NAME
  );

  assert.equal(
    resolveBatchReplayRunsArtifactPath(validRelative, {
      storageBaseDir,
      cwd
    }),
    validAbsolute
  );
  assert.equal(
    resolveBatchReplayRunsArtifactPath(validAbsolute, {
      storageBaseDir,
      cwd
    }),
    validAbsolute
  );
  assert.equal(
    resolveBatchReplayRunsArtifactPath(
      join(cwd, "data", "batch-replay", "batch-smoke", "other.jsonl"),
      { storageBaseDir, cwd }
    ),
    null
  );
  assert.equal(
    resolveBatchReplayRunsArtifactPath(
      join(cwd, "..", "outside", "batch-replay", BATCH_REPLAY_RUNS_FILE_NAME),
      { storageBaseDir, cwd }
    ),
    null
  );
});
