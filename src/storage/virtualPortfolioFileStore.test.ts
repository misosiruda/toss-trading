import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileVirtualPortfolioStore, VirtualPortfolioStateChangedError } from "./virtualPortfolioFileStore.js";

const portfolio = (cashKrw = 1_000_000) => ({ portfolioId: "paper-only-fixture", cashKrw, positions: [],
  updatedAt: "2026-09-01T00:00:00.000Z" });

test("paper portfolio value CAS serializes independent process updates and preserves legacy JSON", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path), old = portfolio();
    await fs.writeFile(path, JSON.stringify(old)); // Existing compact JSON remains readable.
    const results = await Promise.all([900_000, 800_000].map((cash) => childUpdate(path, old, cash)));
    assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
    assert.match(results.find((result) => result.code !== 0)!.output, /paper portfolio state changed/);
    const expected = portfolio(Number(results.find((result) => result.code === 0)!.output.trim()));
    assert.deepEqual(await new FileVirtualPortfolioStore(path).read(), expected);
    assert.equal(await fs.readFile(path, "utf8"), `${JSON.stringify(expected, null, 2)}\n`);
    let called = false;
    await assert.rejects(store.withExclusiveUpdate(null, async () => { called = true; return { portfolio: old, result: null }; }),
      VirtualPortfolioStateChangedError);
    assert.equal(called, false);
  });
});

test("paper portfolio update holds the lock through its callback and rejects a competing process", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path), old = portfolio(), next = portfolio(900_000);
    await store.write(old);
    const entered = deferred(), release = deferred();
    const pending = store.withExclusiveUpdate(old, async () => { entered.resolve(); await release.promise; return { portfolio: next, result: "committed" }; });
    const settled = pending.catch(() => undefined);
    try {
      await entered.promise;
      const competing = await childUpdate(path, old, 800_000, 100);
      assert.notEqual(competing.code, 0); assert.match(competing.output, /paper portfolio lock is unavailable/);
      const legacyWriter = await childUpdate(path, old, 700_000, 100, true);
      assert.notEqual(legacyWriter.code, 0); assert.match(legacyWriter.output, /paper portfolio lock is unavailable/);
      assert.equal(await fs.readFile(path, "utf8"), `${JSON.stringify(old, null, 2)}\n`);
      assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
    } finally { release.resolve(); await settled; }
    assert.equal(await pending, "committed"); assert.deepEqual(await store.read(), next);
  });
});

test("paper portfolio captures queued writes and expected state before waiting", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path), old = portfolio(); await store.write(old);
    const entered = deferred(), release = deferred();
    const held = store.withExclusiveUpdate(old, async () => { entered.resolve(); await release.promise; return { portfolio: old, result: null }; });
    await entered.promise;
    const next = portfolio(700_000), expected = portfolio();
    const queued = store.withExclusiveUpdate(expected, async () => ({ portfolio: portfolio(600_000), result: null }));
    expected.cashKrw = 1;
    release.resolve(); await held; await queued;
    const capturedWrite = store.write(next); next.cashKrw = 1; await capturedWrite;
    assert.deepEqual(await store.read(), portfolio(700_000));
  });
});

test("paper portfolio callback failure preserves prior bytes and blocks retries for explicit recovery", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path, { lockTimeoutMs: 60, lockRetryDelayMs: 2 }), old = portfolio(); await store.write(old);
    const bytes = await fs.readFile(path), denied = new Error("callback failure");
    await assert.rejects(store.withExclusiveUpdate(old, async () => { throw denied; }), (error) => error === denied);
    assert.deepEqual(await fs.readFile(path), bytes);
    assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
    await assert.rejects(store.read(), /lock is unavailable/);
    await assert.rejects(store.write(portfolio(1)), /lock is unavailable/);
    assert.deepEqual(await fs.readFile(path), bytes);
  });
});

test("paper portfolio malformed sources reject conditional update before the callback", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path), old = portfolio();
    for (const corrupt of [Buffer.from([0xff]), Buffer.from("{"), Buffer.from('{"unexpected":true}')]) {
      await fs.writeFile(path, corrupt);
      let called = false;
      await assert.rejects(store.withExclusiveUpdate(old, async () => { called = true; return { portfolio: old, result: null }; }));
      assert.equal(called, false); assert.deepEqual(await fs.readFile(path), corrupt);
    }
  });
});

test("paper portfolio atomic replacement keeps prior bytes on write sync and rename faults", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path), old = portfolio(); await store.write(old);
    const bytes = await fs.readFile(path);
    for (const phase of ["write", "sync", "rename"] as const) {
      const originalOpen = fs.open, originalRename = fs.rename, denied = Object.assign(new Error("injected EIO"), { code: "EIO" });
      const mock = phase === "rename" ? context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
        if (args[1] === path) throw denied; return originalRename(...args);
      }) : context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (String(args[0]).startsWith(`${path}.tmp-`)) context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => { throw denied; });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(store.write(portfolio(1)), (error) => error === denied); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.deepEqual(await fs.readFile(path), bytes); assert.deepEqual(await store.read(), old);
      assert.deepEqual(await fs.readdir(dirname(path)), ["portfolio.json"]);
    }
  });
});

test("paper portfolio failed lock initialization stays as a barrier without automatic recovery", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path, { lockTimeoutMs: 60, lockRetryDelayMs: 2 });
    const originalOpen = fs.open, denied = Object.assign(new Error("injected EACCES"), { code: "EACCES" });
    let calls = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (dirname(String(args[0])) === `${path}.lock`) { calls++; throw denied; }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.write(portfolio()), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(calls, 1); assert.deepEqual(await fs.readdir(`${path}.lock`), []);
    await assert.rejects(store.read(), /lock is unavailable/);
    assert.deepEqual(await fs.readdir(`${path}.lock`), []);
  });
});

test("paper portfolio uncertain post-rename sync preserves a recovery barrier instead of reporting success", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path, { lockTimeoutMs: 60 }), old = portfolio(), next = portfolio(800_000);
    await store.write(old);
    const originalOpen = fs.open, originalRename = fs.rename, denied = Object.assign(new Error("post-rename sync failure"), { code: "EIO" });
    let renamed = false;
    const renameMock = context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      await originalRename(...args); if (args[1] === path) renamed = true;
    });
    const openMock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (renamed && args[0] === dirname(path)) throw denied;
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.withExclusiveUpdate(old, async () => ({ portfolio: next, result: "must not return" })), (error) => error === denied); }
    finally { renameMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(renamed, true);
    assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), next);
    await assert.rejects(store.read(), /lock is unavailable/);
    assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
  });
});

test("paper portfolio validates options and preserves callback return values", async (context) => {
  await fixture(context, async (path) => {
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => new FileVirtualPortfolioStore(path, { lockTimeoutMs: value }));
      assert.throws(() => new FileVirtualPortfolioStore(path, { lockRetryDelayMs: value }));
    }
    const store = new FileVirtualPortfolioStore(path);
    assert.equal(await store.read(), null);
    const result = { status: "paper-only" };
    assert.equal(await store.withExclusiveUpdate(null, async () => ({ portfolio: portfolio(), result })), result);
    assert.deepEqual(await store.read(), portfolio());
  });
});

test("paper portfolio completes durability before unlock without fallible post-unlock I/O", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path), old = portfolio(); await store.write(old);
    const originalOpen = fs.open, originalRmdir = fs.rmdir;
    let unlocked = false, beforeUnlockDirectorySyncs = 0, afterUnlockDirectorySyncs = 0;
    const denied = Object.assign(new Error("injected post-unlock sync failure"), { code: "EIO" });
    const rmdirMock = context.mock.method(fs, "rmdir", async (...args: Parameters<typeof fs.rmdir>) => {
      await originalRmdir(...args); if (args[0] === `${path}.lock`) unlocked = true;
    });
    const openMock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === dirname(path)) {
        if (unlocked) { afterUnlockDirectorySyncs++; throw denied; }
        const handle = await originalOpen(...args), originalSync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { beforeUnlockDirectorySyncs++; await originalSync(); });
        return handle;
      }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.equal(await store.withExclusiveUpdate(old, async () => ({ portfolio: old, result: "committed" })), "committed");
    } finally { rmdirMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(unlocked, true); assert.equal(afterUnlockDirectorySyncs, 0);
    if (process.platform !== "win32") assert.ok(beforeUnlockDirectorySyncs >= 2);
    assert.deepEqual(await fs.readdir(dirname(path)), ["portfolio.json"]);
    assert.deepEqual(await store.read(), old);
  });
});

test("paper portfolio failed directory removal leaves a barrier after an unchanged update", async (context) => {
  await fixture(context, async (path) => {
    const store = new FileVirtualPortfolioStore(path, { lockTimeoutMs: 60 }), old = portfolio(); await store.write(old);
    const originalRmdir = fs.rmdir, denied = Object.assign(new Error("injected unlock failure"), { code: "EACCES" });
    const mock = context.mock.method(fs, "rmdir", async (...args: Parameters<typeof fs.rmdir>) => {
      if (args[0] === `${path}.lock`) throw denied; return originalRmdir(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.withExclusiveUpdate(old, async () => ({ portfolio: old, result: null })), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readdir(`${path}.lock`), []);
    await assert.rejects(store.read(), /lock is unavailable/);
    assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), old);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture(context: TestContext, run: (path: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "paper-portfolio-store-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  await run(join(dir, "portfolio.json"));
}
function childUpdate(path: string, expected: ReturnType<typeof portfolio>, cash: number, lockTimeoutMs = 5000, unconditional = false): Promise<{ code: number | null; output: string }> {
  const moduleUrl = new URL("./virtualPortfolioFileStore.js", import.meta.url).href;
  const script = `import { FileVirtualPortfolioStore } from ${JSON.stringify(moduleUrl)};
    try { const expected = JSON.parse(process.argv[2]); const cashKrw = Number(process.argv[3]);
      const store = new FileVirtualPortfolioStore(process.argv[1], { lockTimeoutMs: Number(process.argv[4]) });
      if (process.argv[5] === "write") { await store.write({ ...expected, cashKrw }); console.log(cashKrw); }
      else console.log(await store.withExclusiveUpdate(expected, async () => ({ portfolio: { ...expected, cashKrw }, result: cashKrw }))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, path, JSON.stringify(expected), String(cash), String(lockTimeoutMs), unconditional ? "write" : "cas"], { windowsHide: true });
    let output = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
    child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); if (timedOut) reject(new Error("portfolio child timed out")); else resolve({ code, output }); });
  });
}
