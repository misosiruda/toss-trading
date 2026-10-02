import type { Stats } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

import {
  PAPER_SIMULATION_ID_PATTERN,
  paperSimulationObservationEventSchema,
  parsePaperSimulationObservation,
  type PaperSimulationObservation
} from "../domain/paperSimulationObservation.js";
import { createBatchReplayRootDirForStorage } from "./artifactPaths.js";
import { JsonlStore } from "./jsonlStore.js";
import { withPaperExecutionLogBatch } from "./paperExecutionLogLocks.js";

export const PAPER_SIMULATION_OBSERVATIONS_FILE_NAME = "paper-simulation-observations.jsonl";
export class PaperSimulationObservationConflict extends Error {}

export function paperSimulationObservationPath(storageBaseDir: string, simulationRunId: string): string {
  if (!PAPER_SIMULATION_ID_PATTERN.test(simulationRunId)) throw new Error("invalid paper simulation identity");
  return join(createBatchReplayRootDirForStorage(storageBaseDir), simulationRunId, PAPER_SIMULATION_OBSERVATIONS_FILE_NAME);
}

/** Exclusive directory reservation is the cross-process same-ID boundary, not a scheduler.
 * A failed admission deliberately leaves its directory/log barrier; never delete or reuse it.
 */
export async function acceptPaperSimulation(storageBaseDir: string, simulationRunId: string, acceptedAt: string): Promise<void> {
  const event = paperSimulationObservationEventSchema.parse({
    schemaVersion: "paper_simulation_observation.v1", event: "accepted",
    simulationRunId, batchId: simulationRunId, acceptedAt
  });
  const path = paperSimulationObservationPath(storageBaseDir, simulationRunId);
  const outputDir = dirname(path);
  await ensureDirectories(dirname(outputDir));
  try { await mkdir(outputDir); }
  catch (error) {
    if (isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM") && await exists(outputDir))) {
      throw new PaperSimulationObservationConflict("paper simulation identity already exists");
    }
    throw error;
  }
  // appendDurably syncs outputDir; reservation also needs its parent's entry persisted.
  await syncDirectory(dirname(outputDir));
  await new JsonlStore(path, paperSimulationObservationEventSchema, "paper simulation observation").appendDurably(event);
}

export async function recordPaperSimulationRunnerFailure(
  storageBaseDir: string, simulationRunId: string, acceptedAt: string, observedAt: string
): Promise<void> {
  const path = paperSimulationObservationPath(storageBaseDir, simulationRunId);
  await assertDirectories(dirname(path));
  await withPaperExecutionLogBatch([path], async () => {
    const { result: prior } = await readObservationFile(path, simulationRunId);
    if (prior.status !== "available" || prior.outcome !== "unknown" || prior.acceptedAt !== acceptedAt) {
      throw new Error("paper simulation acceptance evidence is unavailable");
    }
    const event = paperSimulationObservationEventSchema.parse({
      schemaVersion: "paper_simulation_observation.v1", event: "runner_failed",
      simulationRunId, batchId: simulationRunId, acceptedAt, observedAt, reasonCode: "runner_rejected"
    });
    if (Date.parse(observedAt) < Date.parse(acceptedAt)) throw new Error("paper simulation observation clock moved backwards");
    await new JsonlStore(path, paperSimulationObservationEventSchema, "paper simulation observation").appendDurably(event);
  });
}

/** Read-only forensic view: no mkdir, lock acquisition, fsync, recovery or prefix salvage. */
export async function readPaperSimulationObservation(storageBaseDir: string, simulationRunId: string): Promise<PaperSimulationObservation> {
  if (!PAPER_SIMULATION_ID_PATTERN.test(simulationRunId)) return { status: "invalid", simulationRunId };
  const path = paperSimulationObservationPath(storageBaseDir, simulationRunId);
  try {
    await assertDirectories(dirname(path));
    if (await exists(`${path}.paper-log.lock`)) return { status: "unavailable", simulationRunId };
    const { result, fingerprint } = await readObservationFile(path, simulationRunId);
    await assertDirectories(dirname(path));
    if (await exists(`${path}.paper-log.lock`)) return { status: "unavailable", simulationRunId };
    // A writer can finish and remove its barrier after the file read but before this probe.
    return await observationStillMatches(path, fingerprint) ? result : { status: "unavailable", simulationRunId };
  } catch (error) {
    return { status: isCode(error, "ENOENT") ? "missing" : "unavailable", simulationRunId };
  }
}

async function readObservationFile(path: string, simulationRunId: string): Promise<{ result: PaperSimulationObservation; fingerprint: Stats }> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("observation must be an unaliased file");
  if (before.size > 4096) return { result: { status: "invalid", simulationRunId }, fingerprint: before };
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error("observation identity changed");
    }
    const bytes = Buffer.alloc(4097);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await lstat(path);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== length || before.size !== length || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error("observation changed during read");
    }
    if (length > 4096) return { result: { status: "invalid", simulationRunId }, fingerprint: after };
    try {
      const result = parsePaperSimulationObservation(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)), simulationRunId);
      return { result, fingerprint: after };
    } catch { return { result: { status: "invalid", simulationRunId }, fingerprint: after }; }
  } finally { await handle.close(); }
}

async function observationStillMatches(path: string, expected: Stats): Promise<boolean> {
  try {
    const current = await lstat(path);
    return current.isFile() && !current.isSymbolicLink() && current.nlink === 1 &&
      current.dev === expected.dev && current.ino === expected.ino && current.size === expected.size &&
      current.mtimeMs === expected.mtimeMs && current.ctimeMs === expected.ctimeMs;
  } catch { return false; }
}

async function ensureDirectories(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent === path) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("simulation directory must not be aliased");
    return;
  }
  await ensureDirectories(parent);
  try { await mkdir(path); }
  catch (error) { if (!isCode(error, "EEXIST")) throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("simulation directory must not be aliased");
  // An existing parent can have just been created by another admitting process.
  await syncDirectory(parent);
}
async function assertDirectories(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("simulation directory must not be aliased");
  }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (isCode(error, "ENOENT")) return false; throw error; }
}
async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown): boolean { return process.platform === "win32" && isCode(error, "EPERM"); }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
