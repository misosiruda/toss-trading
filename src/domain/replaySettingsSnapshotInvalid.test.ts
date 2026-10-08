import assert from "node:assert/strict";
import test from "node:test";
import { prepareReplaySettingsSnapshot, replaySettingsSnapshotObservationSchema, replaySettingsSnapshotSchema } from "./replaySettingsSnapshot.js";
import { allSettings, atPath, leafPaths, minimalSettings, recordedSettings, replacePath } from "./replaySettingsSnapshotTestFixtures.js";

test("settings reject nonfinite and non-JSON numeric values and malformed Unicode without coercion", () => {
  const invalid = [undefined, null, -0, NaN, Infinity, -Infinity, 1n, Symbol("synthetic"), () => 0, new Number(1), new Date(0)];
  for (const path of leafPaths(allSettings())) {
    const original = atPath(allSettings(), path);
    if (typeof original === "number") {
      for (const value of invalid) { const input = allSettings(); replacePath(input, path, value); assertUnsupported(input); }
    }
    if (typeof original === "string") {
      for (const value of ["\ud800", "\udfff", "x\ud800x", "\ud800\ud800", "\udc00\ud800"]) {
        const input = allSettings(); replacePath(input, path, value); assertUnsupported(input);
      }
    }
  }
  for (const value of [null, undefined, [], new Set(), new Map(), new Uint8Array(), "{}", Object.create(minimalSettings())]) assertUnsupported(value);
  const cyclic = allSettings(); (cyclic.riskPolicy as Record<string, unknown>).hedgePolicy = cyclic;
  assertUnsupported(cyclic);
});

test("unknown nested keys and excluded labels are unsupported in the strict snapshot parser", () => {
  for (const path of containerPaths(allSettings())) {
    const input = allSettings(); (atPath(input, path) as Record<string, unknown>).futureField = 1;
    assertUnsupported(input);
  }
  for (const [root, nested] of [["riskPolicy", "now"], ["riskPolicy", "dynamicCashReserveMarketRegime"], ["universeManifest", "mode"]]) {
    const input = allSettings(); (input as unknown as Record<string, Record<string, unknown>>)[root!]![nested!] = "excluded";
    assert.equal(prepareReplaySettingsSnapshot(input).status, "recorded");
    assert.equal(replaySettingsSnapshotSchema.safeParse(input).success, false);
  }
  const input = { ...minimalSettings(), unknownRootOption: 1 };
  assert.deepEqual(recordedSettings(input).snapshot, minimalSettings());
  assert.equal(replaySettingsSnapshotSchema.safeParse(input).success, false);
});

test("frozen enum vocabularies accept each v1 value and reject unknown values", () => {
  const cases = [
    { path: ["candidateStrategyBucket"], values: ["long_term", "swing", "short_term", "intraday", "hedge"] },
    { path: ["constraints", "allowedActions", 0], values: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"] },
    { path: ["riskPolicy", "cooldownEntries", 0, "market"], values: ["KR", "US"] },
    { path: ["riskPolicy", "cooldownEntries", 0, "action"], values: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"] },
    { path: ["universeManifest", "symbols", 0, "market"], values: ["KR", "US"] },
    { path: ["universeManifest", "symbols", 0, "lifecycleStatus"], values: ["active", "suspended", "delisted", "unknown"] },
    { path: ["universeManifest", "symbols", 0, "lifecycleStatusSource"], values: ["explicit", "defaulted"] },
    { path: ["executionPolicy", "fillPriceRule"], values: ["current_candidate_last_price"] },
    { path: ["paperExitPolicy", "takeProfitMode"], values: ["full_exit", "partial_then_trail"] }
  ];
  for (const { path, values } of cases) {
    for (const value of values) {
      const input = allSettings(); replacePath(input, path, value);
      assert.equal(atPath(recordedSettings(input).snapshot, path), value);
    }
    for (const value of ["future", "", true, 0]) {
      const input = allSettings(); replacePath(input, path, value); assertUnsupported(input);
    }
  }
});

test("all object levels reject accessor, proxy, symbol and non-enumerable input without executing it", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Synthetic getter must not execute"); };
  const handler = { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap };
  for (const path of [[], ...containerPaths(allSettings())]) {
    for (const variation of ["proxy", "accessor", "hidden", "symbol", "prototype"]) {
      const input = allSettings(); const container = atPath(input, path) as object;
      if (variation === "proxy") {
        const proxy = new Proxy(container, handler);
        if (path.length) { replacePath(input, path, proxy); assertUnsupported(input); } else assertUnsupported(proxy);
      } else {
        // At root, only selected fields are inspected; opaque unrelated fields are intentionally ignored.
        const key = path.length ? Object.keys(container)[0]! : "packetIdPrefix";
        if (variation === "accessor") Object.defineProperty(container, key, { get: trap, enumerable: true });
        if (variation === "hidden") Object.defineProperty(container, key, { value: "hidden", enumerable: false });
        if (variation === "symbol") {
          if (!path.length) continue;
          Object.defineProperty(container, Symbol("unsupported"), { value: 1 });
        }
        if (variation === "prototype") Object.setPrototypeOf(container, { inherited: true });
        assertUnsupported(input);
      }
    }
  }
  const revocable = Proxy.revocable({}, {}); revocable.revoke(); assertUnsupported(revocable.proxy);
  assert.equal(calls, 0);
});

test("arrays reject sparse, own undefined, extra properties, accessors, subclass and proxies before Zod", () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error("Do not inspect array getters"); };
  class ArraySubclass extends Array<unknown> {}
  for (const path of [["constraints", "allowedActions"], ["universeManifest", "symbols"], ["riskPolicy", "cooldownEntries"]]) {
    const original = atPath(allSettings(), path) as unknown[];
    const arrays = [new Array(1), [undefined], Object.assign([...original], { extra: true }), new ArraySubclass(...original),
      Object.defineProperty([...original], "0", { get: getter, enumerable: true }),
      Object.defineProperty([...original], "0", { value: original[0], enumerable: false }),
      Object.assign([...original], { [Symbol("unknown")]: true }), new Proxy(original, { get: getter, ownKeys: getter })];
    for (const array of arrays) { const input = allSettings(); replacePath(input, path, array); assertUnsupported(input); }
  }
  assert.equal(calls, 0);
});

test("runner opaque root values and known excluded data fields are never read, cloned, hashed or traversed", () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error("Excluded data must stay opaque"); };
  const dangerous = new Proxy({}, { get: getter, ownKeys: getter, getPrototypeOf: getter });
  const input = allSettings(); const expected = structuredClone(input);
  for (const key of ["clock", "samplingPolicy", "decisionProvider", "performanceClock", "tickDelay", "onProgress", "futureOpaque"]) {
    Object.defineProperty(input, key, { get: getter, enumerable: true });
  }
  const risk = input.riskPolicy as Record<string, unknown>;
  for (const key of ["now", "dynamicCashReserveMarketRegime"]) risk[key] = dangerous;
  const universe = input.universeManifest as unknown as Record<string, unknown>;
  for (const key of ["mode", "universeId", "snapshotDate", "description", "disclaimer"]) universe[key] = dangerous;
  for (const member of input.universeManifest!.symbols) {
    for (const key of ["sourceSymbol", "name", "assetType", "assetClass", "region", "riskTags", "strategyBucket", "sector", "segment", "required", "tags"]) {
      (member as Record<string, unknown>)[key] = dangerous;
    }
  }
  const observed = recordedSettings(input);
  assert.deepEqual(observed.snapshot, expected);
  assert.equal(observed.contentHash, recordedSettings(expected).contentHash);
  assert.equal(calls, 0);
  for (const [container, key] of [[risk, "now"], [risk, "dynamicCashReserveMarketRegime"], [universe, "description"],
    [input.universeManifest!.symbols[0]!, "name"]] as const) {
    const before = Object.getOwnPropertyDescriptor(container, key)!;
    Object.defineProperty(container, key, { get: getter, enumerable: true, configurable: true });
    assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" });
    Object.defineProperty(container, key, before);
  }
  assert.equal(calls, 0);
});

test("observation parser guards discriminant getters, hostile scalar values and nested snapshot proxies", () => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Observation getter must not execute"); };
  const base = recordedSettings(minimalSettings());
  for (const value of [Object.defineProperty({ ...base }, "status", { get: trap, enumerable: true }),
    new Proxy(base, { get: trap, ownKeys: trap, getPrototypeOf: trap }), { ...base, snapshot: new Proxy(base.snapshot, { get: trap }) },
    { ...base, status: new Proxy({}, { get: trap }) }, { ...base, contentHash: undefined }, { ...base, futureField: 1 },
    { status: "unavailable", reason: "retention_unavailable" }, { ...base, snapshotVersion: "replay_settings_snapshot.v2" }]) {
    assert.equal(replaySettingsSnapshotObservationSchema.safeParse(value).success, false);
  }
  assert.equal(calls, 0);
});
function assertUnsupported(value: unknown): void {
  assert.deepEqual(prepareReplaySettingsSnapshot(value), { status: "unavailable", reason: "unsupported_shape" });
  assert.equal(replaySettingsSnapshotSchema.safeParse(value).success, false);
}
function containerPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (child === null || typeof child !== "object") return [];
    const path = [...prefix, Array.isArray(value) ? Number(key) : key]; return [path, ...containerPaths(child, path)];
  });
}
