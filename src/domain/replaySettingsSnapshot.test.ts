import assert from "node:assert/strict";
import test from "node:test";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { prepareReplaySettingsSnapshot, replaySettingsSnapshotSchema, REPLAY_SETTINGS_SNAPSHOT_VERSION as version } from "./replaySettingsSnapshot.js";
import { allSettings, atPath, leafPaths, minimalSettings, recordedSettings, replacePath } from "./replaySettingsSnapshotTestFixtures.js";

const alternatives: Record<string, string> = { KR: "US", US: "KR", VIRTUAL_BUY: "VIRTUAL_SELL", VIRTUAL_HOLD: "VIRTUAL_BUY",
  swing: "intraday", active: "unknown", suspended: "delisted", explicit: "defaulted", defaulted: "explicit", partial_then_trail: "full_exit" };

test("settings record every frozen v1 field without normalization and bind the documented hash domain", () => {
  const input = allSettings();
  const observed = recordedSettings(input);
  assert.deepEqual(observed.snapshot, input);
  assert.equal(observed.snapshotVersion, version);
  assert.equal(observed.contentHash, createReplayResearchHash({ schemaVersion: version, snapshot: input }));
  assert.deepEqual(replaySettingsSnapshotSchema.parse(input), input);
  assert.equal(observed.snapshot.riskPolicy!.cooldownEntries![0]!.activeUntil, "not a date");
});

test("each scalar and enum contributes to the settings hash, including map values and lifecycle source", () => {
  const base = allSettings();
  const hash = recordedSettings(base).contentHash;
  let changed = 0;
  for (const path of leafPaths(base)) {
    const input = structuredClone(base);
    const old = atPath(input, path);
    if (old === "current_candidate_last_price") {
      delete input.executionPolicy!.fillPriceRule;
    } else replacePath(input, path, typeof old === "number" ? old + 0.123 : typeof old === "boolean" ? !old : alternatives[String(old)] ?? `${old}X`);
    assert.notEqual(recordedSettings(input).contentHash, hash, path.join("."));
    changed += 1;
  }
  assert.equal(changed, 124, "The independent every-field fixture must cover the complete frozen v1 inventory");
});

test("every property preserves omission separately from presence, with required fields remaining required", () => {
  const required = new Set(["packetIdPrefix", "packetExpiresInSeconds", "maxCandidates", "maxSnapshotAgeSeconds", "constraints",
    "constraints.maxNewPositions", "constraints.maxBudgetPerSymbolKrw", "constraints.allowedActions", "allocationPolicy.policyName",
    "allocationPolicy.targetExposureRatio", "allocationPolicy.minCashReserveRatio", "allocationPolicy.maxBudgetPerDecisionRatio",
    "allocationPolicy.maxSymbolExposureRatio", "marketRegimeAllocationPolicy.lookbackDays", "riskPolicy.dynamicCashReservePolicy.lookbackDays",
    "riskPolicy.cooldownEntries.*.symbol", "riskPolicy.cooldownEntries.*.activeUntil", "universeManifest.symbols",
    "universeManifest.symbols.*.market", "universeManifest.symbols.*.symbol"]);
  const originalHash = recordedSettings(allSettings()).contentHash;
  for (const path of allPaths(allSettings())) {
    const input = allSettings();
    delete (atPath(input, path.slice(0, -1)) as Record<string | number, unknown>)[path.at(-1)!];
    const label = path.map(key => typeof key === "number" ? "*" : key).join(".");
    if (required.has(label) || typeof path.at(-1) === "number") {
      assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" }, label);
    } else assert.notEqual(recordedSettings(input).contentHash, originalHash, label);
  }
});

test("own undefined and null never become omission at any field or array element", () => {
  for (const path of allPaths(allSettings())) {
    for (const invalid of [undefined, null]) {
      const input = allSettings(); replacePath(input, path, invalid);
      assert.deepEqual(prepareReplaySettingsSnapshot(input), { status: "unavailable", reason: "unsupported_shape" }, path.join("."));
    }
  }
});

test("absence, empty objects/maps/arrays, zero, false and raw exit presence remain distinct", () => {
  const variants = [minimalSettings(), { ...minimalSettings(), tickDelayMs: 0 }, { ...minimalSettings(), paperExitPolicy: {} },
    { ...minimalSettings(), paperExitPolicy: { takeProfitSellRatio: 0 } }, { ...minimalSettings(), executionPolicy: {} },
    { ...minimalSettings(), executionPolicy: { allowFractionalShares: false } }, { ...minimalSettings(), riskPolicy: {} },
    { ...minimalSettings(), riskPolicy: { cooldownEntries: [] } }, { ...minimalSettings(), riskPolicy: { maxBucketTurnoverRatio: {} } },
    { ...minimalSettings(), universeManifest: { symbols: [] } },
    { ...minimalSettings(), constraints: { ...minimalSettings().constraints, allowedActions: [] } }];
  const hashes = variants.map(input => {
    const result = recordedSettings(input); assert.deepEqual(result.snapshot, input); return result.contentHash;
  });
  assert.equal(new Set(hashes).size, variants.length);
  const raw = { ...minimalSettings(), packetIdPrefix: "", packetExpiresInSeconds: -1.25, maxCandidates: 0,
    executionPolicy: { halfSpreadBps: -0.5, fillRatio: 2 }, paperExitPolicy: { takeProfitRatio: -1 },
    riskPolicy: { cooldownEntries: [{ symbol: "", activeUntil: "", reason: "" }] } };
  assert.deepEqual(recordedSettings(raw).snapshot, raw);
});

test("array order and duplicates affect hash while object key order does not", () => {
  const base = allSettings();
  const hash = recordedSettings(base).contentHash;
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  reordered.riskPolicy = Object.fromEntries(Object.entries(base.riskPolicy!).reverse());
  assert.equal(recordedSettings(reordered).contentHash, hash);
  for (const path of [["constraints", "allowedActions"], ["universeManifest", "symbols"], ["riskPolicy", "cooldownEntries"]]) {
    const doubled = allSettings();
    const entries = atPath(doubled, path) as unknown[]; entries.push(structuredClone(entries[0]));
    const doubledHash = recordedSettings(doubled).contentHash;
    assert.notEqual(doubledHash, hash);
    if (entries.length > 2) {
      entries.unshift(entries.pop()); assert.notEqual(recordedSettings(doubled).contentHash, doubledHash);
    }
  }
});

test("private snapshot and parsed output deeply freeze every container without freezing caller-owned data", () => {
  const input = allSettings(); const before = structuredClone(input); const observed = recordedSettings(input);
  assert.equal(Object.isFrozen(observed), true);
  assertDeepFrozen(observed.snapshot);
  assertDeepFrozen(replaySettingsSnapshotSchema.parse(input));
  for (const path of leafPaths(input)) {
    const old = atPath(input, path); replacePath(input, path, typeof old === "number" ? -9 : typeof old === "boolean" ? !old : "mutated");
  }
  input.universeManifest!.symbols.push({ market: "KR", symbol: "LATE" });
  assert.deepEqual(observed.snapshot, before);
  assert.equal(observed.contentHash, createReplayResearchHash({ schemaVersion: version, snapshot: before }));
  assert.throws(() => { observed.snapshot.constraints.allowedActions.push("VIRTUAL_SELL"); }, TypeError);
});

function allPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...prefix, Array.isArray(value) ? Number(key) : key]; return [path, ...allPaths(child, path)];
  });
}
function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}
