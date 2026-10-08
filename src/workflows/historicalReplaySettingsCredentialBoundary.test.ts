import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initialOptions, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";

const marker = "SYNTHETIC_SETTINGS_OVERFLOW_SECRET";
const credential = `api_key=${marker}`;
const allocation = () => ({ policyName: "ordinary_policy", targetExposureRatio: 0.8, minCashReserveRatio: 0.1,
  maxBudgetPerDecisionRatio: 0.2, maxSymbolExposureRatio: 0.2 });

for (const shape of ["overlong prefix", "unknown risk first", "action limit first", "hidden selected name", "wrong scalar", "inspection exhausted"] as const) {
  test(`settings ${shape} cannot send credential-bearing input to legacy artifacts`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-credential-boundary-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const inputNames = await fs.readdir(root);
    const inputBytes = await Promise.all(inputNames.map(name => fs.readFile(join(root, name))));
    const options = initialOptions(root);
    options.allocationPolicy = allocation();
    if (shape === "overlong prefix") options.packetIdPrefix = credential + "X".repeat(150);
    if (shape === "unknown risk first") {
      options.riskPolicy = { futureUnusedField: 1 } as NonNullable<typeof options.riskPolicy>;
      options.allocationPolicy.policyName = credential;
    }
    if (shape === "action limit first") {
      options.constraints.allowedActions = Array.from({ length: 129 }, () => "VIRTUAL_HOLD");
      options.allocationPolicy.policyName = `https://example.test/prices?token=${marker}`;
    }
    if (shape === "hidden selected name") Object.defineProperty(options.allocationPolicy, "policyName", {
      value: `Authorization: Bearer ${marker}`, enumerable: false
    });
    if (shape === "wrong scalar") Object.assign(options, { maxCandidates: credential });
    if (shape === "inspection exhausted") options.packetIdPrefix = "X".repeat(4097) + credential;
    let calls = 0;
    options.decisionProvider = { decide: async () => { calls++; throw Error("provider must not run"); } };
    const logs: string[] = [];
    for (const method of ["log", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    const reason = shape === "inspection exhausted" ? "inspection_unavailable" : "redacted";
    const expected = reason === "redacted" ? "settings input requires redaction" : "settings credential inspection unavailable";
    await assert.rejects(runHistoricalReplayWorkflow(options), error => {
      assert.equal((error as Error).message, expected);
      assert.equal(String(error).includes(marker), false); return true;
    });
    assert.equal(calls, 0); assert.equal(logs.some(line => line.includes(marker)), false);
    assert.deepEqual(await Promise.all(inputNames.map(name => fs.readFile(join(root, name)))), inputBytes);
    const names = await fs.readdir(root);
    const outputs = names.filter(name => !inputNames.includes(name));
    assert.deepEqual(outputs.sort(), [REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE,
      REPLAY_SOURCE_OBSERVATION_FILE, REPLAY_SETTINGS_OBSERVATION_FILE].sort());
    for (const name of outputs) assert.equal((await fs.readFile(join(root, name), "utf8")).includes(marker), false);
    const record = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.deepEqual(record.settings, { status: "unavailable", reason });
    const before = await Promise.all(names.map(name => fs.readFile(join(root, name))));
    await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
    assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(root, name)))), before);
    assert.equal(calls, 0);
  });
}

for (const shape of ["public long prefix", "public long URL", "unknown risk", "extra actions"] as const) {
  test(`ordinary recording overflow ${shape} keeps the original accepted workflow`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-public-overflow-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const options = initialOptions(root);
    if (shape === "public long prefix") options.packetIdPrefix = "token_documentation_" + "X".repeat(150);
    if (shape === "public long URL") options.packetIdPrefix = "https://example.test/token/history/" + "X".repeat(160) + "?token_count=5";
    if (shape === "unknown risk") options.riskPolicy = { futureUnusedField: 1 } as NonNullable<typeof options.riskPolicy>;
    if (shape === "extra actions") options.constraints.allowedActions = Array.from({ length: 129 }, () => "VIRTUAL_HOLD");
    let calls = 0;
    options.decisionProvider = { decide: async packet => {
      calls++; return { attempted: true, command: null, failure: null, decision: { packetId: packet.packetId, summary: "synthetic public input", decisions: [] } };
    } };
    const result = await runHistoricalReplayWorkflow(options);
    assert.equal(result.status, "completed"); assert.equal(calls, 1);
    const record = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.deepEqual(record.settings, { status: "unavailable", reason: shape === "unknown risk" ? "unsupported_shape" : "limit" });
    assert.equal(result.replayResult.packets[0]!.packetId, `${options.packetIdPrefix}_0`);
  });
}
