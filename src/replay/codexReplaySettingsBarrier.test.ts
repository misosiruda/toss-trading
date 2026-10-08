import assert from "node:assert/strict";
import test from "node:test";
import { REPLAY_SETTINGS_SNAPSHOT_LIMITS } from "../domain/replaySettingsSnapshot.js";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import { sourceDecision, sourceGate, sourceOptions, sourcePortfolio, sourceSnapshot } from "./codexReplaySourceTestFixtures.js";

test("settings persistence is awaited after initial/source and before clock, progress or provider", async t => {
  const events: string[] = [], entered = sourceGate(), gate = sourceGate();
  const options = sourceOptions({
    onInitialPortfolio: () => { events.push("initial"); },
    onSourceSnapshots: () => { events.push("source"); },
    onSettings: async observation => {
      assert.equal(observation.status, "recorded");
      events.push("settings-start"); entered.release(); await gate.promise; events.push("settings-durable");
    },
    onProgress: () => { events.push("progress"); },
    decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
  });
  const ticks = options.clock.ticks.bind(options.clock);
  t.mock.method(options.clock, "ticks", () => { events.push("ticks"); return ticks(); });
  const replay = runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
  await entered.promise;
  assert.deepEqual(events, ["initial", "source", "settings-start"]);
  gate.release();
  const result = await replay;
  assert.deepEqual(events, ["initial", "source", "settings-start", "settings-durable", "ticks", "provider", "progress"]);
  assert.equal(result.decisionProviderCallCount, 1);
});

test("recorded and unavailable settings writer failures retain the zero-tick zero-provider barrier", async t => {
  for (const status of ["recorded", "unsupported_shape", "limit", "redacted"] as const) {
    await t.test(status, async subtest => {
      const events: string[] = [];
      const options = sourceOptions({
        onInitialPortfolio: () => { events.push("initial"); },
        onSourceSnapshots: () => { events.push("source"); },
        onSettings: async observation => {
          assert.deepEqual(observation.status === "recorded" ? "recorded" : observation.reason, status);
          events.push("settings-write");
          throw Error("synthetic settings durability failure");
        },
        onProgress: () => { events.push("progress"); },
        decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
      });
      if (status === "unsupported_shape") options.executionPolicy = undefined;
      if (status === "limit") options.constraints.allowedActions = Array.from({ length: REPLAY_SETTINGS_SNAPSHOT_LIMITS.allowedActions + 1 }, () => "VIRTUAL_HOLD");
      if (status === "redacted") options.packetIdPrefix = "token=synthetic-settings-credential";
      subtest.mock.method(options.clock, "ticks", () => { events.push("ticks"); return []; });
      await assert.rejects(runCodexHistoricalReplay(options, {
        initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()]
      }), /synthetic settings durability failure/);
      assert.deepEqual(events, ["initial", "source", "settings-write"]);
    });
  }
});

test("redacted settings remain a safe stop after durable callback even if caller and observer downgrade them", async t => {
  const sensitive = "token=synthetic-settings-credential";
  const events: string[] = [], entered = sourceGate(), gate = sourceGate();
  const options = sourceOptions({ packetIdPrefix: sensitive,
    onInitialPortfolio: () => { events.push("initial"); options.packetIdPrefix = "now_safe"; },
    onSourceSnapshots: source => { assert.equal(source.status, "recorded"); events.push("source"); },
    onSettings: async observation => {
      assert.deepEqual(observation, { status: "unavailable", reason: "redacted" });
      assert.equal(JSON.stringify(observation).includes(sensitive), false);
      Object.assign(observation, { reason: "unsupported_shape" });
      events.push("settings-start"); entered.release(); await gate.promise; events.push("settings-durable");
    },
    onProgress: () => { events.push("progress"); },
    decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
  });
  t.mock.method(options.clock, "ticks", () => { events.push("ticks"); return []; });
  const replay = runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
  const rejected = assert.rejects(replay, error => {
    assert.match(String(error), /settings input requires redaction/);
    assert.equal(String(error).includes(sensitive), false);
    return true;
  });
  await entered.promise;
  assert.deepEqual(events, ["initial", "source", "settings-start"]);
  gate.release();
  await rejected;
  assert.deepEqual(events, ["initial", "source", "settings-start", "settings-durable"]);
});

test("source redaction still stops before settings even when its callback mutates the observation", async t => {
  const events: string[] = [];
  const options = sourceOptions({
    onInitialPortfolio: () => { events.push("initial"); },
    onSourceSnapshots: source => {
      assert.deepEqual(source, { status: "unavailable", reason: "redacted" });
      Object.assign(source, { reason: "unsupported_shape" });
      events.push("source-durable");
    },
    onSettings: () => { events.push("settings"); },
    onProgress: () => { events.push("progress"); },
    decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
  });
  t.mock.method(options.clock, "ticks", () => { events.push("ticks"); return []; });
  await assert.rejects(runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(),
    snapshots: [sourceSnapshot({ sourceRefs: ["https://synthetic.invalid/history?token=fixture"] })]
  }), /source input requires redaction/);
  assert.deepEqual(events, ["initial", "source-durable"]);
});

test("an observation limit falls back to the original settings without freezing or narrowing replay", async () => {
  const options = sourceOptions({ onInitialPortfolio: () => {
    options.packetIdPrefix = "after_initial";
    options.constraints.maxBudgetPerSymbolKrw = 200_000;
  }, onSettings: observation => {
    assert.deepEqual(observation, { status: "unavailable", reason: "limit" });
    options.constraints.allowedActions.push("VIRTUAL_BUY");
    options.constraints.maxBudgetPerSymbolKrw = 150_000;
  }, decisionProvider: { decide: async packet => sourceDecision(packet, "005930") } });
  options.constraints.allowedActions = Array.from({ length: REPLAY_SETTINGS_SNAPSHOT_LIMITS.allowedActions + 1 }, () => "VIRTUAL_HOLD");
  const result = await runCodexHistoricalReplay(options, { initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
  assert.equal(result.packets[0]!.packetId, "after_initial_0");
  assert.equal(result.packets[0]!.constraints.maxBudgetPerSymbolKrw, 150_000);
  assert.equal(result.packets[0]!.constraints.allowedActions.length, REPLAY_SETTINGS_SNAPSHOT_LIMITS.allowedActions + 2);
  assert.equal(Object.isFrozen(options.constraints.allowedActions), false);
  assert.equal(result.tradeCount, 1);
});
