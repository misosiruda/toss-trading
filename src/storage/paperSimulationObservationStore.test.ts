import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  acceptPaperSimulation,
  PAPER_SIMULATION_OBSERVATIONS_FILE_NAME,
  PaperSimulationObservationConflict,
  paperSimulationObservationPath,
  readPaperSimulationObservation,
  recordPaperSimulationRunnerFailure
} from "./paperSimulationObservationStore.js";

const simulationRunId = "paper_sim_20261002120000000_fixture";
const acceptedAt = "2026-10-02T12:00:00.000Z";
const observedAt = "2026-10-02T12:00:01.000Z";
const accepted = {
  schemaVersion: "paper_simulation_observation.v1",
  simulationRunId, batchId: simulationRunId, acceptedAt, event: "accepted"
};
const failed = { ...accepted, event: "runner_failed", observedAt, reasonCode: "runner_rejected" };
const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

test("one reserved simulation appends acceptance then failure without rewriting the accepted prefix", async (context) => {
  const { storage, path, root } = await fixture(context);
  assert.equal(path, join(dirname(storage), "batch-replay", simulationRunId, PAPER_SIMULATION_OBSERVATIONS_FILE_NAME));
  await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
  const prefix = await fs.readFile(path, "utf8");
  assert.equal(prefix, jsonl(accepted));
  assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), {
    status: "available", schemaVersion: accepted.schemaVersion,
    simulationRunId, batchId: simulationRunId, acceptedAt, outcome: "unknown", runnerFailure: null
  });
  await recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt);
  assert.equal(await fs.readFile(path, "utf8"), prefix + jsonl(failed));
  const beforeRead = await snapshot(root);
  assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), {
    status: "available", schemaVersion: accepted.schemaVersion,
    simulationRunId, batchId: simulationRunId, acceptedAt,
    outcome: "runner_failed", runnerFailure: { observedAt, reasonCode: "runner_rejected" }
  });
  assert.deepEqual(await snapshot(root), beforeRead);
  assert.deepEqual(await fs.readdir(dirname(path)), [PAPER_SIMULATION_OBSERVATIONS_FILE_NAME]);
  await assert.rejects(recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt));
  assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted, failed));
});

test("missing and invalid identity observations are read-only and allocate no storage", async (context) => {
  const { storage, root } = await fixture(context);
  const before = await snapshot(root);
  assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "missing", simulationRunId });
  for (const id of ["../escape", `${simulationRunId}/child`, "invalid"]) {
    assert.throws(() => paperSimulationObservationPath(storage, id));
    assert.deepEqual(await readPaperSimulationObservation(storage, id), { status: "invalid", simulationRunId: id });
    await assert.rejects(acceptPaperSimulation(storage, id, acceptedAt));
  }
  assert.deepEqual(await snapshot(root), before);
});

test("a reserved directory without a log remains missing and is never repaired by reading", async (context) => {
  const { storage, path, root } = await fixture(context);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(join(dirname(path), "sentinel"), "keep");
  const before = await snapshot(root);
  assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "missing", simulationRunId });
  assert.deepEqual(await snapshot(root), before);
});

for (const [name, bytes] of [
  ["corrupt suffix", Buffer.from(jsonl(accepted) + "private-error\n")],
  ["torn suffix", Buffer.from(jsonl(accepted) + JSON.stringify(failed))],
  ["duplicate acceptance", Buffer.from(jsonl(accepted, accepted))],
  ["wrong record order", Buffer.from(jsonl(failed, accepted))],
  ["wrong batch identity", Buffer.from(jsonl({ ...accepted, batchId: "paper_sim_20261002120000000_other" }))],
  ["unknown fields", Buffer.from(jsonl(accepted, { ...failed, error: "synthetic-private-error" }))],
  ["invalid UTF-8", Buffer.concat([Buffer.from(jsonl(accepted)), Buffer.from([0xff, 0x0a])])],
  ["oversized file", Buffer.from("x".repeat(4097))]
] as const) {
  test(`stored ${name} is invalid with no prefix salvage or read-side mutation`, async (context) => {
    const { storage, path, root } = await fixture(context);
    await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, bytes);
    const before = await snapshot(root);
    assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "invalid", simulationRunId });
    assert.deepEqual(await snapshot(root), before);
  });
}

test("read failures expose only unavailable and neither raw errors nor recovery mutations", async (context) => {
  const { storage, path, root } = await fixture(context);
  await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
  const before = await snapshot(root), originalOpen = fs.open;
  const denied = Object.assign(new Error("synthetic-private-credential-and-path"), { code: "EACCES" });
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === path) throw denied;
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try { assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(await snapshot(root), before);
});

test("an existing append barrier makes even valid bytes unavailable without inspecting or removing the barrier", async (context) => {
  const { storage, path, root } = await fixture(context);
  await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
  await fs.mkdir(`${path}.paper-log.lock`); await fs.writeFile(join(`${path}.paper-log.lock`, "sentinel-owner"), "keep\n");
  const before = await snapshot(root), originalOpen = fs.open;
  let observationOpens = 0;
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === path) observationOpens++;
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try { assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(observationOpens, 0); assert.deepEqual(await snapshot(root), before);
});

for (const part of ["ancestor", "batch", "simulation"] as const) {
  test(`a symlinked ${part} directory is unavailable and cannot receive a failure append`, async (context) => {
    const { storage, path, root } = await fixture(context);
    await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
    const alias = part === "ancestor" ? dirname(storage) : part === "batch" ? dirname(dirname(path)) : dirname(path);
    const moved = join(root, "moved-directory");
    await fs.rename(alias, moved); await fs.symlink(moved, alias, "dir");
    const before = await snapshot(root);
    assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId });
    await assert.rejects(recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt));
    await assert.rejects(acceptPaperSimulation(storage, simulationRunId, acceptedAt));
    assert.deepEqual(await snapshot(root), before);
  });
}

for (const alias of ["symlink", "hardlink", "directory"] as const) {
  test(`an observation ${alias} is unavailable and cannot be appended`, async (context) => {
    const { storage, path, root } = await fixture(context);
    await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
    if (alias === "hardlink") await fs.link(path, join(root, "alias-log"));
    else {
      await fs.rename(path, join(root, "original-log"));
      if (alias === "symlink") await fs.symlink(join(root, "original-log"), path, "file");
      else await fs.mkdir(path);
    }
    const before = await snapshot(root);
    assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId });
    await assert.rejects(recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt));
    assert.deepEqual(await snapshot(root), before);
  });
}

for (const existing of ["directory", "file", "accepted", "failed"] as const) {
  test(`exclusive reservation preserves an existing ${existing} and every original byte`, async (context) => {
    const { storage, path, root } = await fixture(context);
    if (existing === "accepted" || existing === "failed") {
      await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
      if (existing === "failed") await recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt);
    } else {
      await fs.mkdir(dirname(dirname(path)), { recursive: true });
      if (existing === "file") await fs.writeFile(dirname(path), "original-file");
      else { await fs.mkdir(dirname(path)); await fs.writeFile(join(dirname(path), "sentinel"), "original-directory"); }
    }
    const before = await snapshot(root);
    await assert.rejects(acceptPaperSimulation(storage, simulationRunId, acceptedAt), PaperSimulationObservationConflict);
    assert.deepEqual(await snapshot(root), before);
  });
}

test("concurrent same-ID admissions have one exclusive winner and one accepted record", async (context) => {
  const { storage, path } = await fixture(context);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => acceptPaperSimulation(storage, simulationRunId, acceptedAt)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof PaperSimulationObservationConflict);
  assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted));
});

for (const phase of ["parent", "log"] as const) {
  test(`acceptance waits for ${phase} fsync before its caller can dispatch`, async (context) => {
    const { storage, path } = await fixture(context);
    const parent = dirname(dirname(path)); await fs.mkdir(parent, { recursive: true });
    const originalOpen = fs.open;
    let notify!: () => void, release!: () => void, dispatched = false;
    const entered = new Promise<void>((done) => { notify = done; }), gate = new Promise<void>((done) => { release = done; });
    const events: string[] = [];
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if ((phase === "parent" && args[0] === parent && args[1] === "r") || (phase === "log" && args[0] === path && args[1] === "a")) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { events.push("sync-enter"); notify(); await gate; await sync(); events.push("sync-complete"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    let admission: Promise<void> | undefined;
    try {
      admission = acceptPaperSimulation(storage, simulationRunId, acceptedAt).then(() => { dispatched = true; events.push("dispatch"); });
      await Promise.race([entered, admission]); assert.equal(dispatched, false);
      if (phase === "parent") await assert.rejects(fs.lstat(path), { code: "ENOENT" });
      else assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted));
      release(); await admission;
      assert.deepEqual(events, ["sync-enter", "sync-complete", "dispatch"]);
    } finally {
      release();
      try { await admission; } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    }
  });
}

for (const phase of ["parent", "log"] as const) {
  test(`acceptance ${phase} fsync failure prevents dispatch and permanently reserves the identity`, async (context) => {
    const { storage, path } = await fixture(context);
    const parent = dirname(dirname(path)); await fs.mkdir(parent, { recursive: true });
    const originalOpen = fs.open, denied = Object.assign(new Error("synthetic-private-fsync-error"), { code: "EIO" });
    let dispatched = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if ((phase === "parent" && args[0] === parent) || (phase === "log" && args[0] === path && args[1] === "a")) {
        context.mock.method(handle, "sync", async () => { throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(acceptPaperSimulation(storage, simulationRunId, acceptedAt).then(() => { dispatched = true; }), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(dispatched, false); assert.equal((await fs.lstat(dirname(path))).isDirectory(), true);
    await assert.rejects(acceptPaperSimulation(storage, simulationRunId, acceptedAt), PaperSimulationObservationConflict);
    assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: phase === "log" ? "unavailable" : "missing", simulationRunId });
    if (phase === "log") {
      assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted));
      assert.equal((await fs.lstat(`${path}.paper-log.lock`)).isDirectory(), true);
    }
  });
}

for (const phase of ["sync", "close"] as const) {
  test(`failure append ${phase} error retains bytes and barrier and cannot appear as a verified runner failure`, async (context) => {
    const { storage, path, root } = await fixture(context);
    await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
    const originalOpen = fs.open, denied = Object.assign(new Error("synthetic-private-runner-error"), { code: "EIO" });
    let appendOpens = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "a") {
        appendOpens++;
        if (phase === "sync") context.mock.method(handle, "sync", async () => { throw denied; });
        else {
          const close = handle.close.bind(handle);
          context.mock.method(handle, "close", async () => { await close(); throw denied; });
        }
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(appendOpens, 1); assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted, failed));
    assert.equal((await fs.lstat(`${path}.paper-log.lock`)).isDirectory(), true);
    const before = await snapshot(root);
    assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId });
    assert.deepEqual(await snapshot(root), before);
  });
}

test("failure appends reject mismatched acceptance times and backwards clocks without changing the accepted bytes", async (context) => {
  const { storage, path } = await fixture(context);
  await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
  await assert.rejects(recordPaperSimulationRunnerFailure(storage, simulationRunId, "2026-10-02T11:00:00.000Z", observedAt));
  await assert.rejects(recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, "2026-10-02T11:59:59.999Z"));
  assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted));
  assert.deepEqual(await fs.readdir(dirname(path)), [PAPER_SIMULATION_OBSERVATIONS_FILE_NAME]);
  assert.equal((await readPaperSimulationObservation(storage, simulationRunId)).status, "available");
});

test("shared-root parent fsync is required on initial admission and retry even when the root already exists", async (context) => {
  for (const existing of [false, true]) {
    const { storage, path } = await fixture(context);
    const sharedRoot = dirname(dirname(path)), sharedParent = dirname(sharedRoot);
    if (existing) {
      await fs.mkdir(sharedRoot, { recursive: true });
      await fs.writeFile(join(sharedRoot, "sentinel"), "original-shared-root");
    }
    const originalOpen = fs.open, denied = Object.assign(new Error("synthetic-shared-root-sync-error"), { code: "EIO" });
    let syncAttempts = 0, dispatches = 0, appendOpens = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === path && args[1] === "a") appendOpens++;
      const handle = await originalOpen(...args);
      if (args[0] === sharedParent && args[1] === "r") {
        context.mock.method(handle, "sync", async () => { syncAttempts++; throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        await assert.rejects(acceptPaperSimulation(storage, simulationRunId, acceptedAt).then(() => { dispatches++; }), (error) => error === denied);
        assert.equal(syncAttempts, attempt);
        assert.equal(dispatches, 0); assert.equal(appendOpens, 0);
        assert.equal((await fs.lstat(sharedRoot)).isDirectory(), true);
        await assert.rejects(fs.lstat(dirname(path)), { code: "ENOENT" });
        assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "missing", simulationRunId });
        assert.deepEqual(await fs.readdir(sharedRoot), existing ? ["sentinel"] : []);
        if (existing) assert.equal(await fs.readFile(join(sharedRoot, "sentinel"), "utf8"), "original-shared-root");
      }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await acceptPaperSimulation(storage, simulationRunId, acceptedAt).then(() => { dispatches++; });
    assert.equal(dispatches, 1);
    assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted));
    assert.equal((await readPaperSimulationObservation(storage, simulationRunId)).status, "available");
  }
});

for (const completion of ["before", "after"] as const) {
  test(`a failure writer finishing ${completion} the trailing barrier probe invalidates the earlier accepted view`, async (context) => {
    const { storage, path, root } = await fixture(context);
    await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
    const originalLstat = fs.lstat;
    let barrierProbes = 0, writerFinished = false, postWriterFingerprintChecks = 0;
    const mock = context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
      if (args[0] === path && writerFinished) postWriterFingerprintChecks++;
      if (args[0] === `${path}.paper-log.lock` && ++barrierProbes === 2) {
        if (completion === "after") {
          let missing: unknown;
          try { await originalLstat(...args); } catch (error) { missing = error; }
          assert.equal((missing as NodeJS.ErrnoException)?.code, "ENOENT");
          await recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt);
          writerFinished = true;
          throw missing; // Preserve the no-barrier result captured before the writer ran.
        }
        await recordPaperSimulationRunnerFailure(storage, simulationRunId, acceptedAt, observedAt);
        writerFinished = true;
      }
      return originalLstat(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId });
      assert.equal(barrierProbes, 2);
      assert.equal(writerFinished, true);
      assert.equal(postWriterFingerprintChecks, 1);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await fs.readFile(path, "utf8"), jsonl(accepted, failed));
    assert.deepEqual(await fs.readdir(dirname(path)), [PAPER_SIMULATION_OBSERVATIONS_FILE_NAME]);
    const beforeStableRead = await snapshot(root);
    const stable = await readPaperSimulationObservation(storage, simulationRunId);
    assert.equal(stable.status === "available" && stable.outcome, "runner_failed");
    assert.deepEqual(await snapshot(root), beforeStableRead);
  });
}

test("replacement or removal after the trailing barrier probe cannot return the earlier file observation", async (context) => {
  for (const mutation of ["replace", "remove"] as const) {
    const { storage, path } = await fixture(context);
    await acceptPaperSimulation(storage, simulationRunId, acceptedAt);
    const originalLstat = fs.lstat;
    let probes = 0;
    const mock = context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
      if (args[0] === `${path}.paper-log.lock` && ++probes === 2) {
        let missing: unknown;
        try { await originalLstat(...args); } catch (error) { missing = error; }
        assert.equal((missing as NodeJS.ErrnoException)?.code, "ENOENT");
        await fs.rename(path, `${path}.previous`);
        if (mutation === "replace") await fs.writeFile(path, jsonl(accepted));
        throw missing;
      }
      return originalLstat(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await readPaperSimulationObservation(storage, simulationRunId), { status: "unavailable", simulationRunId });
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await fs.readFile(`${path}.previous`, "utf8"), jsonl(accepted));
  }
});

async function fixture(context: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "paper-simulation-observation-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = join(root, "workspace", "storage");
  return { root, storage, path: paperSimulationObservationPath(storage, simulationRunId) };
}

async function snapshot(path: string): Promise<unknown> {
  const stat = await fs.lstat(path);
  const metadata = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, nlink: stat.nlink };
  if (stat.isSymbolicLink()) return { ...metadata, link: await fs.readlink(path) };
  if (stat.isFile()) return { ...metadata, bytes: (await fs.readFile(path)).toString("base64") };
  const entries = await fs.readdir(path); entries.sort();
  return { ...metadata, entries: await Promise.all(entries.map(async (name) => [name, await snapshot(join(path, name))])) };
}
