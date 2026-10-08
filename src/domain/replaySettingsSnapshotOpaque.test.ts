import assert from "node:assert/strict";
import test from "node:test";
import { hasUninspectableReplaySettings, prepareReplaySettingsSnapshot, replaySettingsSnapshotSchema } from "./replaySettingsSnapshot.js";
import { REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS as limits } from "./replaySettingsCredentialInspection.js";
import { allSettings, minimalSettings } from "./replaySettingsSnapshotTestFixtures.js";

const unavailable = { status: "unavailable", reason: "inspection_unavailable" };
const credential = "api_key=SYNTHETIC_PRIVATE";

test("selected accessors, proxies, nonplain containers and scalar objects are uninspectable without executing code", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("SYNTHETIC_OPAQUE_MARKER"); };
  const handler = { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap };
  const revocable = Proxy.revocable({}, {}); revocable.revoke();
  class Risk { maxBudgetPerDecisionKrw = 1; }
  const prototype = new Proxy({}, handler);
  const scalar = Object.defineProperty({}, Symbol.toPrimitive, { get: trap });
  const cases = [new Proxy(minimalSettings(), handler), Object.assign(new Risk(), minimalSettings()),
    Object.defineProperty(minimalSettings(), "packetIdPrefix", { get: trap }),
    { ...minimalSettings(), riskPolicy: new Proxy({}, handler) }, { ...minimalSettings(), riskPolicy: revocable.proxy },
    { ...minimalSettings(), riskPolicy: new Risk() }, { ...minimalSettings(), riskPolicy: Object.create(prototype) },
    { ...minimalSettings(), riskPolicy: Object.defineProperty({}, "targetExposureRatio", { get: trap }) },
    { ...minimalSettings(), maxCandidates: scalar }, { ...minimalSettings(), tickDelayMs: trap },
    { ...minimalSettings(), executionPolicy: { allowFractionalShares: {} } },
    { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: Object.defineProperty(["VIRTUAL_HOLD"], "0", { get: trap }) } }];
  for (const input of cases) {
    assert.equal(hasUninspectableReplaySettings(input), true);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
    assert.equal(replaySettingsSnapshotSchema.safeParse(input).success, false);
  }
  assert.equal(calls, 0);
});

test("structural inspection is independent of earlier credential and string-budget verdicts", t => {
  let calls = 0;
  const input = { ...allSettings(), packetIdPrefix: credential,
    riskPolicy: Object.defineProperty({}, "maxSymbolExposureKrw", { get() { calls += 1; throw new Error("Do not read opacity"); } }) };
  assert.equal(hasUninspectableReplaySettings(input), true);
  assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "redacted" });
  input.packetIdPrefix = "X".repeat(limits.perStringUnits + 1);
  assert.equal(hasUninspectableReplaySettings(input), true);
  const plain = { ...minimalSettings(), packetIdPrefix: "X".repeat(limits.perStringUnits + 1) };
  const stringify = t.mock.method(JSON, "stringify", () => { throw new Error("Structural inspection must not serialize or scan strings"); });
  const charCode = t.mock.method(String.prototype, "charCodeAt", () => { throw new Error("Structural inspection must not examine string contents"); });
  try { assert.equal(hasUninspectableReplaySettings(plain), false); }
  finally { stringify.mock.restore(); charCode.mock.restore(); }
  assert.deepEqual(prepareReplaySettingsSnapshot(plain), unavailable);
  const strings = Array(4_096).fill("X".repeat(limits.perStringUnits));
  const aggregate = { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: strings } };
  assert.equal(hasUninspectableReplaySettings(aggregate), false);
  assert.deepEqual(prepareReplaySettingsSnapshot(aggregate), unavailable);
  assert.equal(calls, 0);
});

test("inherited selected fields on native object prototypes do not become omission", () => {
  let calls = 0;
  const input = minimalSettings();
  const shadowed = { ...minimalSettings(), tickDelayMs: undefined };
  const nullPrototype = Object.assign(Object.create(null), minimalSettings());
  Object.defineProperty(Object.prototype, "tickDelayMs", { get() { calls += 1; throw new Error("Inherited getter must not execute"); }, configurable: true });
  try {
    assert.equal(hasUninspectableReplaySettings(input), true);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
    assert.equal(hasUninspectableReplaySettings(shadowed), false);
    assert.equal(hasUninspectableReplaySettings(nullPrototype), false);
  } finally { Reflect.deleteProperty(Object.prototype, "tickDelayMs"); }
  assert.equal(calls, 0);
});

test("sparse selected arrays cannot inherit data or accessors through Array or Object prototypes", () => {
  let calls = 0;
  for (const prototype of [Array.prototype, Object.prototype]) {
    for (const accessor of [false, true]) {
      const input = { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: new Array(1_001) } };
      Object.defineProperty(prototype, "1000", accessor
        ? { get() { calls += 1; throw new Error("Inherited index must not run"); }, configurable: true }
        : { value: "VIRTUAL_HOLD", configurable: true });
      try {
        assert.equal(hasUninspectableReplaySettings(input), true);
        assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
      } finally { Reflect.deleteProperty(prototype, "1000"); }
    }
  }
  assert.equal(calls, 0);
});

test("excluded opaque inputs are ignored while ordinary unsupported plain values keep their prior classification", t => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Excluded input must not execute"); };
  const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
  const input = { ...minimalSettings(), riskPolicy: { now: proxy, dynamicCashReserveMarketRegime: proxy },
    universeManifest: { description: proxy, symbols: [{ market: "KR", symbol: "SYNTH", name: proxy, tags: proxy }] } };
  for (const key of ["clock", "samplingPolicy", "decisionProvider", "performanceClock", "tickDelay", "onProgress", "unknownField"]) {
    Object.defineProperty(input, key, { get: trap });
  }
  const originalOwnKeys = Reflect.ownKeys;
  const ownKeys = t.mock.method(Reflect, "ownKeys", (value: object) => {
    assert.ok(value === input.constraints || value === input.riskPolicy, "Only actual wholesale consumers may enumerate keys");
    return originalOwnKeys(value);
  });
  const descriptors = t.mock.method(Object, "getOwnPropertyDescriptors", () => { throw new Error("Do not collect whole object descriptors"); });
  try { assert.equal(hasUninspectableReplaySettings(input), false); }
  finally { ownKeys.mock.restore(); descriptors.mock.restore(); }
  assert.equal(prepareReplaySettingsSnapshot(input).status, "recorded");
  for (const unsupported of [{ ...minimalSettings(), tickDelayMs: undefined }, { ...minimalSettings(), riskPolicy: { futureField: 1 } },
    { ...minimalSettings(), maxCandidates: "ordinary" }, { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: new Array(1) } }]) {
    assert.equal(hasUninspectableReplaySettings(unsupported), false);
    assert.deepEqual(prepareReplaySettingsSnapshot(unsupported), { status: "unavailable", reason: "unsupported_shape" });
  }
  const empty = { ...minimalSettings(), universeManifest: { symbols: [] }, riskPolicy: {}, executionPolicy: {} };
  assert.equal(hasUninspectableReplaySettings(empty), false);
  assert.equal(prepareReplaySettingsSnapshot(empty).status, "recorded");
  const longPublic = { ...minimalSettings(), packetIdPrefix: "https://fixture.invalid/docs?q=token&description=" + "X".repeat(121) };
  assert.equal(hasUninspectableReplaySettings(longPublic), false);
  assert.deepEqual(prepareReplaySettingsSnapshot(longPublic), { status: "unavailable", reason: "limit" });
  assert.equal(calls, 0);
});

test("structural array and value budgets have exact boundaries and accept maximum supported plain settings", () => {
  for (const length of [limits.arrayEntries - 1, limits.arrayEntries, limits.arrayEntries + 1]) {
    const input = { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: Array(length).fill("VIRTUAL_HOLD") } };
    assert.equal(hasUninspectableReplaySettings(input), length > limits.arrayEntries);
  }
  for (const values of [limits.visitedValues - 1, limits.visitedValues, limits.visitedValues + 1]) {
    const remaining = values - 13;
    const entry = { market: 0, symbol: 0, action: 0, activeUntil: 0, reason: 0 };
    const entries = Array(Math.floor(remaining / 6)).fill(entry);
    if (remaining % 6) entries.push(Object.fromEntries(Object.entries(entry).slice(0, remaining % 6 - 1)));
    const input = { ...minimalSettings(), riskPolicy: { cooldownEntries: entries } };
    assert.equal(hasUninspectableReplaySettings(input), values > limits.visitedValues);
  }
  const maximum = allSettings();
  maximum.constraints.allowedActions = Array(128).fill("VIRTUAL_HOLD");
  maximum.riskPolicy!.cooldownEntries = Array(2_048).fill(maximum.riskPolicy!.cooldownEntries![0]);
  maximum.universeManifest!.symbols = Array(20_000).fill(maximum.universeManifest!.symbols[0]);
  assert.equal(hasUninspectableReplaySettings(maximum), false);
});

test("selected array execution hooks and nested serialization hooks are rejected through descriptors", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Collection hook must not execute"); };
  const hooks: PropertyKey[] = ["map", "some", "includes", "filter", Symbol.iterator, "constructor", "toJSON"];
  for (const hook of hooks) for (const accessor of [false, true]) {
    const input = allSettings();
    const arrays = [input.constraints.allowedActions, input.riskPolicy!.cooldownEntries!, input.universeManifest!.symbols];
    for (const array of arrays) {
      Object.defineProperty(array, hook, accessor ? { get: trap, configurable: true } : { value: trap, configurable: true });
      assert.equal(hasUninspectableReplaySettings(input), true);
      assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable);
      Reflect.deleteProperty(array, hook);
    }
  }
  const selected = allSettings();
  for (const object of [selected.constraints, selected.riskPolicy!, selected.allocationPolicy!, selected.universeManifest!.symbols[0]!]) {
    Object.defineProperty(object, "toJSON", { get: trap, configurable: true });
    assert.equal(hasUninspectableReplaySettings(selected), true);
    assert.deepEqual(prepareReplaySettingsSnapshot(selected), unavailable);
    Reflect.deleteProperty(object, "toJSON");
  }
  assert.equal(calls, 0);
});

test("inherited collection and serialization hook overrides are rejected without reading their values", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Inherited execution hook must not run"); };
  const input = minimalSettings();
  const cases: [object, PropertyKey][] = [[Array.prototype, "map"], [Array.prototype, Symbol.iterator],
    [Array, Symbol.species], [Array.prototype, "toJSON"], [Object.prototype, "toJSON"]];
  for (const [object, key] of cases) {
    const previous = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { get: trap, configurable: true });
    try { assert.equal(hasUninspectableReplaySettings(input), true); }
    finally {
      if (previous) Object.defineProperty(object, key, previous); else Reflect.deleteProperty(object, key);
    }
  }
  assert.equal(calls, 0);
});

test("inert toJSON data retains ordinary unsupported behavior and shadows inherited serialization hooks", () => {
  for (const value of ["ordinary", 1, undefined]) {
    const input = { ...minimalSettings(), riskPolicy: { toJSON: value } };
    assert.equal(hasUninspectableReplaySettings(input), false);
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" });
  }
  let calls = 0;
  const input = { ...minimalSettings(), riskPolicy: Object.assign(Object.create(null), { toJSON: "ordinary" }) };
  const constraints = input.constraints;
  Object.defineProperty(constraints, "toJSON", { value: undefined });
  Object.defineProperty(constraints.allowedActions, "toJSON", { value: undefined });
  Object.defineProperty(Object.prototype, "toJSON", { get() { calls += 1; throw new Error("Shadowed hook must not execute"); }, configurable: true });
  try { assert.equal(hasUninspectableReplaySettings(input), false); }
  finally { Reflect.deleteProperty(Object.prototype, "toJSON"); }
  assert.equal(calls, 0);
});
