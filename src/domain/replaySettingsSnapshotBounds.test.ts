import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { prepareReplaySettingsSnapshot, replaySettingsSnapshotObservationSchema, REPLAY_SETTINGS_SNAPSHOT_LIMITS as limits } from "./replaySettingsSnapshot.js";
import { allSettings, atPath, minimalSettings, recordedSettings, replacePath, settingsAtJsonBytes } from "./replaySettingsSnapshotTestFixtures.js";

test("settings count caps preserve boundary-minus-one and exact and reject plus-one", () => {
  const cases = [
    { path: ["constraints", "allowedActions"], cap: limits.allowedActions, entry: "VIRTUAL_HOLD" },
    { path: ["riskPolicy", "cooldownEntries"], cap: limits.cooldownEntries, entry: { symbol: "SYNTH", activeUntil: "invalid raw time" } },
    { path: ["universeManifest", "symbols"], cap: limits.universeMembers, entry: { market: "KR", symbol: "SYNTH" } }
  ];
  for (const { path, cap, entry } of cases) {
    for (const count of [cap - 1, cap, cap + 1]) {
      const input = allSettings(); replacePath(input, path, Array.from({ length: count }, () => structuredClone(entry)));
      if (count <= cap) assert.equal((atPath(recordedSettings(input).snapshot, path) as unknown[]).length, count);
      else expectLimit(input);
    }
  }
});

test("string caps count raw UTF-16 units, separately from escaped JSON UTF-8 bytes", () => {
  const cases = [
    { path: ["packetIdPrefix"], cap: limits.textUnits }, { path: ["allocationPolicy", "policyName"], cap: limits.textUnits },
    { path: ["marketRegimeAllocationPolicy", "policyNameSuffix"], cap: limits.textUnits },
    { path: ["universeManifest", "symbols", 0, "symbol"], cap: limits.textUnits },
    { path: ["riskPolicy", "cooldownEntries", 0, "symbol"], cap: limits.textUnits },
    { path: ["riskPolicy", "cooldownEntries", 0, "activeUntil"], cap: limits.timeUnits },
    { path: ["riskPolicy", "cooldownEntries", 0, "reason"], cap: limits.reasonUnits }
  ];
  for (const { path, cap } of cases) {
    for (const character of ["X", "가", "\u0001", "😀"]) {
      for (const units of [cap - 1, cap, cap + 1]) {
        const value = character.repeat(Math.floor(units / character.length)) + "X".repeat(units % character.length);
        assert.equal(value.length, units);
        const input = allSettings(); replacePath(input, path, value);
        if (units <= cap) assert.equal(atPath(recordedSettings(input).snapshot, path), value);
        else expectLimit(input);
      }
    }
  }
});

test("map caps use the frozen six/five/two key sets and preserve empty and partial maps", () => {
  const cases = [
    { path: ["riskPolicy", "maxStrategyBucketExposureKrw"], cap: 6 }, { path: ["riskPolicy", "maxStrategyBucketExposureRatio"], cap: 6 },
    { path: ["riskPolicy", "maxBucketTurnoverKrw"], cap: 6 }, { path: ["riskPolicy", "maxBucketTurnoverRatio"], cap: 6 },
    { path: ["riskPolicy", "dynamicCashReservePolicy", "regimeCashReserveRatios"], cap: 5 },
    { path: ["marketRegimeAllocationPolicy", "regimeWeights"], cap: 5 }, { path: ["allocationPolicy", "marketTargetExposureRatios"], cap: 2 }
  ];
  for (const { path, cap } of cases) {
    const entries = Object.entries(atPath(allSettings(), path) as object);
    assert.equal(entries.length, cap);
    for (const count of [0, cap - 1, cap]) {
      const input = allSettings(); const map = Object.fromEntries(entries.slice(0, count)); replacePath(input, path, map);
      assert.deepEqual(atPath(recordedSettings(input).snapshot, path), map);
    }
    for (const entriesWithUnknown of [[...entries, ["future", 1]], [["future", 1]]]) {
      const input = allSettings(); replacePath(input, path, Object.fromEntries(entriesWithUnknown));
      assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" });
    }
  }
});

test("raw snapshot JSON budget rejects plus-one and preserves exact escaped ASCII, CJK and control-byte boundaries", () => {
  // Deliberately serial: each fixture fits the schema without artificial padding or large unbounded strings.
  for (const kind of ["ascii", "cjk", "control"] as const) {
    for (const bytes of [limits.jsonBytes - 1, limits.jsonBytes, limits.jsonBytes + 1]) {
      const input = settingsAtJsonBytes(bytes, kind);
      if (bytes <= limits.jsonBytes) assert.equal(Buffer.byteLength(JSON.stringify(recordedSettings(input).snapshot)), bytes);
      else expectLimit(input);
    }
  }
});

test("count, text, bytes and redaction failures never reach whole-object serialization, cloning or hashing", t => {
  const byteOversize = settingsAtJsonBytes(limits.jsonBytes + 1);
  let getters = 0;
  const countOversize = allSettings();
  const oversized = new Array(limits.universeMembers + 1);
  Object.defineProperty(oversized, "0", { get() { getters += 1; throw new Error("Do not inspect above-cap members"); }, enumerable: true });
  replacePath(countOversize, ["universeManifest", "symbols"], oversized);
  const originalStringify = JSON.stringify;
  const stringify = t.mock.method(JSON, "stringify", (value: unknown) => {
    assert.ok(value === null || typeof value !== "object", "Only bounded primitives may be serialized in preflight");
    return originalStringify(value);
  });
  const clone = t.mock.method(globalThis, "structuredClone", () => { throw new Error("Do not clone rejected settings"); });
  const hash = t.mock.method(crypto, "createHash", () => { throw new Error("Do not hash rejected settings"); });
  syncBuiltinESMExports();
  try {
    for (const input of [byteOversize, countOversize, { ...minimalSettings(), packetIdPrefix: "X".repeat(limits.textUnits + 1) }]) expectLimit(input);
    assert.deepEqual(prepareReplaySettingsSnapshot({ ...minimalSettings(), packetIdPrefix: "token=SYNTHETIC_PRIVATE" }),
      { status: "unavailable", reason: "redacted" });
    assert.equal(getters, 0); assert.equal(clone.mock.callCount(), 0); assert.equal(hash.mock.callCount(), 0);
  } finally { stringify.mock.restore(); clone.mock.restore(); hash.mock.restore(); syncBuiltinESMExports(); }
});

test("forged recorded observations cannot bypass the snapshot size or credential preflight", () => {
  const observation = recordedSettings(minimalSettings());
  for (const input of [settingsAtJsonBytes(limits.jsonBytes + 1), { ...minimalSettings(), packetIdPrefix: "X".repeat(121) },
    { ...minimalSettings(), packetIdPrefix: "Authorization: Bearer SYNTHETIC_PRIVATE" }]) {
    assert.equal(replaySettingsSnapshotObservationSchema.safeParse({ ...observation, snapshot: input }).success, false);
  }
});
function expectLimit(value: unknown): void {
  assert.deepEqual(prepareReplaySettingsSnapshot(value), { status: "unavailable", reason: "limit" });
}
