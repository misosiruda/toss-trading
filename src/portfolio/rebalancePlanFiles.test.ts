import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanPaths, parseRebalancePlanRecords, RebalancePlanFileRepository, resolveVerifiedRebalancePlanOrigin } from "./rebalancePlanFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;

test("rebalance plan storage preserves first creation time on exact semantic retry and restart", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new RebalancePlanFileRepository(baseDir);
    const record = createRebalancePlanRecord(planInput());
    const beforeAppend = Date.now();
    await repository.append(record);
    const path = createRebalancePlanPaths(baseDir).recordsPath;
    const before = await readFile(path, "utf8");
    const later = createRebalancePlanRecord({ ...planInput(), createdAt: "2026-09-01T00:00:02.000Z" });
    assert.deepEqual(await repository.append(later), record);
    assert.equal(await readFile(path, "utf8"), before);
    const restarted = new RebalancePlanFileRepository(baseDir);
    assert.deepEqual(await restarted.resolveById(record.planId), record);
    assert.deepEqual(parseRebalancePlanRecords(before), [record]);
    const history = await restarted.readVerifiedHistory();
    const origin = resolveVerifiedRebalancePlanOrigin(history, record.planId);
    const [entry, marker] = before.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(entry.schemaVersion, "rebalance_plan_entry.v1");
    assert.equal(marker.entryHash, entry.entryHash);
    assert.equal(origin.appendedAt, marker.committedAt);
    assert.equal(origin.commitHash, marker.commitHash);
    assert.ok(Date.parse(origin.appendedAt) >= beforeAppend);
    assert.ok(Object.isFrozen(origin));
    assert.ok(Object.isFrozen(origin.record.actions));
    assert.ok(Object.isFrozen(history.records));
    await assert.rejects(restarted.resolveById("missing"), /does not resolve exactly once/);
  });
});

test("rebalance plan storage rejects different content or scope for an existing cycle", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new RebalancePlanFileRepository(baseDir);
    await repository.append(createRebalancePlanRecord(planInput()));
    const path = createRebalancePlanPaths(baseDir).recordsPath;
    const before = await readFile(path, "utf8");
    for (const input of [
      { ...planInput(), portfolioId: "other" }, { ...planInput(), triggerRef: "other" },
      { ...planInput(), actions: [{ ...planInput().actions[0]!, maximumNotionalKrw: 2_000 }] }
    ]) await assert.rejects(repository.append(createRebalancePlanRecord(input)), /cycle already has a different plan/);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("rebalance plan storage serializes process and in-process retries without duplicate cycles", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new RebalancePlanFileRepository(baseDir);
    const record = createRebalancePlanRecord(planInput());
    await Promise.all(Array.from({ length: 20 }, () => repository.append(record)));
    const fixturePath = join(baseDir, "fixture.json");
    await writeFile(fixturePath, JSON.stringify(record));
    await Promise.all(Array.from({ length: 3 }, () => appendFromChild(baseDir, fixturePath)));
    const distinct = Array.from({ length: 4 }, (_, index) => createRebalancePlanRecord({ ...planInput(), cycleId: `cycle-${index + 2}` }));
    await Promise.all(distinct.map((value) => repository.append(value)));
    const records = await new RebalancePlanFileRepository(baseDir).readAll();
    assert.equal(records.length, 5);
    assert.deepEqual(new Set(records.map((value) => value.planId)), new Set([record, ...distinct].map((value) => value.planId)));
  });
});

test("parsed or copied rebalance histories cannot impersonate repository origins", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new RebalancePlanFileRepository(baseDir);
    const record = createRebalancePlanRecord(planInput());
    await repository.append(record);
    const history = await repository.readVerifiedHistory();
    const raw = await readFile(createRebalancePlanPaths(baseDir).recordsPath, "utf8");
    for (const forged of [{ records: [record] }, { records: parseRebalancePlanRecords(raw) }, { ...history }, Object.create(history)]) {
      assert.throws(() => resolveVerifiedRebalancePlanOrigin(forged, record.planId), /not repository-verified/);
    }
  });
});

test("concurrent conflicting plans for a new cycle persist exactly one winner", async () => {
  await withDirectory(async (baseDir) => {
    const first = createRebalancePlanRecord(planInput());
    const second = createRebalancePlanRecord({ ...planInput(), triggerRef: "conflicting-trigger" });
    const results = await Promise.allSettled([
      new RebalancePlanFileRepository(baseDir).append(first),
      new RebalancePlanFileRepository(baseDir).append(second)
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const winner = results.find((result) => result.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled");
    assert.deepEqual(await new RebalancePlanFileRepository(baseDir).readAll(), [winner.value]);
  });
});

test("rebalance plan storage fails closed on torn pairs, altered hashes, duplicates and order", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new RebalancePlanFileRepository(baseDir);
    const first = createRebalancePlanRecord(planInput());
    await repository.append(first);
    await repository.append(createRebalancePlanRecord({ ...planInput(), cycleId: "cycle-2" }));
    const path = createRebalancePlanPaths(baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const lines = raw.trimEnd().split("\n");
    const [entry, marker] = lines.map((line) => JSON.parse(line));
    const duplicatePayload = { schemaVersion: entry.schemaVersion, record: first, appendStartedAt: marker.committedAt, previousEntryHash: marker.commitHash };
    const duplicateHash = hashCanonicalPayload(duplicatePayload);
    const duplicateMarker = { schemaVersion: marker.schemaVersion, entryHash: duplicateHash, committedAt: marker.committedAt };
    const firstPair = `${lines[0]}\n${lines[1]}\n`;
    const cycleDuplicatePayload = { ...duplicatePayload, record: createRebalancePlanRecord({ ...planInput(), triggerRef: "different-plan-same-cycle" }) };
    const cycleDuplicateHash = hashCanonicalPayload(cycleDuplicatePayload);
    const cycleDuplicateMarker = { ...duplicateMarker, entryHash: cycleDuplicateHash };
    for (const damaged of [
      raw.slice(0, -1), `${lines[0]}\n`, `${lines[0]}\n{`, `${lines[1]}\n`, "\n", "null\n",
      lines.slice(2).join("\n") + "\n", [...lines].reverse().join("\n") + "\n",
      `${JSON.stringify({ ...entry, entryHash: HASH })}\n${lines[1]}\n`,
      `${lines[0]}\n${JSON.stringify({ ...marker, commitHash: HASH })}\n`,
      `${lines[0]}\n${lines[3]}\n`,
      `${JSON.stringify({ ...entry, record: { ...first, triggerRef: "altered" } })}\n${lines[1]}\n`,
      firstPair + JSON.stringify({ ...duplicatePayload, entryHash: duplicateHash }) + "\n" + JSON.stringify({ ...duplicateMarker, commitHash: hashCanonicalPayload(duplicateMarker) }) + "\n",
      firstPair + JSON.stringify({ ...cycleDuplicatePayload, entryHash: cycleDuplicateHash }) + "\n" + JSON.stringify({ ...cycleDuplicateMarker, commitHash: hashCanonicalPayload(cycleDuplicateMarker) }) + "\n"
    ]) {
      await writeFile(path, damaged);
      assert.throws(() => parseRebalancePlanRecords(damaged), /torn|corrupt/);
      await assert.rejects(repository.readVerifiedHistory(), /torn|corrupt/);
      await assert.rejects(repository.append(first), /torn|corrupt/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("rebalance plan repository preserves abandoned locks and rejects future creation or invalid options", async () => {
  await withDirectory(async (baseDir) => {
    for (const value of [0, -1, 0.1, Infinity]) assert.throws(() => new RebalancePlanFileRepository(baseDir, { lockTimeoutMs: value }), /positive safe integer/);
    const paths = createRebalancePlanPaths(baseDir);
    const repository = new RebalancePlanFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const future = createRebalancePlanRecord({ ...planInput(), createdAt: "9999-01-01T00:00:00.000Z" });
    await assert.rejects(repository.append(future), /before creation/);
    assert.deepEqual(await repository.readAll(), []);
    await writeFile(paths.lockPath, "abandoned\n");
    await assert.rejects(repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("rebalance origin is sampled after real record fsync and incomplete writes are not repaired", async (context) => {
  for (const failSync of [false, true]) await withDirectory(async (baseDir) => {
    const path = createRebalancePlanPaths(baseDir).recordsPath;
    const probe = await open(join(baseDir, "probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let afterSync = 0;
    let duringSync = 0;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      const target = await stat(path).catch(() => undefined);
      const matches = afterSync === 0 && target !== undefined && own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev);
      if (matches) { duringSync = Date.now(); await new Promise((resolve) => setTimeout(resolve, 20)); if (failSync) throw new Error("injected plan fsync failure"); }
      await originalSync.call(this);
      if (matches) afterSync = Date.now();
    });
    const record = createRebalancePlanRecord(planInput());
    const repository = new RebalancePlanFileRepository(baseDir);
    try {
      if (failSync) await assert.rejects(repository.append(record), /injected plan fsync failure/);
      else await repository.append(record);
    } finally { mock.mock.restore(); }
    assert.ok(duringSync > 0);
    const restarted = new RebalancePlanFileRepository(baseDir);
    if (failSync) {
      const incomplete = await readFile(path, "utf8");
      assert.equal(incomplete.trimEnd().split("\n").length, 1);
      await assert.rejects(restarted.readVerifiedHistory(), /corrupt/);
      await assert.rejects(restarted.append(record), /corrupt/);
      assert.equal(await readFile(path, "utf8"), incomplete);
    } else {
      const origin = resolveVerifiedRebalancePlanOrigin(await restarted.readVerifiedHistory(), record.planId);
      assert.ok(afterSync > duringSync);
      assert.ok(Date.parse(origin.appendedAt) >= afterSync);
    }
  });
});

test("rebalance storage rejects rehashed cross-entry clock rollback before write and after restart", async (context) => {
  await withDirectory(async (baseDir) => {
    const now = Date.parse("2026-09-04T00:00:00.000Z");
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      const repository = new RebalancePlanFileRepository(baseDir);
      const first = createRebalancePlanRecord(planInput());
      const second = createRebalancePlanRecord({ ...planInput(), cycleId: "cycle-2" });
      await repository.append(first);
      const path = createRebalancePlanPaths(baseDir).recordsPath;
      const before = await readFile(path, "utf8");
      context.mock.timers.setTime(now - 1);
      await assert.rejects(repository.append(second), /clock moved backwards/);
      assert.equal(await readFile(path, "utf8"), before);
      assert.deepEqual(await repository.append(first), first);
      context.mock.timers.setTime(now + 2);
      await repository.append(second);
      const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
      const entry = JSON.parse(lines[2]!);
      const payload = { schemaVersion: entry.schemaVersion, record: second, appendStartedAt: new Date(now - 1).toISOString(), previousEntryHash: entry.previousEntryHash };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: "rebalance_plan_commit.v1", entryHash, committedAt: new Date(now - 1).toISOString() };
      const damaged = `${before}${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
      assert.throws(() => parseRebalancePlanRecords(damaged), /corrupt/);
      await writeFile(path, damaged);
      await assert.rejects(repository.readAll(), /corrupt/);
    } finally { context.mock.timers.reset(); }
  });
});

function planInput(): Parameters<typeof createRebalancePlanRecord>[0] {
  return { cycleId: "cycle-1", portfolioId: "paper-main", portfolioVersion: "v1", portfolioSnapshotHash: HASH,
    policyHash: HASH, evidenceCutoffAt: "2026-09-01T00:00:00.000Z", triggerRef: "trigger-1", phase: "buy", createdAt: "2026-09-01T00:00:01.000Z",
    actions: [{ actionId: "action-1", actionSequence: 0, market: "KR", symbol: "KR:005930", lineageKind: "mandate", side: "BUY", mandateId: "mandate-1", reasonCodes: ["gap"], maximumNotionalKrw: 1_100,
      executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: 1_000 } }] };
}
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "toss-rebalance-plan-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function appendFromChild(baseDir: string, fixturePath: string): Promise<void> {
  const code = 'import { readFile } from "node:fs/promises"; import { RebalancePlanFileRepository } from "./dist/portfolio/rebalancePlanFiles.js"; await new RebalancePlanFileRepository(process.argv[1]).append(JSON.parse(await readFile(process.argv[2], "utf8")));';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, baseDir, fixturePath], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child append failed: ${output}`)));
  });
}
