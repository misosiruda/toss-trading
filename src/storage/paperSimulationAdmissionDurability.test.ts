import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { resolvePaperSimulationConfig } from "../api/paperSimulationConfig.js";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { paperSimulationInputPath } from "./paperSimulationInputStore.js";
import { acceptPaperSimulationWithAdmissionContext, PaperSimulationObservationConflict, paperSimulationObservationPath,
  resolvePaperSimulationAdmissionContext, type PaperSimulationAdmissionContext } from "./paperSimulationObservationStore.js";
import { paperSimulationRequestPath } from "./paperSimulationRequestStore.js";

const id = "paper_sim_20261007090000000_durability";
const acceptedAt = "2026-10-07T09:00:00.000Z";
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "admission-durability-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = join(root, "paper"), snapshot = resolvePaperSimulationConfig(simulationConfig(), {});
  const admit = () => acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt,
    { requestedConfig: snapshot.requestedConfig, inputSnapshot: snapshot });
  return { storage, admit, path: paperSimulationObservationPath(storage, id) };
}

for (const target of ["canonical", "input", "accepted"] as const) {
  for (const phase of ["file_open", "write", "sync", "close", "directory_open", "directory_sync", "directory_close"] as const) {
    test(`${target} ${phase} failure cannot return an issued context and preserves the ID barrier`, async t => {
      const { storage, admit, path } = await fixture(t);
      const targetPath = target === "canonical" ? paperSimulationRequestPath(storage, id)
        : target === "input" ? paperSimulationInputPath(storage, id) : path;
      const originalOpen = fs.open, denied = Object.assign(new Error("synthetic admission durability failure"), { code: "EIO" });
      let context: PaperSimulationAdmissionContext | undefined, closed = false, failures = 0;
      const fail = () => { failures++; throw denied; };
      const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] === targetPath && phase === "file_open") fail();
        const directory = closed && args[0] === dirname(targetPath) && args[1] === "r";
        if (directory && phase === "directory_open") fail();
        const handle = await originalOpen(...args);
        if (args[0] === targetPath) {
          if (phase === "write") t.mock.method(handle, "writeFile", async () => fail());
          if (phase === "sync") t.mock.method(handle, "sync", async () => fail());
          const close = handle.close.bind(handle);
          t.mock.method(handle, "close", async () => { await close(); closed = true; if (phase === "close") fail(); });
        }
        if (directory && phase === "directory_sync") t.mock.method(handle, "sync", async () => fail());
        if (directory && phase === "directory_close") {
          const close = handle.close.bind(handle);
          t.mock.method(handle, "close", async () => { await close(); fail(); });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(admit().then(value => { context = value; }), error => error === denied); }
      finally { open.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(failures, 1); assert.equal(context, undefined);
      assert.equal((await fs.lstat(dirname(path))).isDirectory(), true);
      if (target === "accepted") assert.equal((await fs.lstat(path + ".paper-log.lock")).isDirectory(), true);
      else await assert.rejects(fs.lstat(path), { code: "ENOENT" });
      await assert.rejects(admit(), PaperSimulationObservationConflict);
    });
  }
}

for (const phase of ["unlink_owner", "remove_lock"] as const) {
  test(`${phase} failure after durable accepted append cannot issue context`, async t => {
    const { admit, path } = await fixture(t), denied = new Error("synthetic release failure");
    const lock = path + ".paper-log.lock";
    let context: PaperSimulationAdmissionContext | undefined, failures = 0;
    const unlink = fs.unlink, rmdir = fs.rmdir;
    const mock = phase === "unlink_owner"
      ? t.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
        if (dirname(String(args[0])) === lock) { failures++; throw denied; } return unlink(...args);
      })
      : t.mock.method(fs, "rmdir", async (...args: Parameters<typeof fs.rmdir>) => {
        if (args[0] === lock) { failures++; throw denied; } return rmdir(...args);
      });
    syncBuiltinESMExports();
    try { await assert.rejects(admit().then(value => { context = value; }), error => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(failures, 1); assert.equal(context, undefined);
    assert.equal(JSON.parse((await fs.readFile(path, "utf8")).trim()).event, "accepted");
    assert.equal((await fs.lstat(lock)).isDirectory(), true);
    await assert.rejects(admit(), PaperSimulationObservationConflict);
  });
}

test("issuance waits for accepted file, directory and lock release without a post-accept input reread", async t => {
  const { storage, admit, path } = await fixture(t), lock = path + ".paper-log.lock";
  const events: string[] = [];
  let acceptedClosed = false, inputRereads = 0, context: PaperSimulationAdmissionContext | undefined;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocked = new Promise<void>(resolve => { entered = resolve; });
  const originalOpen = fs.open, originalRmdir = fs.rmdir;
  const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (acceptedClosed && args[0] === paperSimulationInputPath(storage, id)) { inputRereads++; throw new Error("input reader unavailable"); }
    const handle = await originalOpen(...args);
    if (args[0] === path && args[1] === "a") {
      const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
      t.mock.method(handle, "sync", async () => { await sync(); events.push("accepted_sync"); });
      t.mock.method(handle, "close", async () => { await close(); acceptedClosed = true; events.push("accepted_close"); });
    }
    if (acceptedClosed && args[0] === dirname(path) && args[1] === "r") {
      const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
      t.mock.method(handle, "sync", async () => { await sync(); events.push("directory_sync"); });
      t.mock.method(handle, "close", async () => { await close(); events.push("directory_close"); });
    }
    return handle;
  });
  const rmdir = t.mock.method(fs, "rmdir", async (...args: Parameters<typeof fs.rmdir>) => {
    if (args[0] === lock) { events.push("release_enter"); entered(); await gate; }
    await originalRmdir(...args);
    if (args[0] === lock) events.push("release_complete");
  });
  syncBuiltinESMExports();
  const pending = admit().then(value => { context = value; events.push("issued"); });
  try {
    await Promise.race([blocked, pending]);
    assert.equal(context, undefined);
    assert.equal((await fs.lstat(lock)).isDirectory(), true);
    release(); await pending;
    assert.deepEqual(events, ["accepted_sync", "accepted_close", "directory_sync", "directory_close", "release_enter", "release_complete", "issued"]);
    assert.equal(inputRereads, 0);
    assert.equal(resolvePaperSimulationAdmissionContext(context).status, "available");
    await assert.rejects(fs.lstat(lock), { code: "ENOENT" });
  } finally {
    release();
    try { await pending; } finally { open.mock.restore(); rmdir.mock.restore(); syncBuiltinESMExports(); }
  }
});
