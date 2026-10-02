import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

for (const route of [
  { file: "page.tsx", overviewImport: "./OperationsOverview" },
  { file: "operations/page.tsx", overviewImport: "../OperationsOverview" }
]) {
  test(`${route.file} delegates to the shared uncached operations overview`, async () => {
    const source = await readFile(
      new URL(`../src/app/dashboard/${route.file}`, import.meta.url),
      "utf8"
    );
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    });
    const OperationsOverview = () => {};
    const exports = {};
    const imports = [];
    runInNewContext(outputText, {
      exports,
      require(specifier) {
        imports.push(specifier);
        if (specifier === "react/jsx-runtime") {
          return { jsx: (type, props) => ({ type, props }) };
        }
        assert.equal(specifier, route.overviewImport);
        return { OperationsOverview };
      }
    });

    assert.equal(exports.dynamic, "force-dynamic");
    assert.equal(exports.revalidate, 0);
    const page = exports.default();
    assert.equal(page.type, OperationsOverview);
    assert.deepEqual(Object.keys(page.props), []);
    assert.deepEqual(
      imports.sort(),
      [route.overviewImport, "react/jsx-runtime"].sort()
    );
    assert.doesNotMatch(source, /["']use client["']/);
  });
}

test("the shared overview keeps one server-side ViewModel read and its existing landmarks", async () => {
  const source = await readFile(
    new URL("../src/app/dashboard/OperationsOverview.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /export async function OperationsOverview\(\)/);
  assert.doesNotMatch(source, /["']use client["']/);
  assert.equal(source.match(/await readDashboardViewModels\(\)/g)?.length, 1);
  assert.equal(source.match(/<main\b/g)?.length, 1);
  assert.equal(source.match(/<h1\b/g)?.length, 1);
  assert.match(source, /Paper-only Dashboard/);
  assert.match(source, /<RiskGateTracePanel result=\{viewModels.riskGate\}/);
  assert.match(source, /<ValidationLabPanel result=\{viewModels.validationLab\}/);
  assert.deepEqual(
    [...source.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    [
      "/dashboard/portfolio",
      "/dashboard/lab/policies",
      "/dashboard/lab/strategy-tests",
      "/dashboard/live-readiness",
      "/dashboard/risk-gate",
      "/dashboard/validation",
      "/dashboard/audit",
      "/dashboard/component-catalog"
    ]
  );
});
