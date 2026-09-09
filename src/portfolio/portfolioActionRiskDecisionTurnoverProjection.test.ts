// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { createBucketTurnoverEvent, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, createBucketTurnoverEventPaths, resolveVerifiedBucketTurnoverEventOrigin } from "./bucketTurnoverEventFiles.js";
import { BUCKET_TURNOVER_STATE_FILE_NAME, BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation, getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { HASH, withTurnoverFillFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("turnover projection persists initial and filled states and requires explicit CAS refresh after source growth", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root, createNextFill }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const events = new BucketTurnoverEventFileRepository(baseDir);
    const initial = root.snapshotOrigin.initialState;
    await assert.rejects(repository.readVerifiedSnapshot(), /missing/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: null, states: [] } as Parameters<typeof repository.refresh>[0]));
    const empty = await repository.refresh({ expectedProjectionHash: null });
    assert.deepEqual(empty.states, [initial]);
    assert.equal(empty.sourceEventCount, 0);
    const emptyBytes = await readFile(path, "utf8");
    assert.deepEqual(await repository.refresh({ expectedProjectionHash: null }), empty);
    assert.equal(await readFile(path, "utf8"), emptyBytes);
    await writeFile(path, emptyBytes.replace('"sourceEventCount":0', '"sourceEventCount":-0'));
    await assert.rejects(repository.readVerifiedSnapshot(), /corrupt/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: empty.projectionHash }), /corrupt/);
    await writeFile(path, emptyBytes);
    assert.throws(() => getDurableBucketTurnoverStateObservation(empty), /no active durable/);
    const first = await events.appendFill({ paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: initial.turnoverStateHash });
    await assert.rejects(repository.readVerifiedSnapshot(), /stale/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: HASH }), /CAS mismatch/);
    assert.equal(await readFile(path, "utf8"), emptyBytes);
    const firstProjection = await repository.refresh({ expectedProjectionHash: empty.projectionHash });
    assert.deepEqual(firstProjection.states, [replayBucketTurnoverEvents({ initialState: initial, events: [first] })]);
    const nextFill = await createNextFill(firstProjection.states[0]!, "projection-second-fill");
    const second = await events.appendFill({ paperFillRecordId: nextFill.paperFillRecordId,
      expectedTurnoverStateHash: firstProjection.states[0]!.turnoverStateHash });
    await assert.rejects(repository.readVerifiedSnapshot(), /stale/);
    const current = await repository.refresh({ expectedProjectionHash: firstProjection.projectionHash });
    assert.equal(current.sourceEventCount, 2);
    assert.deepEqual(current.states, [replayBucketTurnoverEvents({ initialState: initial, events: [first, second] })]);
    assert.deepEqual(await new BucketTurnoverStateFileRepository(baseDir).readVerifiedSnapshot(), current);
    assert.ok(Object.isFrozen(current.states));
    let leased: typeof current | undefined;
    await repository.withDurableSnapshot(async (snapshot) => {
      leased = snapshot;
      assert.ok(getDurableBucketTurnoverStateObservation(snapshot).observedAt);
      const source = getDurableBucketTurnoverStateSource(snapshot, initial.turnoverStateId);
      assert.deepEqual(source.state, current.states[0]);
      assert.equal(source.windowCommitHash, root.commitHash);
      assert.equal(source.lastEventCommitHash, current.sourceEventGenerationHash);
      assert.throws(() => getDurableBucketTurnoverStateSource({ ...snapshot }, initial.turnoverStateId), /no active durable/);
      assert.throws(() => getDurableBucketTurnoverStateSource(snapshot, "missing"), /no matching window/);
      assert.throws(() => getDurableBucketTurnoverStateObservation({ ...snapshot }), /no active durable/);
      await assert.rejects(new BucketTurnoverEventFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readVerifiedHistory(), /lock is unavailable/);
      assert.ok((await stat(createBucketTurnoverWindowPaths(baseDir).lockPath)).isFile());
    });
    assert.throws(() => getDurableBucketTurnoverStateObservation(leased!), /no active durable/);
    assert.throws(() => getDurableBucketTurnoverStateSource(leased!, initial.turnoverStateId), /no active durable/);
    await assert.rejects(repository.withDurableSnapshot(async (snapshot) => { leased = snapshot; throw new Error("callback failure"); }), /callback failure/);
    assert.throws(() => getDurableBucketTurnoverStateObservation(leased!), /no active durable/);
    assert.deepEqual(await repository.readVerifiedSnapshot(), current);
  });
});


test("turnover projection rejects rehashed state and source tampering without overwriting it", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    await new BucketTurnoverEventFileRepository(baseDir).appendFill({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const valid = await repository.refresh({ expectedProjectionHash: null });
    const original = await readFile(path, "utf8");
    const alternatives = [{ ...valid, states: [] }, { ...valid, sourceEventGenerationHash: HASH },
      { ...valid, sourceWindowGenerationHash: HASH }, { ...valid, sourceEventCount: 99 },
      { ...valid, sourceWindowCount: 0 }, { ...valid, states: [root.snapshotOrigin.initialState] },
      { ...valid, states: [valid.states[0], valid.states[0]] }, { ...valid, extra: true }];
    const damaged = ["{broken", ...alternatives.map(({ projectionHash: _hash, ...payload }) =>
      JSON.stringify({ ...payload, projectionHash: hashCanonicalPayload(payload) }))];
    for (const bytes of damaged) {
      await writeFile(path, bytes);
      await assert.rejects(repository.readVerifiedSnapshot(), /corrupt/);
      await assert.rejects(repository.refresh({ expectedProjectionHash: valid.projectionHash }), /corrupt/);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, original);
    const eventPath = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const eventBytes = await readFile(eventPath, "utf8");
    await writeFile(eventPath, "");
    await assert.rejects(repository.readVerifiedSnapshot(), /corrupt/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: valid.projectionHash }), /corrupt/);
    await writeFile(eventPath, eventBytes);
    await writeFile(createBucketTurnoverEventPaths(baseDir).pendingPath, "unfinished");
    await assert.rejects(repository.readVerifiedSnapshot(), /pending/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: valid.projectionHash }), /pending/);
    assert.equal(await readFile(path, "utf8"), original);
  });
});


test("turnover projection retains historical windows and advances only to the newly verified root generation", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, root }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const first = await repository.refresh({ expectedProjectionHash: null });
    const initial = root.snapshotOrigin.initialState;
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(initial.windowEndsAt) + 1 });
    try {
      const next = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolve({ portfolioId: initial.portfolioId,
        bucket: initial.bucket, expectedPolicyHash: initial.lastAppliedPolicyHash });
      await assert.rejects(repository.readVerifiedSnapshot(), /stale/);
      const current = await repository.refresh({ expectedProjectionHash: first.projectionHash });
      assert.equal(current.sourceWindowCount, 2);
      assert.equal(current.sourceEventCount, 0);
      assert.equal(current.sourceWindowGenerationHash, next.commitHash);
      assert.deepEqual(new Set(current.states.map((state) => state.turnoverStateId)),
        new Set([initial.turnoverStateId, next.snapshotOrigin.initialState.turnoverStateId]));
      assert.deepEqual(await repository.readVerifiedSnapshot(), current);
    } finally { context.mock.timers.reset(); }
  });
});


test("turnover projection concurrent initial refresh across processes converges to one snapshot", async () => {
  await withTurnoverFillFixture(async ({ baseDir, root }) => {
    const script = `import { BucketTurnoverStateFileRepository } from './dist/portfolio/bucketTurnoverStateFiles.js';
      const snapshot = await new BucketTurnoverStateFileRepository(process.argv[1], { lockTimeoutMs: 30000 }).refresh({ expectedProjectionHash: null });
      process.stdout.write(JSON.stringify(snapshot));`;
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => new Promise<unknown>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) { reject(new Error(stderr || `child exited ${code}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    })));
    const snapshot = await new BucketTurnoverStateFileRepository(baseDir).readVerifiedSnapshot();
    assert.deepEqual(snapshot.states, [root.snapshotOrigin.initialState]);
    for (const result of results) { assert.equal(result.status, "fulfilled"); assert.deepEqual(result.value, snapshot); }
  });
});


test("turnover projection failed temporary fsync preserves its old state and durable observation waits for snapshot sync", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const initial = await repository.refresh({ expectedProjectionHash: null });
    const original = await readFile(path, "utf8");
    await new BucketTurnoverEventFileRepository(baseDir).appendFill({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let fail = true;
    let syncedAt: number | null = null;
    let callbackCalled = false;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const metadata = await this.stat({ bigint: true });
      const paths = [path, ...(await readdir(baseDir)).filter((name) => name.startsWith(`${BUCKET_TURNOVER_STATE_FILE_NAME}.tmp-`))
        .map((name) => join(baseDir, name))];
      const targets = await Promise.all(paths.map((target) => stat(target, { bigint: true }).catch(() => undefined)));
      const isProjection = metadata.isFile() && targets.some((target) => target !== undefined && target.ino === metadata.ino &&
        (process.platform === "win32" || target.dev === metadata.dev));
      if (isProjection && fail) throw new Error("injected projection fsync failure");
      await originalSync.call(this);
      if (isProjection) { context.mock.timers.setTime(Date.now() + 1); syncedAt = Date.now(); }
    });
    try {
      await assert.rejects(repository.refresh({ expectedProjectionHash: initial.projectionHash }), /injected projection fsync failure/);
      assert.equal(await readFile(path, "utf8"), original);
      fail = false;
      const current = await repository.refresh({ expectedProjectionHash: initial.projectionHash });
      fail = true;
      await assert.rejects(repository.withDurableSnapshot(async () => { callbackCalled = true; }), /injected projection fsync failure/);
      assert.equal(callbackCalled, false);
      fail = false;
      await repository.withDurableSnapshot(async (snapshot) => {
        assert.equal(snapshot.projectionHash, current.projectionHash);
        assert.ok(syncedAt !== null);
        assert.ok(Date.parse(getDurableBucketTurnoverStateObservation(snapshot).observedAt) >= syncedAt);
      });
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  });
});
