import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStrategyReplayPresetName,
  resolveStrategyReplayPreset,
  STRATEGY_REPLAY_PRESET_NAMES
} from "./strategyReplayPreset.js";

test("strategy replay presets use non-trivial paper-only decision budgets", () => {
  for (const name of STRATEGY_REPLAY_PRESET_NAMES) {
    const preset = resolveStrategyReplayPreset(name);
    const minimumFreshnessSeconds =
      name === "intraday" ? 24 * 60 * 60 : 14 * 24 * 60 * 60;

    assert.equal(preset.name, name);
    assert.ok(preset.maxDecisionCalls > 1);
    assert.equal(preset.maxCodexCallsPerRun, preset.maxDecisionCalls);
    assert.ok(preset.windowMonths >= 1);
    assert.ok(preset.stepSeconds > 0);
    assert.ok(preset.maxSnapshotAgeSeconds >= minimumFreshnessSeconds);
    assert.ok(preset.minWindowSnapshots >= 1);
    assert.ok(preset.minSnapshotsPerRequiredSymbol >= 1);
  }
});

test("strategy replay presets cover strategy buckets with conservative policies", () => {
  const intradayPreset = resolveStrategyReplayPreset("intraday");
  const hedgePreset = resolveStrategyReplayPreset("hedge");

  assert.equal(intradayPreset.decisionFrequency, "every_tick");
  assert.equal(intradayPreset.stepSeconds, 60 * 60);
  assert.equal(intradayPreset.paperExitPolicy?.takeProfitMode, "full_exit");

  assert.deepEqual(hedgePreset.riskPolicy?.maxStrategyBucketExposureRatio, {
    hedge: 0.25
  });
  assert.deepEqual(hedgePreset.riskPolicy?.hedgePolicy, {
    requireHedgeBucket: true,
    maxGrossExposureRatio: 0.65
  });
});

test("strategy replay preset parser accepts hyphen aliases", () => {
  assert.equal(parseStrategyReplayPresetName("long-term"), "long_term");
  assert.equal(parseStrategyReplayPresetName("short-term"), "short_term");
  assert.equal(parseStrategyReplayPresetName("intra-day"), "intraday");
  assert.equal(parseStrategyReplayPresetName("ultra-short"), "intraday");
  assert.equal(parseStrategyReplayPresetName("regime-cash"), "regime_cash");
});

test("strategy replay preset parser rejects unsupported names", () => {
  assert.throws(
    () => parseStrategyReplayPresetName("unsupported-preset"),
    /--strategy-preset must be one of/
  );
});
