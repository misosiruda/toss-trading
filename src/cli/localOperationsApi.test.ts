import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("operations CLI starts on loopback, describes guarded capabilities and leaves paper storage untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "operations-banner-"));
  await writeFile(join(root, "marker"), "unchanged");
  const child = spawn(process.execPath, [
    join(process.cwd(), "dist", "cli", "localOperationsApi.js"),
    "--host", "127.0.0.1", "--port", "0", "--data-dir", join(root, "paper-must-not-exist")
  ], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROKER_PROVIDER: "mock", TRADING_ENABLED: "false",
      AI_DECISION_MODE: "paper_only", AI_DECISION_ENABLED: "false" }
  });
  let output = "", errors = "";
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  child.stderr.on("data", chunk => { errors += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI startup timed out: ${errors}`)), 10_000);
      const finish = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once("error", finish);
      child.once("exit", () => finish(new Error(`CLI exited before startup: ${errors}`)));
      child.stdout.on("data", chunk => {
        output += String(chunk);
        if (output.includes("MCP is a separate read-only interface.")) finish();
      });
    });
    assert.match(output, /Local operations API listening on http:\/\/127\.0\.0\.1:/);
    assert.match(output, /^mode=paper_only live_trading=false paper_mutations=guarded$/m);
    assert.match(output, /HTTP capabilities: read endpoints and guarded paper mutations/);
    assert.doesNotMatch(output, /read_only=(true|false)/);
    assert.deepEqual(await readdir(root), ["marker"]);
    assert.equal(errors, "");
  } finally {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    try { await closed; } finally { clearTimeout(killTimer); }
    await rm(root, { recursive: true, force: true });
  }
});
