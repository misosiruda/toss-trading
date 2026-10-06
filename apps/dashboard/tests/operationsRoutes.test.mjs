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

test("mobile navigation closes on focus exit and links while preserving internal focus and Escape", async () => {
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
      if (specifier === "react") return { useEffect() {}, useState: (initial) => [initial, () => {}], useRef: (initial) => refs.shift() ?? { current: initial } };
      if (specifier === "next/navigation") return { useSearchParams: () => new URLSearchParams() };
      if (specifier === "next/link") return { default: () => {} };
      assert.equal(specifier, "./ExperimentList.module.css");
      return { default: {} };
    }
  });
  const workspace = exports.ExperimentList({ pageData: { experimentList: { status: "offline", data: null } } });
  const navigationComponent = workspace.props.children.find((child) => child.type?.name === "WorkspaceNavigation");
  const insideTarget = {};
  const details = { open: true, contains: (target) => target === insideTarget };
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

  details.open = true;
  mobileMenu.props.onBlur({ currentTarget: details, relatedTarget: insideTarget });
  assert.equal(details.open, true, "focus within the menu must not collapse it");
  mobileMenu.props.onBlur({ currentTarget: details, relatedTarget: {} });
  assert.equal(details.open, false, "forward or reverse Tab outside the overlay must expose its destination");
  details.open = true;
  mobileMenu.props.onBlur({ currentTarget: details, relatedTarget: null });
  assert.equal(details.open, false, "leaving the document also dismisses the overlay");
  mobileMenu.props.onBlur({ currentTarget: details, relatedTarget: {} });
  assert.equal(details.open, false, "an already closed menu stays closed");
  assert.equal(mainFocusCount, 1, "focus exit never redirects focus to the main container");
  assert.equal(summaryFocusCount, 1, "only Escape explicitly restores the trigger focus");
});

test("the retained operations destination uses a native document link after report history", async () => {
  const h = await experimentFilterHarness();
  const navigation = h.find("WorkspaceNavigation").type();
  const operations = h.findWithin(navigation, "OperationsLinks");
  const links = operations.type().props.children.find((child) => child?.type === "div").props.children;
  const overview = links.find((link) => link.props.href === "/dashboard/operations");
  assert.equal(overview.type, "a");
  assert.equal(overview.props.children, "기존 운영 요약");
  assert.equal(overview.props.onClick, undefined, "browser owns the document navigation");
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
  check("visible observation clocks", foreground(".observationTimes"), [canvas, background(".sourceNotice")]);
  check("batch identity in diagnostics", foreground(".batchLine strong"), [background(".diagnosticBody")]);
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
  check("source jump", foreground(".sourceJump"), [canvas, background(".sourceJump:hover")]);
  check("source return", foreground(".sourceReturn"), [background(".sourceReturn"), background(".sourceReturn:hover")]);
  check("table footer", foreground(".tableFooter"), [white, canvas]);

  for (const { label, color, surface } of checks) {
    const values = [luminance(color), luminance(surface)].sort((a, b) => a - b);
    const ratio = (values[1] + 0.05) / (values[0] + 0.05);
    assert.ok(ratio >= 4.5, `${label}: ${color} on ${surface} is ${ratio.toFixed(3)}:1; expected at least 4.5:1`);
  }
});

test("a deferred initial effect cannot overwrite a newer filter URL or selection", async () => {
  const harness = await experimentFilterHarness();
  harness.select.value = "running";
  harness.statusControl.props.onChange({ currentTarget: harness.select });
  assert.equal(harness.location.search, "?status=running");
  harness.effects[0]();
  assert.equal(harness.location.search, "?status=running");
  assert.equal(harness.select.value, "running");
});

test("an initial unchanged-URL effect preserves an unsubmitted search draft and early native selection", async () => {
  const harness = await experimentFilterHarness();
  harness.input.value = "new unsubmitted draft";
  harness.select.value = "failed";
  harness.effects[0]();
  assert.equal(harness.location.search, "");
  assert.equal(harness.input.value, "new unsubmitted draft");
  assert.equal(harness.select.value, "failed");
});

test("deferred effects follow the latest Back/Forward URL and stop writing after route departure", async () => {
  const harness = await experimentFilterHarness("?q=first&status=completed");
  harness.navigate("/dashboard?q=second&status=failed");
  harness.effects[0]();
  assert.equal(harness.location.search, "?q=second&status=failed");
  assert.equal(harness.input.value, "second");
  assert.equal(harness.select.value, "failed");
  harness.navigate("/dashboard?q=first&status=completed");
  harness.effects[0]();
  assert.equal(harness.input.value, "first");
  assert.equal(harness.select.value, "completed");
  harness.navigate("/dashboard/validation#candidate-comparison");
  harness.effects[0]();
  assert.equal(harness.location.pathname + harness.location.search + harness.location.hash, "/dashboard/validation#candidate-comparison");
});

async function experimentFilterHarness(search = "", pageData = null) {
  const source = await readFile(new URL("../src/app/dashboard/ExperimentList.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  });
  const input = { value: new URLSearchParams(search).get("q") ?? "", focus(options) { assert.equal(options.preventScroll, true); focusEvents.push("experiment-query"); } };
  const select = { value: new URLSearchParams(search).get("status") ?? "all" };
  const refs = [{ current: input }, { current: select }];
  const effects = [];
  const readiness = [];
  const focusEvents = [];
  const focusOptions = [];
  const historyWrites = [];
  const listeners = new Map();
  const jsx = (type, props) => ({ type, props });
  const window = { location: new URL(`http://localhost:3000/dashboard${search}`), addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: (type) => listeners.delete(type) };
  const navigate = (destination) => { window.location = new URL(destination, window.location); };
  window.history = Object.fromEntries(["pushState", "replaceState"].map((method) => [method, (state, _unused, destination) => {
    historyWrites.push({ method, state, destination });
    navigate(destination);
  }]));
  const exports = {};
  runInNewContext(outputText, {
    exports, window, URL, URLSearchParams,
    document: { getElementById: (id) => ({ focus(options) { focusOptions.push(options); focusEvents.push(id); } }) },
    require(specifier) {
      if (specifier === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (specifier === "react") return { useEffect: (effect) => effects.push(effect), useState: (initial) => [initial, (ready) => readiness.push(ready)], useRef: (initial) => refs.shift() ?? { current: initial } };
      if (specifier === "next/navigation") return { useSearchParams: () => new URLSearchParams(search) };
      if (specifier === "next/link") return { default: () => {} };
      assert.equal(specifier, "./ExperimentList.module.css");
      return { default: {} };
    }
  });
  const tree = exports.ExperimentList({ pageData: pageData ?? { experimentList: { status: "offline", data: null } } });
  function find(node, type) {
    if (!node || typeof node !== "object") return null;
    if (node.type === type || node.type?.name === type) return node;
    return [node.props?.children].flat().map((child) => find(child, type)).find(Boolean) ?? null;
  }
  return { input, select, effects, readiness, focusEvents, focusOptions, historyWrites, listeners, tree, findWithin: find, find: (type) => find(tree, type), statusControl: find(tree, "select"), navigate, get location() { return window.location; } };
}


test("server filter controls stay disabled until URL normalization is committed", async () => {
  const harness = await experimentFilterHarness("?q=%20ready%20&status=unexpected");
  const form = harness.find("form");
  const controls = form.props.children.flat().filter((child) => child?.type === "button" || child?.type === "select");
  controls.push(harness.find("input"));
  assert.equal(controls.length, 4);
  assert.ok(controls.every((control) => control.props.disabled === true));
  assert.equal(form.props["aria-busy"], true);
  assert.deepEqual(harness.readiness, []);
  harness.effects[0]();
  assert.equal(harness.location.search, "?q=ready");
  assert.deepEqual(harness.readiness, [true]);
});

test("observation clocks are outside the collapsed diagnostics and report fragments use native anchors", async () => {
  const pageData = {
    fetchedAt: "2026-10-02T22:00:00Z",
    experimentList: { status: "ok", data: {
      rows: [], warnings: [], endpointStatus: "ok", batchId: "stored-batch",
      batchUpdatedAt: "2026-10-01T12:30:00Z", count: 2, totalCount: 5,
      projectedTerminalCount: 2, projectedActiveCount: 0,
      excludedRowCount: 0, corruptLineCount: 0, aggregateStatus: "ok", activeRunProgressStatus: "missing"
    } }
  };
  const harness = await experimentFilterHarness("", pageData);
  const source = harness.find("SourceSummary");
  const summary = source.type(source.props);
  const clocks = summary.props.children.find((child) => child?.type?.name === "ObservationTimes");
  assert.equal(clocks.props.fetchedAt, pageData.fetchedAt);
  assert.equal(clocks.props.batchUpdatedAt, pageData.experimentList.data.batchUpdatedAt);
  assert.ok(summary.props.children.every((child) => child?.type !== "details"));
  const mainChildren = harness.find("main").props.children;
  const listIndex = mainChildren.findIndex((child) => child?.props?.["data-testid"] === "experiment-list");
  const detailIndex = mainChildren.findIndex((child) => child?.type?.name === "SourceDetails");
  assert.ok(detailIndex > listIndex, "expanded diagnostics cannot push the first experiment row down");
  const uiSource = await readFile(new URL("../src/app/dashboard/ExperimentList.tsx", import.meta.url), "utf8");
  assert.deepEqual([...uiSource.matchAll(/<a[^>]+href="(\/dashboard\/validation#[^"]+)"/g)].map((match) => match[1]), [
    "/dashboard/validation#candidate-comparison", "/dashboard/validation#data-universe-coverage"
  ]);
});


test("source jump and return preserve native history and explicitly restore fragment focus", async () => {
  const pageData = { fetchedAt: "2026-10-02T22:00:00Z", experimentList: { status: "ok", data: {
    rows: [], warnings: [], endpointStatus: "ok", batchId: "stored-batch", batchStatus: "completed",
    batchUpdatedAt: "2026-10-01T12:30:00Z", count: 0, totalCount: 0, requestedRunCount: 0,
    projectedTerminalCount: 0, projectedActiveCount: 0, excludedRowCount: 0, corruptLineCount: 0,
    aggregateStatus: "ok", activeRunProgressStatus: "missing", statusCounts: {}, unknownStatusCount: 0,
    manifestCounts: { completed: 0, failed: 0, skipped: 0 }, riskProfile: null, decisionProviderMode: null
  } } };
  const harness = await experimentFilterHarness("?q=kept&status=failed", pageData);
  const source = harness.find("SourceSummary");
  const sourceTree = source.type(source.props);
  const clocks = harness.findWithin(sourceTree, "ObservationTimes");
  const jump = harness.findWithin(clocks.type(clocks.props), "a");
  assert.equal(jump.props.href, "#experiment-source-summary");
  jump.props.onClick({ button: 0 });
  assert.equal(harness.focusEvents.at(-1), "experiment-source-summary");
  assert.equal(harness.location.search, "?q=kept&status=failed", "focus handler does not replace native URL behavior");
  const sourceDetails = harness.find("SourceDetails");
  const details = sourceDetails.type(sourceDetails.props);
  assert.equal(harness.findWithin(details, "summary").props.id, "experiment-source-summary");
  const returnLink = harness.findWithin(details, "a");
  assert.equal(returnLink.props.href, "#experiment-query");
  assert.equal(harness.find("input").props.id, "experiment-query");
  returnLink.props.onClick({ button: 0 });
  assert.equal(harness.focusEvents.at(-1), "experiment-query");
  const focusCount = harness.focusEvents.length;
  jump.props.onClick({ button: 0, ctrlKey: true });
  assert.equal(harness.focusEvents.length, focusCount, "modified native navigation does not steal focus");

  const cleanup = harness.effects[1]();
  harness.navigate("/dashboard?q=kept&status=failed#experiment-source-summary");
  harness.listeners.get("hashchange")();
  assert.equal(harness.focusEvents.at(-1), "experiment-source-summary");
  assert.equal(harness.focusOptions.at(-1).preventScroll, false, "restored summary focus must be visible");
  harness.navigate("/dashboard?q=kept&status=failed#experiment-query");
  harness.listeners.get("hashchange")();
  assert.equal(harness.focusEvents.at(-1), "experiment-query");
  assert.equal(harness.focusOptions.at(-1).preventScroll, false, "restored input focus must be visible");
  assert.equal(harness.location.search, "?q=kept&status=failed");
  cleanup();
  assert.equal(harness.listeners.has("hashchange"), false);
  assert.equal(harness.listeners.has("popstate"), false);
});

test("null-state fragment traversal restores the exact URL through the public history integration", async () => {
  const harness = await experimentFilterHarness("?q=kept&status=failed");
  const cleanup = harness.effects[1]();
  harness.navigate("/dashboard?q=kept&status=completed#experiment-query");
  const currentUrl = harness.location.href;
  harness.listeners.get("popstate")({ state: null });
  assert.deepEqual(harness.historyWrites, [{ method: "replaceState", state: null, destination: currentUrl }]);
  assert.equal(harness.location.href, currentUrl, "no new entry, query rewrite, or lost fragment");
  assert.deepEqual(harness.focusEvents, [], "same-hash traversal does not steal focus");
  harness.listeners.get("popstate")({ state: { existingRouterState: true } });
  assert.equal(harness.historyWrites.length, 1, "non-null entries remain owned by the router");
  harness.navigate("/dashboard/validation#candidate-comparison");
  harness.listeners.get("popstate")({ state: null });
  assert.equal(harness.historyWrites.length, 1, "departed routes cannot be rewritten");
  cleanup();
  assert.equal(harness.listeners.size, 0);
});


test("typing after local select, submit, or clear survives their deferred effects", async () => {
  const harness = await experimentFilterHarness();
  harness.effects[0]();
  const draft = (value) => { harness.input.value = value; harness.find("input").props.onInput(); };
  harness.select.value = "running";
  harness.statusControl.props.onChange({ currentTarget: harness.select });
  draft("after selection");
  harness.effects[0]();
  assert.equal(harness.input.value, "after selection");
  assert.equal(harness.location.search, "?status=running");
  harness.find("form").props.onSubmit({ preventDefault() {} });
  draft("after submission");
  harness.effects[0]();
  assert.equal(harness.input.value, "after submission");
  assert.equal(harness.location.search, "?q=after+selection&status=running");
  const clear = harness.find("form").props.children.find((child) => child?.type === "button" && child.props.type === "button");
  clear.props.onClick();
  draft("after clearing");
  harness.effects[0]();
  assert.equal(harness.input.value, "after clearing");
  assert.equal(harness.location.search, "");
});

test("a draft belongs only to the Back/Forward URL where it was typed while select still synchronizes", async () => {
  const harness = await experimentFilterHarness("?q=entry-a&status=completed");
  harness.effects[0]();
  harness.navigate("/dashboard?q=entry-b&status=failed");
  harness.input.value = "new draft for entry b";
  harness.find("input").props.onInput();
  harness.effects[0]();
  assert.equal(harness.input.value, "new draft for entry b");
  assert.equal(harness.select.value, "failed");
  assert.equal(harness.location.search, "?q=entry-b&status=failed");
  harness.navigate("/dashboard?q=entry-c&status=skipped");
  harness.effects[0]();
  assert.equal(harness.input.value, "entry-c", "entry B's draft must not leak into entry C");
  assert.equal(harness.select.value, "skipped");
});

test("same-value commits preserve input selection and stale handlers cannot write another page", async () => {
  const harness = await experimentFilterHarness("?q=kept&status=failed");
  harness.effects[0]();
  let inputValue = harness.input.value;
  let inputWrites = 0;
  Object.defineProperty(harness.input, "value", { get: () => inputValue, set(value) { inputWrites += 1; inputValue = value; } });
  harness.find("form").props.onSubmit({ preventDefault() {} });
  harness.navigate("/dashboard?q=kept&status=running");
  harness.effects[0]();
  assert.equal(inputWrites, 0, "same-value DOM assignments could move the caret");
  assert.equal(harness.select.value, "running");
  harness.navigate("/dashboard/validation#candidate-comparison");
  const before = harness.location.href;
  harness.statusControl.props.onChange({ currentTarget: { value: "completed" } });
  harness.find("form").props.onSubmit({ preventDefault() {} });
  const clear = harness.find("form").props.children.find((child) => child?.type === "button" && child.props.type === "button");
  clear.props.onClick();
  harness.effects[0]();
  assert.equal(harness.location.href, before);
  assert.equal(inputWrites, 0);
  assert.equal(harness.input.value, "kept");
  assert.equal(harness.select.value, "running");
  assert.deepEqual(harness.focusEvents, []);
});


test("rapid history changes discard a middle-entry draft even when returning to the last synchronized URL", async () => {
  for (const destination of ["entry-a", "entry-c"]) {
    const harness = await experimentFilterHarness("?q=entry-a&status=completed");
    harness.effects[0]();
    harness.navigate("/dashboard?q=entry-b&status=failed");
    harness.input.value = "draft belonging only to entry b";
    harness.find("input").props.onInput();
    // No effect observes entry B before another history navigation occurs.
    harness.navigate(`/dashboard?q=${destination}&status=completed`);
    harness.effects[0]();
    assert.equal(harness.input.value, destination);
    assert.equal(harness.select.value, "completed");
    assert.equal(harness.location.search, `?q=${destination}&status=completed`);
  }
});


test("submit and status changes resolve untouched companion fields from pending browser history", async () => {
  for (const action of ["submit", "status"]) {
    for (const dirty of [false, true]) {
      const harness = await experimentFilterHarness("?q=entry-a&status=completed");
      harness.effects[0]();
      harness.navigate("/dashboard?q=entry-b&status=failed");
      if (dirty) {
        harness.input.value = "fresh-b-draft";
        harness.find("input").props.onInput();
      }
      // The entry B effect has not synchronized either DOM field yet.
      if (action === "submit") harness.find("form").props.onSubmit({ preventDefault() {} });
      else harness.statusControl.props.onChange({ currentTarget: { value: "skipped" } });
      const expectedQuery = dirty ? "fresh-b-draft" : "entry-b";
      const expectedStatus = action === "submit" ? "failed" : "skipped";
      assert.equal(harness.location.search, `?q=${expectedQuery}&status=${expectedStatus}`);
      assert.equal(harness.input.value, expectedQuery);
      assert.equal(harness.select.value, expectedStatus);
      harness.effects[0]();
      assert.equal(harness.location.search, `?q=${expectedQuery}&status=${expectedStatus}`);
    }
  }
});

test("an event after rapid A to B draft to A navigation never commits B's abandoned draft", async () => {
  const harness = await experimentFilterHarness("?q=entry-a&status=completed");
  harness.effects[0]();
  harness.navigate("/dashboard?q=entry-b&status=failed");
  harness.input.value = "abandoned-b-draft";
  harness.find("input").props.onInput();
  harness.navigate("/dashboard?q=entry-a&status=completed");
  harness.find("form").props.onSubmit({ preventDefault() {} });
  assert.equal(harness.location.search, "?q=entry-a&status=completed");
  assert.equal(harness.input.value, "entry-a");
});
