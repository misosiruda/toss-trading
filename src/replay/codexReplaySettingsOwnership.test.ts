import assert from "node:assert/strict";
import test from "node:test";
import { REPLAY_SETTINGS_SNAPSHOT_VERSION, type ReplaySettingsSnapshotObservation } from "../domain/replaySettingsSnapshot.js";
import { runCodexHistoricalReplay } from "./codexHistoricalReplayRunner.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { sourceGate } from "./codexReplaySourceTestFixtures.js";
import { mutateSettings, settingsDecision, settingsScenario } from "./codexReplaySettingsTestFixtures.js";

test("settings capture precedes the initial await and observer edits cannot change packets, fills or summary", async t => {
  const baselineFixture = settingsScenario();
  delete baselineFixture.options.onSettings;
  const baseline = await runCodexHistoricalReplay(baselineFixture.options, baselineFixture.input);
  assert.equal(baseline.tickCount, 2);
  assert.deepEqual(baseline.trades.map(trade => [trade.action, trade.symbol]), [
    ["VIRTUAL_SELL", "005930"], ["VIRTUAL_BUY", "000660"], ["VIRTUAL_BUY", "000660"]
  ]);
  assert.deepEqual(baselineFixture.delays, [7, 7]);
  assert.deepEqual(baseline.paperExitPolicy, { takeProfitMode: "full_exit", takeProfitRatio: 0.15 });
  assert.deepEqual(baseline.packets[0]!.candidates.map(candidate => candidate.symbol).sort(), ["000660", "005930"]);
  assert.equal(baseline.packets[0]!.expiresAt, "2025-01-03T00:02:00.000Z");

  for (const stage of ["initial", "source", "settings", "progress", "provider"] as const) {
    await t.test(stage, async () => {
      const { options, input, supplied, delays } = settingsScenario();
      const entered = sourceGate(), release = sourceGate();
      let mutated = false;
      let observed: ReplaySettingsSnapshotObservation | undefined;
      const atStage = async (current: typeof stage) => {
        if (stage !== current || mutated) return;
        mutated = true;
        entered.release();
        await release.promise;
      };
      options.onInitialPortfolio = () => atStage("initial");
      options.onSourceSnapshots = () => atStage("source");
      options.onSettings = async observation => {
        assert.equal(observation.status, "recorded");
        if (observation.status !== "recorded") throw Error("Expected recorded settings");
        observed = structuredClone(observation);
        assert.deepEqual(observation.snapshot, supplied);
        assert.equal(observation.contentHash, createReplayResearchHash({
          schemaVersion: REPLAY_SETTINGS_SNAPSHOT_VERSION, snapshot: supplied
        }));
        assert.equal(Object.isFrozen(observation.snapshot), false);
        mutateSettings(observation.snapshot);
        await atStage("settings");
      };
      options.onProgress = () => atStage("progress");
      options.decisionProvider = { decide: async packet => {
        await atStage("provider");
        return settingsDecision(packet);
      } };
      const replay = runCodexHistoricalReplay(options, input);
      await entered.promise;
      assert.equal(Object.isFrozen(options.constraints.allowedActions), false);
      mutateSettings(options);
      release.release();
      const actual = await replay;
      assert.equal(mutated, true);
      assert.equal(observed?.status, "recorded");
      assert.deepEqual(actual.packets, baseline.packets);
      assert.deepEqual(actual.trades, baseline.trades);
      assert.deepEqual(actual.riskDecisions, baseline.riskDecisions);
      assert.deepEqual(actual.decisions, baseline.decisions);
      assert.deepEqual(actual.finalPortfolio, baseline.finalPortfolio);
      assert.deepEqual(actual.paperExitPolicy, baseline.paperExitPolicy);
      assert.deepEqual(actual.warnings, baseline.warnings);
      assert.deepEqual(actual.progressSummary, baseline.progressSummary);
      assert.deepEqual(delays, [7, 7]);
    });
  }
});

test("without settings observation the direct runner retains late caller settings reads", async () => {
  const { options, input, delays } = settingsScenario();
  delete options.onSettings;
  options.onInitialPortfolio = () => {
    options.packetIdPrefix = "legacy_change";
    options.maxCandidates = 1;
    options.paperExitPolicy!.takeProfitRatio = 9;
    options.tickDelayMs = 13;
  };
  const result = await runCodexHistoricalReplay(options, input);
  assert.equal(result.packets[0]!.packetId, "legacy_change_0");
  assert.equal(result.progressSummary.maxCandidatesPerStep, 1);
  assert.deepEqual(result.paperExitPolicy, { takeProfitMode: "full_exit", takeProfitRatio: 9 });
  assert.equal(result.trades.some(trade => trade.action === "VIRTUAL_SELL"), false);
  assert.deepEqual(delays, [13, 13]);
});
