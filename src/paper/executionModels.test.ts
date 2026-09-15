import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { preparePaperApplication, verifyPreparedPaperApplication } from "./preparedApplication.js";
import { PaperOrderEngine } from "./orderEngine.js";
import { VirtualRiskEngine } from "./riskEngine.js";

const root = fileURLToPath(new URL("../../src/paper/executionModels/v1/", import.meta.url));

test("v1 intents remain readable and reproducible after the current order and risk engines evolve", (context) => {
  const golden: Record<string, unknown> = JSON.parse(readFileSync(resolve(root, "golden.json"), "utf8"));
  context.mock.method(PaperOrderEngine.prototype, "execute", () => { throw new Error("current engine has evolved"); });
  context.mock.method(VirtualRiskEngine.prototype, "evaluate", () => { throw new Error("current Risk has evolved"); });
  for (const value of Object.values(golden)) {
    const record = verifyPreparedPaperApplication(value);
    assert.deepEqual(preparePaperApplication({ expectedSnapshot: record.expectedSnapshot, packet: record.packet,
      providerDecision: record.providerDecision, evaluatedAt: record.evaluatedAt, decisionSummary: record.decisionSummary }), value);
  }
  assert.throws(() => verifyPreparedPaperApplication({ ...golden.buy as object, executionModelVersion: "paper_order_engine.v2" }));
});

test("frozen v1 sources match their manifest and cannot import current application code", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as {
    modelVersion: string; sourceCommit: string; files: Record<string, string>;
  };
  assert.equal(manifest.modelVersion, "paper_order_engine.v1");
  assert.equal(manifest.sourceCommit, "947e77e3fe32ac07a1a8ec7ba0f4f22fc7e1e544");
  const actualFiles: string[] = [];
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith(".ts")) actualFiles.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  collect(root); assert.deepEqual(actualFiles.sort(), Object.keys(manifest.files).sort());
  for (const [name, hash] of Object.entries(manifest.files)) {
    const path = resolve(root, name), source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    assert.equal(createHash("sha256").update(source).digest("hex"), hash, name);
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const check = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = node.moduleSpecifier.text;
        if (target.startsWith(".")) {
          const dependency = relative(root, resolve(dirname(path), target.replace(/\.js$/, ".ts"))).replaceAll("\\", "/");
          assert.ok(Object.hasOwn(manifest.files, dependency), `${name} escapes frozen v1: ${target}`);
        } else assert.ok(["zod", "node:crypto", "node:util"].includes(target), `${name}: unexpected runtime dependency ${target}`);
      }
      if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "no dynamic imports in frozen replay");
      ts.forEachChild(node, check);
    };
    check(ast);
  }
});
