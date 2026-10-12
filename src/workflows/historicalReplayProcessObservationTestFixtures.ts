import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME } from "../domain/replayAdmissionLineage.js";
import { REPLAY_PROCESS_OBSERVATION_FILE_NAME, replayProcessObservationSchema } from "../domain/replayProcessObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { createStoragePaths } from "../storage/repositories.js";
import { readAdmissionArtifacts } from "./historicalReplayAdmissionTestFixtures.js";

export async function readProcessArtifacts(storageBaseDir: string) {
  const artifacts = await readAdmissionArtifacts(storageBaseDir), { lineage } = artifacts;
  const text = await fs.readFile(join(storageBaseDir, REPLAY_PROCESS_OBSERVATION_FILE_NAME), "utf8");
  const record = replayProcessObservationSchema.parse(JSON.parse(text));
  assert.equal(text, JSON.stringify(record) + "\n");
  assert.deepEqual(record.identity, lineage.identity);
  assert.equal(record.startedAt, lineage.startedAt); assert.equal(record.reservationHash, lineage.reservationHash);
  assert.deepEqual(record.initialObservation, lineage.initialObservation);
  assert.deepEqual(record.sourceObservation, lineage.sourceObservation);
  assert.deepEqual(record.settingsObservation, lineage.settingsObservation);
  assert.deepEqual(record.admissionObservation, { schemaVersion: lineage.schemaVersion,
    observationHash: createReplayResearchHash(lineage), lineage: lineage.lineage.status === "recorded"
      ? { status: "recorded", mappingVersion: lineage.lineage.mappingVersion }
      : { status: "unavailable", reason: lineage.lineage.reason } });
  for (const key of ["implementation", "sourceBuild", "dependencyLock", "loadedDependencies", "nodeArtifact",
    "runtimeConfiguration", "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[key], "unavailable");
  assert.equal(record.completeRuntime, false); assert.equal(record.completeConfiguration, false); assert.equal(record.completeInput, false);
  return { ...artifacts, record };
}

export async function assertNoProcessObservation(storageBaseDir: string) {
  await assert.rejects(fs.readFile(join(storageBaseDir, REPLAY_PROCESS_OBSERVATION_FILE_NAME)), { code: "ENOENT" });
}

export async function assertNoLegacyReplayArtifacts(storageBaseDir: string) {
  const paths = createStoragePaths(storageBaseDir);
  for (const path of [paths.historicalReplayRunMetadataPath, paths.historicalReplayResearchManifestPath,
    paths.historicalReplayProgressPath, paths.historicalReplayPacketLogPath, paths.historicalReplayDecisionLogPath,
    paths.historicalReplayRiskDecisionLogPath, paths.historicalReplayTradeLogPath, paths.historicalReplayPortfolioTimelinePath,
    paths.historicalReplayReportPath]) await assert.rejects(fs.readFile(path), { code: "ENOENT" });
}

export const processDurabilityPhases = ["file_open", "write", "file_sync", "file_close", "directory_open", "directory_sync", "directory_close"] as const;
export type ProcessDurabilityPhase = typeof processDurabilityPhases[number];
export const processFailureMarker = "SYNTHETIC_PROCESS_DURABILITY_SECRET";

/** Fault only the actual C1 writer; retain earlier durable bytes for independent post-failure comparison. */
export function failProcessDurability(t: TestContext, phase: ProcessDurabilityPhase) {
  const original = fs.open;
  let target: string | undefined, closed = false, failures = 0;
  const preceding = new Map<string, Buffer>();
  const fail = () => { failures++; throw Error(processFailureMarker); };
  const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const path = String(args[0]), processFile = basename(path) === REPLAY_PROCESS_OBSERVATION_FILE_NAME;
    if (processFile) {
      target = path;
      for (const name of [REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE, REPLAY_INITIAL_PORTFOLIO_FILE,
        REPLAY_SOURCE_OBSERVATION_FILE, REPLAY_SETTINGS_OBSERVATION_FILE, REPLAY_ADMISSION_LINEAGE_FILE_NAME]) {
        const previous = join(dirname(path), name); preceding.set(previous, await fs.readFile(previous));
      }
      if (phase === "file_open") fail();
    }
    const directory = target !== undefined && closed && path === dirname(target) && args[1] === "r";
    if (directory && phase === "directory_open") fail();
    const handle = await original(...args);
    if (processFile) {
      if (phase === "write") t.mock.method(handle, "writeFile", async () => fail());
      if (phase === "file_sync") t.mock.method(handle, "sync", async () => fail());
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => { await close(); closed = true; if (phase === "file_close") fail(); });
    }
    if (directory && phase === "directory_sync") t.mock.method(handle, "sync", async () => fail());
    if (directory && phase === "directory_close") {
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => { await close(); fail(); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  return { restore: () => { open.mock.restore(); syncBuiltinESMExports(); }, failures: () => failures,
    verifyPreceding: async () => {
      assert.equal(preceding.size, 5);
      for (const [path, bytes] of preceding) assert.deepEqual(await fs.readFile(path), bytes);
    } };
}
