import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import {
  PaperFillExecutionFileRepository,
  createPaperFillExecutionPaths,
  getVerifiedPaperFillExecutionRecords,
  getPersistedPaperFillExecutionRecords,
  resolvePersistedPaperFillExecutionOrigin,
  parseVerifiedPaperFillExecutionHistory,
  getHeldPaperFillExecutionObservation,
  type VerifiedPaperFillExecutionHistory
} from "./paperFillExecutionFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}`;

test("paper fill repository appends, resolves, and converges createdAt retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    const retry = paperFill({ createdAt: "2026-09-03T00:00:02.000Z" });

    assert.deepEqual(await repository.append(first), first);
    assert.deepEqual(await repository.append(retry), first);
    assert.deepEqual(await repository.resolveById(first.paperFillRecordId), first);
    assert.deepEqual(await repository.readAll(), [first]);
    const history = await repository.readVerifiedHistory();
    assert.deepEqual(getVerifiedPaperFillExecutionRecords(history), [first]);
    assert.deepEqual(getPersistedPaperFillExecutionRecords(history), [first]);
    const raw = await readFile(
      createPaperFillExecutionPaths(baseDir).recordsPath,
      "utf8"
    );
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(entry.record, first);
    assert.equal(entry.schemaVersion, "paper_fill_execution_entry.v1");
    const restarted = await new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory();
    assert.equal(resolvePersistedPaperFillExecutionOrigin(restarted, first.paperFillRecordId).appendedAt, marker.committedAt);
    await repository.append(retry);
    assert.equal(await readFile(createPaperFillExecutionPaths(baseDir).recordsPath, "utf8"), raw);
  });
});

test("paper fill repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const candidate = paperFill();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(candidate))
    );

    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [candidate]);
  });
});

test("paper fill repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "paper-fill.json");
    const candidate = paperFill();
    await writeFile(fixturePath, JSON.stringify(candidate), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );

    assert.deepEqual(stored, [candidate, candidate, candidate, candidate]);
    assert.deepEqual(
      await new PaperFillExecutionFileRepository(baseDir).readAll(),
      [candidate]
    );
  });
});

test("paper fill repository preserves distinct immutable records", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    const second = paperFill({ fillId: "fill-2" });

    await repository.append(first);
    await repository.append(second);
    assert.deepEqual(await repository.readAll(), [first, second]);
    await assert.rejects(
      () => repository.resolveById("missing"),
      /does not resolve exactly once/
    );
  });
});

test("paper fill repository enforces portfolio-wide fill ID uniqueness", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPaperFillExecutionPaths(baseDir);
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    const repeatedFill = paperFill({ rebalancePlanId: "plan-2" });

    await repository.append(first);
    await assert.rejects(
      () => repository.append(repeatedFill),
      /duplicate portfolio fill ID/
    );

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(first)}\n${JSON.stringify(repeatedFill)}\n`,
      "utf8"
    );
    await assert.rejects(
      () => repository.readAll(),
      /duplicate portfolio fill ID/
    );
  });
});

test("paper fill repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPaperFillExecutionPaths(baseDir);
    const candidate = paperFill();
    const repository = new PaperFillExecutionFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify({
        ...candidate,
        quantity: candidate.quantity + 1
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify(candidate)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ID/);
  });
});

test("paper fill repository rejects unverified history and abandoned locks", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    assert.throws(
      () => getVerifiedPaperFillExecutionRecords({ records: [] } as never),
      /history is not verified/
    );
    const parsed = parseVerifiedPaperFillExecutionHistory("");
    assert.deepEqual(getVerifiedPaperFillExecutionRecords(parsed), []);
    assert.throws(() => getPersistedPaperFillExecutionRecords(parsed), /not repository verified/);
    const forged = Object.create(parsed) as {
      records: readonly ReturnType<typeof paperFill>[];
    };
    Object.defineProperty(forged, "records", {
      value: Object.freeze([paperFill()]),
      enumerable: true
    });
    assert.throws(
      () =>
        getVerifiedPaperFillExecutionRecords(
          forged as VerifiedPaperFillExecutionHistory
        ),
      /history is not verified/
    );

    const paths = createPaperFillExecutionPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PaperFillExecutionFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });

    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("paper fill repository preserves legacy records without synthesizing append origins", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPaperFillExecutionPaths(baseDir);
    const first = paperFill();
    const raw = `${JSON.stringify(first)}\n`;
    await writeFile(paths.recordsPath, raw);
    const repository = new PaperFillExecutionFileRepository(baseDir);
    assert.deepEqual(await repository.append(first), first);
    assert.equal(await readFile(paths.recordsPath, "utf8"), raw);
    let history = await repository.readVerifiedHistory();
    assert.deepEqual(getPersistedPaperFillExecutionRecords(history), [first]);
    assert.throws(() => resolvePersistedPaperFillExecutionOrigin(history, first.paperFillRecordId), /legacy record requires review/);
    const second = paperFill({ fillId: "fill-2" });
    await repository.append(second);
    history = await new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory();
    assert.deepEqual(history.records, [first, second]);
    assert.equal(resolvePersistedPaperFillExecutionOrigin(history, second.paperFillRecordId).record.paperFillHash, second.paperFillHash);
    const mixed = await readFile(paths.recordsPath, "utf8");
    await writeFile(paths.recordsPath, mixed.slice(raw.length));
    await assert.rejects(() => repository.readVerifiedHistory(), /corrupt line/);
  });
});

test("paper fill repository authenticates append metadata and rejects entry downgrade", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const first = paperFill();
    await repository.append(first);
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entryLine, markerLine] = raw.trimEnd().split("\n");
    const entry = JSON.parse(entryLine!);
    const marker = JSON.parse(markerLine!);
    for (const damaged of [
      `${JSON.stringify({ ...entry, appendStartedAt: "2000-01-01T00:00:00.000Z" })}\n${markerLine}\n`,
      `${JSON.stringify({ ...entry, previousEntryHash: HASH_A })}\n${markerLine}\n`,
      `${entryLine}\n${JSON.stringify({ ...marker, committedAt: "2000-01-01T00:00:00.000Z" })}\n`,
      raw + JSON.stringify(paperFill({ fillId: "fill-2" })) + "\n"
    ]) {
      await writeFile(path, damaged);
      await assert.rejects(() => repository.readVerifiedHistory(), /corrupt line/);
      await assert.rejects(() => repository.append(first), /corrupt line/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("paper fill commit origin is sampled after a delayed record fsync", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const probe = await open(join(baseDir, "probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let duringWrite = 0;
    let afterRecordSync = 0;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const ownStat = await this.stat();
      const targetStat = await stat(path).catch(() => undefined);
      // Windows path stat reports dev=0 while fstat reports the volume ID.
      const isFirstRecordSync = afterRecordSync === 0 && targetStat !== undefined &&
        ownStat.isFile() && ownStat.ino === targetStat.ino &&
        (process.platform === "win32" || ownStat.dev === targetStat.dev);
      if (isFirstRecordSync) {
        duringWrite = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await originalSync.call(this);
      if (isFirstRecordSync) afterRecordSync = Date.now();
    });
    try {
      const record = paperFill();
      const repository = new PaperFillExecutionFileRepository(baseDir);
      await repository.append(record);
      const history = await new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory();
      const origin = resolvePersistedPaperFillExecutionOrigin(history, record.paperFillRecordId);
      assert.ok(duringWrite > 0);
      assert.ok(afterRecordSync > duringWrite);
      assert.ok(Date.parse(origin.appendedAt) >= afterRecordSync);
      assert.ok(Date.parse(origin.appendedAt) > duringWrite);
    } finally {
      syncMock.mock.restore();
    }
  });
});

test("paper fill repository rejects missing, torn, orphaned and mismatched commit markers", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir);
    const record = paperFill();
    await repository.append(record);
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n");
    for (const raw of [
      `${entry}\n`, `${entry}\n{`, `${marker}\n`,
      `${entry}\n${entry}\n`, `${entry}\n${marker}\n${marker}\n`
    ]) {
      await writeFile(path, raw);
      await assert.rejects(() => repository.readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(() => repository.append(record), /corrupt|torn/);
      assert.equal(await readFile(path, "utf8"), raw);
    }
  });
});

test("paper fill held observations expire exclude writers and preserve historical origins", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir, { lockTimeoutMs: 40, lockRetryDelayMs: 2 });
    await repository.withDurableVerifiedHistory(async (history) => {
      assert.equal(getHeldPaperFillExecutionObservation(history).recordCount, 0);
      assert.equal(getHeldPaperFillExecutionObservation(history).sourceGenerationHash, null);
    });
    const record = await repository.append(paperFill());
    const historical = await repository.readVerifiedHistory();
    assert.throws(() => getHeldPaperFillExecutionObservation(historical), /unverified/);
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 1 });
    try {
      for (const fail of [false, true]) {
        let escaped: VerifiedPaperFillExecutionHistory | undefined;
        const operation = repository.withDurableVerifiedHistory(async (history) => {
          escaped = history;
          const observation = getHeldPaperFillExecutionObservation(history);
          assert.equal(observation.recordCount, 1); assert.equal(observation.recordsHash, hashCanonicalPayload([record]));
          assert.ok(Object.isFrozen(observation)); assert.match(observation.sourceGenerationHash!, /^sha256:/);
          assert.throws(() => getHeldPaperFillExecutionObservation({ ...history }), /unverified/);
          await assert.rejects(repository.append(record), /lock is unavailable/);
          if (fail) throw new Error("synthetic fill consumer failure");
        });
        if (fail) await assert.rejects(operation, /consumer failure/); else await operation;
        assert.throws(() => getHeldPaperFillExecutionObservation(escaped!), /expired/);
        assert.deepEqual(resolvePersistedPaperFillExecutionOrigin(escaped!, record.paperFillRecordId).record, record);
        assert.deepEqual(await repository.append(record), record);
      }
    } finally { context.mock.timers.reset(); }
  });
});

test("paper fill held source rejects legacy corrupt and future commits without repair", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir), path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const record = await repository.append(paperFill()), raw = await readFile(path, "utf8"), marker = JSON.parse(raw.trimEnd().split("\n")[1]!);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(marker.committedAt) - 1 });
    try { await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("future commit")), /clock precedes/); }
    finally { context.mock.timers.reset(); }
    await writeFile(path, `${JSON.stringify(record)}\n`);
    assert.deepEqual((await repository.readVerifiedHistory()).records, [record]);
    await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("legacy source")), /legacy/);
    for (const damaged of [`${raw}{\n`, raw.slice(0, -1)]) {
      await writeFile(path, damaged);
      await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("corrupt source")));
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("paper fill held source requires durable completion and refuses a future completion observation", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir), record = await repository.append(paperFill());
    const path = createPaperFillExecutionPaths(baseDir).recordsPath, raw = await readFile(path, "utf8");
    const [entry, oldMarker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    const payload = { schemaVersion: "paper_fill_execution_entry.v3", record, appendStartedAt: entry.appendStartedAt, previousEntryHash: null,
      riskOrigin: { riskDecisionId: "synthetic-risk", riskDecisionHash: HASH_A, commitHash: HASH_A, appendedAt: record.asOf } };
    const entryHash = hashCanonicalPayload(payload), marker = { schemaVersion: oldMarker.schemaVersion, entryHash, committedAt: oldMarker.committedAt };
    const commitHash = hashCanonicalPayload(marker), completion = { schemaVersion: "paper_fill_execution_completion.v1", commitHash,
      completedAt: new Date(Date.parse(marker.committedAt) + 10).toISOString() };
    const first = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...marker, commitHash })}\n`;
    await writeFile(path, first);
    await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("missing completion")), /corrupt/);
    await writeFile(path, `${first}${JSON.stringify({ ...completion, completionHash: hashCanonicalPayload(completion) })}\n`);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(completion.completedAt) - 1 });
    try {
      await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("future completion")), /clock precedes/);
      context.mock.timers.setTime(Date.parse(completion.completedAt));
      await repository.withDurableVerifiedHistory(async (history) => {
        assert.equal(resolvePersistedPaperFillExecutionOrigin(history, record.paperFillRecordId).completion!.completedAt, completion.completedAt);
        assert.equal(getHeldPaperFillExecutionObservation(history).recordCount, 1);
      });
    } finally { context.mock.timers.reset(); }
  });
});

test("paper fill held source propagates descriptor fsync failure before consumption and releases its lock", async (context) => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PaperFillExecutionFileRepository(baseDir, { lockTimeoutMs: 40, lockRetryDelayMs: 2 });
    const record = await repository.append(paperFill()), path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const before = await readFile(path), probe = await open(path, "r"), prototype = Object.getPrototypeOf(probe) as FileHandle;
    const sourceStat = await probe.stat(), original = prototype.sync; await probe.close(); let failed = false;
    const hook = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      if (own.isFile() && own.ino === sourceStat.ino && (process.platform === "win32" || own.dev === sourceStat.dev)) {
        failed = true; throw new Error("synthetic held fill fsync failure");
      }
      return original.call(this);
    });
    try { await assert.rejects(repository.withDurableVerifiedHistory(async () => assert.fail("unflushed source")), /fill fsync failure/); }
    finally { hook.mock.restore(); }
    assert.equal(failed, true); assert.deepEqual(await readFile(path), before);
    await repository.withDurableVerifiedHistory(async (history) => assert.deepEqual(history.records, [record]));
  });
});

function paperFill(
  overrides: Partial<{
    createdAt: string;
    fillId: string;
    rebalancePlanId: string;
  }> = {}
) {
  return createPaperFillExecutionRecord({
    ...validInput(),
    fillId: overrides.fillId ?? "fill-1",
    rebalancePlanId: overrides.rebalancePlanId ?? "plan-1",
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

function validInput() {
  const executionPolicy = {
    modelVersion:
      PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION,
    fillPriceRule: "current_candidate_last_price" as const,
    slippageBps: 0,
    feeBps: 0,
    taxBps: 0,
    halfSpreadBps: 0,
    fillRatio: 1,
    allowFractionalShares: true,
    maxVolumeParticipationRate: 0.1,
    minLiquidityFillRatio: 0.1,
    rejectStaleLiquidity: true,
    marketImpactBpsPerParticipationRate: 0
  };
  const replay = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: 1_000,
    sourcePriceKrw: 100,
    liquidityStale: false,
    policy: executionPolicy
  });
  return {
    portfolioId: "portfolio-1",
    rebalancePlanId: "plan-1",
    rebalanceActionId: "action-1",
    fillId: "fill-1",
    market: "KR" as const,
    symbol: "KR:005930",
    side: "BUY" as const,
    requestedNotionalKrw: replay.requestedNotionalKrw,
    requestedQuantity: replay.requestedNotionalKrw / replay.fillPriceKrw,
    quantityOverride: null,
    sourcePriceKrw: replay.sourcePriceKrw,
    sourcePriceEvidence: {
      sourceContractId: "source-price-contract-v1",
      evidenceRef: "price-evidence-1",
      evidenceHash: HASH_A,
      market: "KR" as const,
      symbol: "KR:005930",
      priceField: "last_price" as const,
      observedAt: "2026-09-02T23:59:59.000Z"
    },
    averagePriceKrw: null,
    fillPriceKrw: replay.fillPriceKrw,
    quantity: replay.quantity,
    filledNotionalKrw: replay.filledNotionalKrw,
    grossAmountKrw: replay.grossAmountKrw,
    netAmountKrw: replay.netAmountKrw,
    participationRate: replay.participationRate ?? null,
    volume: replay.volume ?? null,
    averageVolume: replay.averageVolume ?? null,
    liquidityStale: false,
    fillStatus: replay.fillStatus as "filled" | "partial",
    liquidityStatus: replay.liquidityStatus as
      | "not_modeled"
      | "sufficient"
      | "partial",
    liquidityRejectReason: null,
    fractionalShares: replay.fractionalShares,
    executionPolicy,
    costBreakdown: {
      feeKrw: replay.feeKrw,
      taxKrw: replay.taxKrw,
      slippageKrw: replay.slippageKrw,
      spreadCostKrw: replay.spreadCostKrw,
      impactCostKrw: replay.impactCostKrw,
      totalCostKrw: replay.totalCostKrw
    },
    evidenceRefs: ["price-evidence-1", "fee-evidence-1"],
    asOf: "2026-09-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:01.000Z"
  };
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-paper-fill-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof paperFill>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PaperFillExecutionFileRepository } from "./dist/portfolio/paperFillExecutionFiles.js";
    const record = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PaperFillExecutionFileRepository(process.argv[2]);
    const stored = await repository.append(record);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof paperFill>);
    });
  });
}
