import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { type FileHandle, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { createManualAssignmentPaths, getDurableManualAssignmentObservation, ManualAssignmentFileRepository,
  resolveObservedManualAssignmentHistory, type VerifiedManualAssignmentHistory } from "./manualAssignmentFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;

test("manual durable source verifies absent empty and complete logs without exporting a lasting lease", async () => {
  await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    const path = createManualAssignmentPaths(dir).eventsPath;
    let captured: VerifiedManualAssignmentHistory | undefined;
    for (const present of [false, true]) {
      if (present) await writeFile(path, "");
      await repo.withDurableVerifiedHistory(async (history) => {
        captured = history;
        assert.deepEqual(history.events, []);
        const observation = getDurableManualAssignmentObservation(history);
        assert.equal(observation.eventCount, 0);
        assert.equal(observation.eventsHash, hashCanonicalPayload([]));
        assert.deepEqual(resolveObservedManualAssignmentHistory(history, observation), []);
        for (const object of [history, history.events, observation]) assert.ok(Object.isFrozen(object));
        for (const copy of [{ ...history }, JSON.parse(JSON.stringify(history))]) {
          assert.throws(() => getDurableManualAssignmentObservation(copy), /durable observation lease/);
        }
      });
      assert.throws(() => getDurableManualAssignmentObservation(captured!), /durable observation lease/);
      if (!present) await assert.rejects(readFile(path), { code: "ENOENT" });
    }
    const events = [event("classify"), event("opening", true)];
    for (const value of events) await repo.append(value);
    await repo.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(history.events, events);
      assert.equal(getDurableManualAssignmentObservation(history).eventsHash, hashCanonicalPayload(events));
      assert.ok(Object.isFrozen(history.events[0]!.evidenceRefs));
      assert.ok(Object.isFrozen(history.events[1]));
    });
    const plainEvents = await repo.readAll();
    assert.throws(() => getDurableManualAssignmentObservation({ events: plainEvents }), /durable observation lease/);
  });
});

test("manual durable source revalidates saved prefixes after append and restart including createdAt", async () => {
  await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    const first = event("first");
    await repo.append(first);
    const receipt = await repo.withDurableVerifiedHistory(async (history) => getDurableManualAssignmentObservation(history));
    await repo.append(event("second", true));
    const restarted = new ManualAssignmentFileRepository(dir);
    await restarted.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(resolveObservedManualAssignmentHistory(history, receipt), [first]);
      for (const patch of [{ eventCount: 3 }, { eventCount: 0 }, { eventsHash: HASH }, { eventCount: -0 },
        { unknown: true }, { observedAt: "9999-01-01T00:00:00.000Z" }]) {
        assert.throws(() => resolveObservedManualAssignmentHistory(history, { ...receipt, ...patch }));
      }
    });
    const path = createManualAssignmentPaths(dir).eventsPath;
    for (const replacement of [[], [event("other")], [{ ...first, createdAt: "2026-09-01T02:00:00.000Z" }]]) {
      await writeFile(path, replacement.map((value) => `${JSON.stringify(value)}\n`).join(""));
      await restarted.withDurableVerifiedHistory(async (history) => {
        assert.throws(() => resolveObservedManualAssignmentHistory(history, receipt), /durable source prefix/);
      });
    }
  });
});

test("manual durable source rejects corrupt suffixes torn lines duplicate IDs and independently altered payloads", async () => {
  await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    const path = createManualAssignmentPaths(dir).eventsPath;
    const value = event("first");
    const valid = `${JSON.stringify(value)}\n`;
    for (const raw of [valid + "{broken}\n", valid.trimEnd(), valid + "\n", valid + valid,
      `${JSON.stringify({ ...value, authorizationRef: "altered" })}\n`]) {
      await writeFile(path, raw);
      let called = false;
      await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }));
      assert.equal(called, false);
      assert.equal(await readFile(path, "utf8"), raw);
    }
    await assert.rejects(readFile(createManualAssignmentPaths(dir).lockPath), { code: "ENOENT" });
  });
});

test("manual source lease blocks another process writer and expires after consumer failure", async () => {
  await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    await repo.append(event("first"));
    let captured: VerifiedManualAssignmentHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history;
      const script = `import { ManualAssignmentFileRepository } from ${JSON.stringify(new URL("./manualAssignmentFiles.js", import.meta.url).href)};
        const repo = new ManualAssignmentFileRepository(process.argv[1], { lockTimeoutMs: 50, lockRetryDelayMs: 5 });
        try { await repo.append(JSON.parse(process.argv[2])); process.exitCode = 3; }
        catch (error) { if (!/lock is unavailable/.test(error.message)) throw error; console.log("writer-blocked"); }`;
      const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, dir, JSON.stringify(event("second"))]);
      assert.match(result.stdout, /writer-blocked/);
      throw new Error("consumer failed");
    }), /consumer failed/);
    assert.throws(() => getDurableManualAssignmentObservation(captured!), /durable observation lease/);
    await repo.append(event("second"));
    assert.equal((await repo.readAll()).length, 2);
  });
});

test("manual source fsync failure invokes no consumer and successful observation follows fsync", async (context) => {
  await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    await repo.append(event("first"));
    const path = createManualAssignmentPaths(dir).eventsPath;
    const raw = await readFile(path, "utf8");
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let failing = true;
    let called = false;
    let syncedAt = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-09T00:00:00.000Z") });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        if (failing) throw new Error("injected source sync failure");
        await originalSync.call(this);
        context.mock.timers.tick(10);
        syncedAt = Date.now();
        return;
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }), /injected source sync failure/);
      assert.equal(called, false);
      failing = false;
      await repo.withDurableVerifiedHistory(async (history) => {
        assert.ok(syncedAt > 0);
        assert.equal(Date.parse(getDurableManualAssignmentObservation(history).observedAt), syncedAt);
      });
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
    assert.equal(await readFile(path, "utf8"), raw);
  });
});

test("manual source rejects rewrite replacement append and truncation during observation", async (context) => {
  for (const mode of ["rewrite", "replace", "append", "truncate"] as const) await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    await repo.append(event("first"));
    const path = createManualAssignmentPaths(dir).eventsPath;
    const originalOpen = fs.open;
    let changed = false;
    let called = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") {
        const originalSync = handle.sync;
        context.mock.method(handle, "sync", async () => {
          changed = true;
          if (mode === "replace") await rename(path, join(dir, "displaced.jsonl"));
          const values = mode === "truncate" ? [] : mode === "append" ? [event("first"), event("second")] : [event("other")];
          await writeFile(path, values.map((value) => `${JSON.stringify(value)}\n`).join(""));
          await originalSync.call(handle);
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }), /source changed during durable observation/);
      assert.equal(changed, true);
      assert.equal(called, false);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await repo.withDurableVerifiedHistory(async (history) => assert.equal(history.events.length, mode === "truncate" ? 0 : mode === "append" ? 2 : 1));
  });
});

test("manual absent source detects appearance and both empty and present sources fail on directory sync errors", async (context) => {
  for (const mode of ["appearance", "absent_sync", "present_sync"] as const) await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    const path = createManualAssignmentPaths(dir).eventsPath;
    if (mode === "present_sync") await repo.append(event("first"));
    const originalOpen = fs.open;
    let observed = false;
    let called = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (observed && args[0] === dir && args[1] === "r" && mode !== "appearance") {
        throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" });
      }
      if (args[0] === path && args[1] === "r+") {
        observed = true;
        try { return await originalOpen(...args); }
        catch (error) {
          if (mode === "appearance") await writeFile(path, `${JSON.stringify(event("first"))}\n`);
          throw error;
        }
      }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }), mode === "appearance" ? /source appeared/ : /directory sync failure/);
      assert.equal(observed, true);
      assert.equal(called, false);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await assert.rejects(readFile(createManualAssignmentPaths(dir).lockPath), { code: "ENOENT" });
    assert.equal((await repo.readAll()).length, mode === "absent_sync" ? 0 : 1);
  });
});

test("manual observation timestamp is not advanced by descriptor close after verification", async (context) => {
  await temporary(async (dir) => {
    const repo = new ManualAssignmentFileRepository(dir);
    await repo.append(event("first"));
    const path = createManualAssignmentPaths(dir).eventsPath;
    const start = Date.parse("2026-09-09T00:00:00.000Z");
    context.mock.timers.enable({ apis: ["Date"], now: start });
    const originalOpen = fs.open;
    let closed = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") {
        const originalClose = handle.close;
        context.mock.method(handle, "close", async () => {
          await originalClose.call(handle);
          closed = true;
          context.mock.timers.tick(10);
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await repo.withDurableVerifiedHistory(async (history) => {
        assert.equal(closed, true);
        assert.equal(Date.parse(getDurableManualAssignmentObservation(history).observedAt), start);
        assert.ok(Date.now() > start);
      });
    } finally { mock.mock.restore(); syncBuiltinESMExports(); context.mock.timers.reset(); }
  });
});

test("manual durable observation refuses a directory at the source pathname", async () => {
  await temporary(async (dir) => {
    const paths = createManualAssignmentPaths(dir);
    await mkdir(paths.eventsPath);
    let called = false;
    await assert.rejects(new ManualAssignmentFileRepository(dir).withDurableVerifiedHistory(async () => { called = true; }));
    assert.equal(called, false);
    assert.ok((await stat(paths.eventsPath)).isDirectory());
    await assert.rejects(readFile(paths.lockPath), { code: "ENOENT" });
  });
});

function event(authorizationRef: string, opening = false) {
  const common = { portfolioId: "paper-portfolio", policyHash: HASH, market: "KR" as const, symbol: "005930",
    bucket: "intraday" as const, asOf: "2026-09-01T00:30:00.000Z", selectionPolicyRecordId: "selection",
    selectionPolicyHash: HASH, reasonCodes: ["manual"], evidenceRefs: ["evidence"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z", evidenceValidationHash: HASH, authorizationRef,
    createdAt: "2026-09-01T01:00:00.000Z" };
  return createManualAssignmentEvent(opening ? { ...common, authorizationScope: "open_or_increase", evidenceEligibility: "eligible",
    portfolioSnapshotId: "snapshot", portfolioSnapshotHash: HASH, sizingInputRecordId: "sizing",
    minWeightRatio: 0, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumNotionalKrw: 1000, sizingInputHash: HASH, sizingOutputHash: HASH }
    : { ...common, authorizationScope: "classify_existing_reduce_only", evidenceEligibility: "blocked",
      classificationMinWeightRatio: 0.1, classificationTargetWeightRatio: 0.2, classificationMaxWeightRatio: 0.3 });
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "manual-durable-source-"));
  try { await operation(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
