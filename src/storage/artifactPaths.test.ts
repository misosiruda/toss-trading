import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  BATCH_REPLAY_MANIFEST_FILE_NAME,
  BATCH_REPLAY_RUNS_FILE_NAME,
  createBatchReplayArtifactPaths,
  createBatchReplayManifestPath,
  createBatchReplayRootDirForStorage,
  resolveBatchReplayRunsArtifactPath
} from "./artifactPaths.js";

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
