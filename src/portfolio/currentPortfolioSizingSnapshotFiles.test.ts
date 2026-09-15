import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { FileAuditLog, FileVirtualDecisionStore } from "../storage/repositories.js";
import { defaultPaperExecutionLogPaths } from "../storage/paperApplicationLogReceipts.js";
import { preparePaperApplication, verifyPreparedPaperApplication } from "../paper/preparedApplication.js";
import { appendCurrentPortfolioSizingSnapshot } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";

const portfolio = (cashKrw = 100) => ({ portfolioId: "paper-current-sizing", cashKrw, positions: [], updatedAt: "2026-09-01T00:00:00.000Z" });
const input = (baseDir: string, portfolioPath: string, cashKrw = 100) => ({ baseDir, portfolioPath,
  policyHash: `sha256:${"a".repeat(64)}`, asOf: "2026-09-02T00:00:00.000Z", valuationInputs: [], pendingActionInputs: [],
  ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw, cashKrw,
    bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
    marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
    pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });

test("current sizing publisher derives identity from the stored revision and preserves exact retries and ABA", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`);
    const current = await store.readSnapshot(), request = input(baseDir, path);
    const first = await appendCurrentPortfolioSizingSnapshot(request);
    assert.equal(first.portfolioVersion, current.revisionHash);
    assert.deepEqual(first.virtualPortfolio, current.portfolio);
    assert.deepEqual(await appendCurrentPortfolioSizingSnapshot(request), first);
    assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    await store.write(portfolio(90)); await store.write(portfolio());
    const second = await appendCurrentPortfolioSizingSnapshot(request);
    assert.notEqual(second.portfolioSnapshotId, first.portfolioSnapshotId);
    assert.notEqual(second.portfolioVersion, first.portfolioVersion);
    assert.deepEqual(second.virtualPortfolio, first.virtualPortfolio);
    assert.deepEqual(await new PortfolioSizingSnapshotFileRepository(baseDir).readAll(), [first, second]);
  });
});

test("current sizing publisher rejects caller source overrides, legacy absence, stale inputs and corrupt journals", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const request = input(baseDir, path), records = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    for (const extra of [{ portfolioVersion: "forged" }, { portfolioId: "forged" }, { virtualPortfolio: portfolio(1) }]) {
      await assert.rejects(appendCurrentPortfolioSizingSnapshot({ ...request, ...extra }));
    }
    await assert.rejects(appendCurrentPortfolioSizingSnapshot({ ...request, asOf: "2026-08-01T00:00:00.000Z" }), /cannot be after/);
    await store.write(portfolio(90));
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(request), /cash/);
    const legacy = join(baseDir, "legacy.json"); await fs.writeFile(legacy, JSON.stringify(portfolio()));
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(input(baseDir, legacy)), /requires a journaled/);
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(input(baseDir, join(baseDir, "missing.json"))), /requires a journaled/);
    await fs.appendFile(`${path}.revisions.jsonl`, "{");
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(input(baseDir, path, 90)), /torn entry/);
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
  });
});

test("current sizing publication holds the portfolio lock through snapshot fsync against another process", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const records = createPortfolioSizingSnapshotPaths(baseDir).recordsPath, original = fs.open;
    let checked = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === records && args[1] === "a") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          const result = await competingWrite(path);
          assert.notEqual(result.code, 0); assert.match(result.output, /paper portfolio lock is unavailable/);
          checked = true; await sync();
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await appendCurrentPortfolioSizingSnapshot(input(baseDir, path)); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checked, true); assert.deepEqual(await store.read(), portfolio());
    assert.equal((await competingWrite(path)).code, 0);
    assert.deepEqual(await store.read(), portfolio(90));
  });
});

test("current sizing publisher captures input before lock wait and leaves the portfolio unchanged on destination failure", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const request = input(baseDir, path), records = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    let pending!: ReturnType<typeof appendCurrentPortfolioSizingSnapshot>;
    await store.withLockedSnapshot(async (observed) => {
      observed.portfolio!.cashKrw = 1; // Consumer receives a detached copy.
      pending = appendCurrentPortfolioSizingSnapshot(request);
      request.asOf = "2020-01-01T00:00:00.000Z";
    });
    const snapshot = await pending;
    assert.equal(snapshot.asOf, "2026-09-02T00:00:00.000Z"); assert.equal(snapshot.virtualPortfolio.cashKrw, 100);
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`), original = fs.open;
    const denied = Object.assign(new Error("snapshot sync failed"), { code: "EIO" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === records && args[1] === "r+") context.mock.method(handle, "sync", async () => { throw denied; });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(appendCurrentPortfolioSizingSnapshot(input(baseDir, path)), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.deepEqual(await store.read(), portfolio());
    assert.equal((await new PortfolioSizingSnapshotFileRepository(baseDir).readAll()).length, 1);
  });
});

test("current sizing publisher replays actual held quantities and refuses inconsistent exposure", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const held = { ...portfolio(), positions: [{ market: "KR" as const, symbol: "SYNTHETIC", quantity: 2,
      averagePriceKrw: 10, sector: "Synthetic", region: "KR" as const, strategyBucket: "long_term" as const,
      updatedAt: "2026-09-01T00:00:00.000Z" }] };
    await store.write(held);
    const request = { ...input(baseDir, path), valuationInputs: [{ kind: "mark_price" as const, market: "KR" as const,
      symbol: "SYNTHETIC", priceKrw: 12, evidenceRef: "synthetic-price", evidenceAsOf: "2026-09-01T00:00:00.000Z" }],
      ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 124, cashKrw: 100,
        bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 24, short_term: 0, swing: 0 },
        symbolExposureKrw: [{ market: "KR", symbol: "SYNTHETIC", exposureKrw: 24 }],
        marketExposureKrw: { KR: 24, US: 0 }, sectorExposureKrw: { Synthetic: 24 }, countryExposureKrw: { KR: 24 },
        currencyExposureKrw: { KRW: 24 }, pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) };
    const snapshot = await appendCurrentPortfolioSizingSnapshot(request);
    assert.deepEqual(snapshot.virtualPortfolio, held);
    await store.write({ ...held, positions: [{ ...held.positions[0]!, quantity: 3 }] });
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(request), /valuation replay/);
    assert.equal((await new PortfolioSizingSnapshotFileRepository(baseDir).readAll()).length, 1);
  });
});

test("partial snapshot publication never mutates the source portfolio or hides the corrupt destination", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`);
    const records = createPortfolioSizingSnapshotPaths(baseDir).recordsPath, original = fs.open;
    const denied = new Error("partial snapshot append failed");
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === records && args[1] === "a") {
        const write = handle.writeFile.bind(handle);
        context.mock.method(handle, "writeFile", async () => { await write("{"); throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(appendCurrentPortfolioSizingSnapshot(input(baseDir, path)), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.deepEqual(await store.read(), portfolio()); assert.equal(await fs.readFile(records, "utf8"), "{");
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(input(baseDir, path)), /torn final line/);
    assert.equal(await fs.readFile(records, "utf8"), "{");
  });
});

test("current sizing publication resolves custom v3 log evidence and rejects missing evidence before append", async (context) => {
  await fixture(context, async (baseDir, path, store) => {
    const source = verifyPreparedPaperApplication(JSON.parse(await fs.readFile(
      new URL("../../src/paper/executionModels/v1/golden.json", import.meta.url), "utf8")).hold);
    await store.write(source.packet.virtualPortfolio);
    const paths = defaultPaperExecutionLogPaths(path);
    paths.audit += ".custom"; paths.decision += ".custom"; paths.trade += ".custom";
    const options = { executionLogPaths: paths };
    const writer = new FileVirtualPortfolioStore(path, options);
    const app = preparePaperApplication({ expectedSnapshot: await writer.readSnapshot(), packet: source.packet,
      providerDecision: source.providerDecision, evaluatedAt: source.evaluatedAt, decisionSummary: source.decisionSummary });
    await writer.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async (value) => {
      await new FileVirtualDecisionStore(paths.decision).append(value.decision);
      for (const event of value.auditEvents) await new FileAuditLog(paths.audit).append(event);
    }, paths);
    const request = input(baseDir, path, app.portfolio.cashKrw);
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(request), /prefix mismatch/);
    const snapshot = await appendCurrentPortfolioSizingSnapshot(request, options);
    assert.equal(snapshot.portfolioVersion, (await writer.readSnapshot()).revisionHash);
    await fs.unlink(paths.decision);
    await assert.rejects(appendCurrentPortfolioSizingSnapshot(request, options), /prefix mismatch/);
    assert.deepEqual(await new PortfolioSizingSnapshotFileRepository(baseDir).readAll(), [snapshot]);
  });
});

async function fixture(context: TestContext, run: (baseDir: string, path: string, store: FileVirtualPortfolioStore) => Promise<void>) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "paper-current-sizing-")), path = join(baseDir, "portfolio.json");
  context.after(() => fs.rm(baseDir, { recursive: true, force: true }));
  const store = new FileVirtualPortfolioStore(path); await store.write(portfolio());
  await run(baseDir, path, store);
}
function competingWrite(path: string): Promise<{ code: number | null; output: string }> {
  const module = new URL("../storage/virtualPortfolioFileStore.js", import.meta.url).href;
  const script = `import { FileVirtualPortfolioStore } from ${JSON.stringify(module)};
    await new FileVirtualPortfolioStore(${JSON.stringify(path)}, { lockTimeoutMs: 60 }).write(${JSON.stringify(portfolio(90))});`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script]); let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject); child.on("close", (code) => resolve({ code, output }));
  });
}
