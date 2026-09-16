import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { ManualAssignmentFileRepository, assertDurableManualAssignmentSource, getDurableManualAssignmentObservation,
  type VerifiedManualAssignmentHistory } from "./manualAssignmentFiles.js";
import { PortfolioSizingSnapshotFileRepository, assertDurablePortfolioSizingSnapshotSource, getDurablePortfolioSizingSnapshotObservation,
  type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { ManualOpeningCapacityReservationFileRepository, createManualOpeningCapacityReservationPaths,
  getDurableManualCapacityReservationObservation, type VerifiedManualCapacityReservationHistory } from "./manualOpeningCapacityReservationFiles.js";

const options = { lockTimeoutMs: 60, lockRetryDelayMs: 3 };
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "manual-capacity-leases-"));
  try { await operation(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function sources<T>(dir: string, operation: (manual: VerifiedManualAssignmentHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>) {
  return new ManualAssignmentFileRepository(dir, options).withDurableVerifiedHistory((manual) =>
    new PortfolioSizingSnapshotFileRepository(dir, options).withDurableVerifiedHistory((snapshots) => operation(manual, snapshots)));
}
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }

test("shared manual capacity leases reject cloned expired and foreign sources even with identical empty histories", async () => {
  await temporary(async (dir) => {
    const other = join(dir, "other"), repo = new ManualOpeningCapacityReservationFileRepository(dir, options);
    let called = false;
    const operation = async () => { called = true; };
    const escaped = await sources(dir, async (manual, snapshots) => {
      await sources(other, async (foreignManual, foreignSnapshots) => {
        assert.deepEqual(manual, foreignManual); assert.deepEqual(snapshots, foreignSnapshots);
        for (const [m, s] of [[foreignManual, snapshots], [manual, foreignSnapshots], [foreignManual, foreignSnapshots]] as const) {
          await assert.rejects(repo.withDurableVerifiedHistoryFromSources(m, s, operation), /different source path/);
        }
      });
      await assert.rejects(repo.withDurableVerifiedHistoryFromSources({ ...manual }, snapshots, operation), /durable observation lease/);
      await assert.rejects(repo.withDurableVerifiedHistoryFromSources(manual, { ...snapshots }, operation), /durable observation lease/);
      return { manual, snapshots };
    });
    await assert.rejects(repo.withDurableVerifiedHistoryFromSources(escaped.manual, escaped.snapshots, operation), /durable observation lease/);
    assert.equal(called, false);
    await assert.rejects(fs.readFile(createManualOpeningCapacityReservationPaths(dir).lockPath), { code: "ENOENT" });
  });
});

test("shared manual capacity sources bind normalized constructor paths without changing public observation schemas", async () => {
  await temporary(async (dir) => {
    const path = relative(process.cwd(), dir), repo = new ManualOpeningCapacityReservationFileRepository(path, options);
    await sources(path, async (manual, snapshots) => {
      assertDurableManualAssignmentSource(manual, dir); assertDurablePortfolioSizingSnapshotSource(snapshots, join(dir, "unused", ".."));
      assert.deepEqual(Object.keys(getDurableManualAssignmentObservation(manual)).sort(), ["eventCount", "eventsHash", "observedAt"]);
      assert.deepEqual(Object.keys(getDurablePortfolioSizingSnapshotObservation(snapshots)).sort(), ["observedAt", "recordCount", "recordsHash"]);
      await repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async (history) => assert.deepEqual(history.origins, []));
    });
  });
});

test("shared manual capacity sources remain locked and reusable after a consumer failure", async () => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, options);
    await sources(dir, async (manual, snapshots) => {
      let escaped!: VerifiedManualCapacityReservationHistory;
      await assert.rejects(repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async (history) => {
        escaped = history;
        await assert.rejects(new ManualAssignmentFileRepository(dir, options).readAll(), /lock is unavailable/);
        await assert.rejects(new PortfolioSizingSnapshotFileRepository(dir, options).readAll(), /lock is unavailable/);
        throw new Error("synthetic consumer failure");
      }), /synthetic consumer failure/);
      assert.throws(() => getDurableManualCapacityReservationObservation(escaped), /durable observation lease/);
      assertDurableManualAssignmentSource(manual, dir); assertDurablePortfolioSizingSnapshotSource(snapshots, dir);
      await repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async (history) => assert.deepEqual(history.origins, []));
    });
    assert.deepEqual(await repo.readAll(), []);
  });
});

test("shared manual capacity lease expires immediately when an unawaited ancestor callback ends", async () => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, options), entered = gate(), finish = gate();
    let child!: Promise<unknown>, escaped!: VerifiedManualCapacityReservationHistory;
    try {
      await sources(dir, async (manual, snapshots) => {
        child = repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async (history) => {
          escaped = history; entered.release(); await finish.promise;
        }).then(() => null, (error: unknown) => error);
        await entered.promise;
      });
      assert.throws(() => getDurableManualCapacityReservationObservation(escaped), /durable observation lease/);
      finish.release();
      assert.match(String(await child), /durable observation lease/);
      assert.deepEqual(await repo.readAll(), []);
    } finally { finish.release(); if (child) await child; }
  });
});

test("shared manual capacity rechecks ancestor lifetime after waiting for its reservation lock", async (context) => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, options), entered = gate(), finish = gate();
    const path = createManualOpeningCapacityReservationPaths(dir).lockPath, original = fs.open;
    let child!: Promise<unknown>, called = false, intercepted = false;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === path && args[1] === "wx" && !intercepted) { intercepted = true; entered.release(); await finish.promise; }
      return original(...args);
    }); syncBuiltinESMExports();
    try {
      await sources(dir, async (manual, snapshots) => {
        child = repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async () => { called = true; }).then(() => null, (error: unknown) => error);
        await entered.promise;
      });
      finish.release(); assert.match(String(await child), /durable observation lease/); assert.equal(called, false);
    } finally { finish.release(); if (child) await child; hook.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await repo.readAll(), []);
  });
});

test("shared manual capacity rechecks ancestor lifetime after reservation source I/O", async (context) => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, options), entered = gate(), finish = gate();
    const path = createManualOpeningCapacityReservationPaths(dir).recordsPath, original = fs.open;
    let child!: Promise<unknown>, called = false, intercepted = false;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === path && args[1] === "r+" && !intercepted) { intercepted = true; entered.release(); await finish.promise; }
      return original(...args);
    }); syncBuiltinESMExports();
    try {
      await sources(dir, async (manual, snapshots) => {
        child = repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async () => { called = true; }).then(() => null, (error: unknown) => error);
        await entered.promise;
      });
      finish.release(); assert.match(String(await child), /durable observation lease/); assert.equal(called, false);
    } finally { finish.release(); if (child) await child; hook.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await repo.readAll(), []);
  });
});

test("shared manual capacity rejects backward observations before its consumer and releases its lock", async (context) => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, options), now = Date.now();
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      await sources(dir, async (manual, snapshots) => {
        let called = false;
        context.mock.timers.setTime(now - 1);
        await assert.rejects(repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async () => { called = true; }), /clock moved backwards/);
        assert.equal(called, false);
        context.mock.timers.setTime(now);
        await repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async (history) => assert.equal(getDurableManualCapacityReservationObservation(history), new Date(now).toISOString()));
      });
    } finally { context.mock.timers.reset(); }
    assert.deepEqual(await repo.readAll(), []);
  });
});

test("shared manual capacity preserves corrupt and pending reservation bytes without issuing a lease", async () => {
  await temporary(async (dir) => {
    const repo = new ManualOpeningCapacityReservationFileRepository(dir, options), paths = createManualOpeningCapacityReservationPaths(dir);
    await sources(dir, async (manual, snapshots) => {
      let called = false;
      for (const corrupt of [Buffer.from("{broken}\n"), Buffer.from("{torn"), Buffer.from([0xff, 0x0a])]) {
        await fs.writeFile(paths.recordsPath, corrupt);
        await assert.rejects(repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async () => { called = true; }), /corrupt|torn|UTF-8/);
        assert.deepEqual(await fs.readFile(paths.recordsPath), corrupt);
      }
      await fs.writeFile(paths.recordsPath, "");
      await fs.writeFile(paths.pendingPath, "pending-test-barrier");
      await assert.rejects(repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async () => { called = true; }), /pending append requires explicit recovery/);
      assert.equal(await fs.readFile(paths.pendingPath, "utf8"), "pending-test-barrier");
      assert.equal(called, false);
      await fs.unlink(paths.pendingPath);
      await repo.withDurableVerifiedHistoryFromSources(manual, snapshots, async (history) => assert.deepEqual(history.origins, []));
    });
  });
});
