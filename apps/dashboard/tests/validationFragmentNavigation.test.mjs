import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function harness(hash = "#candidate-comparison", { initialFocus, initialScrollY = 0 } = {}) {
  const source = await readFile(new URL("../src/app/dashboard/validation/ValidationFragmentNavigation.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const frames = new Map();
  const listeners = new Map();
  const events = [];
  let nextFrame = 0;
  let effect;
  const target = {
    isConnected: true,
    getBoundingClientRect() { return { top: 600 - window.scrollY }; },
    scrollIntoView(options) { events.push(["scroll", { ...options }]); },
    focus(options) { events.push(["focus", { ...options }]); }
  };
  const window = {
    location: { pathname: "/dashboard/validation", hash },
    scrollX: 0, scrollY: initialScrollY, innerHeight: 800,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const exports = {};
  const body = {};
  const document = { body, documentElement: { scrollHeight: 2000 }, activeElement: initialFocus === "target" ? target : initialFocus ?? body,
    getElementById(id) { events.push(["lookup", id]); return target; } };
  runInNewContext(outputText, {
    exports, window, document, getComputedStyle: () => ({ scrollMarginTop: "24px" }),
    require(name) { assert.equal(name, "react"); return { useEffect(callback) { effect = callback; } }; }
  });
  assert.equal(exports.ValidationFragmentNavigation(), null);
  const cleanup = effect();
  function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); }
  return { window, document, target, frames, listeners, events, flush, cleanup };
}

for (const anchor of ["candidate-comparison", "data-universe-coverage"]) {
  test(`direct and reload mount restores ${anchor} after layout without changing history`, async () => {
    const h = await harness(`#${anchor}`);
    assert.deepEqual(h.events, []);
    assert.equal(h.frames.size, 1);
    h.flush();
    assert.deepEqual(h.events, [["lookup", anchor], ["scroll", { behavior: "instant", block: "start" }], ["focus", { preventScroll: true }]]);
    assert.equal(h.window.location.hash, `#${anchor}`);
    assert.equal(h.frames.size, 0);
  });
}

test("a newer fragment cancels the old frame and restores only the current target", async () => {
  const h = await harness();
  h.window.location.hash = "#data-universe-coverage";
  h.listeners.get("hashchange")();
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.events[0][1], "data-universe-coverage");
  assert.equal(h.events.length, 3);
});

test("unknown fragments, missing targets and route departure do not steal focus", async () => {
  for (const hash of ["", "#unrelated", "#%3Cscript%3E"]) {
    const h = await harness(hash);
    h.flush();
    assert.deepEqual(h.events, []);
  }
  const missing = await harness();
  missing.document.getElementById = () => null;
  missing.flush();
  assert.deepEqual(missing.events, []);
  const detached = await harness();
  detached.target.isConnected = false;
  detached.flush();
  assert.deepEqual(detached.events, [["lookup", "candidate-comparison"]]);
  const departed = await harness();
  departed.window.location.pathname = "/dashboard";
  departed.flush();
  departed.listeners.get("hashchange")();
  assert.deepEqual(departed.events, []);
  assert.equal(departed.frames.size, 0);
});

test("unmount and a changed hash cancel pending focus work", async () => {
  const h = await harness();
  h.cleanup();
  h.flush();
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.events, []);
  const changed = await harness();
  changed.window.location.hash = "#unrelated";
  changed.flush();
  assert.deepEqual(changed.events, []);
});

for (const event of ["pointerdown", "keydown", "wheel", "touchstart", "focusin"]) {
  test(`new ${event} intent cancels a pending report jump`, async () => {
    const h = await harness();
    h.document.activeElement = { id: "user-selected-table" };
    h.listeners.get(event)({ target: h.document.activeElement });
    h.flush();
    assert.equal(h.frames.size, 0);
    assert.ok(h.events.every(([kind]) => kind === "lookup"));
    assert.equal(h.document.activeElement.id, "user-selected-table");
  });
}

test("late hydration preserves existing focus or a different restored scroll position", async () => {
  const focused = await harness(undefined, { initialFocus: { id: "user-selected-link" } });
  focused.flush();
  assert.ok(focused.events.every(([kind]) => kind === "lookup"));
  assert.equal(focused.frames.size, 0);
  const scrolled = await harness(undefined, { initialScrollY: 200 });
  scrolled.flush();
  assert.ok(scrolled.events.every(([kind]) => kind === "lookup"));
  assert.equal(scrolled.window.scrollY, 200);
  const arrived = await harness(undefined, { initialScrollY: 576, initialFocus: "target" });
  arrived.flush();
  assert.deepEqual(arrived.events.slice(-2), [["scroll", { behavior: "instant", block: "start" }], ["focus", { preventScroll: true }]]);
  const focusedBeforeScroll = await harness(undefined, { initialFocus: "target" });
  focusedBeforeScroll.flush();
  assert.deepEqual(focusedBeforeScroll.events.slice(-2), [["scroll", { behavior: "instant", block: "start" }], ["focus", { preventScroll: true }]]);
});

test("native focus arriving at the requested target does not cancel its pending scroll", async () => {
  const h = await harness();
  h.document.activeElement = h.target;
  h.listeners.get("focusin")({ target: h.target });
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.deepEqual(h.events.slice(-2), [["scroll", { behavior: "instant", block: "start" }], ["focus", { preventScroll: true }]]);
});

test("changed focus or scroll before the frame never gets overwritten even without an input event", async () => {
  for (const change of ["focus", "scrollX", "scrollY"]) {
    const h = await harness();
    if (change === "focus") h.document.activeElement = { id: "new-focus" };
    else h.window[change] = 100;
    h.flush();
    assert.ok(h.events.every(([kind]) => kind === "lookup"));
  }
});
