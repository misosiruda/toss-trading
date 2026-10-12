import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { ReplayProcessObservationBinding } from "../domain/replayProcessObservation.js";
import { runCodexHistoricalReplay, type ReplayProcessObservationContext } from "../replay/codexHistoricalReplayRunner.js";
import { admissionStorageFixture, writeAdmissionPredecessors } from "./replayAdmissionLineageTestFixtures.js";

type AdmissionFixture = Awaited<ReturnType<typeof admissionStorageFixture>>;

/** Obtain authority only from an actual runner invocation; stop before ticks or provider work. */
export async function runnerProcessContext(f: AdmissionFixture, input: {
  binding?: ReplayProcessObservationBinding;
  onInitial?: () => void;
  unsupportedVersion?: string;
} = {}): Promise<ReplayProcessObservationContext> {
  const stop = Error("synthetic process context captured");
  let captured: ReplayProcessObservationContext | undefined;
  const descriptor = Object.getOwnPropertyDescriptor(process, "version")!;
  if (input.unsupportedVersion !== undefined) Object.defineProperty(process, "version", { ...descriptor, value: input.unsupportedVersion });
  let pending: ReturnType<typeof runCodexHistoricalReplay>;
  try {
    pending = runCodexHistoricalReplay({ ...f.plan.runnerOptions,
      processObservationBinding: input.binding ?? { identity: f.actual.identity, startedAt: f.actual.startedAt },
      onInitialPortfolio: () => input.onInitial?.(),
      onProcessObservation: context => { captured = context; throw stop; }
    }, f.plan.replayInput);
  } finally {
    // Capture happens synchronously before the runner's first await; never leave the global mocked across awaits.
    if (input.unsupportedVersion !== undefined) Object.defineProperty(process, "version", descriptor);
  }
  await assert.rejects(pending, error => error === stop);
  assert.ok(captured);
  return captured;
}

export async function processStorageFixture(t: TestContext, stored = false) {
  const f = await admissionStorageFixture(t, stored), writer = await f.reserve();
  await writeAdmissionPredecessors(f, writer);
  await writer.observeAdmission(f.context, f.actual);
  const context = await runnerProcessContext(f);
  return { ...f, writer, processContext: context };
}

export async function readStoredJson(directory: string, name: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(join(directory, name), "utf8"));
}
