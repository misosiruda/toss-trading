import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { type FileHandle, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { createBucketSelectionRequestPaths, getDurableBucketSelectionRequestObservation, BucketSelectionRequestFileRepository,
  resolveObservedBucketSelectionRequestHistory, type VerifiedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;

test("selection request durable source verifies absent empty and complete logs without exporting a lasting lease", async () => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
    let captured: VerifiedBucketSelectionRequestHistory | undefined;
    for (const present of [false, true]) {
      if (present) await writeFile(path, "");
      await repo.withDurableVerifiedHistory(async (history) => {
        captured = history;
        assert.deepEqual(history.requests, []);
        const observation = getDurableBucketSelectionRequestObservation(history);
        assert.equal(observation.requestCount, 0);
        assert.equal(observation.requestsHash, hashCanonicalPayload([]));
        assert.deepEqual(resolveObservedBucketSelectionRequestHistory(history, observation), []);
        for (const object of [history, history.requests, observation]) assert.ok(Object.isFrozen(object));
        for (const copy of [{ ...history }, JSON.parse(JSON.stringify(history))]) {
          assert.throws(() => getDurableBucketSelectionRequestObservation(copy), /durable observation lease/);
        }
      });
      assert.throws(() => getDurableBucketSelectionRequestObservation(captured!), /durable observation lease/);
      if (!present) await assert.rejects(readFile(path), { code: "ENOENT" });
    }
    const requests = [request("classify"), request("opening", true)];
    for (const value of requests) await repo.append(value);
    await repo.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(history.requests, requests);
      assert.equal(getDurableBucketSelectionRequestObservation(history).requestsHash, hashCanonicalPayload(requests));
      assert.ok(Object.isFrozen(history.requests[0]));
      assert.ok(Object.isFrozen(history.requests[1]));
    });
    const plainRequests = await repo.readAll();
    assert.throws(() => getDurableBucketSelectionRequestObservation({ requests: plainRequests }), /durable observation lease/);
  });
});

test("selection request durable source revalidates saved prefixes after append and restart including createdAt", async () => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    const first = request("first");
    await repo.append(first);
    const receipt = await repo.withDurableVerifiedHistory(async (history) => getDurableBucketSelectionRequestObservation(history));
    await repo.append(request("second", true));
    const restarted = new BucketSelectionRequestFileRepository(dir);
    await restarted.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(resolveObservedBucketSelectionRequestHistory(history, receipt), [first]);
      for (const patch of [{ requestCount: 3 }, { requestCount: 0 }, { requestsHash: HASH }, { requestCount: -0 },
        { unknown: true }, { observedAt: "9999-01-01T00:00:00.000Z" }]) {
        assert.throws(() => resolveObservedBucketSelectionRequestHistory(history, { ...receipt, ...patch }));
      }
    });
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
    for (const replacement of [[], [request("other")], [{ ...first, createdAt: "2026-09-01T02:00:00.000Z" }]]) {
      await writeFile(path, replacement.map((value) => `${JSON.stringify(value)}\n`).join(""));
      await restarted.withDurableVerifiedHistory(async (history) => {
        assert.throws(() => resolveObservedBucketSelectionRequestHistory(history, receipt), /durable source prefix/);
      });
    }
  });
});

test("selection request durable source rejects corrupt suffixes torn lines duplicate IDs and independently altered payloads", async () => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
    const value = request("first");
    const { requestId: _id, requestHash: _hash, ...creationInput } = value;
    const valid = `${JSON.stringify(value)}\n`;
    for (const raw of [valid + "{broken}\n", valid.trimEnd(), valid + "\n", valid + valid,
      valid + `${JSON.stringify(createBucketSelectionRequest({ ...creationInput, gapKrw: 200 }))}\n`,
      `${JSON.stringify({ ...value, gapKrw: 200 })}\n`]) {
      await writeFile(path, raw);
      let called = false;
      await assert.rejects(repo.withDurableVerifiedHistory(async () => { called = true; }));
      assert.equal(called, false);
      assert.equal(await readFile(path, "utf8"), raw);
    }
    await assert.rejects(readFile(createBucketSelectionRequestPaths(dir).lockPath), { code: "ENOENT" });
  });
});

test("selection request source lease blocks another process writer and expires after consumer failure", async () => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    await repo.append(request("first"));
    let captured: VerifiedBucketSelectionRequestHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history;
      const script = `import { BucketSelectionRequestFileRepository } from ${JSON.stringify(new URL("./bucketSelectionRequestFiles.js", import.meta.url).href)};
        const repo = new BucketSelectionRequestFileRepository(process.argv[1], { lockTimeoutMs: 50, lockRetryDelayMs: 5 });
        try { await repo.append(JSON.parse(process.argv[2])); process.exitCode = 3; }
        catch (error) { if (!/lock is unavailable/.test(error.message)) throw error; console.log("writer-blocked"); }`;
      const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, dir, JSON.stringify(request("second"))]);
      assert.match(result.stdout, /writer-blocked/);
      throw new Error("consumer failed");
    }), /consumer failed/);
    assert.throws(() => getDurableBucketSelectionRequestObservation(captured!), /durable observation lease/);
    await repo.append(request("second"));
    assert.equal((await repo.readAll()).length, 2);
  });
});

test("selection request source fsync failure invokes no consumer and successful observation follows fsync", async (context) => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    await repo.append(request("first"));
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
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
        assert.equal(Date.parse(getDurableBucketSelectionRequestObservation(history).observedAt), syncedAt);
      });
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
    assert.equal(await readFile(path, "utf8"), raw);
  });
});

test("selection request source rejects rewrite replacement append and truncation during observation", async (context) => {
  for (const mode of ["rewrite", "replace", "append", "truncate"] as const) await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    await repo.append(request("first"));
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
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
          const values = mode === "truncate" ? [] : mode === "append" ? [request("first"), request("second")] : [request("other")];
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
    await repo.withDurableVerifiedHistory(async (history) => assert.equal(history.requests.length, mode === "truncate" ? 0 : mode === "append" ? 2 : 1));
  });
});

test("selection request absent source detects appearance and both empty and present sources fail on directory sync errors", async (context) => {
  for (const mode of ["appearance", "absent_sync", "present_sync"] as const) await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
    if (mode === "present_sync") await repo.append(request("first"));
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
          if (mode === "appearance") await writeFile(path, `${JSON.stringify(request("first"))}\n`);
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
    await assert.rejects(readFile(createBucketSelectionRequestPaths(dir).lockPath), { code: "ENOENT" });
    assert.equal((await repo.readAll()).length, mode === "absent_sync" ? 0 : 1);
  });
});

test("selection request observation timestamp is not advanced by descriptor close after verification", async (context) => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    await repo.append(request("first"));
    const path = createBucketSelectionRequestPaths(dir).recordsPath;
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
        assert.equal(Date.parse(getDurableBucketSelectionRequestObservation(history).observedAt), start);
        assert.ok(Date.now() > start);
      });
    } finally { mock.mock.restore(); syncBuiltinESMExports(); context.mock.timers.reset(); }
  });
});

test("selection request durable observation refuses a directory at the source pathname", async () => {
  await temporary(async (dir) => {
    const paths = createBucketSelectionRequestPaths(dir);
    await mkdir(paths.recordsPath);
    let called = false;
    await assert.rejects(new BucketSelectionRequestFileRepository(dir).withDurableVerifiedHistory(async () => { called = true; }));
    assert.equal(called, false);
    assert.ok((await stat(paths.recordsPath)).isDirectory());
    await assert.rejects(readFile(paths.lockPath), { code: "ENOENT" });
  });
});

test("selection request observation rejects invalid UTF-8 even when lossy decoding would produce a hashed request", async () => {
  await temporary(async (dir) => {
    const value = request("replacement-\uFFFD");
    const raw = Buffer.from(`${JSON.stringify(value)}\n`);
    const index = raw.indexOf(Buffer.from("\uFFFD"));
    assert.ok(index > 0);
    const corrupt = Buffer.concat([raw.subarray(0, index), Buffer.from([0xff]), raw.subarray(index + 3)]);
    assert.equal(corrupt.toString("utf8"), raw.toString("utf8"));
    const paths = createBucketSelectionRequestPaths(dir);
    await writeFile(paths.recordsPath, corrupt);
    let called = false;
    await assert.rejects(new BucketSelectionRequestFileRepository(dir).withDurableVerifiedHistory(async () => { called = true; }), /invalid UTF-8/);
    assert.equal(called, false);
    assert.deepEqual(await readFile(paths.recordsPath), corrupt);
  });
});

test("selection request semantic retry preserves the originally observed createdAt and prefix", async () => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    const value = request("first");
    await repo.append(value);
    const observation = await repo.withDurableVerifiedHistory(async (history) => getDurableBucketSelectionRequestObservation(history));
    assert.deepEqual(await repo.append({ ...value, createdAt: "2026-09-01T02:00:00.000Z" }), value);
    await repo.withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(resolveObservedBucketSelectionRequestHistory(history, observation), [value]);
    });
  });
});

test("selection request lock contention expires with a frozen wall clock without deleting an abandoned lock", { timeout: 5_000 }, async (context) => {
  await temporary(async (dir) => {
    const paths = createBucketSelectionRequestPaths(dir);
    await writeFile(paths.lockPath, "abandoned\n");
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-09T00:00:00.000Z") });
    try {
      await assert.rejects(new BucketSelectionRequestFileRepository(dir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 })
        .withDurableVerifiedHistory(async () => assert.fail("consumer must not run")), /lock is unavailable/);
    } finally { context.mock.timers.reset(); }
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("selection request lock retries only acquisition contention and preserves failed initialization", async (context) => {
  for (const mode of ["open_contention", "open_denied", "token_write", "token_sync"] as const) await temporary(async (dir) => {
    const paths = createBucketSelectionRequestPaths(dir);
    const originalOpen = fs.open;
    let attempts = 0;
    let called = false;
    const injected = Object.assign(new Error(`injected ${mode}`), { code: mode === "open_denied" ? "EACCES" : "EPERM" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] !== paths.lockPath || args[1] !== "wx") return originalOpen(...args);
      attempts += 1;
      if (mode === "open_denied") throw injected;
      if (mode === "open_contention" && attempts === 1) {
        throw Object.assign(new Error("contention"), { code: process.platform === "win32" ? "EPERM" : "EEXIST" });
      }
      const handle = await originalOpen(...args);
      if (mode === "token_write") context.mock.method(handle, "writeFile", async () => { throw injected; });
      if (mode === "token_sync") context.mock.method(handle, "sync", async () => { throw injected; });
      return handle;
    });
    syncBuiltinESMExports();
    try {
      const operation = new BucketSelectionRequestFileRepository(dir).withDurableVerifiedHistory(async () => { called = true; });
      if (mode === "open_contention") { await operation; assert.equal(called, true); assert.equal(attempts, 2); }
      else { await assert.rejects(operation, (error) => error === injected); assert.equal(called, false); assert.equal(attempts, 1); }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    if (mode === "token_write" || mode === "token_sync") assert.ok((await stat(paths.lockPath)).isFile());
    else await assert.rejects(readFile(paths.lockPath), { code: "ENOENT" });
  });
});

test("selection request consumer failure is not retried and replacement lock ownership is retained", async () => {
  await temporary(async (dir) => {
    const repo = new BucketSelectionRequestFileRepository(dir);
    const paths = createBucketSelectionRequestPaths(dir);
    let calls = 0;
    const injected = Object.assign(new Error("consumer EPERM"), { code: "EPERM" });
    await assert.rejects(repo.withDurableVerifiedHistory(async () => { calls += 1; throw injected; }), (error) => error === injected);
    assert.equal(calls, 1);
    let captured: VerifiedBucketSelectionRequestHistory | undefined;
    await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
      captured = history;
      await writeFile(paths.lockPath, "replacement\n");
    }), /lock ownership changed/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "replacement\n");
    assert.throws(() => getDurableBucketSelectionRequestObservation(captured!), /durable observation lease/);
  });
});

function request(cycleId: string, alternateBucket = false) {
  return createBucketSelectionRequest({
    cycleId, triggerIdentity: "scheduled:boundary", triggerRef: "slot",
    portfolioId: "paper-portfolio", portfolioSnapshotId: "snapshot",
    portfolioSnapshotHash: HASH, policyHash: HASH, asOf: "2026-09-01T00:30:00.000Z",
    bucket: alternateBucket ? "intraday" : "long_term", gapBasis: "min",
    gapKrw: 100, availableSlots: 2, maximumAdditionalExposureKrw: 80,
    evidenceCutoffAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T01:00:00.000Z"
  });
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "selection-request-durable-source-"));
  try { await operation(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
