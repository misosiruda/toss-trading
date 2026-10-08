import { open } from "node:fs/promises";
import { join } from "node:path";
import { initialPortfolioObservationReference, type ReplayInitialPortfolioObservation } from "../domain/replaySourceObservation.js";
import { assertSettingsSourceBinding, replayDurableSourceReferenceSchema, replaySettingsObservationSchema,
  type ReplayDurableSourceReference } from "../domain/replaySettingsObservation.js";
import type { ReplaySettingsSnapshotObservation } from "../domain/replaySettingsSnapshot.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";

export const REPLAY_SETTINGS_OBSERVATION_FILE = "historical-replay-settings-observation.json";
export const REPLAY_SETTINGS_OBSERVATION_MAX_FILE_BYTES = 4_194_304 + 65_536;

/** Called by the owning reservation after both earlier observations are durable. */
export async function writeReplaySettingsObservation(input: {
  storageBaseDir: string; initialObservation: ReplayInitialPortfolioObservation;
  sourceReference: ReplayDurableSourceReference; settings: ReplaySettingsSnapshotObservation;
}): Promise<void> {
  try {
    const initial = input.initialObservation;
    const source = replayDurableSourceReferenceSchema.parse(input.sourceReference);
    assertSettingsSourceBinding(initial, source);
    const record = replaySettingsObservationSchema.parse({
      schemaVersion: "replay_settings_observation.v1", mode: "paper_only", phase: "runner_supplied_settings",
      identity: initial.identity, startedAt: initial.startedAt, reservationHash: initial.reservationHash,
      initialObservation: initialPortfolioObservationReference(initial), sourceObservation: source.sourceObservation,
      settings: input.settings, admission: "unavailable", clock: "unavailable", sampler: "unavailable", provider: "unavailable",
      acquisition: "unavailable", sourceTrust: "unavailable", sourceFileIdentity: "unavailable", sourceReadCompleteness: "unavailable",
      runtime: "unavailable", dependencies: "unavailable", result: "unavailable", completeConfiguration: false,
      completeInput: false, comparability: "unavailable"
    });
    if (record.settings.status === "recorded" && record.settings.contentHash !== createReplayResearchHash({
      schemaVersion: record.settings.snapshotVersion, snapshot: record.settings.snapshot
    })) throw Error("settings content mismatch");
    const text = JSON.stringify(record) + "\n";
    if (Buffer.byteLength(text, "utf8") > REPLAY_SETTINGS_OBSERVATION_MAX_FILE_BYTES) throw Error("settings file limit");
    await writeExclusiveExperimentFile(join(input.storageBaseDir, REPLAY_SETTINGS_OBSERVATION_FILE), text);
    const directory = await open(input.storageBaseDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { throw Error("settings observation storage failed"); }
}
