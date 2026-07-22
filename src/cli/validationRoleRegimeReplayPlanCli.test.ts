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

import { parseValidationRoleRegimeReplayPlan } from "../replay/validationRoleRegimeReplayPlan.js";
import { createValidationSplitRegimeCliFixture } from "./validationSplitRegimeCliTestFixture.js";

test("role-regime plan CLI writes a verified paper-only plan", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  const feasibilityResult = runFeasibilityCli(fixture.args);
  assert.equal(feasibilityResult.status, 0, feasibilityResult.stderr);
  const outputPath = join(fixture.directory, "output", "plan.json");

  const result = runPlanCli(planArgs(fixture, outputPath));

  assert.equal(result.status, 0, result.stderr);
  const stdoutPlan = parseValidationRoleRegimeReplayPlan(
    JSON.parse(result.stdout)
  );
  const storedPlan = parseValidationRoleRegimeReplayPlan(
    JSON.parse(readFileSync(outputPath, "utf8"))
  );
  assert.equal(stdoutPlan.mode, "paper_only");
  assert.equal(stdoutPlan.status, "ready_for_paper_diagnostic");
  assert.equal(stdoutPlan.runs.length, 3);
  assert.deepEqual(storedPlan, stdoutPlan);
});

test("role-regime plan CLI preserves an existing output", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  const feasibilityResult = runFeasibilityCli(fixture.args);
  assert.equal(feasibilityResult.status, 0, feasibilityResult.stderr);
  const outputPath = join(fixture.directory, "output", "plan.json");
  const existing = "existing plan must remain unchanged\n";
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, existing, "utf8");

  const result = runPlanCli(planArgs(fixture, outputPath));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outputPath, "utf8"), existing);
});

test("role-regime plan CLI rejects unsafe options before source loading", () => {
  const result = runPlanCli(["--use-codex-ai", "true"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported option: --use-codex-ai/);
  assert.equal(result.stdout, "");
});

test("role-regime plan CLI requires fixed policy options", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  const outputPath = join(fixture.directory, "output", "plan.json");
  const invalidPolicy = planArgs(fixture, outputPath).map((value) =>
    value === "exhaustive_role_regime_candidates.v1" ? "random" : value
  );
  const invalidCalendarClass = planArgs(fixture, outputPath).map((value) =>
    value === "observed_session_only" ? "official_exchange" : value
  );

  const policyResult = runPlanCli(invalidPolicy);
  const calendarResult = runPlanCli(invalidCalendarClass);

  assert.notEqual(policyResult.status, 0);
  assert.match(
    policyResult.stderr,
    /--selection-policy must be exhaustive_role_regime_candidates.v1/
  );
  assert.notEqual(calendarResult.status, 0);
  assert.match(
    calendarResult.stderr,
    /--calendar-evidence-class must be observed_session_only/
  );
  assert.equal(existsSync(outputPath), false);
});

test("role-regime plan CLI rejects source drift without output", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  const feasibilityResult = runFeasibilityCli(fixture.args);
  assert.equal(feasibilityResult.status, 0, feasibilityResult.stderr);
  const fixtures = JSON.parse(
    readFileSync(fixture.calendarFixturesPath, "utf8")
  ) as Array<Record<string, unknown>>;
  fixtures[0] = {
    ...fixtures[0],
    createdAt: "2026-07-21T00:00:00.000Z"
  };
  writeFileSync(
    fixture.calendarFixturesPath,
    `${JSON.stringify(fixtures)}\n`,
    "utf8"
  );
  const outputPath = join(fixture.directory, "output", "plan.json");

  const result = runPlanCli(planArgs(fixture, outputPath));

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /feasibility artifact does not match regenerated source inputs/
  );
  assert.equal(result.stdout, "");
  assert.equal(existsSync(outputPath), false);
});

test("role-regime plan CLI rejects a corrupt feasibility artifact", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  mkdirSync(dirname(fixture.outputPath), { recursive: true });
  writeFileSync(fixture.outputPath, "not-json\n", "utf8");
  const outputPath = join(fixture.directory, "output", "plan.json");

  const result = runPlanCli(planArgs(fixture, outputPath));

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /validation split regime feasibility artifact must contain valid JSON/
  );
  assert.equal(result.stdout, "");
  assert.equal(existsSync(outputPath), false);
});

test("historical batch replay CLI executes exact role-regime plan windows", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  const feasibilityResult = runFeasibilityCli(fixture.args);
  assert.equal(feasibilityResult.status, 0, feasibilityResult.stderr);
  const planPath = join(fixture.directory, "output", "plan.json");
  const planResult = runPlanCli(planArgs(fixture, planPath));
  assert.equal(planResult.status, 0, planResult.stderr);
  const plan = parseValidationRoleRegimeReplayPlan(
    JSON.parse(readFileSync(planPath, "utf8"))
  );
  const outputBaseDir = join(fixture.directory, "batch-output");

  const batchArgs = [
    "--source-data-dir",
    fixture.sourceDataDir,
    "--output-dir",
    outputBaseDir,
    "--batch-id",
    "role-regime-plan-e2e",
    "--seed",
    "role-regime-seed",
    "--validation-role-regime-plan-path",
    planPath,
    "--universe-path",
    fixture.universePath,
    "--coverage-path",
    fixture.coveragePath,
    "--calendar-fixtures-path",
    fixture.calendarFixturesPath,
    "--calendar-rule",
    "KR:KRX:Asia/Seoul",
    "--min-window-snapshots",
    "1",
    "--min-snapshots-per-symbol",
    "1",
    "--step-seconds",
    "2678400",
    "--max-snapshot-age-seconds",
    "2678400"
  ];
  const result = runBatchCli(batchArgs);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const manifest = JSON.parse(
    readFileSync(String(output["manifestPath"]), "utf8")
  ) as Record<string, unknown>;
  const records = readFileSync(String(output["runsPath"]), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(output["runCount"], plan.runs.length);
  assert.equal(output["windowSamplingMode"], "validation_role_regime_plan");
  assert.equal(
    output["validationRoleRegimePlanPath"],
    planPath
  );
  assert.equal(
    (manifest["validationRoleRegimePlan"] as Record<string, unknown>)[
      "planHash"
    ],
    plan.planHash
  );
  assert.deepEqual(
    (manifest["validationProtocol"] as Record<string, unknown>)["roleCounts"],
    { train: 1, validation: 1, test: 1 }
  );
  assert.deepEqual(
    records.map((record) => ({
      startAt: (record["window"] as Record<string, unknown>)["startAt"],
      endAt: (record["window"] as Record<string, unknown>)["endAt"],
      targetRegime: (
        record["validationRoleRegimePlan"] as Record<string, unknown>
      )["targetRegime"]
    })),
    plan.runs.map((run) => ({
      startAt: run.startAt,
      endAt: run.endAt,
      targetRegime: run.targetRegime
    }))
  );

  const collision = runBatchCli(batchArgs);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /batch output already exists/);
  assert.equal(
    JSON.parse(readFileSync(String(output["manifestPath"]), "utf8"))["status"],
    "completed"
  );
});

test("historical batch replay CLI rejects plan conflicts before source access", () => {
  const result = runBatchCli([
    "--validation-role-regime-plan-path",
    "missing-plan.json",
    "--runs",
    "1"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--validation-role-regime-plan-path conflicts with --runs/
  );
  assert.doesNotMatch(result.stderr, /ENOENT/);

  const repeated = runBatchCli([
    "--validation-role-regime-plan-path",
    "missing-plan-a.json",
    "--validation-role-regime-plan-path",
    "missing-plan-b.json"
  ]);
  assert.notEqual(repeated.status, 0);
  assert.match(
    repeated.stderr,
    /--validation-role-regime-plan-path must not be repeated/
  );
  assert.doesNotMatch(repeated.stderr, /ENOENT/);
});

test("historical batch replay CLI rejects runtime snapshot drift before output", (t) => {
  const fixture = createValidationSplitRegimeCliFixture(t);
  const feasibilityResult = runFeasibilityCli(fixture.args);
  assert.equal(feasibilityResult.status, 0, feasibilityResult.stderr);
  const planPath = join(fixture.directory, "output", "plan.json");
  const planResult = runPlanCli(planArgs(fixture, planPath));
  assert.equal(planResult.status, 0, planResult.stderr);
  const snapshotPath = join(
    fixture.sourceDataDir,
    "historical-market-snapshots.jsonl"
  );
  writeFileSync(
    snapshotPath,
    readFileSync(snapshotPath, "utf8").replace('"lastPriceKrw":100', '"lastPriceKrw":101'),
    "utf8"
  );
  const outputBaseDir = join(fixture.directory, "drift-output");

  const result = runBatchCli([
    "--source-data-dir",
    fixture.sourceDataDir,
    "--output-dir",
    outputBaseDir,
    "--batch-id",
    "role-regime-plan-drift",
    "--seed",
    "role-regime-seed",
    "--validation-role-regime-plan-path",
    planPath,
    "--universe-path",
    fixture.universePath,
    "--coverage-path",
    fixture.coveragePath,
    "--calendar-fixtures-path",
    fixture.calendarFixturesPath,
    "--calendar-rule",
    "KR:KRX:Asia/Seoul"
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /data snapshot hash mismatch/);
  assert.equal(
    existsSync(join(outputBaseDir, "role-regime-plan-drift")),
    false
  );
});

function runFeasibilityCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [join("dist", "cli", "validationSplitRegimeFeasibility.js"), ...args],
    { cwd: process.cwd(), encoding: "utf8" }
  );
}

function runPlanCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [join("dist", "cli", "validationRoleRegimeReplayPlan.js"), ...args],
    { cwd: process.cwd(), encoding: "utf8" }
  );
}

function runBatchCli(args: string[]) {
  return spawnSync(
    process.execPath,
    [join("dist", "cli", "historicalBatchReplay.js"), ...args],
    { cwd: process.cwd(), encoding: "utf8" }
  );
}

function planArgs(
  fixture: ReturnType<typeof createValidationSplitRegimeCliFixture>,
  outputPath: string
): string[] {
  return [
    "--feasibility-path",
    fixture.outputPath,
    "--source-data-dir",
    fixture.sourceDataDir,
    "--universe-path",
    fixture.universePath,
    "--coverage-path",
    fixture.coveragePath,
    "--validation-splits-path",
    fixture.validationSplitsPath,
    "--calendar-fixtures-path",
    fixture.calendarFixturesPath,
    "--selection-policy",
    "exhaustive_role_regime_candidates.v1",
    "--calendar-evidence-class",
    "observed_session_only",
    "--output-path",
    outputPath
  ];
}
