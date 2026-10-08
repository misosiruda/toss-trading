import { open } from "node:fs/promises";
import { join } from "node:path";
import type { ReplayDurableAdmissionReference } from "../domain/replayAdmissionLineage.js";
import { REPLAY_PROCESS_OBSERVATION_FILE_NAME, REPLAY_PROCESS_OBSERVATION_MAX_BYTES,
  createReplayProcessObservation } from "../domain/replayProcessObservation.js";
import { resolveReplayProcessObservationContext } from "../replay/codexHistoricalReplayRunner.js";
import { writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";

/** The reservation supplies only its actual completed durable B reference. */
export async function writeReplayProcessObservation(context: unknown, input: {
  storageBaseDir: string; admissionReference: ReplayDurableAdmissionReference;
}): Promise<void> {
  try {
    const evidence = resolveReplayProcessObservationContext(context);
    const record = createReplayProcessObservation({ evidence, admission: input.admissionReference });
    const text = JSON.stringify(record) + "\n";
    assertReplayProcessObservationFileSize(text);
    await writeExclusiveExperimentFile(join(input.storageBaseDir, REPLAY_PROCESS_OBSERVATION_FILE_NAME), text);
    const directory = await open(input.storageBaseDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { throw Error("process observation storage failed"); }
}

/** Size validation alone grants no record validity or producer ownership. */
export function assertReplayProcessObservationFileSize(text: string): void {
  if (Buffer.byteLength(text, "utf8") > REPLAY_PROCESS_OBSERVATION_MAX_BYTES) throw Error("process observation file limit");
}
