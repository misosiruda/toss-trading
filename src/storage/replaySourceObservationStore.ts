import { open } from "node:fs/promises";
import { join } from "node:path";
import { replaySourceObservationSchema, initialPortfolioObservationReference,
  type ReplayInitialPortfolioObservation } from "../domain/replaySourceObservation.js";
import type { ReplaySourceSnapshotObservation } from "../domain/replaySourceSnapshot.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { durableSourceObservationReference, type ReplayDurableSourceReference } from "../domain/replaySettingsObservation.js";
import { writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";

export const REPLAY_SOURCE_OBSERVATION_FILE = "historical-replay-source-observation.json";
// A separate whole-file budget: raw snapshot <= 16 MiB; bounded envelope including escaped identity <= 64 KiB.
export const REPLAY_SOURCE_OBSERVATION_MAX_FILE_BYTES = 16_777_216 + 65_536;

/** Called by the owning reservation only after its initial observation is durable. */
export async function writeReplaySourceObservation(input: {
  storageBaseDir: string;
  initialObservation: ReplayInitialPortfolioObservation;
  source: ReplaySourceSnapshotObservation;
}): Promise<ReplayDurableSourceReference> {
  try {
    const initial = input.initialObservation;
    const record = replaySourceObservationSchema.parse({
      schemaVersion: "replay_source_observation.v1", mode: "paper_only", phase: "runner_consumed_source",
      identity: initial.identity, startedAt: initial.startedAt, reservationHash: initial.reservationHash,
      initialObservation: initialPortfolioObservationReference(initial), source: input.source,
      admission: "unavailable", configuration: "unavailable", acquisition: "unavailable", sourceTrust: "unavailable",
      sourceFileIdentity: "unavailable", sourceReadCompleteness: "unavailable", runtime: "unavailable",
      dependencies: "unavailable", result: "unavailable", completeInput: false, comparability: "unavailable"
    });
    if (record.source.status === "recorded" && record.source.contentHash !== createReplayResearchHash({
      schemaVersion: record.source.snapshotVersion, snapshot: record.source.snapshot
    })) throw Error("source content mismatch");
    const text = JSON.stringify(record) + "\n";
    if (Buffer.byteLength(text, "utf8") > REPLAY_SOURCE_OBSERVATION_MAX_FILE_BYTES) throw Error("source file limit");
    await writeExclusiveExperimentFile(join(input.storageBaseDir, REPLAY_SOURCE_OBSERVATION_FILE), text);
    const directory = await open(input.storageBaseDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return durableSourceObservationReference(record);
  } catch { throw Error("source observation storage failed"); }
}
