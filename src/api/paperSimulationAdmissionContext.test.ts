import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { resolvePaperSimulationAdmissionContext, paperSimulationObservationPath,
  type PaperSimulationAdmissionContext } from "../storage/paperSimulationObservationStore.js";
import { readPaperSimulationRequest } from "../storage/paperSimulationRequestStore.js";
import { createPaperSimulationRun, type PaperSimulationRunnerInput } from "./paperSimulationRuns.js";
import { resolvePaperSimulationConfig } from "./paperSimulationConfig.js";
import { simulationConfig, simulationHeaders, simulationServer } from "./paperSimulationTestFixtures.js";

const acceptedAt = "2026-10-07T09:00:00.000Z";
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "api-admission-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, storageBaseDir: join(root, "paper") };
}
const result = (input: PaperSimulationRunnerInput) => ({ mode: "paper_only" as const,
  simulationRunId: input.simulationRunId, batchId: input.batchId, status: "completed" as const,
  outputDir: "synthetic", manifestPath: "synthetic", runsPath: "synthetic" });

test("API runner receives the issued identity while later response/config mutation cannot alter its stored evidence", async t => {
  const { storageBaseDir } = await fixture(t), config = simulationConfig();
  const env = { PAPER_SIMULATION_TICK_DELAY_MS: "17" }, expected = resolvePaperSimulationConfig(config, env);
  let actual: PaperSimulationRunnerInput | undefined, release!: () => void, finish!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { finish = resolve; });
  const accepted = await createPaperSimulationRun(config, { storageBaseDir, env, now: () => new Date(acceptedAt),
    paperSimulationRunner: async input => { actual = input; await gate; finish(); return result(input); } });
  try {
    assert.ok(actual?.admissionContext);
    assert.equal("admissionContext" in accepted, false); assert.equal("receipt" in accepted, false);
    const context = actual.admissionContext, evidence = resolvePaperSimulationAdmissionContext(context);
    assert.equal(evidence.status, "available");
    accepted.requestedConfig.window.seed = "response-change";
    accepted.effectiveConfig.tickDelayMs = 99;
    accepted.effectiveConfig.constraints.allowedActions.reverse();
    actual.createdAt.setUTCFullYear(2030);
    config.capital.initialCashKrw = 999_999;
    env.PAPER_SIMULATION_TICK_DELAY_MS = "5000";
    assert.deepEqual(evidence.status === "available" && evidence.snapshot, expected);
    assert.equal(evidence.status === "available" && evidence.acceptedAt, acceptedAt);
    assert.equal(resolvePaperSimulationAdmissionContext(context), evidence);
  } finally { release(); await done; }
});

test("cloning a stored request performs new validation and issues a fresh identity and current admission", async t => {
  const { storageBaseDir } = await fixture(t), contexts: PaperSimulationAdmissionContext[] = [];
  const runner = async (input: PaperSimulationRunnerInput) => { assert.ok(input.admissionContext); contexts.push(input.admissionContext); return result(input); };
  const original = await createPaperSimulationRun(simulationConfig(), { storageBaseDir, env: { PAPER_SIMULATION_TICK_DELAY_MS: "17" },
    now: () => new Date(acceptedAt), paperSimulationRunner: runner });
  const stored = await readPaperSimulationRequest(storageBaseDir, original.simulationRunId);
  assert.equal(stored.status, "available"); if (stored.status !== "available") return;
  const clone = await createPaperSimulationRun(stored.requestedConfig, { storageBaseDir, env: { PAPER_SIMULATION_TICK_DELAY_MS: "31" },
    now: () => new Date("2026-10-07T09:00:01.000Z"), paperSimulationRunner: runner });
  assert.notEqual(clone.simulationRunId, original.simulationRunId);
  assert.equal(contexts.length, 2); assert.notEqual(contexts[0], contexts[1]);
  const before = resolvePaperSimulationAdmissionContext(contexts[0]), after = resolvePaperSimulationAdmissionContext(contexts[1]);
  assert.equal(before.status, "available"); assert.equal(after.status, "available");
  if (before.status !== "available" || after.status !== "available") return;
  assert.equal(before.snapshot.effectiveConfig.tickDelayMs, 17); assert.equal(after.snapshot.effectiveConfig.tickDelayMs, 31);
  assert.equal(after.batchId, clone.batchId); assert.equal(after.acceptedAt, "2026-10-07T09:00:01.000Z");
  assert.notEqual(before.receipt.inputProvenanceHash, after.receipt.inputProvenanceHash);
});

test("synthetic credential seed remains accepted with no derived identity, hashes or values in its context evidence", async t => {
  const { storageBaseDir } = await fixture(t), config = simulationConfig();
  config.window.seed = "password=SYNTHETIC_SEED";
  let actual: PaperSimulationRunnerInput | undefined;
  const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(acceptedAt),
    paperSimulationRunner: async input => { actual = input; return result(input); } });
  t.after(server.close);
  const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
    headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
  assert.equal(response.status, 202);
  const accepted = await response.json() as Record<string, unknown>;
  assert.equal("admissionContext" in accepted, false);
  assert.ok(actual?.admissionContext);
  assert.deepEqual(resolvePaperSimulationAdmissionContext(actual.admissionContext), { status: "unavailable", reason: "redacted" });
});

test("HTTP ignores caller admission claims and validation creates no evidence", async t => {
  const { root, storageBaseDir } = await fixture(t); let actual: PaperSimulationRunnerInput | undefined;
  const server = await simulationServer({ storageBaseDir, env: {},
    paperSimulationRunner: async input => { actual = input; return result(input); } });
  t.after(server.close);
  const claimed = { verified: true, receipt: { batchId: "invented" } };
  const validation = await fetch(server.baseUrl + "/paper/simulations/validate", { method: "POST",
    headers: simulationHeaders(server.baseUrl), body: JSON.stringify({ ...simulationConfig(), admissionContext: claimed }) });
  assert.equal(validation.status, 200); await validation.text();
  assert.equal(Boolean(actual), false); assert.deepEqual(await fs.readdir(root), []);
  const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
    headers: { ...simulationHeaders(server.baseUrl, "paper-simulation-create"), "x-admission-receipt": "invented" },
    body: JSON.stringify({ ...simulationConfig(), admissionContext: claimed }) });
  assert.equal(response.status, 202); await response.text();
  assert.ok(actual?.admissionContext);
  assert.equal("admissionContext" in actual.config, false);
  const evidence = resolvePaperSimulationAdmissionContext(actual.admissionContext);
  assert.equal(evidence.status, "available");
  assert.equal(evidence.status === "available" && evidence.batchId, actual.batchId);
  assert.throws(() => resolvePaperSimulationAdmissionContext(claimed));
});

test("real accepted fsync failure remains HTTP 503 with runner zero and retained barrier", async t => {
  const { storageBaseDir } = await fixture(t), id = "paper_sim_20261007090000000_ux02a-fixture";
  const path = paperSimulationObservationPath(storageBaseDir, id), originalOpen = fs.open;
  let calls = 0, syncFailures = 0;
  const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(acceptedAt),
    paperSimulationRunner: async input => { calls++; return result(input); } });
  t.after(server.close);
  const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === path && args[1] === "a") t.mock.method(handle, "sync", async () => { syncFailures++; throw new Error("synthetic sync failure"); });
    return handle;
  });
  syncBuiltinESMExports();
  try {
    const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
      headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(simulationConfig()) });
    assert.equal(response.status, 503); assert.match(await response.text(), /paper_simulation_admission_failed/);
  } finally { open.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(calls, 0); assert.equal(syncFailures, 1);
  assert.equal((await fs.lstat(dirname(path))).isDirectory(), true);
  assert.equal((await fs.lstat(path + ".paper-log.lock")).isDirectory(), true);
});
