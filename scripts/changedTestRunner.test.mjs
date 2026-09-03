import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRepoPath,
  planChangedTests,
  readModuleSpecifiers
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
