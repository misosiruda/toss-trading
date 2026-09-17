import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { BucketSelectionRequestFileRepository as Requests, getDurableBucketSelectionRequestObservation,
  assertDurableBucketSelectionRequestSource, type VerifiedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { PortfolioSizingSnapshotFileRepository as Snapshots, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { CandidateSizingInputFileRepository as Inputs, createCandidateSizingInputPaths, getDurableCandidateSizingInputObservation,
  assertDurableCandidateSizingInputSource, type VerifiedCandidateSizingInputHistory } from "./candidateSizingInputFiles.js";
import { CandidateAssignmentFileRepository as Assignments, createCandidateAssignmentPaths, getDurableCandidateAssignmentObservation,
  assertDurableCandidateAssignmentSource, type VerifiedCandidateAssignmentHistory } from "./candidateAssignmentFiles.js";
import { SelectorOpeningCapacityReservationFileRepository as Reservations, createSelectorOpeningCapacityReservationPaths,
  getDurableSelectorCapacityReservationObservation, type VerifiedSelectorCapacityReservationHistory } from "./selectorOpeningCapacityReservationFiles.js";

const options = { lockTimeoutMs: 70, lockRetryDelayMs: 3 };
type Sources = { requests: VerifiedBucketSelectionRequestHistory; snapshots: VerifiedPortfolioSizingSnapshotHistory;
  inputs?: VerifiedCandidateSizingInputHistory; assignments?: VerifiedCandidateAssignmentHistory };
type History = VerifiedCandidateSizingInputHistory | VerifiedCandidateAssignmentHistory | VerifiedSelectorCapacityReservationHistory;
type Operation = (history: History) => Promise<void>;
interface Stage {
  name: string;
  hold: (dir: string, operation: (sources: Sources) => Promise<void>) => Promise<void>;
  read: (dir: string, sources: Sources, operation: Operation) => Promise<void>;
  observe: (history: History) => string;
  paths: (dir: string) => { recordsPath: string; lockPath: string; pendingPath: string };
}
async function roots(dir: string, operation: (sources: Sources) => Promise<void>) {
  await new Requests(dir, options).withDurableVerifiedHistory((requests) =>
    new Snapshots(dir, options).withDurableVerifiedHistory((snapshots) => operation({ requests, snapshots })));
}
const stages: Stage[] = [
  { name: "sizing input", hold: roots, paths: createCandidateSizingInputPaths,
    read: (dir, s, operation) => new Inputs(dir, options).withDurableVerifiedHistoryFromSources(s.requests, s.snapshots, operation),
    observe: (history) => getDurableCandidateSizingInputObservation(history as VerifiedCandidateSizingInputHistory) },
  { name: "assignment", paths: createCandidateAssignmentPaths,
    hold: (dir, operation) => roots(dir, (s) => new Inputs(dir, options).withDurableVerifiedHistoryFromSources(s.requests, s.snapshots,
      (inputs) => operation({ ...s, inputs }))),
    read: (dir, s, operation) => new Assignments(dir, options).withDurableVerifiedHistoryFromSources(s.inputs!, s.requests, s.snapshots, operation),
    observe: (history) => getDurableCandidateAssignmentObservation(history as VerifiedCandidateAssignmentHistory) },
  { name: "reservation", paths: createSelectorOpeningCapacityReservationPaths,
    hold: (dir, operation) => new Assignments(dir, options).withDurableVerifiedHistory((assignments, inputs, requests, snapshots) =>
      operation({ assignments, inputs, requests, snapshots })),
    read: (dir, s, operation) => new Reservations(dir, options).withDurableVerifiedHistoryFromSources(s.assignments!, s.inputs!, s.requests, s.snapshots, operation),
    observe: (history) => getDurableSelectorCapacityReservationObservation(history as VerifiedSelectorCapacityReservationHistory) }
];
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "selector-shared-sources-"));
  try { await operation(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function waitEntered(entered: Promise<void>, child: Promise<unknown>) {
  await Promise.race([entered, child.then((error) => { throw new Error("child ended before the observation checkpoint", { cause: error }); })]);
}

for (const stage of stages) {
  test(`selector shared ${stage.name} rejects cloned foreign and expired source leases`, async () => {
    await temporary(async (dir) => {
      let escaped!: Sources, called = false;
      const consume = async () => { called = true; };
      await stage.hold(dir, async (sources) => {
        escaped = sources;
        await stage.hold(join(dir, "foreign"), async (foreign) => {
          for (const key of Object.keys(sources) as (keyof Sources)[]) {
            assert.deepEqual(sources[key], foreign[key]);
            await assert.rejects(stage.read(dir, { ...sources, [key]: foreign[key] }, consume), /different source path/);
            await assert.rejects(stage.read(dir, { ...sources, [key]: { ...sources[key] } }, consume), /durable observation lease/);
          }
        });
      });
      await assert.rejects(stage.read(dir, escaped, consume), /durable observation lease/);
      assert.equal(called, false);
      await assert.rejects(fs.readFile(stage.paths(dir).lockPath), { code: "ENOENT" });
    });
  });

  test(`selector shared ${stage.name} retains source locks and expires failed consumer observations`, async () => {
    await temporary(async (dir) => {
      await stage.hold(dir, async (sources) => {
        let escaped!: History;
        await assert.rejects(stage.read(dir, sources, async (history) => {
          escaped = history;
          await assert.rejects(new Requests(dir, options).readAll(), /lock is unavailable/);
          await assert.rejects(new Snapshots(dir, options).readAll(), /lock is unavailable/);
          await assert.rejects(stage.read(dir, sources, async () => {}), /lock is unavailable/);
          throw new Error("synthetic shared consumer failure");
        }), /synthetic shared consumer failure/);
        assert.throws(() => stage.observe(escaped), /durable observation lease/);
        await stage.read(dir, sources, async (history) => assert.deepEqual(history.origins, []));
      });
      await stage.hold(dir, (sources) => stage.read(dir, sources, async (history) => assert.deepEqual(history.origins, [])));
    });
  });

  test(`selector shared ${stage.name} expires during an unawaited consumer when its ancestor ends`, async () => {
    await temporary(async (dir) => {
      const entered = gate(), finish = gate();
      let child!: Promise<unknown>, escaped!: History;
      try {
        await stage.hold(dir, async (sources) => {
          child = stage.read(dir, sources, async (history) => { escaped = history; entered.release(); await finish.promise; })
            .then(() => null, (error: unknown) => error);
          await waitEntered(entered.promise, child);
        });
        assert.throws(() => stage.observe(escaped), /durable observation lease/);
        finish.release(); assert.match(String(await child), /durable observation lease/);
      } finally { finish.release(); if (child) await child; }
      await stage.hold(dir, (sources) => stage.read(dir, sources, async () => {}));
    });
  });

  for (const phase of ["lock", "read"] as const) {
    test(`selector shared ${stage.name} rechecks ancestor lifetime after ${phase} wait`, async (context) => {
      await temporary(async (dir) => {
        const entered = gate(), finish = gate(), paths = stage.paths(dir), original = fs.open;
        const path = phase === "lock" ? paths.lockPath : paths.recordsPath, flag = phase === "lock" ? "wx" : "r+";
        let child!: Promise<unknown>, called = false, intercepted = false;
        const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
          if (args[0] === path && args[1] === flag && !intercepted) { intercepted = true; entered.release(); await finish.promise; }
          return original(...args);
        }); syncBuiltinESMExports();
        try {
          await stage.hold(dir, async (sources) => {
            child = stage.read(dir, sources, async () => { called = true; }).then(() => null, (error: unknown) => error);
            await waitEntered(entered.promise, child);
          });
          finish.release(); assert.match(String(await child), /durable observation lease/); assert.equal(called, false);
        } finally { finish.release(); if (child) await child; hook.mock.restore(); syncBuiltinESMExports(); }
        await stage.hold(dir, (sources) => stage.read(dir, sources, async () => {}));
      });
    });
  }

  test(`selector shared ${stage.name} rejects backward observation time and permits recovery`, async (context) => {
    await temporary(async (dir) => {
      const now = Date.now(); context.mock.timers.enable({ apis: ["Date"], now });
      try {
        await stage.hold(dir, async (sources) => {
          let called = false; context.mock.timers.setTime(now - 1);
          await assert.rejects(stage.read(dir, sources, async () => { called = true; }), /clock moved backwards/);
          assert.equal(called, false); context.mock.timers.setTime(now);
          await stage.read(dir, sources, async (history) => assert.equal(stage.observe(history), new Date(now).toISOString()));
        });
      } finally { context.mock.timers.reset(); }
    });
  });

  test(`selector shared ${stage.name} preserves corrupt and pending journal bytes`, async () => {
    await temporary(async (dir) => {
      const paths = stage.paths(dir); let called = false;
      await stage.hold(dir, async (sources) => {
        for (const corrupt of [Buffer.from("{broken}\n"), Buffer.from("{torn"), Buffer.from([0xff, 0x0a])]) {
          await fs.writeFile(paths.recordsPath, corrupt);
          await assert.rejects(stage.read(dir, sources, async () => { called = true; }), /corrupt|torn|UTF-8/);
          assert.deepEqual(await fs.readFile(paths.recordsPath), corrupt);
        }
        await fs.writeFile(paths.recordsPath, ""); await fs.writeFile(paths.pendingPath, "pending-test-barrier");
        await assert.rejects(stage.read(dir, sources, async () => { called = true; }), /pending append requires explicit recovery/);
        assert.equal(await fs.readFile(paths.pendingPath, "utf8"), "pending-test-barrier"); assert.equal(called, false);
        await fs.unlink(paths.pendingPath);
        await stage.read(dir, sources, async (history) => assert.deepEqual(history.origins, []));
      });
    });
  });

  test(`selector shared ${stage.name} refuses fsync failure without issuing a consumer lease`, async (context) => {
    await temporary(async (dir) => {
      const path = stage.paths(dir).recordsPath, original = fs.open; await fs.writeFile(path, "");
      let called = false;
      await stage.hold(dir, async (sources) => {
        const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
          const handle = await original(...args);
          if (args[0] === path && args[1] === "r+") context.mock.method(handle, "sync", async () => { throw new Error("synthetic shared sync failure"); });
          return handle;
        }); syncBuiltinESMExports();
        try { await assert.rejects(stage.read(dir, sources, async () => { called = true; }), /synthetic shared sync failure/); }
        finally { hook.mock.restore(); syncBuiltinESMExports(); }
        assert.equal(called, false); assert.equal(await fs.readFile(path, "utf8"), "");
        await stage.read(dir, sources, async (history) => assert.deepEqual(history.origins, []));
      });
    });
  });
}

test("selector shared chain uses normalized paths and keeps observation schemas unchanged", async () => {
  await temporary(async (dir) => {
    const path = relative(process.cwd(), dir);
    await roots(path, async (s) => {
      assertDurableBucketSelectionRequestSource(s.requests, join(dir, "unused", ".."));
      assert.deepEqual(Object.keys(getDurableBucketSelectionRequestObservation(s.requests)).sort(), ["observedAt", "requestCount", "requestsHash"]);
      await new Inputs(path, options).withDurableVerifiedHistoryFromSources(s.requests, s.snapshots, async (inputs, requests, snapshots) => {
        assert.equal(requests, s.requests); assert.equal(snapshots, s.snapshots); assertDurableCandidateSizingInputSource(inputs, dir);
        assert.equal(typeof getDurableCandidateSizingInputObservation(inputs), "string");
        await new Assignments(path, options).withDurableVerifiedHistoryFromSources(inputs, requests, snapshots, async (assignments, inheritedInputs, inheritedRequests, inheritedSnapshots) => {
          assert.equal(inheritedInputs, inputs); assert.equal(inheritedRequests, requests); assert.equal(inheritedSnapshots, snapshots);
          assertDurableCandidateAssignmentSource(assignments, dir); assert.equal(typeof getDurableCandidateAssignmentObservation(assignments), "string");
          await new Reservations(path, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots, async (history) => {
            assert.equal(typeof getDurableSelectorCapacityReservationObservation(history), "string"); assert.deepEqual(history.origins, []);
          });
        });
      });
    });
  });
});

test("selector shared chain invalidates still-running descendants when the root lease ends", async () => {
  await temporary(async (dir) => {
    const entered = gate(), finish = gate();
    let child!: Promise<unknown>, inputHistory!: VerifiedCandidateSizingInputHistory,
      assignmentHistory!: VerifiedCandidateAssignmentHistory, reservationHistory!: VerifiedSelectorCapacityReservationHistory;
    try {
      await roots(dir, async ({ requests, snapshots }) => {
        child = new Inputs(dir, options).withDurableVerifiedHistoryFromSources(requests, snapshots, async (inputs) => {
          inputHistory = inputs;
          await new Assignments(dir, options).withDurableVerifiedHistoryFromSources(inputs, requests, snapshots, async (assignments) => {
            assignmentHistory = assignments;
            await new Reservations(dir, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots, async (history) => {
              reservationHistory = history; entered.release(); await finish.promise;
            });
          });
        }).then(() => null, (error: unknown) => error);
        await waitEntered(entered.promise, child);
      });
      assert.throws(() => getDurableCandidateSizingInputObservation(inputHistory), /durable observation lease/);
      assert.throws(() => getDurableCandidateAssignmentObservation(assignmentHistory), /durable observation lease/);
      assert.throws(() => getDurableSelectorCapacityReservationObservation(reservationHistory), /durable observation lease/);
      finish.release(); assert.match(String(await child), /durable observation lease/);
    } finally { finish.release(); if (child) await child; }
    assert.deepEqual(await new Reservations(dir).readAll(), []);
  });
});
