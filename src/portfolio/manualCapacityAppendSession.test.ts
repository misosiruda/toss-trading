import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ManualAssignmentFileRepository, type VerifiedManualAssignmentHistory } from "./manualAssignmentFiles.js";
import { PortfolioSizingSnapshotFileRepository, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { ManualOpeningCapacityReservationFileRepository as Repository, createManualOpeningCapacityReservationPaths as paths,
  type ManualCapacityAppendSession } from "./manualOpeningCapacityReservationFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { seedManual, START } from "./storedManualOpeningCapacityTestFixtures.js";

const options = { lockTimeoutMs: 80, lockRetryDelayMs: 3 };
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function sources<T>(dir: string, operation: (manual: VerifiedManualAssignmentHistory, snapshots: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>) {
  return new ManualAssignmentFileRepository(dir, options).withDurableVerifiedHistory((manual) =>
    new PortfolioSizingSnapshotFileRepository(dir, options).withDurableVerifiedHistory((snapshots) => operation(manual, snapshots)));
}
async function fixture(context: TestContext, operation: (state: { dir: string; repo: Repository;
  original: Awaited<ReturnType<typeof seedManual>>["record"]; next: Awaited<ReturnType<typeof seedManual>>["record"] }) => Promise<void>, increase = false) {
  const dir = await fs.mkdtemp(join(tmpdir(), "manual-append-session-"));
  context.mock.timers.enable({ apis: ["Date"], now: START });
  try {
    const seed = await seedManual(dir, (ms) => context.mock.timers.setTime(START + ms), increase);
    context.mock.timers.setTime(START + 100);
    const { manualCapacityReservationId: _id, manualCapacityReservationHash: _hash, ...payload } = seed.record;
    // Journal composition fixture, NOT a shared allocator's approval of repeated authorization or slot use.
    const next = createManualOpeningCapacityReservationRecord({ ...payload, capacityLedgerVersion: 3, resultingReservedNotionalKrw: 200 });
    await operation({ dir, repo: new Repository(dir, options), original: seed.record, next });
  } finally { context.mock.timers.reset(); await fs.rm(dir, { recursive: true, force: true }); }
}

for (const increase of [false, true]) test(`manual append session preserves retry and predecessor bytes increase=${increase}`, async (context) => {
  await fixture(context, async ({ dir, repo, original, next }) => {
    let escaped!: ManualCapacityAppendSession;
    await sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
      escaped = session; assert.ok(Object.isFrozen(session));
      const previous = await session.append(original);
      const added = await session.append(next);
      assert.notEqual(previous.commitHash, added.commitHash);
      const bytes = await fs.readFile(paths(dir).recordsPath);
      assert.deepEqual(await session.append(original), previous);
      assert.deepEqual(await session.append(next, snapshots), added);
      assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes);
      await assert.rejects(fs.open(paths(dir).lockPath, "wx"), { code: "EEXIST" });
    }));
    await assert.rejects(escaped.append(next), /expired/);
    assert.deepEqual((await repo.readAll()).map((value) => value.record), [original, next]);
    assert.deepEqual(await new Repository(dir).append(next), (await repo.readAll())[1]);
  }, increase);
});

test("manual append session rejects copied foreign and expired actual sources before writing", async (context) => {
  await fixture(context, async ({ dir, repo }) => {
    const bytes = await fs.readFile(paths(dir).recordsPath); let called = false;
    const operation = async () => { called = true; };
    const escaped = await sources(dir, async (manual, snapshots) => {
      await assert.rejects(repo.withAppendSessionFromSources({ ...manual }, snapshots, operation), /lease/);
      await assert.rejects(repo.withAppendSessionFromSources(manual, { ...snapshots }, operation), /lease/);
      await sources(join(dir, "foreign"), async (foreignManual, foreignSnapshots) => {
        await assert.rejects(repo.withAppendSessionFromSources(foreignManual, snapshots, operation), /different source path/);
        await assert.rejects(repo.withAppendSessionFromSources(manual, foreignSnapshots, operation), /different source path/);
      });
      return { manual, snapshots };
    });
    await assert.rejects(repo.withAppendSessionFromSources(escaped.manual, escaped.snapshots, operation), /lease/);
    assert.equal(called, false); assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes);
  });
});

test("manual append session revokes a failed consumer without rolling back its durable write", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    let escaped!: ManualCapacityAppendSession;
    await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
      escaped = session; await session.append(next); throw new Error("consumer failed");
    })), /consumer failed/);
    await assert.rejects(escaped.append(next), /expired/);
    const bytes = await fs.readFile(paths(dir).recordsPath);
    assert.equal((await repo.readAll()).length, 2); await repo.append(next);
    assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes);
  });
});

test("manual append session rejects a valid truncated generation without repairing its bytes", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
      await fs.writeFile(paths(dir).recordsPath, "");
      await session.append(next);
    })), /generation changed unexpectedly/);
    assert.equal(await fs.readFile(paths(dir).recordsPath, "utf8"), "");
    await assert.rejects(fs.readFile(paths(dir).pendingPath), { code: "ENOENT" });
  });
});

test("manual append session drains an unawaited write before unlocking and rejects overlapping appends", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    const entered = gate(), finish = gate(), originalOpen = fs.open; let intercepted = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === paths(dir).recordsPath && args[1] === "a" && !intercepted) { intercepted = true; entered.release(); await finish.promise; }
      return originalOpen(...args);
    }); syncBuiltinESMExports();
    let child: Promise<unknown> | undefined;
    try {
      child = sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
        void session.append(next); // Session must drain its own started write before releasing its lock.
        await assert.rejects(session.append(next), /in-flight write/);
        return "drained";
      }));
      await entered.promise;
      await assert.rejects(fs.open(paths(dir).lockPath, "wx"), { code: "EEXIST" });
      finish.release(); assert.equal(await child, "drained");
    } finally { finish.release(); if (child) await child; mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal((await repo.readAll()).length, 2);
  });
});

test("manual append session refuses ancestor expiration before a write", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    const entered = gate(), finish = gate(), bytes = await fs.readFile(paths(dir).recordsPath); let child!: Promise<unknown>;
    try {
      await sources(dir, async (manual, snapshots) => {
        child = repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
          entered.release(); await finish.promise; await session.append(next);
        }).then(() => null, (error: unknown) => error);
        await entered.promise;
      });
      finish.release(); assert.match(String(await child), /lease/);
    } finally { finish.release(); if (child) await child; }
    assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes);
    await assert.rejects(fs.readFile(paths(dir).pendingPath), { code: "ENOENT" });
  });
});

test("manual append session rejects copied replacement snapshots and cannot hide a caught write error", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    const bytes = await fs.readFile(paths(dir).recordsPath);
    await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
      await assert.rejects(session.append(next, { ...snapshots }), /lease/);
      await assert.rejects(session.append(next), /lease/);
    })), /lease/);
    assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes);
  });
});

test("manual append session keeps a recovery barrier when ancestors expire during journal I/O", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    const entered = gate(), finish = gate(), originalOpen = fs.open; let intercepted = false, child!: Promise<unknown>;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === paths(dir).recordsPath && args[1] === "a" && !intercepted) { intercepted = true; entered.release(); await finish.promise; }
      return originalOpen(...args);
    }); syncBuiltinESMExports();
    try {
      await sources(dir, async (manual, snapshots) => {
        child = repo.withAppendSessionFromSources(manual, snapshots, (session) => session.append(next)).then(() => null, (error: unknown) => error);
        await entered.promise;
      });
      finish.release(); assert.match(String(await child), /lease/);
    } finally { finish.release(); if (child) await child; mock.mock.restore(); syncBuiltinESMExports(); }
    const bytes = await fs.readFile(paths(dir).recordsPath), barrier = await fs.readFile(paths(dir).pendingPath);
    assert.equal(bytes.toString("utf8").trim().split("\n").length, 3); // Existing pair plus incomplete new entry, never a new commit.
    await assert.rejects(repo.readAll(), /explicit recovery/);
    assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes); assert.deepEqual(await fs.readFile(paths(dir).pendingPath), barrier);
  });
});

test("manual append session preserves the pending barrier after a failed journal fsync", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    const originalOpen = fs.open;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths(dir).recordsPath && args[1] === "a") context.mock.method(handle, "sync", async () => { throw new Error("synthetic journal sync failure"); });
      return handle;
    }); syncBuiltinESMExports();
    try {
      await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
        await assert.rejects(session.append(next), /journal sync failure/);
      })), /journal sync failure/);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    const bytes = await fs.readFile(paths(dir).recordsPath), barrier = await fs.readFile(paths(dir).pendingPath);
    await assert.rejects(repo.readAll(), /explicit recovery/);
    assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes); assert.deepEqual(await fs.readFile(paths(dir).pendingPath), barrier);
  });
});

test("manual append session rejects backward time and pre-existing damaged or pending journals", async (context) => {
  await fixture(context, async ({ dir, repo, next }) => {
    const bytes = await fs.readFile(paths(dir).recordsPath);
    try {
      await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async (session) => {
        context.mock.timers.setTime(START + 99); await session.append(next);
      })), /clock moved backwards/);
    } finally { context.mock.timers.setTime(START + 100); }
    assert.deepEqual(await fs.readFile(paths(dir).recordsPath), bytes);
    let called = false;
    await fs.writeFile(paths(dir).recordsPath, bytes.subarray(0, -1));
    await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async () => { called = true; })), /torn/);
    await fs.writeFile(paths(dir).recordsPath, bytes); await fs.writeFile(paths(dir).pendingPath, "fixture pending");
    await assert.rejects(sources(dir, (manual, snapshots) => repo.withAppendSessionFromSources(manual, snapshots, async () => { called = true; })), /explicit recovery/);
    assert.equal(called, false); assert.equal(await fs.readFile(paths(dir).pendingPath, "utf8"), "fixture pending");
  });
});
