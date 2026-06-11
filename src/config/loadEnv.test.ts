import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { loadLocalEnv } from "./loadEnv.js";

test("loadLocalEnv reads a project env file when present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toss-trading-env-"));
  const envPath = join(dir, ".env");
  delete process.env["TOSS_TRADING_ENV_TEST_VALUE"];

  await writeFile(envPath, "TOSS_TRADING_ENV_TEST_VALUE=loaded\n", "utf8");
  const loaded = loadLocalEnv(envPath);

  assert.equal(loaded, true);
  assert.equal(process.env["TOSS_TRADING_ENV_TEST_VALUE"], "loaded");
});

test("loadLocalEnv skips missing env files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toss-trading-env-missing-"));

  assert.equal(loadLocalEnv(join(dir, ".env")), false);
});
