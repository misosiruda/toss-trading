import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { parseValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "../replay/validationRoleRegimeEvidenceExpansionPreflightHash.js";
import { createEvidenceExpansionPreflightBundleTestFixture } from "../replay/validationRoleRegimeEvidenceExpansionPreflightBundleVerifierTestFixture.js";

test("preflight CLI writes and prints one strict paper-only artifact", (t) => {
  const fixture = createFixture(t);

  const result = runCli(cliArgs(fixture));

  assert.equal(result.status, 0, result.stderr);
  const stdoutArtifact =
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      JSON.parse(result.stdout)
    );
  const storedArtifact =
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      JSON.parse(readFileSync(fixture.outputPath, "utf8"))
    );
  assert.equal(stdoutArtifact.mode, "paper_only");
  assert.equal(
    stdoutArtifact.generatedAt,
    "2026-07-30T00:00:00.000Z"
  );
  assert.deepEqual(storedArtifact, stdoutArtifact);
});

test("preflight CLI preserves an existing output", (t) => {
  const fixture = createFixture(t);
  const existing = "existing preflight must remain unchanged\n";
  mkdirSync(dirname(fixture.outputPath), { recursive: true });
  writeFileSync(fixture.outputPath, existing, "utf8");

  const result = runCli(cliArgs(fixture));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(fixture.outputPath, "utf8"), existing);
});

test("preflight CLI rejects unsafe options before source loading", () => {
  const result = runCli(["--use-codex-ai", "true"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported option: --use-codex-ai/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
  assert.equal(result.stdout, "");
});

test("preflight CLI requires each explicit path and generation time", () => {
  const missing = runCli([]);
  const repeated = runCli([
    "--input-path",
    "first.json",
    "--input-path",
    "second.json"
  ]);

  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--input-path is required/);
  assert.notEqual(repeated.status, 0);
  assert.match(repeated.stderr, /--input-path must not be repeated/);
  assert.equal(missing.stdout, "");
  assert.equal(repeated.stdout, "");
});

function createFixture(t: test.TestContext): {
  directory: string;
  inputPath: string;
  outputPath: string;
} {
  const directory = mkdtempSync(
    join(tmpdir(), "evidence-expansion-preflight-cli-")
  );
  const inputPath = join(directory, "input.json");
  const outputPath = join(directory, "output", "preflight.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    inputPath,
    `${JSON.stringify(
      createEvidenceExpansionPreflightBundleTestFixture(),
      null,
      2
    )}\n`,
    "utf8"
  );
  return { directory, inputPath, outputPath };
}

function cliArgs(fixture: {
  inputPath: string;
  outputPath: string;
}): string[] {
  return [
    "--input-path",
    fixture.inputPath,
    "--generated-at",
    "2026-07-30T00:00:00.000Z",
    "--output-path",
    fixture.outputPath
  ];
}

function runCli(args: readonly string[]) {
  return spawnSync(
    process.execPath,
    [
      join(
        process.cwd(),
        "dist",
        "cli",
        "validationRoleRegimeEvidenceExpansionPreflight.js"
      ),
      ...args
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
