import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createReplayResearchHash } from "../replay/replayRunManifest.js";

test("validation split assignments CLI writes walk-forward assignment artifact", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "validation-splits-cli-"));
  const outputPath = join(outputDir, "walk-forward-assignments.json");

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "validationSplitAssignments.js"),
      "--range-start",
      "2025-01-01T00:00:00+09:00",
      "--range-end",
      "2025-06-30T23:59:59.999+09:00",
      "--train-months",
      "2",
      "--validation-months",
      "1",
      "--test-months",
      "1",
      "--step-months",
      "1",
      "--timezone-offset-minutes",
      "540",
      "--embargo-duration-days",
      "5",
      "--generated-at",
      "2026-08-01T00:00:00.000Z",
      "--output-path",
      outputPath
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outputPath), true);

  const stdoutArtifact = JSON.parse(result.stdout) as Record<string, unknown>;
  const storedArtifact = JSON.parse(
    readFileSync(outputPath, "utf8")
  ) as Record<string, unknown>;
  const plan = storedArtifact["plan"] as Record<string, unknown>;
  const summary = storedArtifact["summary"] as Record<string, unknown>;
  const assignments = storedArtifact["assignments"] as Array<
    Record<string, unknown>
  >;

  assert.equal(stdoutArtifact["schemaVersion"], "validation_split_assignment.v1");
  assert.equal(storedArtifact["mode"], "paper_only");
  assert.equal(
    storedArtifact["generatedAt"],
    "2026-08-01T00:00:00.000Z"
  );
  assert.equal(plan["validationProtocol"], "walk_forward");
  assert.equal(plan["splitCount"], 3);
  assert.equal(plan["embargoDurationDays"], 5);
  assert.deepEqual(summary["roleCounts"], {
    train: 3,
    validation: 3,
    test: 3
  });
  assert.equal(summary["assignmentCount"], 9);
  assert.equal(assignments.length, 9);
  assert.equal(assignments[0]?.["splitRole"], "train");
  assert.equal(assignments[1]?.["splitRole"], "validation");
  assert.equal(assignments[2]?.["splitRole"], "test");
  assert.equal(assignments[0]?.["trainStart"], "2024-12-31T15:00:00.000Z");
  assert.equal(assignments[0]?.["embargoDurationDays"], 5);
});

test("validation split assignments CLI rejects invalid configuration", () => {
  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "validationSplitAssignments.js"),
      "--range-start",
      "2025-01-01T00:00:00+09:00",
      "--range-end",
      "2025-03-31T23:59:59.999+09:00",
      "--train-months",
      "0",
      "--validation-months",
      "1"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trainMonths/);
});

test("validation split assignments CLI rejects missing output path value", () => {
  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "validationSplitAssignments.js"),
      "--range-start",
      "2025-01-01T00:00:00+09:00",
      "--range-end",
      "2025-03-31T23:59:59.999+09:00",
      "--train-months",
      "1",
      "--validation-months",
      "1",
      "--output-path"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--output-path requires a value/);
  assert.equal(result.stdout, "");
});

test("validation split assignments CLI rejects non-canonical generatedAt", () => {
  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "validationSplitAssignments.js"),
      "--range-start",
      "2025-01-01T00:00:00+09:00",
      "--range-end",
      "2025-03-31T23:59:59.999+09:00",
      "--train-months",
      "1",
      "--validation-months",
      "1",
      "--generated-at",
      "2026-08-01T09:00:00+09:00"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--generated-at must use canonical UTC ISO datetime with millisecond precision/
  );
  assert.equal(result.stdout, "");
});

test("validation split assignments CLI preserves existing output", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "validation-splits-cli-"));
  const outputPath = join(outputDir, "walk-forward-assignments.json");
  const existing = "existing split source must remain unchanged\n";
  writeFileSync(outputPath, existing, "utf8");

  const result = runDeterministicSplitCli(outputPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outputPath, "utf8"), existing);
});

test("validation split assignments CLI reproduces fixed generatedAt payload", () => {
  const first = runDeterministicSplitCli();
  const second = runDeterministicSplitCli();

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));
});

test("validation split assignments CLI reproduces registered expansion split hash", () => {
  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "validationSplitAssignments.js"),
      "--range-start",
      "2013-01-01T00:00:00+09:00",
      "--range-end",
      "2022-12-31T23:59:59.999+09:00",
      "--train-months",
      "40",
      "--validation-months",
      "40",
      "--test-months",
      "40",
      "--step-months",
      "120",
      "--timezone-offset-minutes",
      "540",
      "--embargo-duration-days",
      "5",
      "--generated-at",
      "2026-08-01T00:00:00.000Z"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    createReplayResearchHash(JSON.parse(result.stdout)),
    "sha256:afde7c8d062f0892f9d361f046074b36abf3e0babdc2a65bb69ddc7bc4149fad"
  );
});

function runDeterministicSplitCli(outputPath?: string) {
  return spawnSync(
    process.execPath,
    [
      join("dist", "cli", "validationSplitAssignments.js"),
      "--range-start",
      "2025-01-01T00:00:00+09:00",
      "--range-end",
      "2025-03-31T23:59:59.999+09:00",
      "--train-months",
      "1",
      "--validation-months",
      "1",
      "--generated-at",
      "2026-08-01T00:00:00.000Z",
      ...(outputPath === undefined
        ? []
        : ["--output-path", outputPath])
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );
}
