import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { inspectReplaySettingsCredentials, REPLAY_SETTINGS_CREDENTIAL_INSPECTION_LIMITS as limits } from "./replaySettingsCredentialInspection.js";
import { prepareReplaySettingsSnapshot, replaySettingsSnapshotObservationSchema, replaySettingsSnapshotSchema } from "./replaySettingsSnapshot.js";
import { allSettings, minimalSettings, recordedSettings, settingsAtJsonBytes } from "./replaySettingsSnapshotTestFixtures.js";

const credential = "api_key=SYNTHETIC_PRIVATE";
const unavailable = (reason: string) => ({ status: "unavailable", reason });

test("credential inspection precedes observer string limits while preserving long public URL classification", () => {
  for (const length of [121, 512, limits.perStringUnits]) {
    const secret = credential + "X".repeat(length - credential.length);
    const input = { ...minimalSettings(), packetIdPrefix: secret };
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("redacted"));
    const result = replaySettingsSnapshotSchema.safeParse(input);
    assert.equal(result.success, false);
    assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE"), false);
    const publicUrl = "https://fixture.invalid/token/history?q=public&description=";
    assert.deepEqual(prepareReplaySettingsSnapshot({ ...input, packetIdPrefix: publicUrl + "X".repeat(length - publicUrl.length) }), unavailable("limit"));
  }
});

test("earlier unknown keys, accessors, own undefined and oversized arrays cannot hide a later selected credential", () => {
  let calls = 0;
  const getter = () => { calls += 1; throw new Error("Synthetic accessor must not run"); };
  const variants = [
    { ...allSettings(), riskPolicy: { futureField: true } },
    { ...allSettings(), riskPolicy: Object.defineProperty({}, "maxBudgetPerDecisionKrw", { get: getter }) },
    { ...allSettings(), riskPolicy: { maxBudgetPerDecisionKrw: undefined } },
    { ...allSettings(), constraints: { ...minimalSettings().constraints, allowedActions: Array(129).fill("VIRTUAL_HOLD") } }
  ];
  for (const input of variants) {
    input.allocationPolicy!.policyName = credential;
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("redacted"));
  }
  assert.equal(calls, 0);
});

test("known plain data descriptors are inspected regardless of enumerability or wrong scalar type", () => {
  const hidden = Object.defineProperty(minimalSettings(), "packetIdPrefix", { value: credential, enumerable: false });
  for (const input of [hidden, { ...minimalSettings(), maxCandidates: credential },
    { ...minimalSettings(), executionPolicy: { rejectStaleLiquidity: credential } },
    { ...minimalSettings(), riskPolicy: Object.defineProperty({}, "maxSymbolExposureKrw", { value: credential }) },
    { ...minimalSettings(), constraints: credential }]) {
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("redacted"));
  }
});

test("security inspection ignores unknown/excluded fields and classifies selected getters/proxies as unavailable", t => {
  let calls = 0;
  const trap = () => { calls += 1; throw new Error("Do not execute opaque code"); };
  const proxy = new Proxy({ maxBudgetPerDecisionKrw: credential }, { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
  const revocable = Proxy.revocable({}, {}); revocable.revoke();
  const unknown = { ...minimalSettings(), riskPolicy: { futureField: credential } };
  const accessor = { ...minimalSettings(), riskPolicy: Object.defineProperty({}, "maxBudgetPerDecisionKrw", { get: trap }) };
  assert.equal(inspectReplaySettingsCredentials(unknown), undefined);
  assert.deepEqual(prepareReplaySettingsSnapshot(unknown), unavailable("unsupported_shape"));
  for (const input of [accessor, { ...minimalSettings(), riskPolicy: proxy }, { ...minimalSettings(), riskPolicy: revocable.proxy }]) {
    assert.equal(inspectReplaySettingsCredentials(input), "inspection_unavailable");
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("inspection_unavailable"));
  }
  const input = { ...minimalSettings(), riskPolicy: { now: credential, dynamicCashReserveMarketRegime: proxy },
    universeManifest: { description: credential, symbols: [{ market: "KR", symbol: "SYNTH", name: credential, tags: proxy }] } };
  Object.defineProperty(input, "decisionProvider", { get: trap });
  const originalOwnKeys = Reflect.ownKeys;
  const ownKeys = t.mock.method(Reflect, "ownKeys", (value: object) => {
    assert.ok(value === input.constraints || value === input.riskPolicy, "Only actual wholesale consumers may enumerate keys");
    return originalOwnKeys(value);
  });
  const descriptors = t.mock.method(Object, "getOwnPropertyDescriptors", () => { throw new Error("Security inspection must use known keys"); });
  try { assert.equal(inspectReplaySettingsCredentials(input), undefined); }
  finally { ownKeys.mock.restore(); descriptors.mock.restore(); }
  assert.equal(recordedSettings(input).snapshot.riskPolicy!.maxBudgetPerDecisionKrw, undefined);
  assert.equal(calls, 0);
});

test("per-leaf security cap is separate from recording limits and bounded siblings still receive inspection", () => {
  for (const units of [limits.perStringUnits - 1, limits.perStringUnits, limits.perStringUnits + 1]) {
    const input = { ...minimalSettings(), packetIdPrefix: "X".repeat(units) };
    assert.equal(inspectReplaySettingsCredentials(input), units <= limits.perStringUnits ? undefined : "inspection_unavailable");
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable(units <= limits.perStringUnits ? "limit" : "inspection_unavailable"));
  }
  const input = { ...allSettings(), packetIdPrefix: "X".repeat(limits.perStringUnits + 1) };
  input.allocationPolicy!.policyName = credential;
  assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("redacted"));
  const safe = prepareReplaySettingsSnapshot({ ...minimalSettings(), packetIdPrefix: "X".repeat(limits.perStringUnits + 1) });
  assert.deepEqual(replaySettingsSnapshotObservationSchema.parse(safe), safe);
  assert.equal(Object.hasOwn(safe, "snapshot"), false); assert.equal(Object.hasOwn(safe, "contentHash"), false);
});

test("security-blocked settings never reach serialization, cloning or content hashing", t => {
  const secret = { ...minimalSettings(), packetIdPrefix: credential + "X".repeat(120) };
  const uninspectable = { ...minimalSettings(), packetIdPrefix: "X".repeat(limits.perStringUnits + 1) };
  const stringify = t.mock.method(JSON, "stringify", () => { throw new Error("Do not serialize security-blocked settings"); });
  const clone = t.mock.method(globalThis, "structuredClone", () => { throw new Error("Do not clone security-blocked settings"); });
  const hash = t.mock.method(crypto, "createHash", () => { throw new Error("Do not hash security-blocked settings"); });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(prepareReplaySettingsSnapshot(secret), unavailable("redacted"));
    assert.deepEqual(prepareReplaySettingsSnapshot(uninspectable), unavailable("inspection_unavailable"));
    assert.equal(stringify.mock.callCount(), 0); assert.equal(clone.mock.callCount(), 0); assert.equal(hash.mock.callCount(), 0);
  } finally { stringify.mock.restore(); clone.mock.restore(); hash.mock.restore(); syncBuiltinESMExports(); }
});

test("security aggregate UTF-16 budget has exact boundaries and never resets across siblings", () => {
  for (const units of [limits.totalStringUnits - 1, limits.totalStringUnits, limits.totalStringUnits + 1]) {
    const input = atTotalStringUnits(units);
    assert.equal(inspectReplaySettingsCredentials(input), units <= limits.totalStringUnits ? undefined : "inspection_unavailable");
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable(units <= limits.totalStringUnits ? "limit" : "inspection_unavailable"));
  }
  const input = { ...atTotalStringUnits(limits.totalStringUnits), allocationPolicy: { ...allSettings().allocationPolicy!, policyName: credential } };
  assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("inspection_unavailable"));
});

test("security visited-value budget counts present selected values with exact boundaries", () => {
  for (const values of [limits.visitedValues - 1, limits.visitedValues, limits.visitedValues + 1]) {
    const input = atVisitedValues(values);
    assert.equal(inspectReplaySettingsCredentials(input), values <= limits.visitedValues ? undefined : "inspection_unavailable");
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable(values <= limits.visitedValues ? "limit" : "inspection_unavailable"));
  }
  const input = { ...atVisitedValues(limits.visitedValues), allocationPolicy: { ...allSettings().allocationPolicy!, policyName: credential } };
  assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("inspection_unavailable"));
});

test("security array cap scans beyond observer limits and keeps bounded later siblings available", () => {
  for (const length of [limits.arrayEntries - 1, limits.arrayEntries, limits.arrayEntries + 1]) {
    const input = { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: Array(length).fill("VIRTUAL_HOLD") } };
    assert.equal(inspectReplaySettingsCredentials(input), length <= limits.arrayEntries ? undefined : "inspection_unavailable");
    assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable(length <= limits.arrayEntries ? "limit" : "inspection_unavailable"));
  }
  const input = { ...allSettings(), constraints: { ...minimalSettings().constraints, allowedActions: Array(limits.arrayEntries + 1).fill("VIRTUAL_HOLD") } };
  input.allocationPolicy!.policyName = credential;
  assert.deepEqual(prepareReplaySettingsSnapshot(input), unavailable("redacted"));
  const late = Array(130).fill("VIRTUAL_HOLD"); late[129] = credential;
  assert.deepEqual(prepareReplaySettingsSnapshot({ ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: late } }), unavailable("redacted"));
});

test("maximal sparse arrays have bounded descriptor work and never inspect indices beyond the safety cap", t => {
  const sparse = new Array(0xffff_ffff);
  const input = { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: sparse } };
  let entries = 0; let structuralProbes = 0;
  const descriptor = Object.getOwnPropertyDescriptor;
  const read = t.mock.method(Object, "getOwnPropertyDescriptor", (value: unknown, key: PropertyKey) => {
    if (value === sparse) {
      if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)) { assert.ok(Number(key) < limits.arrayEntries); entries += 1; }
      else structuralProbes += 1;
    }
    return descriptor(value, key);
  });
  try { assert.equal(inspectReplaySettingsCredentials(input), "inspection_unavailable"); }
  finally { read.mock.restore(); }
  assert.equal(entries, limits.arrayEntries);
  assert.equal(structuralProbes, 9, "Two length reads and seven fixed executable-hook probes stay bounded");
});

test("valid maximum shape counts and normal four-MiB overflow remain within security budgets", () => {
  const input = allSettings();
  input.constraints.allowedActions = Array(128).fill("VIRTUAL_HOLD");
  input.riskPolicy!.cooldownEntries = Array(2_048).fill(input.riskPolicy!.cooldownEntries![0]);
  input.universeManifest!.symbols = Array(20_000).fill(input.universeManifest!.symbols[0]);
  assert.equal(countValues(input), 112_545);
  assert.equal(inspectReplaySettingsCredentials(input), undefined);
  assert.equal(prepareReplaySettingsSnapshot(input).status, "recorded");
  assert.deepEqual(prepareReplaySettingsSnapshot(settingsAtJsonBytes(4_194_305)), unavailable("limit"));
});

function atTotalStringUnits(units: number) {
  const input = minimalSettings();
  let remaining = units - input.packetIdPrefix.length;
  const entries: string[] = [];
  while (remaining > 0) { const count = Math.min(remaining, limits.perStringUnits); entries.push("X".repeat(count)); remaining -= count; }
  return { ...input, constraints: { ...input.constraints, allowedActions: entries } };
}
function atVisitedValues(values: number) {
  // Minimal settings contain eleven values. Risk and cooldown array add two; each full entry adds six.
  const remaining = values - 13;
  const entry = { market: 0, symbol: 0, action: 0, activeUntil: 0, reason: 0 };
  const entries: object[] = Array(Math.floor(remaining / 6)).fill(entry);
  const tail = remaining % 6;
  if (tail) entries.push(Object.fromEntries(Object.entries(entry).slice(0, tail - 1)));
  const input = { ...minimalSettings(), riskPolicy: { cooldownEntries: entries } };
  assert.equal(countValues(input), values);
  return input;
}
function countValues(value: unknown): number {
  return 1 + (value !== null && typeof value === "object" ? Object.values(value).reduce<number>((sum, child) => sum + countValues(child), 0) : 0);
}
