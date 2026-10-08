import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initialOptions, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { FileVirtualPortfolioStore } from "../storage/repositories.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { runCodexHistoricalReplay } from "../replay/codexHistoricalReplayRunner.js";
import { sourceOptions, sourcePortfolio, sourceSnapshot, sourceTime } from "../replay/codexReplaySourceTestFixtures.js";
import { reserveReplayInitialPortfolioObservation, type ReplayChildObservationWriter,
  REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";

const marker = "SYNTHETIC_OPAQUE_SETTING_SECRET";
const allocation = () => ({ policyName: "ordinary", targetExposureRatio: 0.8, minCashReserveRatio: 0.1,
  maxBudgetPerDecisionRatio: 0.2, maxSymbolExposureRatio: 0.2 });

for (const kind of ["allocation getter", "allocation proxy", "inherited name", "execution throwing getter",
  "earlier redaction and later getter", "root options proxy", "unknown enumerable getter",
  "nested unknown enumerable getter", "unknown nested proxy", "Risk unknown enumerable getter",
  "Risk symbol enumerable getter", "Risk excluded enumerable getter"] as const) {
  test(`workflow refuses ${kind} before planning with no raw error or invented observation`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-opaque-planning-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const names = (await fs.readdir(root)).sort();
    const before = await Promise.all(names.map(name => fs.readFile(join(root, name))));
    let reads = 0, providers = 0, ticks = 0;
    const options = initialOptions(root);
    const trap = () => { reads++; throw Error(`api_key=${marker}`); };
    options.decisionProvider = { decide: async () => { providers++; throw Error("must not run"); } };
    options.clock.ticks = () => { ticks++; return []; };
    if (kind === "allocation getter" || kind === "earlier redaction and later getter") {
      options.allocationPolicy = allocation();
      Object.defineProperty(options.allocationPolicy, "policyName", { enumerable: true, get() { reads++; return `api_key=${marker}`; } });
    }
    if (kind === "earlier redaction and later getter") options.packetIdPrefix = `api_key=${marker}`;
    if (kind === "allocation proxy") options.allocationPolicy = new Proxy(allocation(), {
      get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap
    });
    if (kind === "inherited name") {
      const { policyName: _ignored, ...own } = allocation();
      options.allocationPolicy = Object.assign(Object.create({ policyName: `api_key=${marker}` }), own);
    }
    if (kind === "unknown enumerable getter" || kind === "nested unknown enumerable getter" || kind === "unknown nested proxy") {
      options.allocationPolicy = allocation();
      const extra: Record<string, unknown> = kind === "unknown nested proxy" ? new Proxy({}, {
        get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap
      }) : {};
      if (kind === "unknown enumerable getter") Object.defineProperty(options.allocationPolicy, "futureUnusedField", { enumerable: true, get: trap });
      else {
        if (kind === "nested unknown enumerable getter") Object.defineProperty(extra, "nested", { enumerable: true, get: trap });
        Object.assign(options.allocationPolicy, { futureUnusedField: extra });
      }
    }
    if (kind === "Risk unknown enumerable getter" || kind === "Risk symbol enumerable getter" || kind === "Risk excluded enumerable getter") {
      const key = kind === "Risk symbol enumerable getter" ? Symbol("futureRisk") : kind === "Risk excluded enumerable getter" ? "now" : "futureRisk";
      options.riskPolicy = Object.defineProperty({}, key, { enumerable: true, get: trap });
    }
    if (kind === "execution throwing getter") options.executionPolicy = Object.defineProperty({}, "feeBps", { enumerable: true, get: trap });
    const input = kind === "root options proxy" ? new Proxy(options, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap }) : options;
    const logs: string[] = [];
    for (const method of ["log", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    await assert.rejects(runHistoricalReplayWorkflow(input), error => {
      assert.equal((error as Error).message, "settings credential inspection unavailable");
      assert.equal(String(error).includes(marker), false); return true;
    });
    assert.equal(reads, 0); assert.equal(providers, 0); assert.equal(ticks, 0);
    assert.equal(logs.some(line => line.includes(marker)), false);
    assert.deepEqual((await fs.readdir(root)).sort(), names);
    assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(root, name)))), before);
  });
}

for (const kind of ["getter", "proxy", "inherited data", "Risk excluded enumerable getter",
  "unknown allocation value", "unknown allocation key"] as const) {
  test(`already initialized runner records ${kind} as durable unavailable before stopping`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-opaque-runner-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let reads = 0, calls = 0, ticks = 0, writer: ReplayChildObservationWriter | undefined;
    const trap = () => { reads++; throw Error(`api_key=${marker}`); };
    let policy = allocation();
    if (kind === "getter") Object.defineProperty(policy, "policyName", { enumerable: true, get: trap });
    if (kind === "proxy") policy = new Proxy(policy, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
    if (kind === "inherited data") {
      const { policyName: _ignored, ...own } = policy;
      policy = Object.assign(Object.create({ policyName: `api_key=${marker}` }), own);
    }
    const logs: string[] = [];
    for (const method of ["log", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    const reason = kind.startsWith("unknown allocation") ? "redacted" : "inspection_unavailable";
    if (kind === "unknown allocation value") Object.assign(policy, { ordinaryExtra: `api_key=${marker}` });
    if (kind === "unknown allocation key") Object.assign(policy, { [`api_key=${marker}`]: 1 });
    const options = sourceOptions({ allocationPolicy: policy,
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } },
      onInitialPortfolio: async portfolio => {
        writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
          identity: { runId: "child_opaque", batchId: "batch_opaque", runIndex: 1 }, startedAt: sourceTime, origin: "generated" });
        await writer(portfolio);
      }, onSourceSnapshots: async source => { await writer!.observeSource(source); },
      onSettings: async settings => {
        assert.deepEqual(settings, { status: "unavailable", reason });
        await writer!.observeSettings(settings);
        Object.assign(settings, { reason: "unsupported_shape" });
      }
    });
    if (kind === "Risk excluded enumerable getter") options.riskPolicy = Object.defineProperty({}, "now", { enumerable: true, get: trap });
    options.clock.ticks = () => { ticks++; return []; };
    await assert.rejects(runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] }),
      reason === "redacted" ? /^Error: settings input requires redaction$/ : /^Error: settings credential inspection unavailable$/);
    assert.equal(reads, 0); assert.equal(calls, 0); assert.equal(ticks, 0);
    assert.equal(logs.some(line => line.includes(marker)), false);
    const names = (await fs.readdir(root)).sort();
    assert.deepEqual(names, [REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE,
      REPLAY_SOURCE_OBSERVATION_FILE, REPLAY_SETTINGS_OBSERVATION_FILE].sort());
    for (const name of names) assert.equal((await fs.readFile(join(root, name), "utf8")).includes(marker), false);
    const settings = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.deepEqual(settings.settings, { status: "unavailable", reason });
    const before = await Promise.all(names.map(name => fs.readFile(join(root, name))));
    await assert.rejects(runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] }), /reservation failed/);
    assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(root, name)))), before);
    assert.equal(reads, 0); assert.equal(calls, 0);
  });
}


test("settings made opaque during the workflow input-read await are rechecked before planning", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-opaque-after-read-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const beforeNames = (await fs.readdir(root)).sort();
  const before = await Promise.all(beforeNames.map(name => fs.readFile(join(root, name))));
  let entered!: () => void, release!: () => void, reads = 0, calls = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const read = FileVirtualPortfolioStore.prototype.read;
  t.mock.method(FileVirtualPortfolioStore.prototype, "read", async function (this: FileVirtualPortfolioStore) {
    entered(); await gate; return read.call(this);
  });
  const options = { ...initialOptions(root), allocationPolicy: allocation(),
    decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
  const run = runHistoricalReplayWorkflow(options);
  const rejected = assert.rejects(run, error => {
    assert.equal((error as Error).message, "settings credential inspection unavailable");
    assert.equal(String(error).includes(marker), false); return true;
  });
  await waiting;
  Object.defineProperty(options.allocationPolicy, "policyName", { enumerable: true, get() { reads++; throw Error(`api_key=${marker}`); } });
  release(); await rejected;
  assert.equal(reads, 0); assert.equal(calls, 0);
  assert.deepEqual((await fs.readdir(root)).sort(), beforeNames);
  assert.deepEqual(await Promise.all(beforeNames.map(name => fs.readFile(join(root, name)))), before);
});
