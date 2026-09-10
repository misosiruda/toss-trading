import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { hashCanonicalPayload } from "../portfolio/runtimePolicyContracts.js";
import { FileHistoricalMarketSnapshotStore } from "./repositories.js";
import { getDurableHistoricalMarketSnapshotObservation, resolveObservedHistoricalMarketSnapshotHistory,
  type VerifiedHistoricalMarketSnapshotHistory } from "./historicalMarketSnapshotSource.js";

test("historical source observes complete canonical content with frozen callback-only leases", async () => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  const records = [snapshot("first"), snapshot("second")];
  await store.replaceAll(records);
  let retained!: VerifiedHistoricalMarketSnapshotHistory;
  await store.withDurableVerifiedHistory(async (history) => {
    retained = history;
    const receipt = getDurableHistoricalMarketSnapshotObservation(history);
    assert.equal(receipt.recordCount, 2);
    assert.equal(receipt.recordsHash, hashCanonicalPayload(records));
    assert.deepEqual(history.records, records);
    assert.deepEqual(resolveObservedHistoricalMarketSnapshotHistory(history, receipt), records);
    frozen(history); frozen(receipt);
    assert.throws(() => getDurableHistoricalMarketSnapshotObservation(structuredClone(history)), /live durable/);
  });
  assert.throws(() => getDurableHistoricalMarketSnapshotObservation(retained), /live durable/);
  await assert.rejects(fs.readFile(lockPath(path)), { code: "ENOENT" });
}));

test("historical source preserves source prefixes across append and restart but rejects replaced materialization", async () => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  await store.append(snapshot("first"));
  const receipt = await store.withDurableVerifiedHistory(async (history) => getDurableHistoricalMarketSnapshotObservation(history));
  await store.append(snapshot("second"));
  await new FileHistoricalMarketSnapshotStore(path).withDurableVerifiedHistory(async (history) => {
    assert.deepEqual(resolveObservedHistoricalMarketSnapshotHistory(history, JSON.parse(JSON.stringify(receipt))), [snapshot("first")]);
    for (const patch of [{ recordCount: 3 }, { recordsHash: `sha256:${"b".repeat(64)}` },
      { observedAt: "2099-01-01T00:00:00.000Z" }, { extra: true }]) {
      assert.throws(() => resolveObservedHistoricalMarketSnapshotHistory(history, { ...receipt, ...patch }));
    }
  });
  await store.replaceAll([{ ...snapshot("first"), createdAt: "2026-09-02T00:00:00.000Z" }, snapshot("second")]);
  await store.withDurableVerifiedHistory(async (history) => {
    assert.throws(() => resolveObservedHistoricalMarketSnapshotHistory(history, receipt), /source prefix/);
  });
}));

test("historical source holds the common append and dataset replacement lock through the consumer", async () => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  const contender = new FileHistoricalMarketSnapshotStore(path, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
  await store.append(snapshot("first"));
  await store.withDurableVerifiedHistory(async (history) => {
    await assert.rejects(contender.append(snapshot("blocked")), /lock is unavailable/);
    await assert.rejects(contender.replaceAll([snapshot("replacement")]), /lock is unavailable/);
    assert.deepEqual(history.records, [snapshot("first")]);
    assert.equal((await store.readAll()).records.length, 1); // Inspection reads remain non-locking.
  });
  await contender.append(snapshot("second"));
  await contender.replaceAll([snapshot("replacement")]);
  assert.deepEqual((await store.readAll()).records, [snapshot("replacement")]);
}));

test("historical source snapshots writer input before waiting and serializes concurrent appends", async () => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  const first = snapshot("first");
  const pending = store.append(first);
  first.lastPriceKrw = 999;
  await pending;
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.append(snapshot(`parallel-${index}`))));
  await store.withDurableVerifiedHistory(async (history) => {
    assert.equal(history.records.length, 9);
    assert.equal(history.records[0]!.lastPriceKrw, 100);
    assert.equal(new Set(history.records.map((item) => item.snapshotId)).size, 9);
  });
}));

test("historical dataset replacement preserves the previous complete source on pre-publication failure", async (context) => {
  for (const phase of ["write", "sync", "rename"] as const) await withDirectory(async (path) => {
    const store = new FileHistoricalMarketSnapshotStore(path);
    await store.replaceAll([snapshot("old")]);
    const before = await fs.readFile(path);
    const originalOpen = fs.open;
    let injected = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (phase !== "rename" && String(args[0]).endsWith(".tmp") && args[1] === "wx") {
        context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => { injected = true; throw new Error("temporary dataset failed"); });
      }
      return handle;
    });
    const originalRename = fs.rename;
    const renameMock = context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      if (phase === "rename" && args[1] === path) { injected = true; throw new Error("temporary dataset failed"); }
      return originalRename(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.replaceAll([snapshot("new")]), /temporary dataset failed/); }
    finally { mock.mock.restore(); renameMock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.deepEqual(await fs.readFile(path), before);
    assert.equal((await fs.readdir(dirname(path))).filter((name) => name.endsWith(".tmp")).length, 1);
    await store.withDurableVerifiedHistory(async (history) => assert.deepEqual(history.records, [snapshot("old")]));
    await store.replaceAll([snapshot("new")]);
    assert.deepEqual((await store.readAll()).records, [snapshot("new")]);
  });
});

test("historical strict source rejects corrupt suffix torn line duplicate identity and noncanonical records without changing inspection reads", async () => withDirectory(async (path) => {
  const valid = JSON.stringify(snapshot("first"));
  const store = new FileHistoricalMarketSnapshotStore(path);
  for (const raw of [`${valid}\nnot-json\n`, valid, `${valid}\n${valid}\n`,
    `${JSON.stringify({ ...snapshot("first"), symbol: " padded " })}\n`,
    `${JSON.stringify({ ...snapshot("first"), extra: true })}\n`,
    `${JSON.stringify({ ...snapshot("first"), sourceRefs: ["bad\ud800"] })}\n`,
    `${valid.replace('"volume":10', '"volume":-0')}\n`]) {
    await fs.writeFile(path, raw);
    let invoked = false;
    await assert.rejects(store.withDurableVerifiedHistory(async () => { invoked = true; }));
    assert.equal(invoked, false);
  }
  await fs.writeFile(path, `${valid}\nnot-json\n`);
  assert.deepEqual(await store.readAll(), { records: [snapshot("first")], corruptLineCount: 1 });
  const selected = await store.readUpTo({ asOf: new Date("2026-09-02T00:00:00.000Z") });
  assert.equal(selected.corruptLineCount, 1);
  assert.deepEqual(selected.records, [snapshot("first")]);
}));

test("historical strict source rejects invalid UTF-8 rather than authenticating replacement characters", async () => withDirectory(async (path) => {
  const raw = JSON.stringify({ ...snapshot("first"), name: "BAD" }) + "\n";
  const bytes = Buffer.from(raw); bytes[raw.indexOf("BAD")] = 0xff;
  await fs.writeFile(path, bytes);
  await assert.rejects(new FileHistoricalMarketSnapshotStore(path).withDurableVerifiedHistory(async () => {}), /invalid UTF-8/);
}));

test("historical source validates materialization and receipt chronology including saved prefixes", async (context) => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  await store.append(snapshot("first"));
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-08-31T00:00:00.000Z") });
  try { await assert.rejects(store.withDurableVerifiedHistory(async () => {}), /predates stored materialization/); }
  finally { context.mock.timers.reset(); }
  await store.withDurableVerifiedHistory(async (history) => {
    const receipt = getDurableHistoricalMarketSnapshotObservation(history);
    assert.throws(() => resolveObservedHistoricalMarketSnapshotHistory(history,
      { ...receipt, observedAt: "2026-08-31T00:00:00.000Z" }), /predates stored materialization/);
  });
  for (const patch of [{ createdAt: "2026-08-31T00:00:00.000Z" }, { observedAt: "2026-09-01T00:00:00" },
    { createdAt: "2026-02-30T00:00:00.000Z" }]) {
    await fs.writeFile(path, JSON.stringify({ ...snapshot("first"), ...patch }) + "\n");
    await assert.rejects(store.withDurableVerifiedHistory(async () => {}));
  }
}));

test("historical observation expires on consumer and release failure and preserves foreign tokens", async () => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  let retained!: VerifiedHistoricalMarketSnapshotHistory;
  await assert.rejects(store.withDurableVerifiedHistory(async (history) => { retained = history; throw new Error("consumer failed"); }), /consumer failed/);
  assert.throws(() => getDurableHistoricalMarketSnapshotObservation(retained), /live durable/);
  await assert.rejects(fs.readFile(lockPath(path)), { code: "ENOENT" });
  await assert.rejects(store.withDurableVerifiedHistory(async (history) => { retained = history; await fs.writeFile(lockPath(path), "foreign\n"); }), /ownership changed/);
  assert.throws(() => getDurableHistoricalMarketSnapshotObservation(retained), /live durable/);
  assert.equal(await fs.readFile(lockPath(path), "utf8"), "foreign\n");
}));

test("historical durable observation rejects sync failure same-size changes and pathname replacement before issuing a lease", async (context) => {
  for (const phase of ["sync", "rewrite", "replacement"] as const) await withDirectory(async (path) => {
    const store = new FileHistoricalMarketSnapshotStore(path);
    await store.append(snapshot("first"));
    const originalOpen = fs.open;
    let injected = false, invoked = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") {
        const originalSync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          injected = true;
          if (phase === "sync") throw new Error("source sync failed");
          await originalSync();
          const bytes = await fs.readFile(path);
          if (phase === "replacement") { await fs.rename(path, `${path}.old`); await fs.writeFile(path, bytes); }
          else await fs.writeFile(path, bytes.toString("utf8").replace('"lastPriceKrw":100', '"lastPriceKrw":101'));
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.withDurableVerifiedHistory(async () => { invoked = true; }), /sync failed|changed during observation/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.equal(invoked, false);
  });
});

test("historical source observes absence without creating a dataset and rejects files appearing during the absence check", async (context) => withDirectory(async (path) => {
  const store = new FileHistoricalMarketSnapshotStore(path);
  const receipt = await store.withDurableVerifiedHistory(async (history) => getDurableHistoricalMarketSnapshotObservation(history));
  assert.equal(receipt.recordCount, 0);
  await assert.rejects(fs.readFile(path), { code: "ENOENT" });
  const originalOpen = fs.open;
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === path && args[1] === "r+") { await fs.writeFile(path, ""); throw Object.assign(new Error("injected missing"), { code: "ENOENT" }); }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(store.withDurableVerifiedHistory(async () => {}), /appeared during observation/); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
}));

test("historical source lock retries only acquisition and preserves failed initialization barriers", async (context) => {
  for (const phase of ["acquisition", "write", "sync"] as const) await withDirectory(async (path) => {
    const store = new FileHistoricalMarketSnapshotStore(path, { lockTimeoutMs: 1000, lockRetryDelayMs: 5 });
    const originalOpen = fs.open;
    let attempts = 0;
    const failure = Object.assign(new Error("injected lock error"), { code: "EPERM" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] !== lockPath(path) || args[1] !== "wx") return originalOpen(...args);
      attempts += 1;
      if (phase === "acquisition" && attempts <= 2) throw failure;
      const handle = await originalOpen(...args);
      if (phase !== "acquisition") context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => {
        await fs.writeFile(lockPath(path), "uncertain\n"); throw failure;
      });
      return handle;
    });
    syncBuiltinESMExports();
    try {
      if (phase === "acquisition" && process.platform === "win32") { await store.append(snapshot("first")); assert.equal(attempts, 3); }
      else { await assert.rejects(store.append(snapshot("first")), (value) => value === failure); assert.equal(attempts, 1); }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    if (phase !== "acquisition") assert.equal(await fs.readFile(lockPath(path), "utf8"), "uncertain\n");
  });
});

test("historical source preserves abandoned locks with a monotonic timeout", async (context) => withDirectory(async (path) => {
  await fs.writeFile(lockPath(path), "abandoned\n");
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  try {
    await assert.rejects(new FileHistoricalMarketSnapshotStore(path, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).append(snapshot("first")),
      (value: Error) => /lock is unavailable/.test(value.message) && (value.cause as NodeJS.ErrnoException).code === "EEXIST");
  } finally { context.mock.timers.reset(); }
  assert.equal(await fs.readFile(lockPath(path), "utf8"), "abandoned\n");
}));

test("historical writers flush new directory ancestors before publication and fail closed on ancestor sync errors", async (context) => {
  for (const operation of ["append", "replace"] as const) for (const fail of [false, true]) await withDirectory(async (path) => {
    const root = await fs.realpath(dirname(path));
    const parent = join(root, "new-parent");
    const directory = join(parent, "new-child");
    const target = join(directory, basename(path));
    const visited: string[] = [];
    const expected = [root, parent, directory];
    let published = false;
    const originalOpen = fs.open;
    const failure = Object.assign(new Error("ancestor sync failed"), { code: "EIO" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const name = String(args[0]);
      if (args[1] === "r" && expected.includes(name)) {
        // Windows cannot open directories for fsync on some filesystems.
        // Inject the supported-directory contract to verify ordering and errors.
        return { sync: async () => {
          visited.push(name);
          if (fail && name === parent) throw failure;
        }, close: async () => {} } as Awaited<ReturnType<typeof fs.open>>;
      }
      if ((name === target && args[1] === "a") || (name.endsWith(".tmp") && args[1] === "wx")) {
        published = true;
        assert.deepEqual(visited.slice(0, 3), expected);
      }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      const store = new FileHistoricalMarketSnapshotStore(target);
      const pending = operation === "append" ? store.append(snapshot("first")) : store.replaceAll([snapshot("first")]);
      if (fail) {
        await assert.rejects(pending, (error) => error === failure);
        assert.equal(published, false);
        assert.deepEqual(await fs.readdir(directory), []);
        await assert.rejects(fs.readFile(target), { code: "ENOENT" });
      } else {
        await pending;
        assert.equal(published, true);
        assert.deepEqual((await store.readAll()).records, [snapshot("first")]);
      }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("historical ingest entry points route dataset replacement through the shared snapshot store", async () => {
  for (const filename of ["historicalYahooDailyIngest", "tossInvestHistoricalChartIngest"]) {
    const source = await fs.readFile(join(process.cwd(), "src", "cli", `${filename}.ts`), "utf8");
    assert.match(source, /new FileHistoricalMarketSnapshotStore\(outputPath\)\.replaceAll\(result\.snapshots\)/);
    assert.doesNotMatch(source, /writeFile\(\s*outputPath/);
  }
});

function snapshot(snapshotId: string): HistoricalMarketSnapshot {
  return { snapshotId, market: "KR", symbol: "SYNTH", interval: "1d", observedAt: "2026-09-01T00:00:00.000Z",
    lastPriceKrw: 100, volume: 10, sourceRefs: ["synthetic"], createdAt: "2026-09-01T00:00:00.000Z" };
}
function lockPath(path: string) { return join(dirname(path), `.${basename(path)}.lock`); }
function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function withDirectory(run: (path: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "toss-historical-source-"));
  try { await run(join(directory, "historical-market-snapshots.jsonl")); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}
