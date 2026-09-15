import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { z } from "zod";
import { JsonlStore } from "./jsonlStore.js";
import { FileAuditLog, FileVirtualDecisionStore, FileVirtualTradeStore } from "./repositories.js";
import { createVirtualDecisionHash } from "../paper/decisionHash.js";
import type { AuditEvent, VirtualDecision, VirtualTrade } from "../domain/schemas.js";

const schema = z.object({ id: z.string().min(1), text: z.string() }).strict();

test("durable JSONL append captures input and waits for fsync before resolving", async (context) => {
  await fixture(context, async (path) => {
    const input = { id: "one", text: "한글 synthetic" }, originalOpen = fs.open;
    let notify!: () => void, release!: () => void, completed = false;
    const entered = new Promise<void>((done) => { notify = done; }), gate = new Promise<void>((done) => { release = done; });
    const events: string[] = [];
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path) {
        const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
        context.mock.method(handle, "sync", async () => { events.push("sync-enter"); notify(); await gate; await sync(); events.push("sync-done"); });
        context.mock.method(handle, "close", async () => { events.push("close"); await close(); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      const promise = new JsonlStore(path, schema, "fixture").appendDurably(input).then(() => { completed = true; });
      input.text = "mutated";
      await entered; assert.equal(completed, false);
      assert.equal(await fs.readFile(path, "utf8"), `${JSON.stringify({ id: "one", text: "한글 synthetic" })}\n`);
      release(); await promise;
      assert.deepEqual(events, ["sync-enter", "sync-done", "close"]);
      assert.equal(completed, true);
    } finally { release(); mock.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("durable JSONL errors reject without retry or removal of partial written bytes", async (context) => {
  for (const phase of ["open", "write", "sync", "close", "directory"] as const) await fixture(context, async (path) => {
    await fs.writeFile(path, 'existing-prefix\n');
    const originalOpen = fs.open, denied = Object.assign(new Error(`injected ${phase}`), { code: "EIO" });
    let attempts = 0, closes = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (phase === "directory" && args[0] === dirname(path)) throw denied;
      if (args[0] === path) { attempts++; if (phase === "open") throw denied; }
      const handle = await originalOpen(...args);
      if (args[0] === path) {
        const write = handle.writeFile.bind(handle), close = handle.close.bind(handle);
        context.mock.method(handle, "close", async () => { closes++; await close(); if (phase === "close") throw denied; });
        if (phase === "write") context.mock.method(handle, "writeFile", async () => { await write("{"); throw denied; });
        if (phase === "sync") context.mock.method(handle, "sync", async () => { throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new JsonlStore(path, schema, "fixture").appendDurably({ id: "two", text: "value" }), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 1); assert.equal(closes, phase === "open" ? 0 : 1);
    assert.equal(await fs.readFile(path, "utf8"), phase === "open" ? 'existing-prefix\n'
      : phase === "write" ? 'existing-prefix\n{' : 'existing-prefix\n{"id":"two","text":"value"}\n');
  });
});

test("durable JSONL validates before opening and ordinary append keeps its existing behavior", async (context) => {
  await fixture(context, async (path) => {
    const originalOpen = fs.open; let opens = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => { opens++; return originalOpen(...args); });
    syncBuiltinESMExports();
    try {
      const store = new JsonlStore(path, schema, "fixture");
      await assert.rejects(store.appendDurably({ id: "", text: "bad" })); assert.equal(opens, 0);
      await store.append({ id: "old", text: "ordinary" }); assert.equal(opens, 0);
      assert.deepEqual(await store.readAll(), { records: [{ id: "old", text: "ordinary" }], corruptLineCount: 0 });
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("audit decision and trade repositories require fsync and preserve their legacy record payloads", async (context) => {
  await fixture(context, async (path) => {
    const audit: AuditEvent = { eventId: "synthetic_audit", eventType: "TEST", actor: "system", summary: "fixture", maskedRefs: [], createdAt: "2026-09-15T00:00:00.000Z" };
    const decision: VirtualDecision = { packetId: "synthetic_packet", summary: "fixture", decisions: [] };
    const trade: VirtualTrade = { tradeId: "synthetic_trade", packetId: "synthetic_packet", decisionId: "synthetic_risk", market: "KR", symbol: "SYNTHETIC",
      action: "VIRTUAL_BUY", quantity: 1, priceKrw: 100, amountKrw: 100, status: "VIRTUAL_FILLED", executedAt: audit.createdAt };
    const cases = [
      { path: `${path}.audit`, append: () => new FileAuditLog(`${path}.audit`).append(audit), value: audit },
      { path: `${path}.decision`, append: () => new FileVirtualDecisionStore(`${path}.decision`).append(decision), value: { ...decision, decisionHash: createVirtualDecisionHash(decision) } },
      { path: `${path}.trade`, append: () => new FileVirtualTradeStore(`${path}.trade`).append(trade), value: trade }
    ];
    for (const item of cases) {
      const originalOpen = fs.open, denied = Object.assign(new Error("repository fsync failure"), { code: "EIO" });
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (args[0] === item.path) context.mock.method(handle, "sync", async () => { throw denied; });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(item.append(), (error) => error === denied); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.deepEqual(JSON.parse(await fs.readFile(item.path, "utf8")), item.value);
    }
    assert.equal(decision.decisionHash, undefined);
  });
});

async function fixture(context: TestContext, run: (path: string) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), "paper-durable-log-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await run(join(root, "events.jsonl"));
}
