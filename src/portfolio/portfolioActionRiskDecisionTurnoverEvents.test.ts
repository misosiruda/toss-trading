// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { resolveBucketTurnoverFillOrigin } from "./bucketTurnoverFillOrigin.js";
import { createBucketTurnoverEvent, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, createBucketTurnoverEventPaths, resolveVerifiedBucketTurnoverEventOrigin } from "./bucketTurnoverEventFiles.js";
import { HASH, rehashTurnoverFillPair, withTurnoverFillFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("turnover event storage derives fills, preserves retry origins and replays the complete cumulative state", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root, createNextFill }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const initial = root.snapshotOrigin.initialState;
    assert.deepEqual(await repository.readWindowState(initial.turnoverStateId), initial);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: initial.turnoverStateHash };
    for (const extra of [{ absoluteFilledNotionalKrw: 1 }, { asOf: fill.asOf }, { previousTurnoverEventId: "caller" }]) {
      await assert.rejects(repository.appendFill({ ...input, ...extra }));
    }
    const first = await repository.appendFill(input);
    const path = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const firstBytes = await readFile(path, "utf8");
    assert.equal(firstBytes.trimEnd().split("\n").length, 2);
    assert.equal(first.absoluteFilledNotionalKrw, fill.filledNotionalKrw);
    assert.equal(first.asOf, fill.asOf);
    assert.deepEqual(await repository.appendFill(input), first);
    assert.equal(await readFile(path, "utf8"), firstBytes);
    const prior = replayBucketTurnoverEvents({ initialState: initial, events: [first] });
    assert.deepEqual(await repository.readWindowState(initial.turnoverStateId), prior);
    const nextFill = await createNextFill(prior, "second-turnover-fill");
    await assert.rejects(repository.appendFill({ ...input, paperFillRecordId: nextFill.paperFillRecordId }), /CAS mismatch/);
    const second = await repository.appendFill({ paperFillRecordId: nextFill.paperFillRecordId, expectedTurnoverStateHash: prior.turnoverStateHash });
    assert.equal(second.previousTurnoverEventId, first.turnoverEventId);
    assert.equal(second.resultingCumulativeAbsoluteFilledNotionalKrw, fill.filledNotionalKrw + nextFill.filledNotionalKrw);
    const reopened = new BucketTurnoverEventFileRepository(baseDir);
    const history = await reopened.readVerifiedHistory();
    assert.deepEqual(history.events, [first, second]);
    assert.deepEqual(await reopened.readWindowState(initial.turnoverStateId), replayBucketTurnoverEvents({ initialState: initial, events: [first, second] }));
    const origin = resolveVerifiedBucketTurnoverEventOrigin(history, first.turnoverEventId);
    assert.equal(origin.source.paperFillOrigin.paperFillRecordId, fill.paperFillRecordId);
    assert.ok(Object.isFrozen(origin.source.turnoverAssessment));
    assert.throws(() => resolveVerifiedBucketTurnoverEventOrigin({ ...history }, first.turnoverEventId), /not repository-verified/);
    assert.deepEqual(await reopened.appendFill(input), first);
    await assert.rejects(reopened.appendFill({ ...input, expectedTurnoverStateHash: prior.turnoverStateHash }), /original state mismatch/);
  });
});


test("turnover event accepts the durable fill completion millisecond and rejects earlier creation", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const source = await resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId });
    const completedAt = source.paperFillOrigin.completion!.completedAt;
    const before = new Date(Date.parse(completedAt) - 1).toISOString();
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    const paths = createBucketTurnoverEventPaths(baseDir);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(before) });
    try {
      await assert.rejects(repository.appendFill(input), /chronology|availability/);
      await assert.rejects(stat(paths.eventsPath), { code: "ENOENT" });
      await assert.rejects(stat(paths.pendingPath), { code: "ENOENT" });
      context.mock.timers.setTime(Date.parse(completedAt));
      const event = await repository.appendFill(input);
      assert.equal(event.createdAt, completedAt);
      const original = await readFile(paths.eventsPath, "utf8");
      const reopened = new BucketTurnoverEventFileRepository(baseDir);
      assert.deepEqual((await reopened.readVerifiedHistory()).events, [event]);
      assert.deepEqual(await reopened.appendFill(input), event);
      assert.equal(await readFile(paths.eventsPath, "utf8"), original);
      const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
      const earlier = { ...entry, appendStartedAt: before, event: { ...entry.event, createdAt: before } };
      const damaged = rehashTurnoverFillPair(earlier, marker);
      await writeFile(paths.eventsPath, damaged);
      await assert.rejects(reopened.readVerifiedHistory(), /corrupt/);
      assert.equal(await readFile(paths.eventsPath, "utf8"), damaged);
    } finally { context.mock.timers.reset(); }
  });
});


test("turnover event concurrent first append across processes converges to one event", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const request = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    const script = `import { BucketTurnoverEventFileRepository } from './dist/portfolio/bucketTurnoverEventFiles.js';
      const event = await new BucketTurnoverEventFileRepository(process.argv[1], { lockTimeoutMs: 30000 }).appendFill(JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify(event));`;
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => new Promise<unknown>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir, JSON.stringify(request)],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) { reject(new Error(stderr || `child exited ${code}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    })));
    const history = await new BucketTurnoverEventFileRepository(baseDir).readVerifiedHistory();
    assert.equal(history.events.length, 1);
    for (const result of results) { assert.equal(result.status, "fulfilled"); assert.deepEqual(result.value, history.events[0]); }
  });
});


test("turnover event rejects rehashed source, cumulative, predecessor and chronology drift without repairing bytes", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    const event = await repository.appendFill(input);
    const path = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { turnoverEventId: _id, turnoverEventHash: _hash, ...eventInput } = event;
    const alternatives = [
      { ...entry, priorStateHash: HASH }, { ...entry, previousEntryHash: HASH },
      { ...entry, source: { ...entry.source, absoluteFilledNotionalKrw: 1 } },
      { ...entry, event: createBucketTurnoverEvent({ ...eventInput, resultingCumulativeAbsoluteFilledNotionalKrw: event.absoluteFilledNotionalKrw + 1 }) },
      { ...entry, event: createBucketTurnoverEvent({ ...eventInput, previousTurnoverEventId: "unrelated" }) }
    ];
    const damaged = [original.trimEnd(), `${original}{corrupt}\n`, `${original}\n`, original.split("\n")[0] + "\n",
      ...alternatives.map((value) => rehashTurnoverFillPair(value, marker)),
      rehashTurnoverFillPair(entry, { ...marker, committedAt: root.snapshotOrigin.initialState.windowEndsAt })];
    // Even a correctly chained duplicate cannot count the same portfolio fill twice.
    damaged.push(original + rehashTurnoverFillPair({ ...entry, previousEntryHash: marker.commitHash, appendStartedAt: marker.committedAt }, marker));
    for (const bytes of damaged) {
      await writeFile(path, bytes);
      await assert.rejects(repository.readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(repository.appendFill(input), /corrupt|torn/);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, original);
    assert.deepEqual((await repository.readVerifiedHistory()).events, [event]);
  });
});


test("turnover event revalidates stored fill sources and refuses stale Risk prior state", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root, createNextFill }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const initial = root.snapshotOrigin.initialState;
    const event = await repository.appendFill({ paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: initial.turnoverStateHash });
    const current = await repository.readWindowState(initial.turnoverStateId);
    const stale = await createNextFill(initial, "stale-risk-fill");
    await assert.rejects(repository.appendFill({ paperFillRecordId: stale.paperFillRecordId, expectedTurnoverStateHash: current.turnoverStateHash }), /complete prior replay/);
    const fillPath = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(fillPath, "utf8");
    await writeFile(fillPath, original.split("\n").slice(0, 2).join("\n") + "\n");
    await assert.rejects(repository.readVerifiedHistory(), /corrupt/);
    await writeFile(fillPath, original);
    assert.deepEqual((await repository.readVerifiedHistory()).events, [event]);
    const paths = createBucketTurnoverEventPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned");
    await assert.rejects(new BucketTurnoverEventFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readVerifiedHistory(), /lock is unavailable/);
    await rm(paths.lockPath);
    await writeFile(paths.pendingPath, "unfinished");
    await assert.rejects(repository.readVerifiedHistory(), /pending/);
  });
});


test("turnover event append failures and boundary-crossing fsync retain a pending barrier", async (context) => {
  for (const failure of ["entry", "marker", "boundary"] as const) await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const paths = createBucketTurnoverEventPaths(baseDir);
    const probe = await open(join(baseDir, "turnover-probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let logSyncs = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 1 });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const target = await stat(paths.eventsPath, { bigint: true }).catch(() => undefined);
      await originalSync.call(this);
      if (target !== undefined && own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev)) {
        logSyncs++;
        if ((failure === "entry" && logSyncs === 1) || (failure === "marker" && logSyncs === 2)) throw new Error("injected turnover fsync failure");
        if (failure === "boundary" && logSyncs === 2) context.mock.timers.setTime(Date.parse(root.snapshotOrigin.initialState.windowEndsAt));
      }
    });
    try {
      await assert.rejects(repository.appendFill({ paperFillRecordId: fill.paperFillRecordId,
        expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash }), /injected turnover|commit clock or boundary/);
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
    const bytes = await readFile(paths.eventsPath, "utf8");
    assert.ok((await stat(paths.pendingPath)).isFile());
    await assert.rejects(new BucketTurnoverEventFileRepository(baseDir).readVerifiedHistory(), /pending/);
    assert.equal(await readFile(paths.eventsPath, "utf8"), bytes);
  });
});
