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
