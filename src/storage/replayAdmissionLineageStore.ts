import { open } from "node:fs/promises";
import { join } from "node:path";
import type { ReplayInitialPortfolioObservation } from "../domain/replaySourceObservation.js";
import type { ReplayDurableSettingsReference } from "../domain/replaySettingsObservation.js";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME, REPLAY_ADMISSION_LINEAGE_MAX_BYTES } from "../domain/replayAdmissionLineage.js";
import { createReplayAdmissionLineage } from "../domain/replayAdmissionMapping.js";
import { resolvePaperSimulationAdmissionContext } from "./paperSimulationObservationStore.js";
import { writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";

/** Only the owning child reservation supplies the actual durable references. Context ownership comes first. */
export async function writeReplayAdmissionLineage(context: unknown, input: {
  storageBaseDir: string; actual: unknown; initialObservation: ReplayInitialPortfolioObservation;
  settingsReference: ReplayDurableSettingsReference;
}): Promise<void> {
  try {
    const evidence = resolvePaperSimulationAdmissionContext(context);
    // Even a sanitized child identity can retain a sensitive seed fragment. Do not construct an envelope.
    if (evidence.status === "unavailable") return;
    const record = createReplayAdmissionLineage(evidence, input.actual, input.initialObservation, input.settingsReference);
    const text = JSON.stringify(record) + "\n";
    assertReplayAdmissionLineageFileSize(text);
    await writeExclusiveExperimentFile(join(input.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME), text);
    const directory = await open(input.storageBaseDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { throw Error("admission lineage observation storage failed"); }
}

/** A byte guard only; accepting text here does not validate a record or grant writer ownership. */
export function assertReplayAdmissionLineageFileSize(text: string): void {
  if (Buffer.byteLength(text, "utf8") > REPLAY_ADMISSION_LINEAGE_MAX_BYTES) throw Error("admission lineage file limit");
}
