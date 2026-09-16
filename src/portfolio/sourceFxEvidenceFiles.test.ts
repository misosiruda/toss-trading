import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSourceFxEvidenceRecord, parseSourceFxEvidenceRecord } from "./sourceFxEvidence.js";
import { createSourceFxEvidencePaths, getDurableSourceFxEvidenceObservation, parseSourceFxEvidenceRecords,
  resolveVerifiedSourceFxEvidenceOrigin, SourceFxEvidenceFileRepository, type VerifiedSourceFxEvidenceHistory } from "./sourceFxEvidenceFiles.js";

const TIME = Date.parse("2026-09-02T00:00:00.000Z"), OBSERVED = "2026-09-01T00:00:00.000Z";
const record = (overrides = {}) => createSourceFxEvidenceRecord({ schemaVersion: "source_fx_evidence.v1", sourceContractId: "synthetic-fx.v1",
  baseCurrency: "USD", quoteCurrency: "KRW", rate: 1400, observedAt: OBSERVED, createdAt: OBSERVED, sourceRefs: ["synthetic-fx"], ...overrides });
async function fixture(operation: (baseDir: string, repository: SourceFxEvidenceFileRepository, paths: ReturnType<typeof createSourceFxEvidencePaths>) => Promise<void>) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "source-fx-files-"));
  try { await operation(baseDir, new SourceFxEvidenceFileRepository(baseDir), createSourceFxEvidencePaths(baseDir)); }
  finally { await fs.rm(baseDir, { recursive: true, force: true }); }
}

test("FX file repository persists a complete committed chain and converges exact retries across restart", async () => {
  await fixture(async (baseDir, repository, paths) => {
    assert.deepEqual(await repository.readAll(), []);
    const first = record(), second = record({ observedAt: "2026-09-01T01:00:00Z", createdAt: "2026-09-01T01:00:00Z", rate: 1399 });
    await repository.append(first); await repository.append(second);
    const before = await fs.readFile(paths.recordsPath);
    assert.deepEqual(await new SourceFxEvidenceFileRepository(baseDir).append(first), first);
    assert.deepEqual(await repository.readAll(), [first, second]);
    assert.deepEqual(parseSourceFxEvidenceRecords(before.toString("utf8")), [first, second]);
    assert.deepEqual(await fs.readFile(paths.recordsPath), before);
    assert.equal(before.toString("utf8").trim().split("\n").length, 4);
  });
});

test("FX file repository grants only callback-scoped real source origins", async () => {
  await fixture(async (_baseDir, repository) => {
    const value = record(); await repository.append(value);
    let escaped: VerifiedSourceFxEvidenceHistory | undefined;
    await repository.withDurableVerifiedHistory(async (history) => {
      escaped = history;
      const origin = resolveVerifiedSourceFxEvidenceOrigin(history, value.evidenceRef), observation = getDurableSourceFxEvidenceObservation(history);
      assert.deepEqual(origin.record, value); assert.match(origin.commitHash, /^sha256:/);
      assert.ok(Date.parse(origin.appendedAt) <= Date.parse(observation.observedAt));
      assert.equal(observation.recordCount, 1); assert.ok(Object.isFrozen(origin)); assert.ok(Object.isFrozen(history.records));
      assert.throws(() => resolveVerifiedSourceFxEvidenceOrigin(history, "missing"), /does not resolve/);
      assert.throws(() => getDurableSourceFxEvidenceObservation({ records: history.records }), /unverified/);
    });
    assert.throws(() => getDurableSourceFxEvidenceObservation(escaped!), /expired/);
    assert.throws(() => resolveVerifiedSourceFxEvidenceOrigin(escaped!, value.evidenceRef), /expired/);
  });
});

test("FX file repository rejects ref and numeric-instant origin collisions without writing", async () => {
  await fixture(async (_baseDir, repository, paths) => {
    await repository.append(record()); const before = await fs.readFile(paths.recordsPath);
    await assert.rejects(repository.append(record({ createdAt: "2026-09-01T00:00:01Z" })), /ref collision/);
    for (const change of [{ rate: 1401 }, { observedAt: "2026-09-01T09:00:00+09:00" }, { sourceRefs: ["different-synthetic-source"] }]) {
      await assert.rejects(repository.append(record(change)), /origin collision/);
    }
    assert.deepEqual(await fs.readFile(paths.recordsPath), before);
  });
});

test("FX file repository rejects corrupt UTF-8 noncanonical JSON torn markers and forged chains before append", async () => {
  await fixture(async (_baseDir, repository, paths) => {
    await repository.append(record()); const before = await fs.readFile(paths.recordsPath, "utf8"), lines = before.trimEnd().split("\n");
    const entry = JSON.parse(lines[0]!), marker = JSON.parse(lines[1]!);
    const pair = (nextRecord: unknown, previousCommitHash: string | null, time = entry.appendStartedAt) => {
      const payload = { schemaVersion: entry.schemaVersion, record: parseSourceFxEvidenceRecord(nextRecord), appendStartedAt: time, previousCommitHash };
      const entryHash = hashCanonicalPayload(payload), commit = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      return `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...commit, commitHash: hashCanonicalPayload(commit) })}\n`;
    };
    const variants = [before.slice(0, -1), `${before}\n`, `${lines[0]}\n`, `${lines[0]}\n{}\n`,
      before.replace('"rate":1400', '"rate":1400,"rate":1400'), before.replace('"rate":1400', '"rate":1401'),
      ` ${before}`, pair(entry.record, `sha256:${"a".repeat(64)}`),
      `${before}${pair(entry.record, marker.commitHash)}`,
      `${before}${pair(JSON.parse(JSON.stringify(record({ rate: 1401 }))), marker.commitHash)}`,
      pair(entry.record, null, "2026-08-31T00:00:00Z"),
      Buffer.concat([Buffer.from(before), Buffer.from([0xff, 0x0a])])];
    for (const damaged of variants) {
      await fs.writeFile(paths.recordsPath, damaged); const actual = await fs.readFile(paths.recordsPath);
      await assert.rejects(repository.readAll()); await assert.rejects(repository.append(record()));
      assert.deepEqual(await fs.readFile(paths.recordsPath), actual);
    }
  });
});

test("FX file repository serializes concurrent process writers and releases callback failure locks", async () => {
  await fixture(async (baseDir, repository) => {
    const script = 'import {SourceFxEvidenceFileRepository as R} from "./dist/portfolio/sourceFxEvidenceFiles.js"; await new R(process.argv[1]).append(JSON.parse(process.argv[2]));';
    const value = record();
    await Promise.all(Array.from({ length: 3 }, () => child(script, [baseDir, JSON.stringify(value)])));
    assert.deepEqual(await repository.readAll(), [value]);
    await assert.rejects(repository.withDurableVerifiedHistory(async () => { throw new Error("synthetic callback failure"); }), /callback failure/);
    assert.deepEqual(await repository.readAll(), [value]);
  });
});

test("FX source lock contention is bounded under frozen and backwards wall clocks and never steals abandoned locks", async () => {
  await fixture(async (baseDir, repository, paths) => {
    await repository.withDurableVerifiedHistory(async () => {
      const script = 'import assert from "node:assert/strict"; import {SourceFxEvidenceFileRepository as R} from "./dist/portfolio/sourceFxEvidenceFiles.js"; let now=Date.now(); Date.now=()=>process.argv[2]==="backwards" ? (now-=1000):now; await assert.rejects(new R(process.argv[1], {lockTimeoutMs:40,lockRetryDelayMs:5}).readAll(), /lock is unavailable/);';
      for (const mode of ["frozen", "backwards"]) await child(script, [baseDir, mode]);
    });
    await fs.writeFile(paths.lockPath, "synthetic abandoned lock\n");
    await assert.rejects(new SourceFxEvidenceFileRepository(baseDir, { lockTimeoutMs: 40, lockRetryDelayMs: 5 }).readAll(), /lock is unavailable/);
    assert.equal(await fs.readFile(paths.lockPath, "utf8"), "synthetic abandoned lock\n");
  });
});

test("FX repository rejects append and observation clock regression and future creation", async (context) => {
  await fixture(async (_baseDir, repository, paths) => {
    context.mock.timers.enable({ apis: ["Date"], now: TIME });
    try {
      await assert.rejects(repository.append(record({ createdAt: new Date(TIME + 1).toISOString() })), /clock precedes/);
      await assert.rejects(fs.readFile(paths.recordsPath), { code: "ENOENT" });
      await repository.append(record()); const before = await fs.readFile(paths.recordsPath);
      context.mock.timers.setTime(TIME - 1);
      await assert.rejects(repository.readAll(), /clock precedes commit/);
      await assert.rejects(repository.append(record({ sourceContractId: "synthetic-other" })), /clock precedes commit/);
      assert.deepEqual(await fs.readFile(paths.recordsPath), before);
    } finally { context.mock.timers.reset(); }
  });
});

test("FX repository records post-record-fsync availability and fails closed on missing commit markers", async (context) => {
  await fixture(async (_baseDir, repository, paths) => {
    context.mock.timers.enable({ apis: ["Date"], now: TIME });
    try {
      let appends = 0;
      await mockOpen(context, async (args, handle) => {
        if (args[0] === paths.recordsPath && args[1] === "a" && ++appends === 1) {
          const sync = handle.sync.bind(handle);
          context.mock.method(handle, "sync", async () => { await sync(); context.mock.timers.setTime(TIME + 100); });
        }
      }, async () => { await repository.append(record()); });
      await repository.withDurableVerifiedHistory(async (history) => {
        assert.equal(resolveVerifiedSourceFxEvidenceOrigin(history, record().evidenceRef).appendedAt, new Date(TIME + 100).toISOString());
      });
    } finally { context.mock.timers.reset(); }
  });
  await fixture(async (_baseDir, repository, paths) => {
    const original = fs.open; let appends = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === paths.recordsPath && args[1] === "a" && ++appends === 2) throw new Error("synthetic marker write failure");
      return original(...args);
    }); syncBuiltinESMExports();
    try { await assert.rejects(repository.append(record()), /marker write failure/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    const before = await fs.readFile(paths.recordsPath);
    await assert.rejects(repository.readAll(), /corrupt/); await assert.rejects(repository.append(record()), /corrupt/);
    assert.deepEqual(await fs.readFile(paths.recordsPath), before);
  });
});

test("FX durable observation rejects source changes and propagates fsync errors on reads and retries", async (context) => {
  for (const mode of ["replace", "append", "sync"] as const) await fixture(async (_baseDir, repository, paths) => {
    await repository.append(record()); const before = await fs.readFile(paths.recordsPath); let injected = false;
    await mockOpen(context, async (args, handle) => {
      if (args[0] === paths.recordsPath && args[1] === "r+") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await sync();
          if (injected) return; injected = true;
          if (mode === "sync") throw new Error("synthetic FX sync failure");
          if (mode === "replace") { await fs.rename(paths.recordsPath, `${paths.recordsPath}.replaced`); await fs.writeFile(paths.recordsPath, before); }
          else await fs.appendFile(paths.recordsPath, "{");
        });
      }
    }, async () => { await assert.rejects(repository.append(record()), mode === "sync" ? /FX sync failure/ : /changed during observation/); });
    assert.equal(injected, true);
  });
});

async function child(script: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const childProcess = spawn(globalThis.process.execPath, ["--input-type=module", "--eval", script, ...args],
      { cwd: globalThis.process.cwd(), stdio: ["ignore", "ignore", "pipe"], windowsHide: true, timeout: 15_000 });
    let stderr = ""; childProcess.stderr.setEncoding("utf8"); childProcess.stderr.on("data", (chunk: string) => { stderr += chunk; });
    childProcess.once("error", reject); childProcess.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(stderr || `FX child failed: ${code}/${signal}`)));
  });
}
async function mockOpen(context: TestContext, configure: (args: Parameters<typeof fs.open>, handle: Awaited<ReturnType<typeof fs.open>>) => Promise<void>, operation: () => Promise<void>) {
  const original = fs.open;
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args); await configure(args, handle); return handle;
  }); syncBuiltinESMExports();
  try { await operation(); } finally { mock.mock.restore(); syncBuiltinESMExports(); }
}
