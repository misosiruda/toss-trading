import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import {
  PortfolioSizingSnapshotFileRepository,
  createPortfolioSizingSnapshotPaths,
  getDurablePortfolioSizingSnapshotObservation,
  resolveObservedPortfolioSizingSnapshotHistory,
  type VerifiedPortfolioSizingSnapshotHistory,
  type PortfolioSizingSnapshotObservation
} from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}` as const;

test("sizing snapshot repository appends, resolves, and converges retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const snapshot = sizingSnapshot();

    assert.deepEqual(await repository.append(snapshot), snapshot);
    assert.deepEqual(await repository.append(snapshot), snapshot);
    assert.deepEqual(
      await repository.resolveById(snapshot.portfolioSnapshotId),
      snapshot
    );
    assert.deepEqual(await repository.readAll(), [snapshot]);
    const raw = await readFile(
      createPortfolioSizingSnapshotPaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(snapshot)}\n`);
  });
});

test("sizing snapshot repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const snapshot = sizingSnapshot();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(snapshot))
    );
    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [snapshot]);
  });
});

test("sizing snapshot repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "snapshot.json");
    const snapshot = sizingSnapshot();
    await writeFile(fixturePath, JSON.stringify(snapshot), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );
    assert.deepEqual(stored, [snapshot, snapshot, snapshot, snapshot]);
    assert.deepEqual(
      await new PortfolioSizingSnapshotFileRepository(baseDir).readAll(),
      [snapshot]
    );
  });
});

test("sizing snapshot repository rejects semantic origin collisions", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    await repository.append(sizingSnapshot());

    await assert.rejects(
      () => repository.append(sizingSnapshot({ priceKrw: 101 })),
      /origin collision/
    );
  });
});

test("sizing snapshot repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioSizingSnapshotPaths(baseDir);
    const snapshot = sizingSnapshot();
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(snapshot)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(snapshot)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(snapshot)}\n${JSON.stringify({
        ...snapshot,
        portfolioSnapshotHash: HASH
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(snapshot)}\n${JSON.stringify(snapshot)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ID/);

    const originCollision = sizingSnapshot({ priceKrw: 101 });
    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(snapshot)}\n${JSON.stringify(originCollision)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate origin/);
  });
});

test("sizing snapshot repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioSizingSnapshotPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });
    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("snapshot durable observation covers empty and complete sources and expires with its lease", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    let captured: VerifiedPortfolioSizingSnapshotHistory | undefined;
    const empty = await repository.withDurableVerifiedHistory(async (history) => {
      captured = history;
      const observation = getDurablePortfolioSizingSnapshotObservation(history);
      assert.equal(observation.recordCount, 0);
      assert.equal(observation.recordsHash, hashCanonicalPayload([]));
      assert.deepEqual(resolveObservedPortfolioSizingSnapshotHistory(history, observation), []);
      assert.ok(Object.isFrozen(history));
      assert.ok(Object.isFrozen(history.snapshots));
      assert.ok(Object.isFrozen(observation));
      for (const copied of [{ ...history }, JSON.parse(JSON.stringify(history))]) {
        assert.throws(() => getDurablePortfolioSizingSnapshotObservation(copied), /durable observation lease/);
      }
      return observation;
    });
    assert.ok(captured);
    const expired = captured;
    assert.throws(() => getDurablePortfolioSizingSnapshotObservation(expired), /durable observation lease/);
    await assert.rejects(readFile(createPortfolioSizingSnapshotPaths(baseDir).recordsPath), { code: "ENOENT" });
    await repository.append(sizingSnapshot());
    await repository.withDurableVerifiedHistory(async (history) => {
      assert.equal(getDurablePortfolioSizingSnapshotObservation(history).recordCount, 1);
      assert.deepEqual(resolveObservedPortfolioSizingSnapshotHistory(history, empty), []);
      const content = resolveObservedPortfolioSizingSnapshotHistory(history, getDurablePortfolioSizingSnapshotObservation(history));
      assert.deepEqual(content, [sizingSnapshot()]);
      assert.throws(() => getDurablePortfolioSizingSnapshotObservation({ snapshots: content }), /durable observation lease/);
    });
  });
});

test("absent snapshot observation rechecks pathname after directory sync and rejects recovery races", async (context) => {
  for (const mode of ["appearance", "directory_sync_failure"] as const) await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const paths = createPortfolioSizingSnapshotPaths(baseDir);
    const snapshot = sizingSnapshot();
    const originalOpen = fs.open;
    let absent = false;
    let directoryFailed = false;
    let called = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (absent && !directoryFailed && mode === "directory_sync_failure" && args[0] === baseDir && args[1] === "r") {
        directoryFailed = true;
        throw Object.assign(new Error("injected absence directory sync failure"), { code: "EIO" });
      }
      try {
        return await originalOpen(...args);
      } catch (error) {
        if (!absent && args[0] === paths.recordsPath && args[1] === "r+" && (error as NodeJS.ErrnoException).code === "ENOENT") {
          absent = true;
          if (mode === "appearance") await writeFile(paths.recordsPath, `${JSON.stringify(snapshot)}\n`, "utf8");
        }
        throw error;
      }
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }),
        mode === "appearance" ? /source appeared during durable observation/ : /injected absence directory sync failure/);
      assert.equal(absent, true);
      assert.equal(called, false);
      if (mode === "directory_sync_failure") assert.equal(directoryFailed, true);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await repository.readAll(), mode === "appearance" ? [snapshot] : []);
    await assert.rejects(readFile(paths.lockPath), { code: "ENOENT" });
  });
});

test("snapshot observation follows source fsync and refuses to invoke consumers on sync failure", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    await repository.append(sizingSnapshot());
    const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    const before = await readFile(path, "utf8");
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let failing = true;
    let called = false;
    let syncedAt = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-07T00:00:00.000Z") });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        if (failing) throw new Error("injected snapshot sync failure");
        await originalSync.call(this);
        context.mock.timers.tick(10);
        syncedAt = Date.now();
        return;
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /injected snapshot sync failure/);
      assert.equal(called, false);
      assert.equal(await readFile(path, "utf8"), before);
      failing = false;
      await repository.withDurableVerifiedHistory(async (history) => {
        assert.ok(syncedAt > 0);
        assert.equal(Date.parse(getDurablePortfolioSizingSnapshotObservation(history).observedAt), syncedAt);
      });
      assert.equal(await readFile(path, "utf8"), before);
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  });
});

test("snapshot observation rejects non-cooperative rewrites and pathname replacement during sync", async (context) => {
  for (const mode of ["rewrite", "replace"] as const) await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const first = sizingSnapshot();
    const replacement = sizingSnapshot({ priceKrw: 101 });
    await repository.append(first);
    const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    const source = await stat(path);
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let changed = false;
    let called = false;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (!changed && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        changed = true;
        if (mode === "replace") await rename(path, join(baseDir, "displaced-snapshots.jsonl"));
        await writeFile(path, `${JSON.stringify(replacement)}\n`, "utf8");
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /source changed during durable observation/);
      assert.equal(changed, true);
      assert.equal(called, false);
    } finally { mock.mock.restore(); }
    // The observer must not repair the externally changed source or strand the lock.
    assert.deepEqual(await repository.readAll(), [replacement]);
    await repository.withDurableVerifiedHistory(async (history) => assert.deepEqual(history.snapshots, [replacement]));
  });
});

test("snapshot receipt time precedes post-validation replacement or creation", async (context) => {
  for (const initiallyPresent of [true, false]) await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    const first = sizingSnapshot();
    const replacement = sizingSnapshot({ priceKrw: 101 });
    if (initiallyPresent) await repository.append(first);
    const start = Date.parse("2026-09-07T00:00:00.000Z");
    context.mock.timers.enable({ apis: ["Date"], now: start });
    let changed = false;
    let restore: () => void;
    if (initiallyPresent) {
      const originalOpen = fs.open;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (args[0] === path && args[1] === "r+") {
          const originalClose = handle.close;
          context.mock.method(handle, "close", async () => {
            await originalClose.call(handle);
            context.mock.timers.tick(10);
            await writeFile(path, `${JSON.stringify(replacement)}\n`, "utf8");
            changed = true;
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      restore = () => { mock.mock.restore(); syncBuiltinESMExports(); };
    } else {
      const originalLstat = fs.lstat;
      const mock = context.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
        try { return await originalLstat(...args); }
        catch (error) {
          if (args[0] === path && (error as NodeJS.ErrnoException).code === "ENOENT") {
            context.mock.timers.tick(10);
            await writeFile(path, `${JSON.stringify(replacement)}\n`, "utf8");
            changed = true;
          }
          throw error;
        }
      });
      syncBuiltinESMExports();
      restore = () => { mock.mock.restore(); syncBuiltinESMExports(); };
    }
    try {
      await repository.withDurableVerifiedHistory(async (history) => {
        assert.equal(changed, true);
        const observation = getDurablePortfolioSizingSnapshotObservation(history);
        assert.equal(Date.parse(observation.observedAt), start);
        assert.ok(Date.parse(observation.observedAt) < Date.now());
        assert.deepEqual(history.snapshots, initiallyPresent ? [first] : []);
      });
    } finally { restore(); context.mock.timers.reset(); }
    assert.deepEqual(await repository.readAll(), [replacement]);
  });
});

test("snapshot consumer holds writer lock and releases failed callbacks without leaking leases", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const other = new PortfolioSizingSnapshotFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const second = sizingSnapshot({ portfolioVersion: "v2" });
    await repository.append(sizingSnapshot());
    let captured: VerifiedPortfolioSizingSnapshotHistory | undefined;
    await assert.rejects(repository.withDurableVerifiedHistory(async (history) => {
      captured = history;
      await assert.rejects(other.append(second), /lock is unavailable/);
      throw new Error("consumer failure");
    }), /consumer failure/);
    assert.ok(captured);
    const expired = captured;
    assert.throws(() => getDurablePortfolioSizingSnapshotObservation(expired), /durable observation lease/);
    await other.append(second);
    assert.equal((await repository.readAll()).length, 2);
  });
});

test("snapshot observation replays its exact prefix after append and restart with strict receipt validation", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const first = sizingSnapshot();
    await repository.append(first);
    const receipt = await repository.withDurableVerifiedHistory(async (history) => getDurablePortfolioSizingSnapshotObservation(history));
    await repository.append(sizingSnapshot({ portfolioVersion: "v2", priceKrw: 101 }));
    await new PortfolioSizingSnapshotFileRepository(baseDir).withDurableVerifiedHistory(async (history) => {
      const parsed: PortfolioSizingSnapshotObservation = JSON.parse(JSON.stringify(receipt));
      assert.deepEqual(resolveObservedPortfolioSizingSnapshotHistory(history, parsed), [first]);
      for (const bad of [
        { ...parsed, recordCount: -1 }, { ...parsed, recordCount: -0 }, { ...parsed, recordCount: 0.5 },
        { ...parsed, recordCount: Number.MAX_SAFE_INTEGER + 1 }, { ...parsed, recordCount: 3 },
        { ...parsed, recordsHash: HASH }, { ...parsed, unexpected: true },
        { ...parsed, observedAt: new Date(Date.parse(getDurablePortfolioSizingSnapshotObservation(history).observedAt) + 1).toISOString() }
      ]) assert.throws(() => resolveObservedPortfolioSizingSnapshotHistory(history, bad));
    });
  });
});

test("snapshot observation rejects valid truncation or replacement and never hides corrupt suffixes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const first = sizingSnapshot();
    const second = sizingSnapshot({ portfolioVersion: "v2" });
    await repository.append(first);
    await repository.append(second);
    const receipt = await repository.withDurableVerifiedHistory(async (history) => getDurablePortfolioSizingSnapshotObservation(history));
    const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    for (const records of [[first], [first, sizingSnapshot({ portfolioVersion: "v2", priceKrw: 102 })]]) {
      await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
      await assert.rejects(repository.withDurableVerifiedHistory(async (history) => resolveObservedPortfolioSizingSnapshotHistory(history, receipt)), /source prefix/);
    }
    const prefix = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;
    for (const suffix of ["{", "{}\n", `${JSON.stringify({ ...first, portfolioSnapshotHash: HASH })}\n`]) {
      await writeFile(path, prefix + suffix, "utf8");
      let called = false;
      await assert.rejects(repository.withDurableVerifiedHistory(async () => { called = true; }), /torn|corrupt/);
      assert.equal(called, false);
    }
  });
});

function sizingSnapshot(overrides: { priceKrw?: number; portfolioVersion?: string } = {}) {
  const priceKrw = overrides.priceKrw ?? 100;
  const positionExposureKrw = priceKrw * 2;
  const exposure = createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 100 + positionExposureKrw,
    cashKrw: 100,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: positionExposureKrw,
      short_term: 0,
      swing: 0
    },
    symbolExposureKrw: [
      { market: "KR", symbol: "005930", exposureKrw: positionExposureKrw }
    ],
    marketExposureKrw: { KR: positionExposureKrw, US: 0 },
    sectorExposureKrw: { Electronics: positionExposureKrw },
    countryExposureKrw: { KR: positionExposureKrw },
    currencyExposureKrw: { KRW: positionExposureKrw },
    pendingBuyExposureKrw: 0,
    pendingSellExposureKrw: 0
  });
  return createPortfolioSizingSnapshot({
    portfolioId: "portfolio-1",
    portfolioVersion: overrides.portfolioVersion ?? "portfolio-version-1",
    policyHash: HASH,
    asOf: "2026-09-02T00:00:00.000Z",
    virtualPortfolio: {
      portfolioId: "portfolio-1",
      cashKrw: 100,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          riskTags: [],
          strategyBucket: "long_term",
          sector: "Electronics",
          quantity: 2,
          averagePriceKrw: 100,
          marketPriceKrw: priceKrw,
          marketValueKrw: positionExposureKrw,
          unrealizedPnlKrw: positionExposureKrw - 200,
          updatedAt: "2026-09-01T23:30:00.000Z"
        }
      ],
      updatedAt: "2026-09-01T23:30:00.000Z"
    },
    valuationInputs: [
      {
        kind: "mark_price",
        market: "KR",
        symbol: "005930",
        priceKrw,
        evidenceRef: "price-KR-005930",
        evidenceAsOf: "2026-09-01T23:00:00.000Z"
      }
    ],
    pendingActionInputs: [],
    ...exposure
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-sizing-snapshot-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof sizingSnapshot>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PortfolioSizingSnapshotFileRepository } from "./dist/portfolio/portfolioSizingSnapshotFiles.js";
    const snapshot = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PortfolioSizingSnapshotFileRepository(process.argv[2]);
    const stored = await repository.append(snapshot);
    process.stdout.write(JSON.stringify(stored));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, fixturePath, baseDir],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `child exited with code ${code}`));
        return;
      }
      resolve(JSON.parse(stdout) as ReturnType<typeof sizingSnapshot>);
    });
  });
}
