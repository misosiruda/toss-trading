import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { resolvePaperSimulationConfig } from "../api/paperSimulationConfig.js";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { admissionMappingFixture } from "../domain/replayAdmissionTestFixtures.js";
import { prepareReplaySourceSnapshot } from "../domain/replaySourceSnapshot.js";
import { initialPortfolio } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { acceptPaperSimulationWithAdmissionContext } from "./paperSimulationObservationStore.js";
import { reserveReplayInitialPortfolioObservation, REPLAY_INITIAL_PORTFOLIO_FILE,
  REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE, type ReplayChildObservationWriter } from "./replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "./replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "./replaySettingsObservationStore.js";

export const admissionPredecessors = [REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE,
  REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_SOURCE_OBSERVATION_FILE, REPLAY_SETTINGS_OBSERVATION_FILE];

export async function admissionStorageFixture(t: TestContext, stored = false) {
  const root = await fs.mkdtemp(join(tmpdir(), "admission-lineage-storage-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = simulationConfig();
  config.runType = "batch_replay"; config.runCount = 3; config.window.seed = "  storage-fixture  ";
  const data = admissionMappingFixture({ config, index: 2, ...(stored ? { storedPortfolio: initialPortfolio() } : {}) });
  const admissionDir = join(root, "admission"), childDir = join(root, "child");
  const admissionSnapshot = resolvePaperSimulationConfig(config, { PAPER_SIMULATION_TICK_DELAY_MS: "17" });
  // The domain helper supplies only data. Authority comes from the actual successful admission writer.
  const context = await acceptPaperSimulationWithAdmissionContext(admissionDir, data.evidence.simulationRunId,
    data.evidence.acceptedAt, { requestedConfig: config, inputSnapshot: admissionSnapshot });
  const reservationInput = { storageBaseDir: childDir, identity: data.actual.identity,
    startedAt: data.actual.startedAt, origin: stored ? "stored_portfolio" as const : "generated" as const };
  return { ...data, root, admissionDir, childDir, context, admissionSnapshot, reservationInput,
    reserve: () => reserveReplayInitialPortfolioObservation(reservationInput) };
}

export async function writeAdmissionPredecessors(f: Awaited<ReturnType<typeof admissionStorageFixture>>,
  writer: ReplayChildObservationWriter) {
  await writer(f.plan.initialPortfolio);
  await writer.observeSource(prepareReplaySourceSnapshot([]));
  await writer.observeSettings(f.a.settings);
}

export async function childFileBytes(directory: string) {
  const names = (await fs.readdir(directory)).sort();
  return Promise.all(names.map(async name => [name, await fs.readFile(join(directory, name))] as const));
}
