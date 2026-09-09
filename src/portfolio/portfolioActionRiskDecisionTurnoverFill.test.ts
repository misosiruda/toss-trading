// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { resolveBucketTurnoverFillOrigin } from "./bucketTurnoverFillOrigin.js";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { createStoragePaths, FileMarketPacketStore } from "../storage/repositories.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { HASH, turnoverRetryInput, rehashTurnoverFillPair, withTurnoverFillFixture, withRiskExecutionFixture, executionBoundFillInput } from "./portfolioActionRiskDecisionTestFixtures.js";


test("turnover fill origin resolves actual partial BUY, SELL and whole-share gross amounts without writes", async () => {
  for (const options of [{}, { side: "SELL" as const }, { whole: true }]) {
    await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
      const input = { baseDir, paperFillRecordId: fill.paperFillRecordId };
      const path = createPaperFillExecutionPaths(baseDir).recordsPath;
      const before = await readFile(path, "utf8");
      const result = await resolveBucketTurnoverFillOrigin(input);
      assert.equal(result.absoluteFilledNotionalKrw, fill.filledNotionalKrw);
      assert.notEqual(result.absoluteFilledNotionalKrw, fill.netAmountKrw);
      assert.equal(result.asOf, fill.asOf);
      assert.equal(result.bucket, "swing");
      assert.deepEqual(result.windowOrigin, root);
      assert.equal(result.rebalancePlanId, fill.rebalancePlanId);
      assert.equal(result.rebalanceActionId, fill.rebalanceActionId);
      assert.ok(Object.isFrozen(result.windowOrigin.snapshotOrigin.initialState));
      assert.deepEqual(await resolveBucketTurnoverFillOrigin(input), result);
      assert.equal(await readFile(path, "utf8"), before);
      if (fill.side === "BUY") assert.ok(result.absoluteFilledNotionalKrw < fill.requestedNotionalKrw);
    }, options);
  }
});


test("turnover fill origin rejects caller projections and independently rehashed plan/action substitutions", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const input = { baseDir, paperFillRecordId: fill.paperFillRecordId };
    for (const patch of [{ bucket: "hedge" }, { absoluteFilledNotionalKrw: 1 }, { asOf: fill.asOf }, { riskOrigin: {} }]) {
      await assert.rejects(resolveBucketTurnoverFillOrigin({ ...input, ...patch }));
    }
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker, completion] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { paperFillRecordId: _id, paperFillHash: _hash, ...payload } = fill;
    for (const patch of [{ rebalancePlanId: "other-plan" }, { rebalanceActionId: "other-action" }]) {
      const record = createPaperFillExecutionRecord({ ...payload, ...patch });
      await writeFile(path, rehashTurnoverFillPair({ ...entry, record }, marker, completion));
      await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: record.paperFillRecordId }), /scope mismatch/);
    }
    await writeFile(path, rehashTurnoverFillPair({ ...entry, riskOrigin: { ...entry.riskOrigin, commitHash: HASH } }, marker, completion));
    await assert.rejects(resolveBucketTurnoverFillOrigin(input), /persisted Risk origin/);
    await writeFile(path, original);
    assert.equal((await resolveBucketTurnoverFillOrigin(input)).fillId, fill.fillId);
  });
});


test("turnover fill origin rejects missing, corrupt and pending actual source histories", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const input = { baseDir, paperFillRecordId: fill.paperFillRecordId };
    for (const path of [createRebalancePlanPaths(baseDir).recordsPath, createInvestmentMandatePaths(baseDir).recordsPath,
      createSourcePriceEvidencePaths(baseDir).recordsPath, createStoragePaths(baseDir).marketPacketsPath,
      createBucketTurnoverWindowPaths(baseDir).recordsPath]) {
      const original = await readFile(path, "utf8");
      for (const content of ["", `${original}{corrupt}\n`]) {
        await writeFile(path, content);
        await assert.rejects(resolveBucketTurnoverFillOrigin(input));
        assert.equal(await readFile(path, "utf8"), content);
      }
      await writeFile(path, original);
    }
    const pending = createBucketTurnoverWindowPaths(baseDir).pendingPath;
    await writeFile(pending, "unfinished");
    await assert.rejects(resolveBucketTurnoverFillOrigin(input), /pending/);
  });
});


test("turnover fill origin rejects mismatched Risk window identity and denominator", async () => {
  for (const patch of [{ turnoverStateId: "other-window" }, { turnoverWindowOpenPortfolioNetWorthKrw: 2_000_000 }]) {
    await withTurnoverFillFixture(async ({ baseDir, fill }) => {
      await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /window identity or fixed denominator/);
    }, { assessment: patch });
  }
});


test("turnover fill origin rejects late durable fill commits and source clock rollback", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker, completion] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    await writeFile(path, rehashTurnoverFillPair(entry, marker, { ...completion, completedAt: root.snapshotOrigin.initialState.windowEndsAt }));
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /chronology or window boundary/);
    await writeFile(path, original);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(root.appendedAt) - 1 });
    try { await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId })); }
    finally { context.mock.timers.reset(); }
  });
});


test("turnover fill origin rejects unbound fills and never assigns legacy reduce-only fills to buckets", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const history = await repository.readVerifiedHistory();
    const preview = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!.preview;
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const fill = await fills.createAndAppendWithRiskOrigin(executionBoundFillInput(candidate, preview), history, decision.riskDecisionId);
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /legacy reduce-only/);
    const unboundDir = join(baseDir, "unbound");
    await new PaperFillExecutionFileRepository(unboundDir).append(fill);
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir: unboundDir, paperFillRecordId: fill.paperFillRecordId }), /requires a persisted Risk origin/);
  }, { side: "SELL", legacy: true });
});


test("turnover fill completion proof survives retries and cannot be retrofitted to old pairs", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const history = await fills.readVerifiedHistory();
    const origin = resolvePersistedPaperFillExecutionOrigin(history, fill.paperFillRecordId);
    assert.ok(origin.completion);
    assert.ok(Date.parse(origin.completion.completedAt) >= Date.parse(origin.appendedAt));
    const risks = await new PortfolioActionRiskDecisionFileRepository(baseDir).readVerifiedHistory();
    const riskId = origin.riskOrigin!.riskDecisionId;
    const input = turnoverRetryInput(fill);
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    assert.equal(original.trimEnd().split("\n").length, 3);
    assert.deepEqual(await fills.createAndAppendWithRiskCompletion(input, risks, riskId), fill);
    assert.equal(await readFile(path, "utf8"), original);
    const unbound = createPaperFillExecutionRecord({ ...input, fillId: "mixed-v1-fill", asOf: fill.asOf, createdAt: fill.createdAt });
    await fills.append(unbound);
    const mixed = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(mixed[3].previousEntryHash, origin.completion.completionHash);
    assert.deepEqual(await fills.readAll(), [fill, unbound]);
    const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const oldPair = rehashTurnoverFillPair({ ...entry, schemaVersion: "paper_fill_execution_entry.v2" }, marker);
    await writeFile(path, oldPair);
    assert.deepEqual(await fills.createAndAppendWithRiskOrigin(input, risks, riskId), fill);
    await assert.rejects(fills.createAndAppendWithRiskCompletion(input, risks, riskId), /cannot be added after persistence/);
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /post-fsync completion proof/);
    assert.equal(await readFile(path, "utf8"), oldPair);
  });
});


test("turnover fill completion rejects missing, torn, altered and backward completion records", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker, completion] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const bytes of [rehashTurnoverFillPair(entry, marker), original.trimEnd(),
      rehashTurnoverFillPair(entry, marker, { ...completion, completedAt: new Date(Date.parse(marker.committedAt) - 1).toISOString() }),
      `${original.split("\n").slice(0, 2).join("\n")}\n${JSON.stringify({ ...completion, commitHash: HASH })}\n`]) {
      await writeFile(path, bytes);
      await assert.rejects(new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }));
      assert.equal(await readFile(path, "utf8"), bytes);
    }
  });
});


test("turnover rejects a marker fsync that crosses the window even when committedAt is inside", async (context) => {
  for (const failMarker of [false, true]) await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const fillOrigin = resolvePersistedPaperFillExecutionOrigin(await fills.readVerifiedHistory(), fill.paperFillRecordId);
    const risks = await new PortfolioActionRiskDecisionFileRepository(baseDir).readVerifiedHistory();
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const probe = await open(path, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const end = Date.parse(root.snapshotOrigin.initialState.windowEndsAt);
    let crossed = false;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const target = await stat(path, { bigint: true });
      await originalSync.call(this);
      if (own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev) &&
        (await readFile(path, "utf8")).trimEnd().split("\n").length === 5) {
        crossed = true;
        context.mock.timers.setTime(end);
        if (failMarker) throw new Error("injected marker fsync failure");
      }
    });
    let late: ReturnType<typeof createPaperFillExecutionRecord> | undefined;
    try {
      const operation = fills.createAndAppendWithRiskCompletion({ ...turnoverRetryInput(fill), fillId: "late-fill" }, risks, fillOrigin.riskOrigin!.riskDecisionId);
      if (failMarker) await assert.rejects(operation, /injected marker fsync failure/);
      else late = await operation;
    } finally { sync.mock.restore(); }
    try {
      assert.equal(crossed, true);
      if (failMarker) await assert.rejects(fills.readVerifiedHistory(), /corrupt/);
      else {
        assert.ok(late);
        const lateOrigin = resolvePersistedPaperFillExecutionOrigin(await fills.readVerifiedHistory(), late.paperFillRecordId);
        assert.ok(Date.parse(lateOrigin.appendedAt) < end);
        assert.equal(Date.parse(lateOrigin.completion!.completedAt), end);
        await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: late.paperFillRecordId }), /chronology or window boundary/);
      }
    } finally { context.mock.timers.reset(); }
  });
});
