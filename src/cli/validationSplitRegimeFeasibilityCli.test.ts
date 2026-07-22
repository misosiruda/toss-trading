import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createValidationSplitRegimeCliFixture as createCliFixture } from "./validationSplitRegimeCliTestFixture.js";

test("feasibility CLI writes an available paper-only artifact", (t) => {
  const fixture = createCliFixture(t);
  const result = runCli(fixture.args);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(fixture.outputPath), true);
  const stdoutArtifact = JSON.parse(result.stdout) as Record<string, unknown>;
  const storedArtifact = JSON.parse(
    readFileSync(fixture.outputPath, "utf8")
  ) as Record<string, unknown>;
  assert.equal(stdoutArtifact["mode"], "paper_only");
  assert.equal(stdoutArtifact["status"], "available");
  assert.deepEqual(storedArtifact, stdoutArtifact);
});

test("feasibility CLI preserves an existing output artifact", (t) => {
  const fixture = createCliFixture(t);
  const existing = "existing output must remain unchanged\n";
  mkdirSync(dirname(fixture.outputPath), { recursive: true });
  writeFileSync(fixture.outputPath, existing, "utf8");

  const result = runCli(fixture.args);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(fixture.outputPath, "utf8"), existing);
});

test("feasibility CLI rejects provider options before source loading", () => {
  const result = runCli(["--use-codex-ai", "true"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported option: --use-codex-ai/);
  assert.equal(result.stdout, "");
});

test("feasibility CLI rejects missing snapshot market calendar rules", (t) => {
  const fixture = createCliFixture(t, { includeUsMarket: true });

  const result = runCli(fixture.args);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /missing --calendar-rule for snapshot markets: US/
  );
  assert.equal(result.stdout, "");
  assert.equal(existsSync(fixture.outputPath), false);
});

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [join("dist", "cli", "validationSplitRegimeFeasibility.js"), ...args],
    { cwd: process.cwd(), encoding: "utf8" }
  );
}
