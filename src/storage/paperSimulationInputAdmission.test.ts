import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createPaperSimulationRun } from "../api/paperSimulationRuns.js";
import { simulationConfig, simulationHeaders, simulationServer } from "../api/paperSimulationTestFixtures.js";
import { paperSimulationObservationEventSchema } from "../domain/paperSimulationObservation.js";
import { PAPER_SIMULATION_INPUT_FILE, readPaperSimulationInput } from "./paperSimulationInputStore.js";
import { paperSimulationObservationPath } from "./paperSimulationObservationStore.js";
import { paperSimulationRequestPath } from "./paperSimulationRequestStore.js";

const id = "paper_sim_20261007090000000_ux02a-fixture";
const time = "2026-10-07T09:00:00.000Z";
for (const failure of ["write", "file-sync", "directory-sync", "accepted-sync"] as const) {
  test("HTTP input admission " + failure + " failure returns 503 with runner0 and retains ID barrier", async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "input-admission-failure-")), storage = join(root, "paper");
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let runs = 0, inputOpened = false, injected = false;
    const batchDir = dirname(paperSimulationRequestPath(storage, id));
    const original = fs.open;
    const fail = async () => { injected = true; throw Object.assign(Error("synthetic-private-storage-error"), { code: "EIO" }); };
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (failure === "directory-sync" && inputOpened && String(args[0]) === batchDir) return fail();
      const handle = await original(...args);
      if (String(args[0]).endsWith(PAPER_SIMULATION_INPUT_FILE) && typeof args[1] === "number") {
        inputOpened = true;
        if (failure === "write") t.mock.method(handle, "writeFile", fail);
        if (failure === "file-sync") t.mock.method(handle, "sync", fail);
      }
      if (failure === "accepted-sync" && String(args[0]) === paperSimulationObservationPath(storage, id)) {
        t.mock.method(handle, "sync", fail);
      }
      return handle;
    });
    syncBuiltinESMExports();
    const server = await simulationServer({ storageBaseDir: storage, env: {}, now: () => new Date(time),
      paperSimulationRunner: async () => { runs++; throw Error("must not run"); } });
    t.after(server.close);
    try {
      const request = () => fetch(server.baseUrl + "/paper/simulations", { method: "POST",
        headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(simulationConfig()) });
      const response = await request(); assert.equal(response.status, 503);
      const body = await response.text(); assert.equal(body.includes("synthetic-private"), false);
      assert.equal(injected, true); assert.equal(runs, 0); assert.equal((await fs.lstat(batchDir)).isDirectory(), true);
      assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable");
      mock.mock.restore(); syncBuiltinESMExports();
      const again = await request(); assert.equal(again.status, 409); await again.text(); assert.equal(runs, 0);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("input file sync must finish before accepted evidence, response and runner invocation", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "input-admission-order-")), storage = join(root, "paper");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let entered!: () => void, release!: () => void, runs = 0, settled = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(PAPER_SIMULATION_INPUT_FILE) && typeof args[1] === "number") {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => { entered(); await gate; await sync(); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const create = createPaperSimulationRun(simulationConfig(), { storageBaseDir: storage, env: {}, now: () => new Date(time),
    paperSimulationRunner: async input => {
      runs++;
      return { mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId,
        status: "completed", outputDir: "synthetic", manifestPath: "synthetic", runsPath: "synthetic" };
    } }).then(value => { settled = true; return value; });
  try {
    await started; assert.equal(settled, false); assert.equal(runs, 0);
    await assert.rejects(fs.lstat(paperSimulationObservationPath(storage, id)), { code: "ENOENT" });
    release(); assert.equal((await create).status, "accepted"); assert.equal(runs, 1);
    assert.equal((await readPaperSimulationInput(storage, id)).status, "available");
  } finally { release(); await create; mock.mock.restore(); syncBuiltinESMExports(); }
});

test("observation v1 accepts legacy bindings but rejects an input hash without canonical binding", () => {
  const base = { schemaVersion: "paper_simulation_observation.v1", event: "accepted", simulationRunId: id, batchId: id, acceptedAt: time };
  const hash = "sha256:" + "a".repeat(64);
  assert.equal(paperSimulationObservationEventSchema.safeParse(base).success, true);
  assert.equal(paperSimulationObservationEventSchema.safeParse({ ...base, canonicalRequestHash: hash }).success, true);
  assert.equal(paperSimulationObservationEventSchema.safeParse({ ...base, inputProvenanceHash: hash }).success, false);
  assert.equal(paperSimulationObservationEventSchema.safeParse({ ...base, canonicalRequestHash: hash, inputProvenanceHash: hash }).success, true);
});
