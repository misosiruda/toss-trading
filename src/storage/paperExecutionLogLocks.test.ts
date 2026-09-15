import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileAuditLog } from "./repositories.js";
import { withPaperExecutionLogAppend, withPaperExecutionLogBatch } from "./paperExecutionLogLocks.js";

const event = (summary: string) => ({ eventId: "synthetic", eventType: "TEST", actor: "system" as const, summary,
  maskedRefs: [], createdAt: "2026-09-15T00:00:00.000Z" });
const options = { lockTimeoutMs: 80, lockRetryDelayMs: 2 };

test("execution log batch holds all paths against independent writers through the consumer", async (context) => {
  await fixture(context, async (paths) => {
    await withPaperExecutionLogBatch(paths.slice().reverse(), async () => {
      await new FileAuditLog(paths[0]!).append(event("first"));
      for (const path of paths) {
        const child = await childAppend(path, "denied");
        assert.notEqual(child.code, 0); assert.match(child.output, /log lock is unavailable/);
        assert.equal((await fs.readdir(`${path}.paper-log.lock`)).length, 1);
      }
      await new FileAuditLog(paths[0]!).append(event("last"));
    });
    for (const path of paths) assert.equal((await childAppend(path, "after")).code, 0);
    assert.deepEqual((await new FileAuditLog(paths[0]!).readAll()).records.map((value) => value.summary), ["first", "last", "after"]);
  });
});

test("execution log append serializes independent processes and same-scope concurrent writes", async (context) => {
  await fixture(context, async ([path]) => {
    const results = await Promise.all(["one", "two", "three"].map((value) => childAppend(path!, value, 5000)));
    assert.ok(results.every((value) => value.code === 0), JSON.stringify(results));
    let active = 0, maximum = 0;
    await withPaperExecutionLogBatch([path!], async () => {
      await Promise.all(Array.from({ length: 8 }, (_, index) => withPaperExecutionLogAppend(path!, async () => {
        active++; maximum = Math.max(maximum, active);
        await new Promise((done) => setTimeout(done, 3));
        await fs.appendFile(path!, `${JSON.stringify(event(`queued-${index}`))}\n`);
        active--;
      })));
    });
    assert.equal(maximum, 1);
    const read = await new FileAuditLog(path!).readAll();
    assert.equal(read.corruptLineCount, 0); assert.equal(read.records.length, 11);
    assert.deepEqual(read.records.slice(3).map((value) => value.summary).sort(), Array.from({ length: 8 }, (_, index) => `queued-${index}`));
  });
});

test("execution log batch failures preserve all barriers and forensic bytes without retry", async (context) => {
  await fixture(context, async (paths) => {
    const denied = new Error("effect failed");
    await assert.rejects(withPaperExecutionLogBatch(paths, async () => {
      await new FileAuditLog(paths[0]!).append(event("written"));
      throw denied;
    }), (error) => error === denied);
    for (const path of paths) {
      assert.equal((await fs.readdir(`${path}.paper-log.lock`)).length, 1);
      await assert.rejects(withPaperExecutionLogAppend(path, async () => assert.fail("must not write"), options), /log lock is unavailable/);
    }
    assert.deepEqual((await new FileAuditLog(paths[0]!).readAll()).records, [event("written")]);
  });
});

test("execution log scopes reject escaped callbacks and undeclared paths without writes", async (context) => {
  await fixture(context, async (paths) => {
    let release!: () => void, escaped!: Promise<void>;
    const gate = new Promise<void>((done) => { release = done; });
    await withPaperExecutionLogBatch([paths[0]!], async () => {
      await assert.rejects(new FileAuditLog(paths[1]!).append(event("outside")), /outside the held batch/);
      await assert.rejects(withPaperExecutionLogBatch([paths[0]!], async () => undefined), /must not be nested/);
      escaped = gate.then(() => new FileAuditLog(paths[0]!).append(event("expired")));
    });
    const rejected = assert.rejects(escaped, /scope has expired/);
    release(); await rejected;
    for (const path of paths) await assert.rejects(fs.readFile(path), { code: "ENOENT" });
  });
});

test("execution log batch rejects swallowed append errors and skips queued writes", async (context) => {
  await fixture(context, async ([path]) => {
    const denied = new Error("failed write"); let called = false;
    await assert.rejects(withPaperExecutionLogBatch([path!], async () => {
      await withPaperExecutionLogAppend(path!, async () => { throw denied; }).catch(() => undefined);
      await withPaperExecutionLogAppend(path!, async () => { called = true; }).catch(() => undefined);
    }), (error) => error === denied);
    assert.equal(called, false);
    assert.equal((await fs.readdir(`${path}.paper-log.lock`)).length, 1);
  });
});

test("execution log clean failures release acquired locks and reject aliased files", async (context) => {
  await fixture(context, async (paths) => {
    const denied = new Error("before effects");
    await assert.rejects(withPaperExecutionLogBatch(paths, async () => { throw denied; }), (error) => error === denied);
    for (const path of paths) await assert.rejects(fs.readdir(`${path}.paper-log.lock`), { code: "ENOENT" });
    await assert.rejects(withPaperExecutionLogBatch([paths[0]!, paths[0]!], async () => assert.fail()), /must be distinct/);
    await fs.writeFile(paths[0]!, "existing\n"); await fs.link(paths[0]!, paths[1]!);
    await assert.rejects(new FileAuditLog(paths[0]!).append(event("hardlink")), /unaliased regular file/);
    assert.equal(await fs.readFile(paths[0]!, "utf8"), "existing\n");
  });
});

test("execution log lock initialization errors preserve their own barrier and release earlier locks", async (context) => {
  await fixture(context, async (paths) => {
    const original = fs.open, denied = Object.assign(new Error("lock init failed"), { code: "EIO" });
    const target = `${paths[1]}.paper-log.lock`;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (String(args[0]).startsWith(target)) context.mock.method(handle, "sync", async () => { throw denied; });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(withPaperExecutionLogBatch(paths, async () => assert.fail()), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await assert.rejects(fs.readdir(`${paths[0]}.paper-log.lock`), { code: "ENOENT" });
    assert.equal((await fs.readdir(target)).length, 1);
    await assert.rejects(withPaperExecutionLogAppend(paths[1]!, async () => assert.fail(), options), /log lock is unavailable/);
  });
});

test("execution log ownership changes block subsequent writes without deleting foreign tokens", async (context) => {
  await fixture(context, async ([path]) => {
    await assert.rejects(withPaperExecutionLogBatch([path!], async () => {
      await new FileAuditLog(path!).append(event("first"));
      await fs.writeFile(join(`${path}.paper-log.lock`, "foreign-owner"), "foreign\n");
      await new FileAuditLog(path!).append(event("must-not-write"));
    }), /ownership changed/);
    assert.equal((await fs.readdir(`${path}.paper-log.lock`)).length, 2);
    assert.deepEqual((await new FileAuditLog(path!).readAll()).records, [event("first")]);
  });
});

test("execution log lock release failure preserves a barrier after successful writes", async (context) => {
  await fixture(context, async ([path]) => {
    const original = fs.rmdir, denied = Object.assign(new Error("release failed"), { code: "EIO" });
    const mock = context.mock.method(fs, "rmdir", async (...args: Parameters<typeof fs.rmdir>) => {
      if (args[0] === `${path}.paper-log.lock`) throw denied;
      return original(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new FileAuditLog(path!).append(event("written")), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readdir(`${path}.paper-log.lock`), []);
    await assert.rejects(withPaperExecutionLogAppend(path!, async () => assert.fail(), options), /log lock is unavailable/);
    assert.deepEqual((await new FileAuditLog(path!).readAll()).records, [event("written")]);
  });
});

async function fixture(context: TestContext, run: (paths: string[]) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "paper-log-locks-"));
  context.after(() => fs.rm(dir, { recursive: true, force: true }));
  await run(["a.jsonl", "b.jsonl", "c.jsonl"].map((name) => join(dir, name)));
}
function childAppend(path: string, summary: string, timeout = 80): Promise<{ code: number | null; output: string }> {
  const module = new URL("./paperExecutionLogLocks.js", import.meta.url).href;
  const repositories = new URL("./repositories.js", import.meta.url).href;
  const code = `import { withPaperExecutionLogBatch } from ${JSON.stringify(module)};
    import { FileAuditLog } from ${JSON.stringify(repositories)};
    await withPaperExecutionLogBatch([${JSON.stringify(path)}], () => new FileAuditLog(${JSON.stringify(path)}).append(${JSON.stringify(event(summary))}), { lockTimeoutMs: ${timeout}, lockRetryDelayMs: 2 });`;
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", code], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject); child.on("close", (code) => done({ code, output }));
  });
}
