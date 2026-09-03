#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fullTestGlob = "dist/**/*.test.js";
const defaultMaximumSelectedTests = 120;

/**
 * Builds a conservative test plan from changed repository paths.
 *
 * Source changes select every test that directly or transitively imports the
 * changed module. Documentation-only changes need no Node test. Any path whose
 * impact cannot be proven (tooling, config, non-TypeScript source, or an
 * unreferenced source module) falls back to the complete suite.
 */
export function planChangedTests(input) {
  const maximumSelectedTests =
    input.maximumSelectedTests ?? defaultMaximumSelectedTests;
  if (!Number.isSafeInteger(maximumSelectedTests) || maximumSelectedTests <= 0) {
    throw new Error("maximumSelectedTests must be a positive safe integer");
  }

  const sourceFiles = normalizeSourceFiles(input.sourceFiles);
  const allTests = [...sourceFiles.keys()]
    .filter(isTestSourcePath)
    .sort(compareText);
  const changedPaths = [...new Set(input.changedPaths.map(normalizeRepoPath))]
    .filter((path) => path.length > 0)
    .sort(compareText);
  const changedSources = [];
  const fullReasons = [];

  for (const path of changedPaths) {
    if (isDocumentationPath(path)) {
      continue;
    }
    if (!path.startsWith("src/")) {
      fullReasons.push(`non-source change: ${path}`);
      continue;
    }
    if (!path.endsWith(".ts")) {
      fullReasons.push(`non-TypeScript source change: ${path}`);
      continue;
    }
    changedSources.push(path);
  }

  if (fullReasons.length > 0) {
    return fullPlan(allTests, changedPaths, fullReasons);
  }
  if (changedSources.length === 0) {
    return Object.freeze({
      mode: "none",
      changedPaths: Object.freeze(changedPaths),
      testFiles: Object.freeze([]),
      reasons: Object.freeze(["documentation-only or no changes"])
    });
  }

  const reverseDependencies = buildReverseDependencyGraph(sourceFiles);
  const affectedFiles = new Set(changedSources);
  const pending = [...changedSources];
  while (pending.length > 0) {
    const dependency = pending.pop();
    if (dependency === undefined) {
      continue;
    }
    for (const dependent of reverseDependencies.get(dependency) ?? []) {
      if (!affectedFiles.has(dependent)) {
        affectedFiles.add(dependent);
        pending.push(dependent);
      }
    }
  }

  const selectedTests = allTests.filter((path) => affectedFiles.has(path));
  const unresolvedSources = changedSources.filter(
    (path) => !hasAffectedTest(path, reverseDependencies, allTests)
  );
  if (unresolvedSources.length > 0) {
    return fullPlan(
      allTests,
      changedPaths,
      unresolvedSources.map((path) => `unresolved source impact: ${path}`)
    );
  }
  if (selectedTests.length > maximumSelectedTests) {
    return fullPlan(allTests, changedPaths, [
      `selected test count ${selectedTests.length} exceeds ${maximumSelectedTests}`
    ]);
  }

  return Object.freeze({
    mode: "selected",
    changedPaths: Object.freeze(changedPaths),
    testFiles: Object.freeze(selectedTests),
    reasons: Object.freeze([
      `${selectedTests.length} transitive test file(s) selected`
    ])
  });
}

export function buildReverseDependencyGraph(sourceFilesInput) {
  const sourceFiles = normalizeSourceFiles(sourceFilesInput);
  const sourcePaths = new Set(sourceFiles.keys());
  const reverse = new Map();
  for (const [importer, source] of sourceFiles) {
    for (const specifier of readModuleSpecifiers(source, importer)) {
      const dependency = resolveInternalModule(importer, specifier, sourcePaths);
      if (dependency === undefined) {
        continue;
      }
      const dependents = reverse.get(dependency) ?? new Set();
      dependents.add(importer);
      reverse.set(dependency, dependents);
    }
    if (isTestSourcePath(importer)) {
      const testReferences = new Set([
        ...readRuntimeEntrypointReferences(source, importer),
        ...readSourceFileReferences(source, importer)
      ]);
      for (const dependency of testReferences) {
        const dependents = reverse.get(dependency) ?? new Set();
        dependents.add(importer);
        reverse.set(dependency, dependents);
      }
    }
  }
  return reverse;
}

export function readModuleSpecifiers(source, fileName = "source.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return Object.freeze(specifiers);
}

/**
 * Finds compiled internal entry points launched or imported by a test at
 * runtime. These references do not appear in the TypeScript import graph, but
 * the test still depends on the corresponding source module.
 */
export function readRuntimeEntrypointReferences(
  source,
  fileName = "source.test.ts"
) {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const references = new Set();
  const collectText = (value) => {
    for (const match of value.matchAll(
      /(?:^|[.][/\\])dist[/\\]([A-Za-z0-9_./\\-]+\.(?:js|mjs|cjs))/g
    )) {
      const sourcePath = compiledPathToSourcePath(`dist/${match[1]}`);
      if (sourcePath !== undefined) {
        references.add(sourcePath);
      }
    }
  };
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) {
      collectText(node.text);
    }
    if (ts.isCallExpression(node)) {
      const literalArguments = node.arguments.map((argument) =>
        ts.isStringLiteralLike(argument) ? argument.text : undefined
      );
      const distIndex = literalArguments.findIndex(
        (argument) => argument === "dist"
      );
      if (
        distIndex >= 0 &&
        literalArguments.slice(distIndex).every((argument) => argument !== undefined)
      ) {
        const sourcePath = compiledPathToSourcePath(
          literalArguments.slice(distIndex).join("/")
        );
        if (sourcePath !== undefined) {
          references.add(sourcePath);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return Object.freeze([...references].sort(compareText));
}

/**
 * Finds source files inspected as test data instead of imported as modules.
 * Safety-contract tests use this pattern to scan implementation text for
 * forbidden runtime surfaces.
 */
export function readSourceFileReferences(source, fileName = "source.test.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const references = new Set();
  const collectText = (value) => {
    const normalized = normalizeRepoPath(value);
    if (isSourceImplementationPath(normalized)) {
      references.add(normalized);
    } else if (
      (value.startsWith("./") || value.startsWith("../")) &&
      isSourceImplementationPath(
        normalizeRepoPath(join(dirname(fileName), value))
      )
    ) {
      references.add(normalizeRepoPath(join(dirname(fileName), value)));
    }
  };
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) {
      collectText(node.text);
    }
    if (ts.isCallExpression(node)) {
      const literalArguments = node.arguments.map((argument) =>
        ts.isStringLiteralLike(argument) ? argument.text : undefined
      );
      const sourceIndex = literalArguments.findIndex(
        (argument) => argument === "src"
      );
      if (
        sourceIndex >= 0 &&
        literalArguments
          .slice(sourceIndex)
          .every((argument) => argument !== undefined)
      ) {
        collectText(literalArguments.slice(sourceIndex).join("/"));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return Object.freeze([...references].sort(compareText));
}

export function normalizeRepoPath(value) {
  if (typeof value !== "string") {
    throw new Error("repository path must be a string");
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = [];
  let leadingParents = 0;
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        leadingParents += 1;
        continue;
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return [...Array.from({ length: leadingParents }, () => ".."), ...segments].join(
    "/"
  );
}

function hasAffectedTest(source, reverseDependencies, allTests) {
  const testSet = new Set(allTests);
  const visited = new Set([source]);
  const pending = [source];
  while (pending.length > 0) {
    const dependency = pending.pop();
    if (dependency === undefined) {
      continue;
    }
    if (testSet.has(dependency)) {
      return true;
    }
    for (const dependent of reverseDependencies.get(dependency) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        pending.push(dependent);
      }
    }
  }
  return false;
}

function resolveInternalModule(importer, specifier, sourcePaths) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = normalizeRepoPath(join(dirname(importer), specifier));
  const extension = extname(base);
  const candidates = [];
  if (extension === ".js") {
    candidates.push(`${base.slice(0, -3)}.ts`);
  } else if (extension === ".mjs") {
    candidates.push(`${base.slice(0, -4)}.mts`);
  } else if (extension === ".cjs") {
    candidates.push(`${base.slice(0, -4)}.cts`);
  } else if (extension === ".ts" || extension === ".mts" || extension === ".cts") {
    candidates.push(base);
  } else if (extension.length === 0) {
    candidates.push(`${base}.ts`, `${base}/index.ts`);
  }
  const existing = candidates.find((path) => sourcePaths.has(path));
  return existing ?? candidates[0];
}

function compiledPathToSourcePath(value) {
  const normalized = normalizeRepoPath(value);
  if (!normalized.startsWith("dist/")) {
    return undefined;
  }
  if (normalized.endsWith(".mjs")) {
    return `src/${normalized.slice(5, -4)}.mts`;
  }
  if (normalized.endsWith(".cjs")) {
    return `src/${normalized.slice(5, -4)}.cts`;
  }
  if (normalized.endsWith(".js")) {
    return `src/${normalized.slice(5, -3)}.ts`;
  }
  return undefined;
}

function normalizeSourceFiles(values) {
  const entries = values instanceof Map ? [...values] : Object.entries(values);
  const files = new Map();
  for (const [path, source] of entries) {
    if (typeof source !== "string") {
      throw new Error(`source content must be a string: ${path}`);
    }
    files.set(normalizeRepoPath(path), source);
  }
  return files;
}

function isTestSourcePath(path) {
  return path.startsWith("src/") && path.endsWith(".test.ts");
}

function isSourceImplementationPath(path) {
  return (
    path.startsWith("src/") &&
    (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts"))
  );
}

function isDocumentationPath(path) {
  return path.endsWith(".md");
}

function fullPlan(allTests, changedPaths, reasons) {
  return Object.freeze({
    mode: "full",
    changedPaths: Object.freeze([...changedPaths]),
    testFiles: Object.freeze([...allTests]),
    reasons: Object.freeze([...reasons])
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readRepositorySourceFiles() {
  const files = new Map();
  const visit = (absoluteDirectory) => {
    for (const entry of readdirSync(absoluteDirectory, {
      withFileTypes: true
    })) {
      const absolutePath = join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.set(
          normalizeRepoPath(relative(repoRoot, absolutePath)),
          readFileSync(absolutePath, "utf8")
        );
      }
    }
  };
  visit(join(repoRoot, "src"));
  return files;
}

function collectChangedPaths(baseRef) {
  const mergeBase = git(["merge-base", "HEAD", baseRef]).trim();
  if (mergeBase.length === 0) {
    throw new Error(`cannot resolve merge base for ${baseRef}`);
  }
  const paths = new Set();
  for (const args of [
    ["diff", "--name-only", "-z", "--diff-filter=ACMRD", `${mergeBase}...HEAD`],
    ["diff", "--name-only", "-z", "--diff-filter=ACMRD"],
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRD"],
    ["ls-files", "--others", "--exclude-standard", "-z"]
  ]) {
    for (const path of git(args).split("\0")) {
      if (path.length > 0) {
        paths.add(normalizeRepoPath(path));
      }
    }
  }
  return [...paths].sort(compareText);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function parseCliArguments(args) {
  let baseRef = process.env.CHANGED_TEST_BASE_REF ?? "origin/main";
  let planOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--plan") {
      planOnly = true;
    } else if (argument === "--base-ref") {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("--base-ref requires a value");
      }
      baseRef = value;
      index += 1;
    } else {
      throw new Error(`unknown changed-test option: ${argument}`);
    }
  }
  return { baseRef, planOnly };
}

function toCompiledTestPath(sourcePath) {
  return sourcePath.replace(/^src\//, "dist/").replace(/\.ts$/, ".js");
}

function runTestPlan(plan, baseRef, planOnly) {
  console.log(
    `[test:changed] base=${baseRef} changed=${plan.changedPaths.length} mode=${plan.mode} tests=${plan.testFiles.length}`
  );
  for (const reason of plan.reasons) {
    console.log(`[test:changed] reason=${reason}`);
  }
  const preview = plan.testFiles.slice(0, 20);
  for (const testFile of preview) {
    console.log(`[test:changed] test=${testFile}`);
  }
  if (plan.testFiles.length > preview.length) {
    console.log(
      `[test:changed] ... ${plan.testFiles.length - preview.length} more test file(s)`
    );
  }
  if (planOnly || plan.mode === "none") {
    return 0;
  }

  const testArguments =
    plan.mode === "full"
      ? ["--test", fullTestGlob]
      : ["--test", ...plan.testFiles.map(toCompiledTestPath)];
  for (const path of testArguments.slice(1)) {
    if (path === fullTestGlob) {
      continue;
    }
    if (!existsSync(join(repoRoot, path))) {
      console.error(`[test:changed] compiled test is missing: ${path}`);
      return 1;
    }
  }
  const result = spawnSync(process.execPath, testArguments, {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return result.status ?? 1;
}

function main() {
  const { baseRef, planOnly } = parseCliArguments(process.argv.slice(2));
  let plan;
  try {
    plan = planChangedTests({
      changedPaths: collectChangedPaths(baseRef),
      sourceFiles: readRepositorySourceFiles()
    });
  } catch (error) {
    console.error(
      `[test:changed] impact analysis failed; running full suite: ${error instanceof Error ? error.message : String(error)}`
    );
    plan = fullPlan(
      [...readRepositorySourceFiles().keys()]
        .filter(isTestSourcePath)
        .sort(compareText),
      [],
      ["impact analysis failure"]
    );
  }
  process.exitCode = runTestPlan(plan, baseRef, planOnly);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
