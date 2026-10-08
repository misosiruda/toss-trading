import assert from "node:assert/strict";
import test from "node:test";
import { hasUninspectableReplaySettings, prepareReplaySettingsSnapshot, replaySettingsSnapshotSchema } from "./replaySettingsSnapshot.js";
import { REPLAY_SETTINGS_WHOLESALE_INSPECTION_LIMITS as limits, createReplayResearchValueInspector } from "./replaySettingsOpaqueInspection.js";
import { allSettings, atPath, minimalSettings } from "./replaySettingsSnapshotTestFixtures.js";

const unavailable = { status: "unavailable", reason: "inspection_unavailable" };
const deepPaths = [["constraints"], ["allocationPolicy"], ["marketRegimeAllocationPolicy"],
  ["riskPolicy", "maxStrategyBucketExposureKrw"], ["riskPolicy", "maxStrategyBucketExposureRatio"],
  ["riskPolicy", "maxBucketTurnoverKrw"], ["riskPolicy", "maxBucketTurnoverRatio"],
  ["riskPolicy", "dynamicCashReservePolicy"], ["riskPolicy", "hedgePolicy"]];

test("actual wholesale canonicalization paths reject unknown enumerable accessors and nested proxies before execution", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("api_key=SYNTHETIC_WHOLESALE_MARKER"); };
  const proxy = new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  for (const path of deepPaths) for (const kind of ["accessor", "nested accessor", "proxy", "function", "nonplain"]) {
    const input = allSettings(); const container = atPath(input, path) as Record<string, unknown>;
    if (kind === "accessor") Object.defineProperty(container, "futureUnusedField", { get: trap, enumerable: true });
    else if (kind === "nested accessor") container.futureUnusedField = { nested: Object.defineProperty({}, "opaqueValue", { get: trap, enumerable: true }) };
    else container.futureUnusedField = kind === "proxy" ? proxy : kind === "function" ? trap : new Date(0);
    assert.equal(hasUninspectableReplaySettings(input), true, path.join("."));
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
    assert.equal(replaySettingsSnapshotSchema.safeParse(input).success, false);
  }
  assert.equal(calls, 0);
});

test("ordinary unknown data and non-enumerable unknown accessors keep the existing unsupported shape classification", () => {
  let calls = 0;
  for (const path of deepPaths) {
    const input = allSettings(); const container = atPath(input, path) as Record<string, unknown>;
    const shared = { value: "ordinary public token documentation", nested: [0, false, null, "public"] };
    container.futureUnusedField = { first: shared, second: shared };
    Object.defineProperty(container, "hiddenFutureField", { get() { calls += 1; throw new Error("Hidden value must not run"); } });
    assert.equal(hasUninspectableReplaySettings(input), false, path.join("."));
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" });
  }
  assert.equal(calls, 0);
});

test("Risk spread rejects string and symbol accessors, including excluded enumerable fields, without traversing data values", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("api_key=SYNTHETIC_RISK_MARKER"); };
  const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  for (const key of ["futureUnusedField", "now", "dynamicCashReserveMarketRegime", Symbol("future")]) {
    const input = { ...minimalSettings(), riskPolicy: Object.defineProperty({}, key, { get: trap, enumerable: true }) };
    assert.equal(hasUninspectableReplaySettings(input), true);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
  }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const data = { ...minimalSettings(), riskPolicy: { now: new Date(0), dynamicCashReserveMarketRegime: proxy,
    futureUnusedField: { opaque: proxy, cycle, nested: Object.defineProperty({}, "hidden", { get: trap, enumerable: true }) } } };
  assert.equal(hasUninspectableReplaySettings(data), false);
  assert.deepEqual(prepareReplaySettingsSnapshot(data), { status: "unavailable", reason: "unsupported_shape" });
  const hidden = { ...minimalSettings(), riskPolicy: Object.defineProperty({}, "now", { get: trap }) };
  assert.equal(hasUninspectableReplaySettings(hidden), false);
  assert.equal(calls, 0);
});

test("field-projected execution, exit and universe inputs do not gain unknown-field traversal", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Unconsumed unknown accessor"); };
  const paths = [["executionPolicy"], ["paperExitPolicy"], ["universeManifest"], ["universeManifest", "symbols", 0]];
  for (const path of paths) {
    const input = allSettings(); const container = atPath(input, path) as object;
    Object.defineProperty(container, "futureUnusedField", { get: trap, enumerable: true });
    assert.equal(hasUninspectableReplaySettings(input), false);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" });
  }
  assert.equal(calls, 0);
});

test("cycles in recursively consumed unknown objects or arrays are unavailable while shared plain references stay inspectable", () => {
  const object: Record<string, unknown> = {}; object.self = object;
  const array: unknown[] = []; array.push(array);
  for (const nested of [object, array]) {
    const input = withUnknown(nested);
    assert.equal(hasUninspectableReplaySettings(input), true);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
  }
  const shared = { ordinary: 1 };
  assert.equal(hasUninspectableReplaySettings(withUnknown({ first: shared, second: shared })), false);
});

test("wholesale object-key, array-entry and recursive-depth budgets preserve exact boundaries", () => {
  for (const count of [limits.objectKeys - 1, limits.objectKeys, limits.objectKeys + 1]) {
    const entries: Record<string, number> = {};
    for (let index = 0; index < count; index += 1) entries[`field${index}`] = index;
    assert.equal(hasUninspectableReplaySettings(withUnknown(entries)), count > limits.objectKeys);
  }
  for (const count of [limits.arrayEntries - 1, limits.arrayEntries, limits.arrayEntries + 1]) {
    assert.equal(hasUninspectableReplaySettings(withUnknown(Array(count).fill(0))), count > limits.arrayEntries);
  }
  for (const depth of [limits.depth - 1, limits.depth, limits.depth + 1]) {
    const nested: Record<string, unknown> = {}; let tail = nested;
    // allocationPolicy is depth one; the unknown subtree occupies the remaining container levels.
    for (let index = 1; index < depth - 1; index += 1) { const next = {}; tail.child = next; tail = next; }
    assert.equal(hasUninspectableReplaySettings(withUnknown(nested)), depth > limits.depth);
  }
});

test("cumulative descriptor and value budgets cannot reset across wholesale sibling objects", () => {
  const hidden: Record<string, unknown> = {};
  for (let index = 0; index < limits.objectKeys; index += 1) Object.defineProperty(hidden, `hidden${index}`, { value: 0 });
  assert.equal(hasUninspectableReplaySettings(withUnknown([hidden, hidden, hidden, hidden])), false);
  assert.equal(hasUninspectableReplaySettings(withUnknown([hidden, hidden, hidden, hidden, hidden])), true);
  const entries = Array(limits.arrayEntries).fill(0);
  assert.equal(hasUninspectableReplaySettings(withUnknown([entries, entries, entries, entries])), false);
  assert.equal(hasUninspectableReplaySettings(withUnknown([entries, entries, entries, entries, entries])), true);
});
function withUnknown(value: unknown) {
  return { ...minimalSettings(), allocationPolicy: { ...allSettings().allocationPolicy!, futureUnusedField: value } };
}

test("returned allocation unknown enumerable values and property names use the bounded credential guard", () => {
  for (const value of ["api_key=SYNTHETIC_RETURN_MARKER", { nested: ["https://fixture.invalid/?token=SYNTHETIC_RETURN_MARKER"] },
    { "api_key=SYNTHETIC_RETURN_MARKER": 1 }]) {
    const input = withUnknown(value);
    assert.equal(hasUninspectableReplaySettings(input), false);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "redacted" });
  }
  const input = { ...minimalSettings(), allocationPolicy: { ...allSettings().allocationPolicy!, "api_key=SYNTHETIC_RETURN_MARKER": 1 } };
  assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "redacted" });
  for (const value of ["https://fixture.invalid/token/history?symbol=SYNTH", { token_count: 10, note: "token documentation" }]) {
    assert.deepEqual(prepareReplaySettingsSnapshot(withUnknown(value)), { status: "unavailable", reason: "unsupported_shape" });
  }
  // These unknown values are projected/discarded instead of being returned wholesale by the runner.
  for (const field of ["riskPolicy", "executionPolicy", "paperExitPolicy"]) {
    const ignored = { ...minimalSettings(), [field]: { futureUnusedField: "api_key=SYNTHETIC_DISCARDED_MARKER" } };
    assert.deepEqual(prepareReplaySettingsSnapshot(ignored), { status: "unavailable", reason: "unsupported_shape" });
  }
});

test("returned allocation key/value inspection observes finite leaf and cumulative budgets without executing opaque branches", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("SYNTHETIC_UNREADABLE"); };
  const input = withUnknown({ first: "X".repeat(4_097), later: "api_key=SYNTHETIC_LATER_MARKER" });
  assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "redacted" });
  assert.deepEqual(prepareReplaySettingsSnapshot(withUnknown({ ["X".repeat(4_097)]: 1 })), unavailable);
  const unreadable = withUnknown(Object.defineProperty({ later: "api_key=SYNTHETIC_LATER_MARKER" }, "first", { get: trap, enumerable: true }));
  assert.equal(hasUninspectableReplaySettings(unreadable), true);
  assert.deepEqual(prepareReplaySettingsSnapshot(unreadable), { status: "unavailable", reason: "redacted" });
  const dense = Array(4_096).fill("X".repeat(4_096));
  assert.deepEqual(prepareReplaySettingsSnapshot(withUnknown(dense)), unavailable);
  assert.equal(calls, 0);
});

test("research value inspector shares one structural budget across projected sibling fields without credential scanning", () => {
  const inspect = createReplayResearchValueInspector();
  assert.equal(inspect("api_key=SYNTHETIC_LABEL_CONTENT"), false);
  const batch = Array(limits.arrayEntries).fill(0);
  for (let index = 0; index < 4; index += 1) assert.equal(inspect(batch), false);
  assert.equal(inspect(batch), true);
  const fresh = createReplayResearchValueInspector();
  assert.equal(fresh(batch), false);
});

test("every proven wholesale path inspects unknown credential keys, values and associations while preserving public controls", () => {
  for (const path of deepPaths) {
    for (const unknown of [{ "api_key=SYNTHETIC_KEY_MARKER": 1 }, { api_key: "SYNTHETIC_ASSOCIATION_MARKER" },
      { futureUnusedField: "api_key=SYNTHETIC_VALUE_MARKER" }, { futureUnusedField: { credentials: { api_key: "SYNTHETIC_NESTED_MARKER" } } }]) {
      const input = allSettings(); Object.assign(atPath(input, path) as object, unknown);
      assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "redacted" }, path.join("."));
    }
    const input = allSettings(); Object.assign(atPath(input, path) as object, { token_count: 5, public_note: "token market documentation", public_url: "https://fixture.invalid/docs?q=token" });
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" }, path.join("."));
  }
});

test("unknown property association framing fits the existing finite string budget", () => {
  for (const units of [4_094, 4_095, 4_096]) {
    const input = withUnknown({ ["X".repeat(units)]: 1 });
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: units < 4_096 ? "unsupported_shape" : "inspection_unavailable" });
  }
  const input = withUnknown({ api_key: Object.defineProperty({}, "toString", { get() { throw new Error("Association must not coerce a value"); } }) });
  assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "redacted" });
});
