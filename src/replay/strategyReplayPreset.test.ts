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

    assert.equal(preset.name, name);
    assert.ok(preset.maxDecisionCalls > 1);
    assert.equal(preset.maxCodexCallsPerRun, preset.maxDecisionCalls);
    assert.ok(preset.windowMonths >= 1);
    assert.ok(preset.stepSeconds > 0);
    assert.ok(preset.maxSnapshotAgeSeconds >= 14 * 24 * 60 * 60);
    assert.ok(preset.minWindowSnapshots >= 1);
    assert.ok(preset.minSnapshotsPerRequiredSymbol >= 1);
  }
});

test("strategy replay preset parser accepts hyphen aliases", () => {
  assert.equal(parseStrategyReplayPresetName("long-term"), "long_term");
  assert.equal(parseStrategyReplayPresetName("short-term"), "short_term");
  assert.equal(parseStrategyReplayPresetName("regime-cash"), "regime_cash");
});

test("strategy replay preset parser rejects unsupported names", () => {
  assert.throws(
    () => parseStrategyReplayPresetName("unsupported-preset"),
    /--strategy-preset must be one of/
  );
});
