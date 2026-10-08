import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { resolvePaperSimulationConfig } from "../api/paperSimulationConfig.js";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { replayAdmissionLineageSchema, REPLAY_ADMISSION_LINEAGE_FILE_NAME } from "../domain/replayAdmissionLineage.js";
import { replayInitialPortfolioObservationSchema } from "../domain/replayInitialPortfolioObservation.js";
import { replaySourceObservationSchema } from "../domain/replaySourceObservation.js";
import { durableSettingsObservationReference, replaySettingsObservationSchema } from "../domain/replaySettingsObservation.js";
import { sourceDecision, sourceSnapshot } from "../replay/codexReplaySourceTestFixtures.js";
import { selectReplayWindow } from "../replay/replayWindowSampler.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { safeArtifactPathPart } from "../storage/artifactPaths.js";
import { acceptPaperSimulationWithAdmissionContext } from "../storage/paperSimulationObservationStore.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import type { HistoricalReplayWorkflowOptions } from "./historicalReplayWorkflow.js";

export const admissionAcceptedAt = "2026-10-08T09:00:00.000Z";
export async function admissionRoot(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "replay-admission-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** Issue through the durable admission writer. No fixture can manufacture issuer ownership. */
export async function issuedWorkflowFixture(t: TestContext, input: {
  unavailable?: "input_missing" | "redacted"; index?: number;
} = {}) {
  const root = await admissionRoot(t), storageBaseDir = join(root, "child");
  const requested = simulationConfig();
  requested.runType = "batch_replay"; requested.runCount = 2;
  requested.window.mode = "fixed_range"; requested.window.seed = "token";
  requested.window.startAt = "2024-01-01"; requested.window.endAt = "2024-01-02";
  requested.samplingPolicy.stepSeconds = 2_592_000;
  if (input.unavailable === "redacted") requested.window.seed = "password=SYNTHETIC_ADMISSION";
  const snapshot = resolvePaperSimulationConfig(requested, { PAPER_SIMULATION_TICK_DELAY_MS: "0" });
  const batchId = "paper_sim_20261008090000000_workflow";
  const admissionContext = await acceptPaperSimulationWithAdmissionContext(join(root, "paper"), batchId,
    admissionAcceptedAt, input.unavailable === "input_missing" ? { requestedConfig: requested }
      : { requestedConfig: requested, inputSnapshot: snapshot });
  const config = snapshot.effectiveConfig, index = input.index ?? 0;
  const seed = `${config.window.seed.trim()}:${index}`;
  const window = config.window.fixedWindow === null
    ? selectReplayWindow({ seed, rangeStart: new Date(config.window.rangeStartAt), rangeEnd: new Date(config.window.rangeEndAt),
      windowMonths: config.window.windowMonths!, timezoneOffsetMinutes: config.window.timezoneOffsetMinutes })
    : { ...config.window.fixedWindow, seed };
  await new FileHistoricalMarketSnapshotStore(createStoragePaths(storageBaseDir).historicalMarketSnapshotsPath)
    .append(sourceSnapshot({ observedAt: window.startAt, createdAt: window.startAt }));
  let providers = 0;
  const options: HistoricalReplayWorkflowOptions = {
    storageBaseDir, admissionContext, admissionWindowSamplingMode: "fixed_range",
    batchId, batchRunIndex: index,
    runId: `${batchId}_run_${String(index).padStart(6, "0")}_${safeArtifactPathPart(window.selectedMonth, "window")}`,
    generatedAt: new Date(Date.parse(admissionAcceptedAt) + index), windowSelection: window,
    clock: new SimulatedClock({ startAt: new Date(window.startAt), endAt: new Date(window.endAt), stepSeconds: 2_592_000 }),
    packetIdPrefix: `packet_${batchId}_${index}`, packetExpiresInSeconds: 60, maxCandidates: 10, maxSnapshotAgeSeconds: 86_400,
    constraints: config.constraints, executionPolicy: config.costModel.executionPolicy, riskPolicy: config.riskPolicy,
    allocationPolicy: config.allocationPolicy, initialCashKrw: config.capital.initialCashKrw, tickDelayMs: config.tickDelayMs,
    ...(config.paperExitPolicy === null ? {} : { paperExitPolicy: config.paperExitPolicy }),
    decisionProvider: { decide: async packet => { providers++; return sourceDecision(packet); } }
  };
  return { root, options, admissionContext, snapshot, providers: () => providers };
}

export async function readAdmissionArtifacts(storageBaseDir: string) {
  const read = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(storageBaseDir, name), "utf8"));
  const initial = replayInitialPortfolioObservationSchema.parse(await read(REPLAY_INITIAL_PORTFOLIO_FILE));
  const source = replaySourceObservationSchema.parse(await read(REPLAY_SOURCE_OBSERVATION_FILE));
  const settings = replaySettingsObservationSchema.parse(await read(REPLAY_SETTINGS_OBSERVATION_FILE));
  const lineage = replayAdmissionLineageSchema.parse(await read(REPLAY_ADMISSION_LINEAGE_FILE_NAME));
  assert.equal(lineage.initialObservation.observationHash, createReplayResearchHash(initial));
  assert.equal(lineage.sourceObservation.observationHash, createReplayResearchHash(source));
  assert.equal(lineage.settingsObservation.observationHash, createReplayResearchHash(settings));
  const durable = durableSettingsObservationReference(settings);
  assert.deepEqual(lineage.identity, durable.identity);
  assert.equal(lineage.startedAt, durable.startedAt);
  assert.equal(lineage.reservationHash, durable.reservationHash);
  assert.deepEqual(lineage.initialObservation, durable.initialObservation);
  assert.deepEqual(lineage.sourceObservation, durable.sourceObservation);
  assert.deepEqual(lineage.settingsObservation, durable.settingsObservation);
  for (const old of [initial, source, settings]) assert.equal(old.admission, "unavailable");
  assert.equal(lineage.completeConfiguration, false); assert.equal(lineage.completeInput, false);
  for (const key of ["clock", "sampler", "provider", "runtime", "dependencies", "result", "comparability"] as const)
    assert.equal(lineage[key], "unavailable");
  return { initial, source, settings, lineage };
}
