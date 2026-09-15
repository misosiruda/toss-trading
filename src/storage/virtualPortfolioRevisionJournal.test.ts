import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileVirtualPortfolioStore, VirtualPortfolioStateChangedError, type VirtualPortfolioRevisionSnapshot } from "./virtualPortfolioFileStore.js";
import { hashPortfolioRevisionPayload } from "./virtualPortfolioRevisionJournal.js";

const portfolio = (cashKrw = 1_000_000) => ({ portfolioId: "paper-revision-fixture", cashKrw, positions: [],
  updatedAt: "2026-09-15T00:00:00.000Z" });

test("portfolio revisions preserve legacy JSON and advance across equal writes and process restarts", async (context) => {
  await fixture(context, async (path, store) => {
    assert.deepEqual(await store.readSnapshot(), { portfolio: null, revisionHash: null });
    const old = portfolio();
    await fs.writeFile(path, JSON.stringify(old));
    const legacy = await store.readSnapshot();
    assert.deepEqual(legacy, { portfolio: old, revisionHash: null });
    await assert.rejects(fs.readFile(`${path}.revisions.jsonl`), { code: "ENOENT" });
    await store.write(old);
    const first = await store.readSnapshot(); assert.match(first.revisionHash!, /^sha256:[a-f0-9]{64}$/);
    await store.write(old);
    const second = await new FileVirtualPortfolioStore(path).readSnapshot();
    assert.notEqual(second.revisionHash, first.revisionHash); assert.deepEqual(second.portfolio, old);
    let called = false;
    for (const expected of [legacy, first]) {
      await assert.rejects(store.withExclusiveSnapshotUpdate(expected, async () => { called = true; return { portfolio: old, result: null }; }), VirtualPortfolioStateChangedError);
    }
    assert.equal(called, false);
    assert.equal(await fs.readFile(path, "utf8"), `${JSON.stringify(old, null, 2)}\n`);
    const lines = (await fs.readFile(`${path}.revisions.jsonl`, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.sequence), [1, 2]);
    assert.equal(lines[1].previousRevisionHash, first.revisionHash);
    assert.equal(lines[0].previousPortfolioHash, hashPortfolioRevisionPayload(old));
  });
});

test("portfolio revision CAS serializes unchanged writes from independent processes", async (context) => {
  await fixture(context, async (path, store) => {
    await store.write(portfolio()); const expected = await store.readSnapshot();
    const results = await Promise.all([child(path, expected, "cas"), child(path, expected, "cas")]);
    assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
    assert.match(results.find((result) => result.code !== 0)!.output, /portfolio state changed/);
    assert.deepEqual(await store.read(), portfolio());
    assert.equal((await fs.readFile(`${path}.revisions.jsonl`, "utf8")).trimEnd().split("\n").length, 2);
  });
});

test("portfolio revision CAS rejects ABA written by another process", async (context) => {
  await fixture(context, async (path, store) => {
    await store.write(portfolio()); const expected = await store.readSnapshot();
    assert.equal((await child(path, expected, "aba")).code, 0);
    assert.deepEqual(await store.read(), expected.portfolio);
    let called = false;
    await assert.rejects(store.withExclusiveSnapshotUpdate(expected, async () => { called = true; return { portfolio: portfolio(1), result: null }; }), VirtualPortfolioStateChangedError);
    assert.equal(called, false);
  });
});

test("portfolio revision reader rejects corrupt rehashed chains and projection drift before writes", async (context) => {
  await fixture(context, async (path, store) => {
    await store.write(portfolio()); await store.write(portfolio(900_000));
    const expected = await store.readSnapshot(), journalPath = `${path}.revisions.jsonl`, original = await fs.readFile(journalPath);
    const lines = original.toString("utf8").trimEnd().split("\n"), first = JSON.parse(lines[0]!), second = JSON.parse(lines[1]!);
    const rehash = (entry: typeof second) => {
      const { revisionHash: _ignored, ...payload } = entry;
      return JSON.stringify({ ...payload, revisionHash: hashPortfolioRevisionPayload(payload) });
    };
    const cases = [Buffer.from([0xff]), Buffer.from(""), original.subarray(0, original.length - 1),
      Buffer.from(`${lines.join("\n")}\n\n`), Buffer.from(`${lines[0]}\n${lines[0]}\n`),
      Buffer.from(`${lines[0]}\n${JSON.stringify({ ...second, revisionHash: `sha256:${"0".repeat(64)}` })}\n`),
      Buffer.from(`${lines[0]}\n${rehash({ ...second, sequence: 3 })}\n`),
      Buffer.from(`${lines[0]}\n${rehash({ ...second, previousRevisionHash: null })}\n`),
      Buffer.from(`${lines[0]}\n${rehash({ ...second, previousPortfolioHash: hashPortfolioRevisionPayload(null) })}\n`),
      Buffer.from(`${lines[0]}\n${rehash({ ...second, portfolio: portfolio(1) })}\n`),
      Buffer.from(`${JSON.stringify(first).replace('"sequence":1', '"sequence":7,"sequence":1')}\n${lines[1]}\n`)
    ];
    for (const raw of cases) {
      await fs.writeFile(journalPath, raw);
      let called = false;
      await assert.rejects(store.readSnapshot());
      await assert.rejects(store.withExclusiveSnapshotUpdate(expected, async () => { called = true; return { portfolio: portfolio(1), result: null }; }));
      await assert.rejects(store.write(portfolio(1)));
      assert.equal(called, false); assert.deepEqual(await fs.readFile(journalPath), raw);
      assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), expected.portfolio);
    }
    await fs.writeFile(journalPath, original);
    await fs.writeFile(path, JSON.stringify(portfolio(1)));
    await assert.rejects(store.read(), /differs from its revision journal head/);
  });
});

test("portfolio journal write and fsync faults retain prior projection and block retry", async (context) => {
  for (const phase of ["write", "sync"] as const) await fixture(context, async (path, store) => {
    await store.write(portfolio()); const before = await fs.readFile(path);
    const originalOpen = fs.open, denied = Object.assign(new Error(`journal ${phase} failure`), { code: "EIO" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === `${path}.revisions.jsonl`) {
        const originalWrite = handle.writeFile.bind(handle);
        if (phase === "write") context.mock.method(handle, "writeFile", async () => { await originalWrite("{"); throw denied; });
        else context.mock.method(handle, "sync", async () => { throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.write(portfolio(1)), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readFile(path), before);
    assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
    await assert.rejects(store.readSnapshot(), /lock is unavailable/);
    await assert.rejects(store.write(portfolio(1)), /lock is unavailable/);
  });
});

test("portfolio revision update captures expected values and rejects loose revision inputs", async (context) => {
  await fixture(context, async (_path, store) => {
    await store.write(portfolio()); const expected = await store.readSnapshot();
    const pending = store.withExclusiveSnapshotUpdate(expected, async () => ({ portfolio: portfolio(900_000), result: "done" }));
    expected.portfolio!.cashKrw = 1; expected.revisionHash = null;
    assert.equal(await pending, "done"); assert.deepEqual(await store.read(), portfolio(900_000));
    for (const value of [{}, { portfolio: null }, { portfolio: null, revisionHash: "" },
      { portfolio: null, revisionHash: null, unknown: true }]) {
      await assert.rejects(store.withExclusiveSnapshotUpdate(value as VirtualPortfolioRevisionSnapshot, async () => { throw new Error("must not execute"); }));
    }
  });
});

async function fixture(context: TestContext, run: (path: string, store: FileVirtualPortfolioStore) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), "paper-portfolio-revision-")), path = join(root, "portfolio.json");
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await run(path, new FileVirtualPortfolioStore(path, { lockTimeoutMs: 100 }));
}
function child(path: string, expected: VirtualPortfolioRevisionSnapshot, mode: "cas" | "aba"): Promise<{ code: number | null; output: string }> {
  const script = `import { FileVirtualPortfolioStore } from ${JSON.stringify(new URL("./virtualPortfolioFileStore.js", import.meta.url).href)};
    const store = new FileVirtualPortfolioStore(process.argv[1]); const expected = JSON.parse(process.argv[2]);
    try {
      if (process.argv[3] === "aba") { await store.write({ ...expected.portfolio, cashKrw: 600000 }); await store.write(expected.portfolio); }
      else await store.withExclusiveSnapshotUpdate(expected, async () => ({ portfolio: expected.portfolio, result: null }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }`;
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, ["--input-type=module", "-e", script, path, JSON.stringify(expected), mode], { windowsHide: true });
    let output = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; processHandle.kill(); }, 30000);
    processHandle.stdout.on("data", (chunk) => { output += String(chunk); }); processHandle.stderr.on("data", (chunk) => { output += String(chunk); });
    processHandle.once("error", (error) => { clearTimeout(timer); reject(error); });
    processHandle.once("close", (code) => { clearTimeout(timer); if (timedOut) reject(new Error("revision child timed out")); else resolve({ code, output }); });
  });
}
