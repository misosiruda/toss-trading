#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

/** Full verification remains mandatory for the final merge candidate. */
export function createVerificationPlan(profile, options = {}) {
  if (profile !== "review" && profile !== "merge") {
    throw new Error("verification profile must be review or merge");
  }
  const unknownOptions = Object.keys(options).filter(
    (key) => key !== "baseRef" && key !== "planOnly"
  );
  if (unknownOptions.length > 0 ||
    (options.planOnly !== undefined && typeof options.planOnly !== "boolean") ||
    (options.baseRef !== undefined &&
      (typeof options.baseRef !== "string" || options.baseRef.length === 0 || options.baseRef.startsWith("-")))) {
    throw new Error("invalid verification options");
  }
  if (profile === "merge" && (options.baseRef !== undefined || options.planOnly)) {
    throw new Error("merge verification cannot select or skip tests");
  }
  const testArgs = profile === "merge"
    ? ["--test", "dist/**/*.test.js"]
    : ["scripts/changedTestRunner.mjs",
      ...(options.baseRef === undefined ? [] : ["--base-ref", options.baseRef]),
      ...(options.planOnly ? ["--plan"] : [])];
  const stages = [
    { name: "build", args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"] },
    { name: "quality", args: ["scripts/qualityGate.mjs"] },
    { name: "tooling-tests", args: ["--test", "scripts/changedTestRunner.test.mjs", "scripts/verificationRunner.test.mjs"] },
    { name: options.planOnly ? "test-plan" : profile === "merge" ? "full-tests" : "affected-tests", args: testArgs }
  ];
  return Object.freeze({
    profile,
    planOnly: options.planOnly === true,
    stages: Object.freeze(stages.map((stage) => Object.freeze({
      ...stage, args: Object.freeze(stage.args)
    })))
  });
}

/** Executes every gate once, stops at first failure, and never caches success. */
export function runVerification(profile, options = {}, dependencies = {}) {
  const plan = createVerificationPlan(profile, options);
  const now = dependencies.now ?? (() => performance.now());
  const report = dependencies.report ?? ((event) => console.log(`[verify] ${JSON.stringify(event)}`));
  const run = dependencies.run ?? ((args) => spawnSync(process.execPath, args, {
    cwd: repoRoot, stdio: "inherit"
  }));
  const started = now();
  const elapsed = (since) => Math.round((now() - since) * 100) / 100;
  for (const stage of plan.stages) {
    report({ type: "stage", profile, stage: stage.name, status: "running" });
    const stageStarted = now();
    let exitCode;
    let reason;
    try {
      const result = run(stage.args);
      if (result.error) throw result.error;
      exitCode = !result.signal && Number.isInteger(result.status) &&
        result.status >= 0 && result.status <= 255 ? result.status : 1;
      if (result.signal) reason = `terminated by ${result.signal}`;
    } catch (error) {
      exitCode = 1;
      reason = error instanceof Error ? error.message : "stage execution failed";
    }
    report({ type: "stage", profile, stage: stage.name,
      status: exitCode === 0 ? "passed" : "failed", exitCode,
      durationMs: elapsed(stageStarted), ...(reason === undefined ? {} : { reason }) });
    if (exitCode !== 0) {
      report({ type: "summary", profile, status: "failed", exitCode, durationMs: elapsed(started) });
      return exitCode;
    }
  }
  report({ type: "summary", profile, status: plan.planOnly ? "planned" : "passed",
    scope: plan.planOnly ? "plan-only" : profile === "merge" ? "full" : "affected-or-fallback",
    exitCode: 0, durationMs: elapsed(started) });
  return 0;
}

export function parseVerificationArguments(args) {
  const [profile, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--base-ref" && options.baseRef === undefined) {
      const baseRef = rest[++index];
      if (baseRef === undefined) throw new Error("--base-ref requires a value");
      options.baseRef = baseRef;
    } else if (argument === "--plan" && options.planOnly === undefined) {
      options.planOnly = true;
    } else {
      throw new Error("unknown or repeated verification option");
    }
  }
  createVerificationPlan(profile, options);
  return { profile, options };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { profile, options } = parseVerificationArguments(process.argv.slice(2));
    console.log(`[verify] ${JSON.stringify({ type: "runtime", node: process.version,
      platform: process.platform, arch: process.arch, availableParallelism: availableParallelism() })}`);
    process.exitCode = runVerification(profile, options);
  } catch (error) {
    console.error(`[verify] ${error instanceof Error ? error.message : "verification failed"}`);
    process.exitCode = 1;
  }
}
