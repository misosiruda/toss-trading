import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hasUninspectableReplayResearchUniverse } from "./historicalReplaySettingsPreparation.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { initialOptions, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";

const marker = "SYNTHETIC_ALLOCATION_KEY_SECRET";
const allocation = () => ({ policyName: "ordinary", targetExposureRatio: 0.8, minCashReserveRatio: 0.1,
  maxBudgetPerDecisionRatio: 0.2, maxSymbolExposureRatio: 0.2 });
const universe = () => ({ mode: "paper_only_historical_universe" as const, universeId: "ordinary", snapshotDate: "2026-01-05",
  description: "ordinary public label", disclaimer: "synthetic", symbols: [{ market: "KR" as const, symbol: "005930",
    lifecycleStatus: "active" as const, lifecycleStatusSource: "explicit" as const, required: true, tags: ["ordinary"] }] });

test("preparation inspects every consumed universe descriptor while retaining non-consumed fields and plain labels", () => {
  let reads = 0;
  const trap = () => { reads++; throw Error(marker); };
  for (const [scope, fields] of [["manifest", ["mode", "universeId", "snapshotDate", "description", "disclaimer"]],
    ["member", ["sourceSymbol", "name", "assetType", "assetClass", "region", "riskTags", "strategyBucket", "sector", "segment", "required", "tags"]]] as const) {
    for (const field of fields) {
      const value = universe();
      Object.defineProperty(scope === "manifest" ? value : value.symbols[0], field, { get: trap });
      assert.equal(hasUninspectableReplayResearchUniverse({ universeManifest: value }), true, field);
    }
  }
  const ordinary = universe();
  Object.defineProperty(ordinary, "unused", { get: trap });
  Object.defineProperty(ordinary.symbols[0], "unused", { get: trap });
  assert.equal(hasUninspectableReplayResearchUniverse({ universeManifest: ordinary }), false);
  ordinary.description = `api_key=${marker}`;
  assert.equal(hasUninspectableReplayResearchUniverse({ universeManifest: ordinary }), false, "Plain label contents stay excluded from credential scan");
  const excluded = Object.defineProperty({}, "decisionProvider", { get: trap });
  assert.equal(hasUninspectableReplayResearchUniverse(excluded), false);
  assert.equal(reads, 0);
});

for (const kind of ["label getter", "nested tags proxy"] as const) {
  test(`workflow refuses ${kind} before preparation without reading it or creating output`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-research-opacity-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const names = (await fs.readdir(root)).sort();
    let reads = 0, calls = 0;
    const value = universe();
    const trap = () => { reads++; throw Error(marker); };
    if (kind === "label getter") Object.defineProperty(value, "description", { get: trap });
    else value.symbols[0]!.tags = new Proxy([], { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    const options = { ...initialOptions(root), universeManifest: value,
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
    await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: settings credential inspection unavailable$/);
    assert.equal(reads, 0); assert.equal(calls, 0);
    assert.deepEqual((await fs.readdir(root)).sort(), names);
  });
}

for (const value of [undefined, Number.NaN, 1n, Symbol("ordinary")]) {
  test(`credential allocation key with ${typeof value} preparation failure has a fixed error and no fabricated observation`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-preparation-key-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const names = (await fs.readdir(root)).sort();
    let calls = 0;
    const options = { ...initialOptions(root), allocationPolicy: { ...allocation(), [`api_key=${marker}`]: value },
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
    await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: settings input requires redaction$/);
    assert.equal(calls, 0);
    assert.deepEqual((await fs.readdir(root)).sort(), names);
  });
}

test("safe preparation diagnostic remains visible and ordinary unknown allocation data keeps its prior failure", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-safe-preparation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const options = { ...initialOptions(root), allocationPolicy: { ...allocation(), ordinaryExtra: undefined } };
  await assert.rejects(runHistoricalReplayWorkflow(options), /Research hash input must be JSON-compatible plain data.*ordinaryExtra/);
});

test("credential allocation key with otherwise valid data reaches the durable redacted boundary", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-durable-allocation-key-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const inputs = new Set(await fs.readdir(root));
  let calls = 0;
  const options = { ...initialOptions(root), allocationPolicy: { ...allocation(), [`api_key=${marker}`]: 1 },
    decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
  await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: settings input requires redaction$/);
  const names = (await fs.readdir(root)).filter(name => !inputs.has(name));
  assert.equal(names.length, 4); assert.equal(calls, 0);
  for (const name of names) assert.equal((await fs.readFile(join(root, name), "utf8")).includes(marker), false);
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8")).settings,
    { status: "unavailable", reason: "redacted" });
});
