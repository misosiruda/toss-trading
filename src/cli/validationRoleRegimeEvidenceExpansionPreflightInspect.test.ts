import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "../replay/validationRoleRegimeEvidenceExpansionPreflightHash.js";
import { createEvidenceExpansionPreflightTestArtifact } from "../replay/validationRoleRegimeEvidenceExpansionPreflightTestFixture.js";

test("preflight inspect CLI prints a strict hash-verified artifact", (t) => {
  const fixture = createFixture(t);
  const artifact = createEvidenceExpansionPreflightTestArtifact();
  writeFileSync(
    fixture.artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );

  const result = runInspectCli(["--artifact-path", fixture.artifactPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      JSON.parse(result.stdout)
    ),
    artifact
  );
});

test("preflight inspect CLI rejects a hash mismatch", (t) => {
  const fixture = createFixture(t);
  const artifact = {
    ...createEvidenceExpansionPreflightTestArtifact(),
    generatedAt: "2026-07-29T00:00:00.000Z"
  };
  writeFileSync(
    fixture.artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8"
  );

  const result = runInspectCli(["--artifact-path", fixture.artifactPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /preflight hash mismatch/);
  assert.equal(result.stdout, "");
});

test("preflight inspect CLI rejects unsupported options", () => {
  const result = runInspectCli(["--output-path", "preflight.json"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported option: --output-path/);
  assert.equal(result.stdout, "");
});

test("preflight inspect CLI requires one artifact path", () => {
  const missing = runInspectCli([]);
  const repeated = runInspectCli([
    "--artifact-path",
    "first.json",
    "--artifact-path",
    "second.json"
  ]);

  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--artifact-path is required exactly once/);
  assert.notEqual(repeated.status, 0);
  assert.match(repeated.stderr, /--artifact-path is required exactly once/);
  assert.equal(missing.stdout, "");
  assert.equal(repeated.stdout, "");
});

function createFixture(t: test.TestContext): { artifactPath: string } {
  const directory = mkdtempSync(
    join(tmpdir(), "evidence-expansion-preflight-inspect-")
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    artifactPath: join(directory, "preflight.json")
  };
}

function runInspectCli(args: readonly string[]) {
  return spawnSync(
    process.execPath,
    [
      join(
        process.cwd(),
        "dist",
        "cli",
        "validationRoleRegimeEvidenceExpansionPreflightInspect.js"
      ),
      ...args
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}
