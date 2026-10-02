import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

for (const route of [
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


test("the dashboard performs one server read and renders the experiment workspace", async () => {
  const source = await readFile(
    new URL("../src/app/dashboard/page.tsx", import.meta.url),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  });
  const ExperimentList = () => {};
  const pageData = { experimentList: { status: "offline", data: null } };
  let reads = 0;
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require(specifier) {
      if (specifier === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (specifier === "@/lib/dashboardViewModels") return {
        readExperimentListPageData: async () => { reads += 1; return pageData; }
      };
      assert.equal(specifier, "./ExperimentList");
      return { ExperimentList };
    }
  });
  const page = await exports.default();
  assert.equal(exports.dynamic, "force-dynamic");
  assert.equal(exports.revalidate, 0);
  assert.equal(reads, 1);
  assert.equal(page.type, ExperimentList);
  assert.equal(page.props.pageData, pageData);
  assert.doesNotMatch(source, /["']use client["']/);
});

test("the experiment workspace has one main, one heading, a skip link and all retained routes", async () => {
  const source = await readFile(
    new URL("../src/app/dashboard/ExperimentList.tsx", import.meta.url),
    "utf8"
  );
  assert.equal(source.match(/<main\b/g)?.length, 1);
  assert.equal(source.match(/<h1\b/g)?.length, 1);
  assert.match(source, /href="#experiments-main"/);
  assert.match(source, /id="experiments-main" tabIndex=\{-1\}/);
  for (const href of [
    "/dashboard", "/dashboard/lab/policies",
    "/dashboard/validation#candidate-comparison",
    "/dashboard/validation#data-universe-coverage",
    "/dashboard/operations", "/dashboard/portfolio",
    "/dashboard/lab/strategy-tests", "/dashboard/risk-gate",
    "/dashboard/audit", "/dashboard/live-readiness",
    "/dashboard/component-catalog"
  ]) assert.ok(source.includes(`href="${href}"`), `${href} remains available`);
  assert.match(source, /API가 선택한 batch \/ 최신 여부 미확인/);
  assert.doesNotMatch(source, /localStorage|setInterval|router\.refresh|fetch\(/);
});

test("mobile navigation closes on same-page links and restores focus on Escape", async () => {
  const source = await readFile(
    new URL("../src/app/dashboard/ExperimentList.tsx", import.meta.url),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  });
  const jsx = (type, props) => ({ type, props });
  const refs = [];
  let mainFocusCount = 0;
  let summaryFocusCount = 0;
  class Element {}
  class HTMLAnchorElement extends Element {
    constructor(href) { super(); this.href = href; }
    closest() { return this; }
  }
  const exports = {};
  runInNewContext(outputText, {
    exports, Element, HTMLAnchorElement, URL,
    window: { location: { origin: "http://localhost:3000", pathname: "/dashboard" } },
    document: { getElementById(id) {
      assert.equal(id, "experiments-main");
      return { focus(options) { assert.equal(options.preventScroll, true); mainFocusCount += 1; } };
    } },
    require(specifier) {
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (specifier === "react") return { useEffect() {}, useRef: () => refs.shift() ?? { current: null } };
      if (specifier === "next/navigation") return { useSearchParams: () => new URLSearchParams() };
      if (specifier === "next/link") return { default: () => {} };
      assert.equal(specifier, "./ExperimentList.module.css");
      return { default: {} };
    }
  });
  const workspace = exports.ExperimentList({ pageData: { experimentList: { status: "offline", data: null } } });
  const navigationComponent = workspace.props.children.find((child) => child.type?.name === "WorkspaceNavigation");
  const details = { open: true };
  refs.push({ current: details }, { current: { focus(options) { assert.equal(options.preventScroll, true); summaryFocusCount += 1; } } });
  const navigation = navigationComponent.type();
  const mobileMenu = navigation.props.children.find((child) => child.type === "details");
  const mobileNav = mobileMenu.props.children.find((child) => child.type === "nav");
  const link = new HTMLAnchorElement("http://localhost:3000/dashboard");
  const click = { button: 0, target: link, currentTarget: { contains: () => true } };
  mobileNav.props.onClick(click);
  assert.equal(details.open, false);
  assert.equal(mainFocusCount, 1);

  details.open = true;
  let prevented = false;
  let stopped = false;
  mobileMenu.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(details.open, false);
  assert.equal(summaryFocusCount, 1);
  assert.ok(prevented && stopped);

  details.open = true;
  mobileNav.props.onClick({ ...click, ctrlKey: true });
  assert.equal(details.open, true, "modified clicks keep native new-tab behavior");
  mobileNav.props.onClick({ ...click, target: new HTMLAnchorElement("http://localhost:3000/dashboard/operations") });
  assert.equal(details.open, false, "other destinations also close the menu");
  assert.equal(mainFocusCount, 1, "other-page navigation owns its next focus destination");
});

test("workspace normal text meets AA contrast on its actual default, hover, and selected surfaces", async () => {
  const css = await readFile(
    new URL("../src/app/dashboard/ExperimentList.module.css", import.meta.url),
    "utf8"
  );
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].trim().split(",").map((selector) => selector.trim()),
    declarations: match[2]
  }));
  function declaration(selector, property) {
    let value;
    for (const rule of rules) {
      if (!rule.selectors.includes(selector)) continue;
      const match = rule.declarations.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
      if (match) value = match[1].trim();
    }
    assert.ok(value, `missing CSS declaration ${selector}: ${property}`);
    const variable = value.match(/^var\((--[\w-]+)\)$/);
    return variable ? declaration(".workspace", variable[1]) : value;
  }
  function luminance(color) {
    assert.match(color, /^#[\da-f]{3}(?:[\da-f]{3})?$/i, `expected opaque text/surface color, got ${color}`);
    const hex = color.length === 4 ? color.slice(1).split("").map((digit) => digit + digit).join("") : color.slice(1);
    const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  const foreground = (selector, property = "color") => declaration(selector, property);
  const background = (selector) => declaration(selector, "background");
  const canvas = background(".workspace");
  const white = background(".sidebar");
  const rowHover = background(".table tbody tr:hover");
  const checks = [];
  function check(label, color, surfaces) {
    for (const surface of surfaces) checks.push({ label, color, surface });
  }

  // Actual text colors are read from CSS, so a later token or state edit cannot
  // silently keep passing a regression test built from old hard-coded colors.
  check("workspace body", foreground(".workspace"), [canvas, white]);
  for (const selector of [".sourceLabel", ".actionGroup p", ".sourceSummary", ".listMeta", ".brand span", ".operationsLinks a"]) {
    check(selector, foreground(selector), [canvas, white]);
  }
  check("navigation", foreground(".navLink"), [white, background(".navLink:hover")]);
  check("selected navigation", foreground(".navCurrent"), [background(".navCurrent"), background(".navCurrent:hover")]);
  check("operation disclosure", foreground(".operationsMenu summary"), [white, background(".operationsMenu summary:hover")]);
  check("operation link hover", foreground(".operationsLinks a:hover"), [background(".operationsLinks a:hover")]);
  check("primary action", foreground(".primaryAction"), [background(".primaryAction"), background(".primaryAction:hover")]);
  check("skip link", foreground(".skipLink"), [background(".skipLink")]);
  for (const selector of [".batchLine strong", ".sourceCounts strong", ".snapshotNotice", ".listMeta strong", ".listMeta span", ".pageFooter"]) {
    check(selector, foreground(selector), [canvas]);
  }
  for (const selector of [".sourceNotice", ".compactWarning"]) {
    check(selector, foreground(selector), [background(selector)]);
  }
  check("diagnostic disclosure", foreground(".diagnostics summary"), [canvas]);
  for (const selector of [".diagnosticBody", ".diagnosticBody dt", ".diagnosticBody dd"]) {
    check(selector, foreground(selector), [background(".diagnosticBody")]);
  }
  check("search input", foreground(".filters input"), [background(".filters input")]);
  check("search placeholder", foreground(".filters input::placeholder"), [background(".filters input")]);
  check("status select", foreground(".filters select"), [background(".filters select")]);
  check("search action", foreground(".searchButton"), [background(".searchButton"), background(".searchButton:hover")]);
  check("clear filters", foreground(".clearButton"), [canvas, background(".clearButton:hover")]);
  for (const selector of [".table th", ".table td", ".runLink", ".runLink:hover", ".provenance", ".windowEnd", ".unknown", ".table .windowCell", ".table .timeCell", ".table .resultsCell"]) {
    check(selector, foreground(selector), [white, rowHover]);
  }
  for (const state of ["running", "completed", "completed_with_failures", "failed"]) {
    const selector = `.status_${state}`;
    check(selector, foreground(selector), [white, rowHover, background(selector)]);
  }
  check("skipped status", foreground(".status_skipped"), [white, rowHover, background(".status")]);
  check("empty state title", foreground(".emptyState h2"), [white]);
  check("empty state text", foreground(".emptyState p"), [white]);
  check("secondary action", foreground(".secondaryAction"), [background(".secondaryAction")]);
  check("table footer", foreground(".tableFooter"), [white, canvas]);

  for (const { label, color, surface } of checks) {
    const values = [luminance(color), luminance(surface)].sort((a, b) => a - b);
    const ratio = (values[1] + 0.05) / (values[0] + 0.05);
    assert.ok(ratio >= 4.5, `${label}: ${color} on ${surface} is ${ratio.toFixed(3)}:1; expected at least 4.5:1`);
  }
});
