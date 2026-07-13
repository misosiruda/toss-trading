import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

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
