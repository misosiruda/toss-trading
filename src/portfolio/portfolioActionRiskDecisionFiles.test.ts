import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import {
  PortfolioActionRiskDecisionFileRepository,
  createPortfolioActionRiskDecisionPaths,
  getVerifiedPortfolioActionRiskDecisions,
  parsePortfolioActionRiskDecisions,
  resolveVerifiedPortfolioActionRiskDecisionOrigin
} from "./portfolioActionRiskDecisionFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

test("risk decision repository durably preserves approvals, rejections, and exact retries", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const approved = createPortfolioActionRiskDecision(bucketInput());
    const rejected = createPortfolioActionRiskDecision({
      ...bucketInput(),
      decision: "rejected",
      approvedMaximumFillNotionalKrw: 0,
      ruleResults: bucketInput().ruleResults.map((rule) => ({ ...rule, result: "fail" as const }))
    });
    const beforeAppend = Date.now();
    await repository.append(approved);
    await repository.append(rejected);
    const paths = createPortfolioActionRiskDecisionPaths(baseDir);
    const beforeRetry = await readFile(paths.recordsPath, "utf8");
    const [entry, marker, nextEntry] = beforeRetry.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(entry.schemaVersion, "portfolio_action_risk_decision_entry.v2");
    assert.equal(marker.schemaVersion, "portfolio_action_risk_decision_commit.v1");
    assert.equal(marker.entryHash, entry.entryHash);
    assert.equal(nextEntry.previousEntryHash, marker.commitHash);
    assert.deepEqual(await repository.append(approved), approved);
    assert.equal(await readFile(paths.recordsPath, "utf8"), beforeRetry);
    const restarted = new PortfolioActionRiskDecisionFileRepository(baseDir);
    assert.deepEqual(await restarted.readAll(), [approved, rejected]);
    assert.deepEqual(await restarted.resolveById(approved.riskDecisionId), approved);
    const history = await restarted.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, approved.riskDecisionId);
    assert.deepEqual(origin.record, approved);
    assert.equal(origin.appendedAt, marker.committedAt);
    assert.ok(Date.parse(origin.appendedAt) >= beforeAppend);
    assert.ok(Date.parse(origin.appendedAt) <= Date.now());
    assert.ok(Object.isFrozen(history.records));
    assert.ok(Object.isFrozen(origin.record.ruleResults));
    assert.deepEqual(parsePortfolioActionRiskDecisions(beforeRetry), [approved, rejected]);
    await assert.rejects(() => repository.resolveById("missing"), /does not resolve exactly once/);
    assert.throws(() => resolveVerifiedPortfolioActionRiskDecisionOrigin(history, "missing"), /does not resolve exactly once/);
  });
});

test("risk decision repository serializes concurrent appends and cross-process retries", async () => {
  await withDirectory(async (baseDir) => {
    const candidate = createPortfolioActionRiskDecision(bucketInput());
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    await Promise.all(Array.from({ length: 8 }, () => repository.append(candidate)));
    const fixturePath = join(baseDir, "fixture.json");
    await writeFile(fixturePath, JSON.stringify(candidate));
    await Promise.all(Array.from({ length: 4 }, () => appendFromChild(baseDir, fixturePath)));
    assert.deepEqual(await repository.readAll(), [candidate]);
    const distinct = Array.from({ length: 4 }, (_, index) => createPortfolioActionRiskDecision({
      ...bucketInput(), actionId: `action-${index + 2}`
    }));
    await Promise.all(distinct.map((record) => repository.append(record)));
    const history = await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll();
    assert.equal(history.length, 5);
    assert.deepEqual(new Set(history.map((record) => record.riskDecisionId)),
      new Set([candidate, ...distinct].map((record) => record.riskDecisionId)));
  });
});

test("risk decision repository does not authenticate arbitrary parsed or prototype histories", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const record = createPortfolioActionRiskDecision(bucketInput());
    await repository.append(record);
    const history = await repository.readVerifiedHistory();
    const raw = await readFile(createPortfolioActionRiskDecisionPaths(baseDir).recordsPath, "utf8");
    for (const forged of [
      { records: [record] },
      { records: parsePortfolioActionRiskDecisions(raw) },
      Object.create(history)
    ]) {
      assert.throws(() => getVerifiedPortfolioActionRiskDecisions(forged), /history is not verified/);
      assert.throws(() => resolveVerifiedPortfolioActionRiskDecisionOrigin(forged, record.riskDecisionId), /history is not verified/);
    }
  });
});

test("risk decision repository rejects tampered payloads and future decision times before writing", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const record = createPortfolioActionRiskDecision(bucketInput());
    await repository.append(record);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const before = await readFile(path, "utf8");
    await assert.rejects(() => repository.append({ ...record, approvedMaximumFillNotionalKrw: 999 }), /identity mismatch/);
    const future = createPortfolioActionRiskDecision({ ...bucketInput(), decidedAt: "9999-01-01T00:00:00.000Z" });
    await assert.rejects(() => repository.append(future), /before decision time/);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("risk decision repository fails closed on torn, corrupt, reordered, and duplicate history", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const first = createPortfolioActionRiskDecision(bucketInput());
    const second = createPortfolioActionRiskDecision({ ...bucketInput(), actionId: "action-2" });
    await repository.append(first);
    await repository.append(second);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    // Preserve the old envelope's strict parser tests independently of v2 pairs.
    const firstEntry = legacyEntry(first, first.decidedAt, null);
    const secondEntry = legacyEntry(second, second.decidedAt, firstEntry.entryHash);
    const entries = [firstEntry, secondEntry];
    const raw = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    const entry = firstEntry;
    const duplicatePayload = { record: first, appendedAt: entry.appendedAt, previousEntryHash: entry.entryHash };
    const duplicate = { ...duplicatePayload, entryHash: hashCanonicalPayload(duplicatePayload) };
    const cases = [
      raw.slice(0, -1),
      raw + "\n",
      "{}\n",
      JSON.stringify(first) + "\n",
      JSON.stringify({ ...entry, appendedAt: "2020-01-01T00:00:00.000Z" }) + "\n",
      JSON.stringify({ ...entry, record: { ...first, requestedQuantity: 99 } }) + "\n",
      [...entries].reverse().map((value) => JSON.stringify(value)).join("\n") + "\n",
      JSON.stringify(entry) + "\n" + JSON.stringify(duplicate) + "\n"
    ];
    for (const damaged of cases) {
      await writeFile(path, damaged);
      assert.throws(() => parsePortfolioActionRiskDecisions(damaged), /torn|corrupt|duplicate/);
      await assert.rejects(() => repository.readVerifiedHistory(), /torn|corrupt|duplicate/);
      await assert.rejects(() => repository.append(first), /torn|corrupt|duplicate/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("risk decision repository preserves abandoned locks and validates options", async () => {
  await withDirectory(async (baseDir) => {
    assert.throws(() => new PortfolioActionRiskDecisionFileRepository(baseDir, { lockTimeoutMs: 0 }), /positive safe integer/);
    assert.throws(() => new PortfolioActionRiskDecisionFileRepository(baseDir, { lockRetryDelayMs: -1 }), /positive safe integer/);
    const paths = createPortfolioActionRiskDecisionPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n");
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

test("risk decision repository retains legacy queries and retries without promoting approval origin", async () => {
  await withDirectory(async (baseDir) => {
    const first = createPortfolioActionRiskDecision(bucketInput());
    const entry = legacyEntry(first, first.decidedAt, null);
    const raw = JSON.stringify(entry) + "\n";
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    await writeFile(path, raw);
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    assert.deepEqual(await repository.resolveById(first.riskDecisionId), first);
    assert.deepEqual(await repository.append(first), first);
    assert.equal(await readFile(path, "utf8"), raw);
    assert.deepEqual(parsePortfolioActionRiskDecisions(raw), [first]);
    const history = await repository.readVerifiedHistory();
    assert.throws(() => resolveVerifiedPortfolioActionRiskDecisionOrigin(history, first.riskDecisionId), /legacy record requires review/);
    const second = createPortfolioActionRiskDecision({ ...bucketInput(), actionId: "action-2" });
    await repository.append(second);
    const mixed = await readFile(path, "utf8");
    assert.equal(JSON.parse(mixed.split("\n")[1]!).previousEntryHash, entry.entryHash);
    const restarted = await new PortfolioActionRiskDecisionFileRepository(baseDir).readVerifiedHistory();
    assert.deepEqual(restarted.records, [first, second]);
    assert.equal(resolveVerifiedPortfolioActionRiskDecisionOrigin(restarted, second.riskDecisionId).record.riskDecisionId, second.riskDecisionId);
    assert.throws(() => resolveVerifiedPortfolioActionRiskDecisionOrigin(restarted, first.riskDecisionId), /legacy record requires review/);
    for (const damaged of [mixed.slice(raw.length), mixed + raw]) {
      await writeFile(path, damaged);
      await assert.rejects(() => repository.readAll(), /corrupt/);
      await assert.rejects(() => repository.append(second), /corrupt/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("risk decision repository requires complete markers and independently validates pair hashes and time", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const first = createPortfolioActionRiskDecision(bucketInput());
    const second = createPortfolioActionRiskDecision({ ...bucketInput(), actionId: "action-2" });
    await repository.append(first);
    await repository.append(second);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const lines = raw.trimEnd().split("\n");
    const [entry, marker, nextEntry] = lines.map((line) => JSON.parse(line));
    const oldMarkerPayload = { schemaVersion: marker.schemaVersion, entryHash: marker.entryHash, committedAt: "2000-01-01T00:00:00.000Z" };
    const oldMarker = { ...oldMarkerPayload, commitHash: hashCanonicalPayload(oldMarkerPayload) };
    const duplicatePayload = { schemaVersion: entry.schemaVersion, record: first, appendStartedAt: entry.appendStartedAt, previousEntryHash: marker.commitHash };
    const duplicate = { ...duplicatePayload, entryHash: hashCanonicalPayload(duplicatePayload) };
    const duplicateMarkerPayload = { schemaVersion: marker.schemaVersion, entryHash: duplicate.entryHash, committedAt: marker.committedAt };
    const duplicateMarker = { ...duplicateMarkerPayload, commitHash: hashCanonicalPayload(duplicateMarkerPayload) };
    for (const damaged of [
      `${lines[0]}\n`, `${lines[0]}\n{`, `${lines[1]}\n`,
      `${lines[0]}\n${lines[3]}\n`,
      JSON.stringify({ ...entry, previousEntryHash: HASH_A }) + "\n" + lines[1] + "\n",
      JSON.stringify({ ...entry, record: { ...first, requestedQuantity: 99 } }) + "\n" + lines[1] + "\n",
      lines[0] + "\n" + JSON.stringify({ ...marker, commitHash: HASH_A }) + "\n",
      lines[0] + "\n" + JSON.stringify(oldMarker) + "\n",
      lines.slice(2).join("\n") + "\n",
      lines.slice(0, 2).join("\n") + "\n" + JSON.stringify({ ...nextEntry, previousEntryHash: entry.entryHash }) + "\n" + lines[3] + "\n",
      lines.slice(0, 2).join("\n") + "\n" + JSON.stringify(duplicate) + "\n" + JSON.stringify(duplicateMarker) + "\n",
      raw + lines[1] + "\n"
    ]) {
      await writeFile(path, damaged);
      assert.throws(() => parsePortfolioActionRiskDecisions(damaged), /corrupt|torn|duplicate/);
      await assert.rejects(() => repository.readVerifiedHistory(), /corrupt|torn|duplicate/);
      await assert.rejects(() => repository.append(first), /corrupt|torn|duplicate/);
      assert.equal(await readFile(path, "utf8"), damaged);
    }
  });
});

test("risk decision origin follows actual record fsync and incomplete append stays fail-closed", async (context) => {
  for (const failSync of [false, true]) {
    await withDirectory(async (baseDir) => {
      const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
      const probe = await open(join(baseDir, "probe"), "a");
      const prototype = Object.getPrototypeOf(probe) as FileHandle;
      const originalSync = prototype.sync;
      await probe.close();
      let duringWrite = 0;
      let afterRecordSync = 0;
      const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
        const ownStat = await this.stat();
        const targetStat = await stat(path).catch(() => undefined);
        const isRecord = afterRecordSync === 0 && targetStat !== undefined &&
          ownStat.isFile() && ownStat.ino === targetStat.ino &&
          (process.platform === "win32" || ownStat.dev === targetStat.dev);
        if (isRecord) {
          duringWrite = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (failSync) throw new Error("injected record fsync failure");
        }
        await originalSync.call(this);
        if (isRecord) afterRecordSync = Date.now();
      });
      const record = createPortfolioActionRiskDecision(bucketInput());
      const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
      try {
        if (failSync) await assert.rejects(() => repository.append(record), /injected record fsync failure/);
        else await repository.append(record);
      } finally {
        syncMock.mock.restore();
      }
      const restarted = new PortfolioActionRiskDecisionFileRepository(baseDir);
      assert.ok(duringWrite > 0);
      if (failSync) {
        const incomplete = await readFile(path, "utf8");
        assert.equal(incomplete.trimEnd().split("\n").length, 1);
        await assert.rejects(() => restarted.readVerifiedHistory(), /corrupt/);
        await assert.rejects(() => restarted.append(record), /corrupt/);
        assert.equal(await readFile(path, "utf8"), incomplete);
      } else {
        const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await restarted.readVerifiedHistory(), record.riskDecisionId);
        assert.ok(afterRecordSync > duringWrite);
        assert.ok(Date.parse(origin.appendedAt) >= afterRecordSync);
        assert.ok(Date.parse(origin.appendedAt) > duringWrite);
      }
    });
  }
});

test("risk decision repository rejects cross-entry clock rollback before writing and after restart", async (context) => {
  await withDirectory(async (baseDir) => {
    const now = Date.parse("2026-09-04T00:00:00.000Z");
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      const repository = new PortfolioActionRiskDecisionFileRepository(baseDir);
      const first = createPortfolioActionRiskDecision(bucketInput());
      const second = createPortfolioActionRiskDecision({ ...bucketInput(), actionId: "action-2" });
      await repository.append(first);
      const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
      const before = await readFile(path, "utf8");
      context.mock.timers.setTime(now - 1);
      await assert.rejects(() => new PortfolioActionRiskDecisionFileRepository(baseDir).append(second), /clock moved backwards since previous commit/);
      assert.equal(await readFile(path, "utf8"), before);
      // Retrying an existing record neither samples nor promotes its origin.
      assert.deepEqual(await repository.append(first), first);
      assert.equal(await readFile(path, "utf8"), before);
      context.mock.timers.setTime(now + 2);
      await repository.append(second);
      const raw = await readFile(path, "utf8");
      const lines = raw.trimEnd().split("\n");
      const entry = JSON.parse(lines[2]!);
      const marker = JSON.parse(lines[3]!);
      const entryPayload = {
        schemaVersion: entry.schemaVersion, record: second,
        appendStartedAt: new Date(now - 1).toISOString(), previousEntryHash: entry.previousEntryHash
      };
      const changedEntry = { ...entryPayload, entryHash: hashCanonicalPayload(entryPayload) };
      const markerPayload = {
        schemaVersion: marker.schemaVersion, entryHash: changedEntry.entryHash,
        committedAt: new Date(now - 1).toISOString()
      };
      const damaged = lines.slice(0, 2).join("\n") + "\n" + JSON.stringify(changedEntry) + "\n" +
        JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) }) + "\n";
      // Pair-local time and hashes are valid; only the cross-entry order is wrong.
      assert.throws(() => parsePortfolioActionRiskDecisions(damaged), /corrupt/);
      await writeFile(path, damaged);
      await assert.rejects(() => repository.readVerifiedHistory(), /corrupt/);
      await assert.rejects(() => repository.append(second), /corrupt/);
      assert.equal(await readFile(path, "utf8"), damaged);
    } finally {
      context.mock.timers.reset();
    }
  });
});

function legacyEntry(record: unknown, appendedAt: string, previousEntryHash: string | null) {
  const payload = { record, appendedAt, previousEntryHash };
  return { ...payload, entryHash: hashCanonicalPayload(payload) };
}

async function withDirectory(run: (baseDir: string) => Promise<void>): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-risk-decision-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(baseDir: string, fixturePath: string): Promise<void> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PortfolioActionRiskDecisionFileRepository } from "./dist/portfolio/portfolioActionRiskDecisionFiles.js";
    const record = JSON.parse(await readFile(process.argv[2], "utf8"));
    await new PortfolioActionRiskDecisionFileRepository(process.argv[1]).append(record);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir, fixturePath], {
      cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited with code ${code}`)));
  });
}

function bucketInput() {
  return {
    riskRuleSetRecordId: "risk-set-1",
    riskRuleSetVersion: "v1",
    riskRuleSetHash: HASH_A,
    planId: "plan-1",
    actionId: "action-1",
    portfolioId: "portfolio-1",
    policyHash: HASH_B,
    expectedPortfolioVersion: "portfolio-v1",
    expectedPortfolioSnapshotHash: HASH_C,
    market: "KR" as const,
    symbol: "KR:005930",
    side: "BUY" as const,
    riskRuleScope: { scopeKind: "bucket" as const, bucket: "swing" as const },
    actionExecutionTargetHash: HASH_A,
    turnoverAssessment: {
      scopeKind: "bucket" as const,
      turnoverStateId: "turnover-state-1",
      turnoverStateHash: HASH_B,
      turnoverWindowOpenPortfolioNetWorthKrw: 1_000,
      priorBucketTurnoverNotionalKrw: 100,
      requestedBucketTurnoverNotionalKrw: 105,
      resultingBucketTurnoverRatio: 0.205
    },
    priorCumulativeFilledNotionalKrw: 0,
    priorCumulativeFilledQuantity: 0,
    requestedNotionalKrw: 100,
    requestedQuantity: 1,
    worstCaseFillNotionalKrw: 105,
    approvedMaximumFillNotionalKrw: 110,
    cashAssessment: {
      side: "BUY" as const,
      worstCaseNetCashDebitKrw: 106,
      approvedMaximumNetCashDebitKrw: 111
    },
    decision: "approved" as const,
    requiredRuleIds: ["turnover", "cash"],
    ruleResults: [
      { ruleId: "turnover", result: "pass" as const, reasonCode: "within_limit" },
      { ruleId: "cash", result: "pass" as const, reasonCode: "within_limit" }
    ],
    riskEvidenceRefs: ["evidence-b", "evidence-a"],
    decidedAt: "2026-09-03T00:00:00.000Z"
  };
}
