// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { BucketTurnoverEventFileRepository, createBucketTurnoverEventPaths, resolveVerifiedBucketTurnoverEventOrigin } from "./bucketTurnoverEventFiles.js";
import { BUCKET_TURNOVER_STATE_FILE_NAME, BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation, getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths, getDurablePortfolioSizingSnapshotObservation } from "./portfolioSizingSnapshotFiles.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths, RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import { RuntimePortfolioPolicyFileRepository, createRuntimePortfolioPolicyPaths } from "./runtimePortfolioPolicyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { withCompletedTurnoverFillFixture } from "./portfolioActionRiskDecisionTestFixtures.js";


test("turnover Risk sources retain repository leases and exclude other processes until callback exit", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const expected = await repository.refresh({ expectedProjectionHash: null });
    const files = [join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME), createBucketTurnoverEventPaths(baseDir).eventsPath,
      createBucketTurnoverWindowPaths(baseDir).recordsPath, createSourcePriceEvidencePaths(baseDir).recordsPath,
      createPortfolioSizingSnapshotPaths(baseDir).recordsPath];
    const bytes = await Promise.all(files.map((path) => readFile(path, "utf8")));
    const expired: (() => unknown)[] = [];
    const returned = await repository.withDurableRiskSources(async (sources) => {
      assert.ok(Object.isFrozen(sources));
      assert.deepEqual(sources.projection, expected);
      const getters = [() => getDurableSourcePriceEvidenceObservation(sources.prices),
        () => getDurablePortfolioSizingSnapshotObservation(sources.snapshots),
        () => getDurableBucketTurnoverStateObservation(sources.projection)];
      const observed = getters.map((get) => Date.parse(get().observedAt));
      assert.ok(observed[0]! <= observed[1]! && observed[1]! <= observed[2]!);
      expired.push(...getters);
      assert.throws(() => getDurableSourcePriceEvidenceObservation(structuredClone(sources.prices)), /lease/);
      assert.throws(() => getDurablePortfolioSizingSnapshotObservation(structuredClone(sources.snapshots)), /lease/);
      assert.throws(() => getDurableBucketTurnoverStateObservation(structuredClone(sources.projection)), /observation/);
      for (const path of [createBucketTurnoverEventPaths(baseDir).lockPath, createBucketTurnoverWindowPaths(baseDir).lockPath,
        createSourcePriceEvidencePaths(baseDir).lockPath, createPortfolioSizingSnapshotPaths(baseDir).lockPath]) {
        assert.ok((await stat(path)).isFile());
      }
      const script = `import assert from 'node:assert/strict';
        import { BucketTurnoverEventFileRepository } from './dist/portfolio/bucketTurnoverEventFiles.js';
        import { BucketTurnoverWindowFileRepository } from './dist/portfolio/bucketTurnoverWindowFiles.js';
        import { SourcePriceEvidenceFileRepository } from './dist/portfolio/sourcePriceEvidenceFiles.js';
        import { PortfolioSizingSnapshotFileRepository } from './dist/portfolio/portfolioSizingSnapshotFiles.js';
        const options = { lockTimeoutMs: 40, lockRetryDelayMs: 5 };
        const root = process.argv[1];
        await assert.rejects(new BucketTurnoverEventFileRepository(root, options).readVerifiedHistory(), /lock is unavailable/);
        await assert.rejects(new BucketTurnoverWindowFileRepository(root, options).readVerifiedHistory(), /lock is unavailable/);
        await assert.rejects(new SourcePriceEvidenceFileRepository(root, options).readVerifiedHistory(), /lock is unavailable/);
        await assert.rejects(new PortfolioSizingSnapshotFileRepository(root, options).readAll(), /lock is unavailable/);`;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir],
          { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
      });
      return "source-consumer-result";
    });
    assert.equal(returned, "source-consumer-result");
    for (const get of expired) assert.throws(get, /lease|observation/);
    assert.deepEqual(await Promise.all(files.map((path) => readFile(path, "utf8"))), bytes);
    await repository.withDurableRiskSources(async ({ prices, snapshots }) => {
      assert.ok(getDurableSourcePriceEvidenceObservation(prices));
      assert.ok(getDurablePortfolioSizingSnapshotObservation(snapshots));
    });
  });
});


test("turnover Risk sources honor short lock timeouts throughout nonempty historical source resolution", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const repository = new BucketTurnoverStateFileRepository(baseDir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    await repository.refresh({ expectedProjectionHash: null });
    const paths = [createSourcePriceEvidencePaths(baseDir).lockPath, createPortfolioSizingSnapshotPaths(baseDir).lockPath,
      createBucketTurnoverWindowPaths(baseDir).lockPath, createPaperFillExecutionPaths(baseDir).lockPath,
      createPortfolioActionRiskDecisionPaths(baseDir).lockPath, createRebalancePlanPaths(baseDir).lockPath,
      createRebalancePlanEventPaths(baseDir).lockPath, createInvestmentMandatePaths(baseDir).lockPath,
      createRuntimePortfolioPolicyPaths(baseDir).lockPath, createRuntimePortfolioPolicyActivationPaths(baseDir).lockPath];
    for (const path of paths) {
      await writeFile(path, "synthetic contended source", { flag: "wx" });
      let calls = 0;
      const started = performance.now();
      try {
        await assert.rejects(repository.withDurableRiskSources(async () => { calls += 1; }), (error: unknown) => {
          let cause = error;
          while (cause instanceof Error) {
            if (/lock is unavailable/.test(cause.message)) return true;
            cause = cause.cause;
          }
          return false;
        });
        // Allow filesystem/CI overhead, but detect a forgotten default 5-second acquisition wait.
        assert.ok(performance.now() - started < 4_000, `historical source ignored the short timeout: ${path}`);
        assert.equal(calls, 0);
        assert.equal(await readFile(path, "utf8"), "synthetic contended source");
      } finally { await rm(path); }
      await repository.withDurableRiskSources(async () => undefined);
      assert.deepEqual((await readdir(baseDir)).filter((name) => name.endsWith(".lock")), []);
    }
  });
});


test("turnover Risk sources release every lease and lock when the consumer throws", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    await repository.refresh({ expectedProjectionHash: null });
    const expired: (() => unknown)[] = [];
    await assert.rejects(repository.withDurableRiskSources(async ({ projection, prices, snapshots }) => {
      expired.push(() => getDurableBucketTurnoverStateObservation(projection),
        () => getDurableSourcePriceEvidenceObservation(prices), () => getDurablePortfolioSizingSnapshotObservation(snapshots));
      throw new Error("injected source consumer failure");
    }), /injected source consumer failure/);
    for (const get of expired) assert.throws(get, /lease|observation/);
    await repository.withDurableRiskSources(async () => undefined);
    assert.deepEqual((await readdir(baseDir)).filter((name) => name.endsWith(".lock")), []);
  });
});


test("turnover Risk sources wait for price before acquiring snapshot and do not deadlock a price owner", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    await repository.refresh({ expectedProjectionHash: null });
    const prices = new SourcePriceEvidenceFileRepository(baseDir);
    const snapshots = new PortfolioSizingSnapshotFileRepository(baseDir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 });
    let pending: Promise<void> | undefined;
    try { await prices.withDurableVerifiedHistory(async () => {
      let attempted!: () => void;
      const started = new Promise<void>((resolve) => { attempted = resolve; });
      const original = SourcePriceEvidenceFileRepository.prototype.withDurableVerifiedHistory;
      const hook = context.mock.method(SourcePriceEvidenceFileRepository.prototype, "withDurableVerifiedHistory",
        function (this: SourcePriceEvidenceFileRepository, ...args: Parameters<typeof original>) {
          attempted(); return original.apply(this, args);
        });
      try {
        pending = repository.withDurableRiskSources(async () => undefined);
        // Observe the actual price-acquisition attempt, not an elapsed-time guess.
        await started;
        assert.ok((await snapshots.readAll()).length > 0);
      } finally { hook.mock.restore(); }
    }); } finally { await pending; }
  });
});


test("turnover Risk sources reject missing stale corrupt and pending artifacts before invoking the consumer", async () => {
  await withCompletedTurnoverFillFixture(async ({ baseDir, root, fill }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    let calls = 0;
    const read = () => repository.withDurableRiskSources(async () => { calls += 1; });
    await assert.rejects(read(), /projection is missing/);
    const first = await repository.refresh({ expectedProjectionHash: null });
    await new BucketTurnoverEventFileRepository(baseDir).appendFillWithCompletion({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    await assert.rejects(read(), /projection is stale/);
    await repository.refresh({ expectedProjectionHash: first.projectionHash });
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const bytes = await readFile(path, "utf8");
    await writeFile(path, "{}");
    await assert.rejects(read(), /projection is corrupt/);
    assert.equal(await readFile(path, "utf8"), "{}");
    await writeFile(path, bytes);
    const pendingPath = createBucketTurnoverEventPaths(baseDir).pendingPath;
    await writeFile(pendingPath, "synthetic pending");
    await assert.rejects(read(), /pending append/);
    assert.equal(await readFile(pendingPath, "utf8"), "synthetic pending");
    await rm(pendingPath);
    assert.equal(calls, 0);
    await read();
    assert.equal(calls, 1);
  });
});


test("turnover Risk sources fail closed on each source fsync and release acquired locks", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    await repository.refresh({ expectedProjectionHash: null });
    const paths = [createSourcePriceEvidencePaths(baseDir).recordsPath, createPortfolioSizingSnapshotPaths(baseDir).recordsPath,
      createBucketTurnoverWindowPaths(baseDir).recordsPath, join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME)];
    const probe = await open(paths[0]!, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const original = prototype.sync;
    await probe.close();
    for (const path of paths) {
      const target = await stat(path, { bigint: true });
      let matched = 0;
      let calls = 0;
      const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
        const actual = await this.stat({ bigint: true });
        if (actual.isFile() && actual.ino === target.ino && (process.platform === "win32" || actual.dev === target.dev)) {
          matched += 1; throw new Error("injected Risk source sync failure");
        }
        await original.call(this);
      });
      try {
        await assert.rejects(repository.withDurableRiskSources(async () => { calls += 1; }), /injected Risk source sync failure/);
        assert.equal(calls, 0);
        assert.equal(matched, 1);
      } finally { sync.mock.restore(); }
      await repository.withDurableRiskSources(async () => undefined);
      assert.deepEqual((await readdir(baseDir)).filter((name) => name.endsWith(".lock")), []);
    }
  });
});


test("turnover Risk sources reject clock rollback between source observations", async (context) => {
  await withCompletedTurnoverFillFixture(async ({ baseDir }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    await repository.refresh({ expectedProjectionHash: null });
    const paths = [createPortfolioSizingSnapshotPaths(baseDir).recordsPath, join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME)];
    const probe = await open(paths[0]!, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const original = prototype.sync;
    await probe.close();
    for (const path of paths) {
      const target = await stat(path, { bigint: true });
      const now = Date.now() + 100;
      let calls = 0;
      let matched = 0;
      context.mock.timers.enable({ apis: ["Date"], now });
      const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
        const actual = await this.stat({ bigint: true });
        await original.call(this);
        if (actual.isFile() && actual.ino === target.ino && (process.platform === "win32" || actual.dev === target.dev)) {
          matched += 1; context.mock.timers.setTime(now - 1);
        }
      });
      try {
        await assert.rejects(repository.withDurableRiskSources(async () => { calls += 1; }), /Risk source observation clock moved backward/);
        assert.equal(calls, 0);
        assert.equal(matched, 1);
      } finally { sync.mock.restore(); context.mock.timers.reset(); }
      await repository.withDurableRiskSources(async () => undefined);
    }
  });
});
