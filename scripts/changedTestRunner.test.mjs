import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRepoPath,
  planChangedTests,
  readModuleSpecifiers,
  readRuntimeEntrypointReferences,
  readSourceFileReferences
} from "./changedTestRunner.mjs";

test("selects tests that directly import a changed module", () => {
  const plan = planChangedTests({
    changedPaths: ["src/feature.ts"],
    sourceFiles: sourceFiles()
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, ["src/feature.test.ts"]);
});

test("selects transitive dependents and excludes unrelated tests", () => {
  const plan = planChangedTests({
    changedPaths: ["src/core.ts"],
    sourceFiles: sourceFiles()
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, [
    "src/feature.test.ts",
    "src/service.test.ts"
  ]);
});

test("selects a changed test file itself", () => {
  const plan = planChangedTests({
    changedPaths: ["src/other.test.ts"],
    sourceFiles: sourceFiles()
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, ["src/other.test.ts"]);
});

test("supports re-exports and dynamic imports", () => {
  const plan = planChangedTests({
    changedPaths: ["src/lazy.ts"],
    sourceFiles: {
      "src/lazy.ts": "export const value = 1;",
      "src/barrel.ts": 'export { value } from "./lazy.js";',
      "src/lazy.test.ts":
        'import test from "node:test"; void import("./barrel.js");'
    }
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, ["src/lazy.test.ts"]);
});

test("selects tests that launch a dependent compiled CLI", () => {
  const plan = planChangedTests({
    changedPaths: ["src/config/loadEnv.ts"],
    sourceFiles: {
      "src/config/loadEnv.ts": "export const loadEnv = () => ({});",
      "src/config/loadEnv.test.ts": 'import "./loadEnv.js";',
      "src/cli/tool.ts": 'import "../config/loadEnv.js";',
      "src/cli/toolCli.test.ts": `
        import { join } from "node:path";
        import { spawnSync } from "node:child_process";
        spawnSync(process.execPath, [join("dist", "cli", "tool.js")]);
      `
    }
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, [
    "src/cli/toolCli.test.ts",
    "src/config/loadEnv.test.ts"
  ]);
});

test("detects compiled entry points embedded in worker source", () => {
  assert.deepEqual(
    readRuntimeEntrypointReferences(`
      const worker = \`
        import { Repository } from "./dist/portfolio/repository.js";
      \`;
    `),
    ["src/portfolio/repository.ts"]
  );
});

test("selects safety tests that inspect source files as data", () => {
  const plan = planChangedTests({
    changedPaths: ["src/api/server.ts"],
    sourceFiles: {
      "src/api/server.ts": "export const methods = ['GET'];",
      "src/api/server.test.ts": 'import "./server.js";',
      "src/replay/safety.test.ts": `
        import { readFile } from "node:fs/promises";
        for (const path of ["src/api/server.ts"]) await readFile(path, "utf8");
      `
    }
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, [
    "src/api/server.test.ts",
    "src/replay/safety.test.ts"
  ]);
});

test("resolves repository-root and relative source-file references", () => {
  assert.deepEqual(
    readSourceFileReferences(
      `
        const root = "src/api/server.ts";
        const relative = "../portfolio/policy.ts";
      `,
      "src/replay/safety.test.ts"
    ),
    ["src/api/server.ts", "src/portfolio/policy.ts"]
  );
});

test("resolves dependents of a deleted source module", () => {
  const plan = planChangedTests({
    changedPaths: ["src/deleted.ts"],
    sourceFiles: {
      "src/consumer.ts": 'import "./deleted.js";',
      "src/consumer.test.ts": 'import "./consumer.js";'
    }
  });

  assert.equal(plan.mode, "selected");
  assert.deepEqual(plan.testFiles, ["src/consumer.test.ts"]);
});

test("documentation-only changes skip Node tests", () => {
  const plan = planChangedTests({
    changedPaths: ["README.md", "docs/testing.md"],
    sourceFiles: sourceFiles()
  });

  assert.equal(plan.mode, "none");
  assert.deepEqual(plan.testFiles, []);
});

test("tooling and configuration changes fall back to the full suite", () => {
  for (const changedPath of ["package.json", "scripts/tool.mjs", "tsconfig.json"]) {
    const plan = planChangedTests({
      changedPaths: [changedPath],
      sourceFiles: sourceFiles()
    });

    assert.equal(plan.mode, "full");
    assert.deepEqual(plan.testFiles, [
      "src/feature.test.ts",
      "src/other.test.ts",
      "src/service.test.ts"
    ]);
  }
});

test("unresolved source impact falls back to the full suite", () => {
  const plan = planChangedTests({
    changedPaths: ["src/unreferenced.ts"],
    sourceFiles: {
      ...sourceFiles(),
      "src/unreferenced.ts": "export const value = 1;"
    }
  });

  assert.equal(plan.mode, "full");
  assert.match(plan.reasons.join("\n"), /unresolved source impact/);
});

test("large selected sets fall back before exceeding command limits", () => {
  const plan = planChangedTests({
    changedPaths: ["src/core.ts"],
    sourceFiles: sourceFiles(),
    maximumSelectedTests: 1
  });

  assert.equal(plan.mode, "full");
  assert.match(plan.reasons.join("\n"), /selected test count/);
});

test("module parsing and path normalization preserve repository identity", () => {
  assert.deepEqual(
    readModuleSpecifiers(
      'import "./a.js"; export * from "./b.js"; void import("./c.js");'
    ),
    ["./a.js", "./b.js", "./c.js"]
  );
  assert.equal(normalizeRepoPath(".\\src\\feature.ts"), "src/feature.ts");
  assert.equal(normalizeRepoPath("../outside/file.ts"), "../outside/file.ts");
});

function sourceFiles() {
  return {
    "src/core.ts": "export const core = 1;",
    "src/feature.ts": 'import { core } from "./core.js"; export { core };',
    "src/service.ts": 'import { core } from "./core.js"; export { core };',
    "src/feature.test.ts": 'import "./feature.js";',
    "src/service.test.ts": 'import "./service.js";',
    "src/other.test.ts": 'import test from "node:test";'
  };
}
