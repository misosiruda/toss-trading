import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const BATCH_REPLAY_ARTIFACT_DIR_NAME = "batch-replay";
export const BATCH_REPLAY_RUNS_DIR_NAME = "runs";
export const BATCH_REPLAY_MANIFEST_FILE_NAME = "batch-replay-manifest.json";
export const BATCH_REPLAY_RUNS_FILE_NAME = "batch-replay-runs.jsonl";
export const BATCH_REPLAY_AGGREGATE_REPORT_FILE_NAME =
  "batch-replay-aggregate-report.json";

export interface BatchReplayArtifactPaths {
  outputDir: string;
  runsDir: string;
  manifestPath: string;
  runsPath: string;
}

export interface ResolveBatchReplayRunsArtifactPathOptions {
  storageBaseDir: string;
  cwd?: string;
}

export function createBatchReplayArtifactPaths(
  outputBaseDir: string,
  batchId: string
): BatchReplayArtifactPaths {
  const outputDir = join(outputBaseDir, safeArtifactPathPart(batchId, "batch"));
  return {
    outputDir,
    runsDir: join(outputDir, BATCH_REPLAY_RUNS_DIR_NAME),
    manifestPath: join(outputDir, BATCH_REPLAY_MANIFEST_FILE_NAME),
    runsPath: join(outputDir, BATCH_REPLAY_RUNS_FILE_NAME)
  };
}

export function createBatchReplayRootDirForStorage(
  storageBaseDir: string
): string {
  return resolve(
    dirname(resolve(storageBaseDir)),
    BATCH_REPLAY_ARTIFACT_DIR_NAME
  );
}

export function createBatchReplayManifestPath(
  batchReplayRootDir: string,
  batchDirName: string
): string {
  return join(
    batchReplayRootDir,
    batchDirName,
    BATCH_REPLAY_MANIFEST_FILE_NAME
  );
}

export function resolveBatchReplayRunsArtifactPath(
  sourceRunsPath: string,
  options: ResolveBatchReplayRunsArtifactPathOptions
): string | null {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = isAbsolute(sourceRunsPath)
    ? resolve(sourceRunsPath)
    : resolve(cwd, sourceRunsPath);
  const normalized = resolvedPath.replace(/\\/g, "/");

  if (
    basename(resolvedPath) !== BATCH_REPLAY_RUNS_FILE_NAME ||
    !normalized.includes(`/${BATCH_REPLAY_ARTIFACT_DIR_NAME}/`)
  ) {
    return null;
  }

  const allowedRoots = [
    resolve(cwd),
    resolve(options.storageBaseDir),
    createBatchReplayRootDirForStorage(options.storageBaseDir),
    resolve(cwd, "data", BATCH_REPLAY_ARTIFACT_DIR_NAME)
  ];
  return allowedRoots.some((root) => isPathInside(resolvedPath, root))
    ? resolvedPath
    : null;
}

export function safeArtifactPathPart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length === 0 ? fallback : sanitized;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const path = relative(parentPath, childPath);
  return path === "" || (!!path && !path.startsWith("..") && !isAbsolute(path));
}
