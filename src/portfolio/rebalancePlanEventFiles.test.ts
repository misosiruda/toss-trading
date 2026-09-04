import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRebalancePlanRecord, type RebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths, RebalancePlanEventFileRepository, replayVerifiedRebalancePlanEventHistory, resolveVerifiedRebalancePlanEventOrigin } from "./rebalancePlanEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const H = (value: string) => hashCanonicalPayload({ fixture: value });
type EventInput = Parameters<typeof createRebalancePlanEvent>[0];

test("rebalance event storage replays complete partial-fill history after restart and preserves retry origin", async () => {
  await withDirectory(async (directory) => {
    const { plans, repository, plan, path } = await setup(directory);
    assert.deepEqual(await repository.readAll(), []);
    await assert.rejects(repository.readPlanState(plan.planId), /no stored event history/);
    const preview = await repository.append(event(plan, "previewed"));
    const firstRead = await repository.readVerifiedHistory();
    const firstOrigin = resolveVerifiedRebalancePlanEventOrigin(firstRead, preview.planEventId);
    let previous = await repository.append(event(plan, "approved", preview));
    const executions: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      previous = await repository.append(event(plan, "execution_applied", previous, {
        actionId: "action-1", actionSequence: 0, fillSequence: index, fillId: `fill-${index}`, paperFillRecordId: `paper-${index}`,
        paperFillHash: H(`paper-${index}`), riskDecisionId: `risk-${index}`, requestedNotionalKrw: 50, requestedQuantity: 0.5,
        filledNotionalKrw: 50, filledQuantity: 0.5, cumulativeFilledNotionalKrw: 50 * (index + 1), cumulativeFilledQuantity: 0.5 * (index + 1),
        expectedPrePortfolioVersion: `v${index + 1}`, expectedPrePortfolioSnapshotHash: H(`v${index + 1}`),
        resultingPortfolioVersion: `v${index + 2}`, resultingPortfolioSnapshotHash: H(`v${index + 2}`)
      }));
      executions.push(previous.planEventId);
    }
    await repository.append(event(plan, "applied", previous, { executionEventIds: executions, resultingPortfolioVersion: "v3", resultingPortfolioSnapshotHash: H("v3") }));
    const before = await readFile(path, "utf8");
    const restarted = new RebalancePlanEventFileRepository(directory, new RebalancePlanFileRepository(directory));
    assert.equal((await restarted.readPlanState(plan.planId)).status, "applied");
    assert.deepEqual(await restarted.append(preview), preview);
    assert.equal(await readFile(path, "utf8"), before);
    const latest = await restarted.readVerifiedHistory();
    assert.deepEqual(resolveVerifiedRebalancePlanEventOrigin(latest, preview.planEventId), firstOrigin);
    assert.notEqual(latest.generationHash, firstRead.generationHash);
    assert.equal(replayVerifiedRebalancePlanEventHistory(firstRead, plan.planId).status, "previewed");
    assert.ok(Object.isFrozen(latest.events));
    assert.ok(Object.isFrozen(firstOrigin));
    assert.ok((await plans.readAll()).length === 1);
    for (const copy of [{ ...latest }, JSON.parse(JSON.stringify(latest)), Object.create(latest)]) {
      assert.throws(() => resolveVerifiedRebalancePlanEventOrigin(copy, preview.planEventId), /not repository-verified/);
      assert.throws(() => replayVerifiedRebalancePlanEventHistory(copy, plan.planId), /not repository-verified/);
    }
    assert.throws(() => resolveVerifiedRebalancePlanEventOrigin(latest, "missing"), /does not resolve exactly once/);
  });
});

test("rebalance event storage serializes exact retries across processes and competing predecessors", async () => {
  await withDirectory(async (directory) => {
    const { repository, plan } = await setup(directory);
    const preview = event(plan, "previewed");
    await Promise.all(Array.from({ length: 20 }, () => repository.append(preview)));
    const fixture = join(directory, "fixture.json");
    await writeFile(fixture, JSON.stringify(preview));
    await Promise.all(Array.from({ length: 3 }, () => appendFromChild(directory, fixture)));
    const results = await Promise.allSettled([repository.append(event(plan, "approved", preview)), repository.append(event(plan, "rejected", preview))]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await repository.readAll()).length, 2);
  });
});

test("rebalance event storage independently replays interleaved plans and rejects missing or mismatched plan sources", async () => {
  await withDirectory(async (directory) => {
    const { repository, plans, plan, path } = await setup(directory);
    const second = await plans.append(makePlan("cycle-2"));
    const firstPreview = await repository.append(event(plan, "previewed"));
    const secondPreview = await repository.append(event(second, "previewed"));
    await repository.append(event(plan, "rejected", firstPreview));
    await repository.append(event(second, "stale", secondPreview, { observedCurrentPortfolioVersion: "external", observedCurrentPortfolioSnapshotId: "external", observedCurrentPortfolioSnapshotHash: H("external") }));
    assert.equal((await repository.readPlanState(plan.planId)).status, "rejected");
    assert.equal((await repository.readPlanState(second.planId)).status, "stale");
    const before = await readFile(path, "utf8");
    await assert.rejects(repository.append(event(makePlan("missing"), "previewed")), /does not resolve exactly once/);
    await assert.rejects(repository.append(event(plan, "previewed", undefined, { policyHash: H("other") })), /record policyHash mismatch/);
    assert.equal(await readFile(path, "utf8"), before);
    await writeFile(createRebalancePlanPaths(directory).recordsPath, "");
    await assert.rejects(repository.readAll(), /corrupt entry/);
  });
});

test("rebalance event reader rejects torn, duplicate, reordered and rehashed invalid histories without repair", async () => {
  await withDirectory(async (directory) => {
    const { repository, plan, path } = await setup(directory);
    const preview = await repository.append(event(plan, "previewed"));
    const approved = await repository.append(event(plan, "approved", preview));
    const raw = await readFile(path, "utf8");
    const lines = raw.trimEnd().split("\n");
    const parsed = lines.map((line) => JSON.parse(line));
    const branch = event(plan, "rejected", preview, { asOf: approved.asOf, previousPlanEventId: "unknown" });
    const damage = [raw.slice(0, -1), `${lines[0]}\n`, `${lines[0]}\n{`, "\n", "null\n",
      `${lines[2]}\n${lines[3]}\n`, [...lines].reverse().join("\n") + "\n",
      `${JSON.stringify({ ...parsed[0], entryHash: H("tampered") })}\n${lines[1]}\n`,
      rewrite(raw, 0, { planCommitHash: H("foreign-origin") }),
      rewrite(raw, 2, { event: preview }), rewrite(raw, 2, { event: branch }),
      `${lines[0]}\n${JSON.stringify({ ...parsed[1], commitHash: H("tampered") })}\n`
    ];
    for (const damaged of damage) {
      await writeFile(path, damaged);
      await assert.rejects(repository.readVerifiedHistory());
      await assert.rejects(repository.append(preview));
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("rebalance event persistence enforces plan and predecessor availability and rejects clock rollback", async (context) => {
  await withDirectory(async (directory) => {
    const now = Date.parse("2026-09-04T01:00:00.000Z");
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      const { repository, plan, path, plans } = await setup(directory);
      await assert.rejects(repository.append(event(plan, "previewed", undefined, { asOf: new Date(now - 1).toISOString() })), /precedes stored plan/);
      await assert.rejects(repository.append(event(plan, "previewed", undefined, { asOf: new Date(now + 1).toISOString() })), /before its asOf/);
      const preview = await repository.append(event(plan, "previewed"));
      context.mock.timers.setTime(now + 10);
      const approved = await repository.append(event(plan, "approved", preview));
      const before = await readFile(path, "utf8");
      await assert.rejects(repository.append(event(plan, "rejected", approved, { asOf: new Date(now + 5).toISOString() })), /time moved backwards|precedes stored/);
      const other = await plans.append(makePlan("cycle-2"));
      context.mock.timers.setTime(now + 9);
      await assert.rejects(repository.append(event(other, "previewed")), /precedes stored|clock moved backwards/);
      assert.deepEqual(await repository.append(preview), preview);
      assert.equal(await readFile(path, "utf8"), before);
      await writeFile(path, rewrite(before, 2, { appendStartedAt: new Date(now - 1).toISOString() }));
      await assert.rejects(repository.readAll(), /corrupt entry/);
    } finally { context.mock.timers.reset(); }
  });
});

test("rebalance event origin is sampled after record fsync and incomplete pairs fail closed", async (context) => {
  for (const failSync of [false, true]) await withDirectory(async (directory) => {
    const { repository, plan, path } = await setup(directory);
    const probe = await open(join(directory, "probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let afterSync = 0;
    let duringSync = 0;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat();
      const target = await stat(path).catch(() => undefined);
      const matches = afterSync === 0 && target !== undefined && own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev);
      if (matches) { duringSync = Date.now(); await new Promise((resolve) => setTimeout(resolve, 20)); if (failSync) throw new Error("injected event fsync failure"); }
      await originalSync.call(this);
      if (matches) afterSync = Date.now();
    });
    const preview = event(plan, "previewed");
    try {
      if (failSync) await assert.rejects(repository.append(preview), /injected event fsync failure/);
      else await repository.append(preview);
    } finally { mock.mock.restore(); }
    assert.ok(duringSync > 0);
    if (failSync) {
      const incomplete = await readFile(path, "utf8");
      assert.equal(incomplete.trimEnd().split("\n").length, 1);
      await assert.rejects(repository.readAll(), /corrupt entry/);
      await assert.rejects(repository.append(preview), /corrupt entry/);
      assert.equal(await readFile(path, "utf8"), incomplete);
    } else {
      assert.ok(afterSync > duringSync);
      assert.ok(Date.parse(resolveVerifiedRebalancePlanEventOrigin(await repository.readVerifiedHistory(), preview.planEventId).appendedAt) >= afterSync);
    }
  });
});

test("rebalance event storage retains abandoned locks and validates timing options", async () => {
  await withDirectory(async (directory) => {
    const { plans } = await setup(directory);
    for (const timing of [0, -1, 0.1, Infinity]) assert.throws(() => new RebalancePlanEventFileRepository(directory, plans, { lockTimeoutMs: timing }), /positive safe integer/);
    const path = createRebalancePlanEventPaths(directory).lockPath;
    await writeFile(path, "abandoned\n");
    const repository = new RebalancePlanEventFileRepository(directory, plans, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    await assert.rejects(repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(path, "utf8"), "abandoned\n");
  });
});

function makePlan(cycleId = "cycle-1"): RebalancePlanRecord {
  return createRebalancePlanRecord({ cycleId, portfolioId: "paper-main", portfolioVersion: "v1", portfolioSnapshotHash: H("v1"), policyHash: H("policy"),
    evidenceCutoffAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", triggerRef: cycleId, phase: "buy",
    actions: [{ actionId: "action-1", actionSequence: 0, market: "KR", symbol: "synthetic-1", lineageKind: "mandate", side: "BUY", mandateId: "mandate-1",
      executionTarget: { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 }, maximumNotionalKrw: 100, reasonCodes: ["fixture"] }] });
}
function event(plan: RebalancePlanRecord, eventType: RebalancePlanEvent["eventType"], previous?: RebalancePlanEvent, extra: Record<string, unknown> = {}) {
  return createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: new Date().toISOString(), eventType,
    ...(previous === undefined ? {} : { previousPlanEventId: previous.planEventId }),
    ...(["approved", "rejected", "stale"].includes(eventType) ? { reasonCodes: ["fixture"] } : {}), ...extra } as EventInput);
}
async function setup(directory: string) {
  const plans = new RebalancePlanFileRepository(directory);
  const plan = await plans.append(makePlan());
  return { plans, plan, repository: new RebalancePlanEventFileRepository(directory, plans), path: createRebalancePlanEventPaths(directory).eventsPath };
}
function rewrite(raw: string, index: number, patch: Record<string, unknown>) {
  const lines = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
  for (let cursor = index; cursor < lines.length; cursor += 2) {
    const { entryHash: _entryHash, ...original } = lines[cursor];
    const payload = { ...original, ...(cursor === index ? patch : {}), previousEntryHash: cursor === 0 ? null : lines[cursor - 1].commitHash };
    lines[cursor] = { ...payload, entryHash: hashCanonicalPayload(payload) };
    const { commitHash: _commitHash, ...marker } = lines[cursor + 1];
    const updated = { ...marker, entryHash: lines[cursor].entryHash };
    lines[cursor + 1] = { ...updated, commitHash: hashCanonicalPayload(updated) };
  }
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "toss-rebalance-events-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function appendFromChild(directory: string, fixture: string): Promise<void> {
  const code = 'import { readFile } from "node:fs/promises"; import { RebalancePlanFileRepository } from "./dist/portfolio/rebalancePlanFiles.js"; import { RebalancePlanEventFileRepository } from "./dist/portfolio/rebalancePlanEventFiles.js"; await new RebalancePlanEventFileRepository(process.argv[1], new RebalancePlanFileRepository(process.argv[1])).append(JSON.parse(await readFile(process.argv[2], "utf8")));';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, directory, fixture], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child event append failed: ${output}`)));
  });
}
