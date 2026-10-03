import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const viewSource = await readFile(new URL("../src/lib/dashboardViewModels.ts", import.meta.url), "utf8");
const viewModels = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(viewSource, { mode: "strip" }))}`);
const source = await readFile(new URL("../src/app/dashboard/lab/strategy-tests/strategyBucketTestObservation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
function harness(fetch = async () => { throw new Error("unexpected fetch"); }) {
  const exports = {};
  const timers = new Map();
  let nextTimer = 0;
  runInNewContext(compiled, { exports, Map, Set, Date, Promise, Error, AbortController, encodeURIComponent, fetch,
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) { assert.equal(name, "@/lib/dashboardViewModels"); return viewModels; }
  });
  return { ...exports, timers, expire() { for (const { callback } of [...timers.values()]) callback(); } };
}
function summary(testId = "created-a", overrides = {}) {
  return { testId, bucket: "long_term", configHash: "sha256:fixture", status: "queued", startedAt: null, completedAt: null, runId: null,
    progress: { phase: "queued", progressRatio: 0, completedPacketCount: 0, totalPacketCount: null, decisionCount: 0,
      riskApprovedCount: 0, riskRejectedCount: 0, simulatedTradeCount: 0, providerFailureCount: 0,
      latestMessage: "queued", latestAuditEventRef: null, updatedAt: "2026-10-03T03:00:00Z" },
    heartbeat: { status: "fresh", lastSeenAt: "2026-10-03T03:00:00Z", staleAfterSeconds: 30 }, ...overrides };
}
function identity(test = summary()) { return { testId: test.testId, bucket: test.bucket, configHash: test.configHash }; }
function payload(test = summary(), overrides = {}) {
  return { mode: "paper_only", readOnly: true, viewModel: "strategy-test-progress", testId: test.testId, test,
    sourceStatus: { strategyBucketTestRecords: "ok" }, storageMutationEnabled: false, liveTradingEnabled: false,
    orderPlacementEnabled: false, replayRunnerStarted: false, status: "ok", ...overrides };
}
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const ids = (values) => Array.from(values, (value) => value.testId);

test("accepted identity alone cannot invent an active row; actual source and progress observations deduplicate", () => {
  const h = harness(), existing = summary("source");
  assert.deepEqual(ids(h.visibleActiveTests([existing], [identity()], new Map())), ["source"]);
  const observed = new Map([["created-a", summary()]]);
  assert.deepEqual(ids(h.visibleActiveTests([existing], [identity()], observed)), ["source", "created-a"]);
  assert.deepEqual(ids(h.visibleActiveTests([existing, summary()], [identity()], observed)), ["source", "created-a"]);
});

test("recent creation identities are deduplicated and bounded to20 without discarding server snapshot rows", () => {
  const h = harness(), initial = [identity()];
  assert.equal(h.rememberQueuedTests(initial, [identity()]), initial);
  const queued = h.rememberQueuedTests([], Array.from({ length: 25 }, (_, i) => identity(summary(`created-${i}`))));
  assert.equal(queued.length, 20); assert.equal(queued[0].testId, "created-5");
  const source = Array.from({ length: 20 }, (_, i) => summary(`source-${i}`));
  const observed = new Map(queued.map((test) => [test.testId, summary(test.testId)]));
  assert.equal(h.visibleActiveTests(source, queued, observed).length, 40);
});

test("stale RSC cannot remove a confirmed created row or resurrect its terminal observation", () => {
  const h = harness(), old = summary(), queued = [identity(old)];
  let observed = new Map([[old.testId, old]]);
  assert.deepEqual(ids(h.visibleActiveTests([], queued, observed)), [old.testId]);
  const completed = summary(old.testId, { status: "completed", progress: { ...old.progress, phase: "completed", updatedAt: "2026-10-03T03:01:00Z" } });
  observed = h.mergeTestObservations(observed, [completed], h.allowedTestIdentities([], queued));
  assert.equal(h.visibleActiveTests([old], queued, observed).length, 0);
  assert.equal(h.latestTestObservation(completed, summary(old.testId, { progress: { ...old.progress, updatedAt: "2026-10-03T03:02:00Z" } })), completed);
});

test("older progress cannot replace newer evidence, equal timestamps can update heartbeat", () => {
  const h = harness(), old = summary(), newer = summary(old.testId, { status: "running", progress: { ...old.progress, phase: "loading_data", updatedAt: "2026-10-03T03:01:00Z" } });
  assert.equal(h.latestTestObservation(newer, old), newer);
  const heartbeat = { ...newer, heartbeat: { ...newer.heartbeat, status: "stale" } };
  assert.equal(h.latestTestObservation(newer, heartbeat), heartbeat);
  assert.equal(h.latestTestObservation(newer, summary(old.testId, { bucket: "hedge" })), newer);
});

test("source removal and identity eviction prevent late responses from re-inserting unrelated rows", () => {
  const h = harness(), old = summary("removed");
  const allowed = h.allowedTestIdentities([], [identity()]);
  assert.equal(h.mergeTestObservations(new Map([[old.testId, old]]), [old], allowed).size, 0);
  assert.equal(h.visibleActiveTests([], [], new Map([[old.testId, old]])).length, 0);
});

test("observation uses the existing read-only GET contract and exact identity", async () => {
  let request;
  const h = harness(async (url, init) => { request = { url, init }; return Response.json(payload()); });
  const controller = new AbortController();
  assert.deepEqual(await h.readTestObservation(identity(), controller.signal), summary());
  assert.equal(request.url, "/dashboard/lab/strategy-tests/tests/created-a/progress");
  assert.equal(request.init.method ?? "GET", "GET"); assert.equal(request.init.body, undefined);
  assert.equal(request.init.cache, "no-store"); assert.equal(request.init.signal, controller.signal);
});

for (const [label, change] of [
  ["outer ID", (p) => ({ ...p, testId: "other" })],
  ["inner ID", (p) => ({ ...p, test: { ...p.test, testId: "other" } })],
  ["other bucket", (p) => ({ ...p, test: { ...p.test, bucket: "hedge" } })],
  ["other config", (p) => ({ ...p, test: { ...p.test, configHash: "different" } })],
  ["invalid timestamp", (p) => ({ ...p, test: { ...p.test, progress: { ...p.test.progress, updatedAt: "invalid" } } })],
  ["missing record", (p) => ({ ...p, status: "missing", test: null })],
  ["mutation enabled", (p) => ({ ...p, storageMutationEnabled: true })],
  ["live trading", (p) => ({ ...p, liveTradingEnabled: true })],
  ["runner started", (p) => ({ ...p, replayRunnerStarted: true })],
  ["read-only false", (p) => ({ ...p, readOnly: false })]
]) test(`observation rejects ${label} without creating a row`, async () => {
  const h = harness(async () => Response.json(change(payload())));
  await assert.rejects(h.readTestObservation(identity(), new AbortController().signal), /could not be confirmed/);
});

test("single create, periodic polling and manual retry share one in-flight request", async () => {
  const response = deferred(); let calls = 0; const observed = [];
  const h = harness(async () => { calls++; return response.promise; });
  const reader = h.createTestObservationReader({ isAllowed: () => true, onObservation: (s) => observed.push(s), onError: () => assert.fail() });
  const one = reader.observe(identity(), true), two = reader.observe(identity()), three = reader.observe(identity(), true);
  assert.equal(one, two); assert.equal(two, three); assert.equal(calls, 1); assert.equal(h.timers.size, 1);
  response.resolve(Response.json(payload())); await one;
  assert.equal(observed.length, 1); assert.equal(h.timers.size, 0); reader.dispose();
});

test("matrix partial failure preserves other actual outcomes and never automatically retries", async () => {
  const calls = []; const observed = []; const errors = [];
  const h = harness(async (url) => { calls.push(url); return url.includes("failed") ? Response.json({}, { status: 503 }) : Response.json(payload(summary("good"))); });
  const reader = h.createTestObservationReader({ isAllowed: () => true, onObservation: (s) => observed.push(s), onError: (s) => errors.push(s.testId) });
  const outcomes = await Promise.allSettled([reader.observe(identity(summary("failed")), true), reader.observe(identity(summary("good")), true)]);
  assert.equal(outcomes[0].status, "rejected"); assert.equal(outcomes[1].status, "fulfilled");
  assert.deepEqual(ids(observed), ["good"]); assert.deepEqual(errors, ["failed"]); assert.equal(calls.length, 2);
  await Promise.resolve(); assert.equal(calls.length, 2); reader.dispose();
});

test("new observation times out even when fetch ignores abort and explicit retry can recover", async () => {
  const stalled = deferred(); let calls = 0; const errors = []; const observed = [];
  const h = harness(async () => { calls++; return calls === 1 ? stalled.promise : Response.json(payload()); });
  const reader = h.createTestObservationReader({ isAllowed: () => true, onObservation: (s) => observed.push(s), onError: (s) => errors.push(s.testId) });
  const first = reader.observe(identity(), true); const rejected = assert.rejects(first, /could not be confirmed/);
  assert.equal([...h.timers.values()][0].milliseconds, 2000); h.expire(); await rejected;
  assert.equal(calls, 1); assert.deepEqual(errors, ["created-a"]);
  await reader.observe(identity(), true); assert.equal(calls, 2); assert.equal(observed.length, 1);
  stalled.resolve(Response.json(payload(summary("created-a", { status: "running" })))); await Promise.resolve();
  assert.equal(observed.length, 1); reader.dispose();
});

test("ordinary existing polling keeps its deadline while a new creation can bound a shared pending read", async () => {
  const stalled = deferred(); const h = harness(async () => stalled.promise);
  const reader = h.createTestObservationReader({ isAllowed: () => true, onObservation() {}, onError() {} });
  const first = reader.observe(identity()); assert.equal(h.timers.size, 0);
  assert.equal(reader.observe(identity(), true), first); assert.equal(h.timers.size, 1);
  const rejected = assert.rejects(first); h.expire(); await rejected; reader.dispose();
});

test("unmount and identity eviction cancel requests and ignore success arriving later", async () => {
  for (const mode of ["unmount", "eviction"]) {
    let allowed = true; const response = deferred(); const observed = []; const errors = [];
    const h = harness(async () => response.promise);
    const reader = h.createTestObservationReader({ isAllowed: () => allowed, onObservation: (s) => observed.push(s), onError: (s) => errors.push(s) });
    const pending = reader.observe(identity(), true);
    if (mode === "unmount") reader.dispose(); else { allowed = false; reader.cancelUnwanted(); }
    await pending; response.resolve(Response.json(payload())); await Promise.resolve();
    assert.equal(observed.length, 0); assert.equal(errors.length, 0); assert.equal(h.timers.size, 0);
  }
});


test("an equal-timestamp stale RSC snapshot cannot undo a newer heartbeat observation", () => {
  const h = harness(), old = summary();
  const observed = { ...old, heartbeat: { ...old.heartbeat, status: "stale" } };
  assert.equal(h.visibleActiveTests([old], [identity()], new Map([[old.testId, observed]]))[0].heartbeat.status, "stale");
});

async function componentHarness(filename, componentName, imports, props, globals = {}) {
  const componentSource = await readFile(new URL(`../src/app/dashboard/lab/strategy-tests/${filename}`, import.meta.url), "utf8");
  const output = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const slots = []; const effects = new Map(); let queuedEffects = new Map(); let cursor = 0; let dirty = true; let tree;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (update) => { const next = typeof update === "function" ? update(slots[i]) : update; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(create, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { value: create(), deps }; return slots[i].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(create, deps) { const i = cursor++; if (!sameDeps(effects.get(i)?.deps, deps)) queuedEffects.set(i, { create, deps, layout: false }); },
    useLayoutEffect(create, deps) { const i = cursor++; if (!sameDeps(effects.get(i)?.deps, deps)) queuedEffects.set(i, { create, deps, layout: true }); }
  };
  const exports = {};
  runInNewContext(output, { exports, Map, Set, Date, Promise, Error, AbortController, ...globals,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" };
      assert.ok(name in imports, `unexpected import ${name}`); return imports[name];
    }
  });
  function flush() {
    let attempts = 0;
    while (dirty) {
      assert.ok(attempts++ < 20, "component state must settle without a render loop");
      do { dirty = false; cursor = 0; queuedEffects = new Map(); tree = exports[componentName](props); } while (dirty);
      for (const [i, effect] of [...queuedEffects].sort((a, b) => Number(b[1].layout) - Number(a[1].layout))) {
        effects.get(i)?.cleanup?.(); const cleanup = effect.create(); effects.set(i, { ...effect, cleanup });
      }
    }
  }
  function find(predicate, node = tree) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity).filter((value) => value !== undefined)) { const result = find(predicate, child); if (result) return result; }
    return null;
  }
  flush();
  return { flush, find, get tree() { return tree; },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); flush(); },
    update(next) { props = next; dirty = true; flush(); },
    unmount() { for (const effect of effects.values()) effect.cleanup?.(); },
    replayEffects() { for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); dirty = true; flush(); }
  };
}
async function workspaceHarness(fetch, source = []) {
  const helper = harness(fetch);
  function Form() {} function Panel() {}
  const h = await componentHarness("StrategyBucketTestWorkspace.tsx", "StrategyBucketTestWorkspace", {
    "./strategyBucketTestObservation": helper,
    "./StrategyBucketTestValidationForm": { StrategyBucketTestValidationForm: Form },
    "./StrategyBucketTestProgressPanel": { StrategyBucketTestProgressPanel: Panel }
  }, { initialActiveTests: source, children: "server-results-slot" });
  return { ...h, helper,
    queue(tests) { h.find((node) => node.type === Form).props.onQueuedTests(tests); h.flush(); },
    rows() { return h.find((node) => node.type === Panel).props.activeTests; },
    refresh() { return h.find((node) => node.type === Panel).props.onRefreshProgress(); },
    snapshot(tests) { h.update({ initialActiveTests: tests, children: "server-results-slot" }); }
  };
}

test("actual Workspace wires creation observation without RSC refresh and retains terminal memory through stale snapshots", async () => {
  let value = summary(); let calls = 0;
  const h = await workspaceHarness(async () => { calls++; return Response.json(payload(value)); });
  h.queue([identity()]); assert.equal(h.rows().length, 0); await h.settle();
  assert.deepEqual(ids(h.rows()), ["created-a"]); assert.equal(calls, 1);
  h.queue([identity()]); await h.settle(); assert.equal(calls, 1);
  h.snapshot([]); assert.deepEqual(ids(h.rows()), ["created-a"]); await h.settle(); assert.equal(calls, 1);
  value = summary("created-a", { status: "completed", progress: { ...value.progress, phase: "completed", updatedAt: "2026-10-03T03:01:00Z" } });
  await h.refresh(); await h.settle(); assert.equal(h.rows().length, 0);
  h.snapshot([summary()]); assert.equal(h.rows().length, 0); h.unmount();
});

test("actual Workspace matrix failure is visible and explicit retry does not recreate the record", async () => {
  let fail = true; const calls = [];
  const h = await workspaceHarness(async (url) => { calls.push(url); const id = url.includes("bad") ? "bad" : "good";
    return id === "bad" && fail ? Response.json({}, { status: 503 }) : Response.json(payload(summary(id))); });
  h.queue([identity(summary("bad")), identity(summary("good"))]); await h.settle();
  assert.deepEqual(ids(h.rows()), ["good"]);
  const retry = h.find((node) => node.type === "button" && node.props.children === "Retry created record observation");
  assert.ok(retry); assert.equal(calls.length, 2); fail = false; retry.props.onClick(); await h.settle();
  assert.deepEqual(ids(h.rows()), ["bad", "good"]); assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => url.endsWith("/progress"))); h.unmount();
});

test("actual Workspace unmount and Strict Mode effect replay cancel the obsolete request", async () => {
  const requests = [];
  const h = await workspaceHarness(async (_url, init) => { const response = deferred(); requests.push({ ...response, signal: init.signal }); return response.promise; });
  h.queue([identity()]); assert.equal(requests.length, 1);
  h.replayEffects(); assert.equal(requests.length, 2); assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(Response.json(payload(summary("created-a", { status: "running" }))));
  requests[1].resolve(Response.json(payload())); await h.settle();
  assert.equal(h.rows()[0].status, "queued"); h.unmount();
});

test("actual Workspace rejects a removed source request that completes after newer props commit", async () => {
  const response = deferred(); const h = await workspaceHarness(async () => response.promise, [summary("old-source")]);
  const pending = h.refresh(); h.snapshot([]); response.resolve(Response.json(payload(summary("old-source"))));
  await pending; await h.settle(); assert.equal(h.rows().length, 0); h.unmount();
});

const policySource = await readFile(new URL("../src/lib/policyDraft.ts", import.meta.url), "utf8");
const policyDraft = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(policySource, { mode: "strip" }))}`);
function queuedResponse(testId = "created-a", bucket = "long_term") {
  return { mode: "paper_only", mutation: "strategy_bucket_test_create", status: "queued", testId, bucket,
    configHash: "sha256:fixture", recordPath: "synthetic-record-only", storageMutationEnabled: true,
    liveTradingEnabled: false, orderPlacementEnabled: false, replayRunnerStarted: false, disclaimer: "runner not started" };
}
async function formHarness(onQueuedTests, createReply = queuedResponse(), refreshAfterCreate = true) {
  const requests = []; let refreshes = 0;
  const router = { refresh() { refreshes++; } };
  const h = await componentHarness("StrategyBucketTestValidationForm.tsx", "StrategyBucketTestValidationForm", {
    "@/lib/policyDraft": policyDraft, "next/navigation": { useRouter: () => router }
  }, { onQueuedTests, refreshAfterCreate }, { fetch: async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/validate")) return Response.json({ mode: "paper_only", validation: "strategy_bucket_test", readOnly: true,
      storageMutationEnabled: false, liveTradingEnabled: false, orderPlacementEnabled: false, replayRunnerStarted: false,
      status: "valid", validatedForStrategyBucketTestConfig: true, bucket: "long_term", policyId: "fixture", policyHash: "sha256:fixture",
      configHash: "sha256:fixture", issueCount: 0, issues: [], summary: {}, validatedAt: "2026-10-03T03:00:00Z" });
    if (url.endsWith("/matrix-create")) return Response.json({ mode: "paper_only", mutation: "strategy_bucket_test_matrix_create", status: "queued",
      matrixId: "fixture-matrix", bucketCount: 2, queuedTests: [queuedResponse("matrix-long"), queuedResponse("matrix-hedge", "hedge")],
      recordPath: "synthetic-matrix", storageMutationEnabled: true, liveTradingEnabled: false, orderPlacementEnabled: false,
      replayRunnerStarted: false, disclaimer: "runner not started" }, { status: 202 });
    return Response.json(createReply, { status: 202 });
  } });
  const button = (text) => h.find((node) => node.type === "button" && node.props.children === text);
  h.find((node) => node.props?.id === "mutation-token").props.onChange({ target: { value: "synthetic-test-token" } }); h.flush();
  button("Validate bucket config").props.onClick(); await h.settle();
  return { ...h, requests, button, get refreshes() { return refreshes; } };
}

test("actual Form notifies only validated single/matrix identities and retains the queued-only POST boundary", async () => {
  const notified = []; const h = await formHarness((tests) => notified.push(tests));
  h.button("Queue enabled bucket matrix").props.onClick(); await h.settle();
  h.button("Queue bucket test record").props.onClick(); await h.settle();
  assert.deepEqual(notified.map(ids), [["matrix-long", "matrix-hedge"], ["created-a"]]);
  assert.deepEqual(Object.keys(notified[0][0]).sort(), ["bucket", "configHash", "testId"]);
  const create = h.requests.find((request) => request.url.endsWith("/create"));
  assert.equal(create.init.method, "POST");
  assert.equal(create.init.headers["x-toss-trading-dashboard-intent"], "strategy-bucket-test-create");
  assert.equal(create.init.headers["x-toss-trading-dashboard-mutation-token"], "synthetic-test-token");
  assert.equal(h.find((node) => node.type?.name === "CreateResultPanel").props.state.status, "queued");
  assert.equal(h.refreshes, 2); h.unmount();
});

test("actual Form never emits identity for an invalid create contract", async () => {
  const notified = []; const h = await formHarness((tests) => notified.push(tests), { ...queuedResponse(), replayRunnerStarted: true });
  h.button("Queue bucket test record").props.onClick(); await h.settle();
  assert.equal(notified.length, 0); assert.equal(h.refreshes, 0); h.unmount();
});

test("an observation callback failure cannot turn an accepted POST back into a create failure", async () => {
  const h = await formHarness(() => { throw new Error("observer failure"); });
  h.button("Queue bucket test record").props.onClick(); await h.settle();
  assert.equal(h.find((node) => node.type?.name === "CreateResultPanel").props.state.status, "queued");
  assert.equal(h.refreshes, 1); h.unmount();
});


test("main Workspace uses explicit observation while the reusable Form default remains compatible", async () => {
  const workspace = await workspaceHarness(async () => Response.json(payload()));
  assert.equal(workspace.find((node) => node.props?.onQueuedTests !== undefined).props.refreshAfterCreate, false);
  workspace.unmount();
  const notified = []; const form = await formHarness((tests) => notified.push(tests), queuedResponse(), false);
  form.button("Queue bucket test record").props.onClick(); await form.settle();
  assert.deepEqual(notified.map(ids), [["created-a"]]);
  assert.equal(form.find((node) => node.type?.name === "CreateResultPanel").props.state.status, "queued");
  assert.equal(form.refreshes, 0); form.unmount();
});


test("unknown progress is explicit text without a filled or indeterminate bar; numeric progress remains measured", async () => {
  const h = await componentHarness("StrategyBucketTestProgressPanel.tsx", "StrategyBucketTestProgressPanel", {}, {
    activeTests: [summary()], onRefreshProgress: async () => {}
  }, { window: { setInterval() { return 1; }, clearInterval() {} } });
  const meter = h.find((node) => node.type?.name === "ProgressMeter").type;
  const unknown = meter({ ratio: null });
  assert.equal(unknown.props.role, "group"); assert.equal(unknown.props.children, "진행률 없음");
  assert.equal(unknown.props["aria-valuenow"], undefined); assert.equal(unknown.props.style, undefined);
  for (const [ratio, percentage] of [[0, 0], [0.35, 35], [1, 100]]) {
    const result = meter({ ratio }); assert.equal(result.props.role, "progressbar");
    assert.equal(result.props["aria-valuenow"], percentage);
    assert.equal(result.props.children.props.style.width, `${percentage}%`);
  }
  const area = h.find((node) => node.props?.["aria-label"] === "Bucket test progress table scroll area");
  assert.equal(area.props.role, "region"); assert.equal(area.props.tabIndex, 0);
  assert.match(area.props.className, /overflow-x-auto/); assert.match(area.props.className, /focus-visible:outline-2/);
  h.unmount();
});

test("Lab tables retain bounded scroll regions and intrinsic-width grids can shrink without clipping content", async () => {
  const base = "../src/app/dashboard/lab/strategy-tests/";
  const page = await readFile(new URL(base + "page.tsx", import.meta.url), "utf8");
  for (const label of ["Bucket result matrix table scroll area", "Bucket baseline comparison table scroll area"]) {
    assert.ok(page.includes(`role="region" aria-label="${label}" tabIndex={0}`));
  }
  for (const file of ["StrategyBucketTestWorkspace.tsx", "StrategyBucketTestValidationForm.tsx"]) {
    const code = await readFile(new URL(base + file, import.meta.url), "utf8");
    assert.match(code, /minmax\(0,0\.95fr\)_minmax\(0,1\.05fr\)/);
    assert.doesNotMatch(code, /overflow-x-hidden/);
  }
  const form = await readFile(new URL(base + "StrategyBucketTestValidationForm.tsx", import.meta.url), "utf8");
  assert.match(form, /min-w-0 w-full rounded/);
  assert.match(form, /\[overflow-wrap:anywhere\]/);
});


test("every locked bucket route renders its accepted-result form without a redundant server refresh and inherits the root title", async () => {
  const routeSource = await readFile(new URL("../src/app/dashboard/lab/strategy-tests/buckets/[bucket]/new/page.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}; function Form() {}
  runInNewContext(output, { exports, Promise, fetch: () => assert.fail("locked bucket page must not require a server data read"),
    require(name) {
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "next/link") return { default() {} };
      if (name === "next/navigation") return { notFound() { throw new Error("not-found"); } };
      assert.equal(name, "../../../StrategyBucketTestValidationForm"); return { StrategyBucketTestValidationForm: Form };
    }
  });
  function formIn(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === Form) return node;
    return [node.props?.children].flat(Infinity).map(formIn).find(Boolean) ?? null;
  }
  for (const bucket of ["long_term", "swing", "short_term", "intraday", "hedge"]) {
    const page = await exports.default({ params: Promise.resolve({ bucket }) });
    const form = formIn(page); assert.ok(form);
    assert.equal(form.props.initialBucket, bucket); assert.equal(form.props.lockedBucket, true);
    assert.equal(form.props.refreshAfterCreate, false);
  }
  await assert.rejects(exports.default({ params: Promise.resolve({ bucket: "unknown" }) }), /not-found/);
  assert.equal(exports.metadata, undefined); assert.equal(exports.generateMetadata, undefined);
  const root = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("layout.tsx", root, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TSX);
  const metadata = ast.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find((declaration) => declaration.name.getText(ast) === "metadata");
  const title = metadata.initializer.properties.find((property) => property.name.getText(ast) === "title");
  assert.equal(title.initializer.text, "Toss Trading Dashboard");
});
