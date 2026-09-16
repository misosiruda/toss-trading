import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readDurableRebalanceSource } from "./rebalanceDurableSource.js";

async function fixture(operation: (path: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "rebalance-durable-source-"));
  try { await operation(join(directory, "source.jsonl")); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test("rebalance durable source captures missing empty and UTF-8 bytes without creating or modifying history", async () => {
  await fixture(async (path) => {
    assert.equal((await readDurableRebalanceSource(path)).raw, "");
    await assert.rejects(fs.stat(path), { code: "ENOENT" });
    for (const raw of ["", "합성 원본\n"]) {
      await fs.writeFile(path, raw);
      const before = Date.now(), observation = await readDurableRebalanceSource(path);
      assert.equal(observation.raw, raw);
      assert.ok(Date.parse(observation.observedAt) >= before);
      assert.equal(await fs.readFile(path, "utf8"), raw);
    }
  });
});

test("rebalance durable source rejects invalid UTF-8 directories and multiple hard links", async () => {
  await fixture(async (path) => {
    await fs.writeFile(path, Buffer.from([0xff, 0x0a]));
    await assert.rejects(readDurableRebalanceSource(path), /invalid UTF-8/);
    await fs.writeFile(path, "synthetic\n");
    await fs.link(path, `${path}.alias`);
    await assert.rejects(readDurableRebalanceSource(path), /single-link/);
  });
  await fixture(async (path) => {
    await fs.mkdir(path);
    await assert.rejects(readDurableRebalanceSource(path), /regular file/);
  });
});

test("rebalance durable source rejects descriptor replacement append rewrite and fsync failures", async (context) => {
  for (const mode of ["replace", "append", "rewrite", "sync"] as const) await fixture(async (path) => {
    const original = fs.open, raw = "synthetic original\n";
    await fs.writeFile(path, raw); let injected = false;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === path && args[1] === "r+") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await sync(); injected = true;
          if (mode === "sync") throw new Error("synthetic source fsync failure");
          if (mode === "replace") { await fs.rename(path, `${path}.old`); await fs.writeFile(path, raw); }
          if (mode === "append") await fs.appendFile(path, "suffix\n");
          if (mode === "rewrite") await fs.writeFile(path, "synthetic modified\n");
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(readDurableRebalanceSource(path), mode === "sync" ? /fsync failure/ : /changed during/); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
  });
});
