import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createVerificationPlan, parseVerificationArguments, runVerification } from "./verificationRunner.mjs";

test("review builds once and preserves quality and tooling gates before impact selection", () => {
  const plan = createVerificationPlan("review", { baseRef: "origin/main" });
  assert.deepEqual(plan.stages.map((stage) => stage.name), ["build", "quality", "tooling-tests", "affected-tests"]);
  assert.deepEqual(plan.stages[0].args, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]);
  assert.deepEqual(plan.stages[1].args, ["scripts/qualityGate.mjs"]);
  assert.deepEqual(plan.stages[2].args, ["--test", "scripts/changedTestRunner.test.mjs", "scripts/verificationRunner.test.mjs"]);
  assert.deepEqual(plan.stages[3].args, ["scripts/changedTestRunner.mjs", "--base-ref", "origin/main"]);
  assert.ok(Object.isFrozen(plan.stages[0].args));
});

test("merge runs the entire suite and cannot select or plan away required tests", () => {
  const plan = createVerificationPlan("merge");
  assert.deepEqual(plan.stages.map((stage) => stage.name), ["build", "quality", "tooling-tests", "full-tests"]);
  assert.deepEqual(plan.stages[3].args, ["--test", "dist/**/*.test.js"]);
  for (const options of [{ baseRef: "HEAD" }, { planOnly: true }, { skipTests: true }]) {
    assert.throws(() => createVerificationPlan("merge", options));
  }
});

test("invalid profiles and CLI flags fail before any verification stage", () => {
  for (const args of [[], ["fast"], ["review", "--skip"], ["merge", "--plan"],
    ["review", "--base-ref"], ["review", "--base-ref", ""], ["review", "--base-ref", "--plan"],
    ["review", "--plan", "--plan"], ["review", "--base-ref", "HEAD", "--base-ref", "HEAD"]]) {
    assert.throws(() => parseVerificationArguments(args));
  }
  assert.deepEqual(parseVerificationArguments(["review", "--base-ref", "main", "--plan"]), {
    profile: "review", options: { baseRef: "main", planOnly: true }
  });
});

test("stage timing and full summary reflect actual execution without duplicate builds or cached success", () => {
  const calls = [];
  const events = [];
  let clock = 0;
  const dependencies = {
    now: () => clock,
    report: (event) => events.push(event),
    run: (args) => { calls.push(args); clock += 25; return { status: 0 }; }
  };
  assert.equal(runVerification("merge", {}, dependencies), 0);
  assert.equal(calls.length, 4);
  assert.deepEqual(events.filter((event) => event.type === "stage" && event.status === "passed").map((event) => event.durationMs), [25, 25, 25, 25]);
  assert.deepEqual(events.at(-1), { type: "summary", profile: "merge", status: "passed", scope: "full", exitCode: 0, durationMs: 100 });
  assert.equal(runVerification("merge", {}, dependencies), 0);
  assert.equal(calls.length, 8);
});

test("each failed gate stops later stages and preserves the failure exit code", () => {
  for (let failureIndex = 0; failureIndex < 4; failureIndex += 1) {
    let calls = 0;
    const events = [];
    const exitCode = runVerification("merge", {}, {
      run: () => ({ status: calls++ === failureIndex ? 7 : 0 }),
      report: (event) => events.push(event)
    });
    assert.equal(exitCode, 7);
    assert.equal(calls, failureIndex + 1);
    assert.equal(events.at(-1).status, "failed");
    assert.equal(events.filter((event) => event.type === "summary" && event.status === "passed").length, 0);
  }
});

test("spawn errors signals missing status and thrown exceptions cannot become success", () => {
  for (const run of [
    () => ({ error: new Error("spawn failed"), status: 0 }),
    () => ({ signal: "SIGTERM", status: 0 }),
    () => ({ status: null }), () => ({ status: -1 }), () => ({ status: 256 }),
    () => { throw new Error("execution failed"); }
  ]) {
    let calls = 0;
    assert.equal(runVerification("review", {}, {
      run: (...args) => { calls += 1; return run(...args); }, report: () => {}
    }), 1);
    assert.equal(calls, 1);
  }
});

test("plan-only and affected verification never claim a full test pass", () => {
  for (const planOnly of [false, true]) {
    const events = [];
    const calls = [];
    assert.equal(runVerification("review", { planOnly }, {
      run: (args) => { calls.push(args); return { status: 0 }; },
      report: (event) => events.push(event)
    }), 0);
    assert.equal(events.at(-1).status, planOnly ? "planned" : "passed");
    assert.equal(events.at(-1).scope, planOnly ? "plan-only" : "affected-or-fallback");
    assert.equal(calls.at(-1).includes("--plan"), planOnly);
  }
});

test("npm verification entrypoints preserve full and review profiles", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(scripts.check, "node scripts/verificationRunner.mjs merge");
  assert.equal(scripts["check:merge"], scripts.check);
  assert.equal(scripts["check:review"], "node scripts/verificationRunner.mjs review");
  assert.equal(scripts["check:changed"], scripts["check:review"]);
});

test("invalid merge CLI exits nonzero without running build or tests", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./verificationRunner.mjs", import.meta.url)), "merge", "--plan"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot select or skip tests/);
  assert.doesNotMatch(result.stdout, /"type":"stage"/);
});
