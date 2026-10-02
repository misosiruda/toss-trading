import assert from "node:assert/strict";
import test from "node:test";

import { createPaperCostModel } from "../paper/costModel.js";
import { resolvePaperRiskProfile } from "../paper/riskProfile.js";
import {
  PaperSimulationRequestError,
  parsePaperSimulationRunConfig,
  resolvePaperSimulationConfig,
  validatePaperSimulationCandidate
} from "./paperSimulationConfig.js";
import { simulationConfig } from "./paperSimulationTestFixtures.js";

test("legacy and Next default simulation inputs retain their existing semantics", () => {
  for (const modelId of ["static-decision-provider", "gpt-5.3-codex-spark"]) {
    const config = simulationConfig();
    config.decisionProvider.modelId = modelId;
    config.riskProfile = modelId === "static-decision-provider" ? "conservative" : "balanced";
    const result = validatePaperSimulationCandidate(config, {});
    assert.equal(result.status, "valid");
    assert.deepEqual(result.requestedConfig, config);
    assert.deepEqual(result.effectiveConfig.costModel, createPaperCostModel(undefined));
    assert.equal(result.effectiveConfig.costModel.executionPolicy.feeBps, 0);
    assert.equal(result.effectiveConfig.costModel.executionPolicy.slippageBps, 0);
    assert.deepEqual(result.effectiveConfig.universe, {
      selection: "source_snapshots", presetApplied: false, marketFilterApplied: false,
      allocationMode: "split_target_kr_us"
    });
    assert.equal(result.effectiveConfig.decisionProvider.modelId, null);
    assert.equal(result.effectiveConfig.decisionProvider.outputSchema, null);
    assert.equal(result.effectiveConfig.portfolioPolicyApplied, false);
    assert.equal(result.sourceDataKind, "unknown");
    assert.equal(result.dataAvailabilityChecked, false);
    assert.equal(result.replayRunnerStarted, false);
    assert.equal(result.effectiveConfig.window.rangeStartAt, "2023-12-31T15:00:00.000Z");
    assert.equal(result.effectiveConfig.window.rangeEndAt, "2024-12-31T14:59:59.999Z");
    assert.deepEqual(result.effectiveConfig.benchmarkPolicy.names,
      ["cashOnly", "equalWeightBuyAndHold", "initialPortfolioBuyAndHold"]);
    assert.equal(result.effectiveConfig.benchmarkPolicy.equalWeightAvailability, "requires_priced_replay_packet");
  }
});

test("each market preserves allocation behavior without claiming symbol filtering", () => {
  for (const name of ["conservative", "balanced", "aggressive_paper"] as const) {
    for (const market of ["mixed_global", "kr", "us"] as const) {
      const config = simulationConfig();
      config.riskProfile = name;
      config.universe.market = market;
      config.capital.initialCashKrw = 5_000_000;
      const effective = resolvePaperSimulationConfig(config, {}).effectiveConfig;
      const profile = resolvePaperRiskProfile({ name, initialCashKrw: 5_000_000 });
      assert.equal(effective.riskProfile, name);
      assert.deepEqual(effective.constraints, profile.constraints);
      assert.deepEqual(effective.riskPolicy, profile.riskPolicy);
      assert.equal(effective.universe.marketFilterApplied, false);
      if (market === "mixed_global") {
        assert.deepEqual(effective.allocationPolicy, {
          ...profile.allocationPolicy,
          marketTargetExposureRatios: {
            KR: profile.allocationPolicy.targetExposureRatio / 2,
            US: profile.allocationPolicy.targetExposureRatio / 2
          }
        });
      } else {
        assert.deepEqual(effective.allocationPolicy, profile.allocationPolicy);
        assert.equal(effective.universe.allocationMode, "risk_profile_default");
      }
    }
  }
});

test("legacy and custom preset metadata never filters or blocks source snapshots", () => {
  for (const preset of ["global_broad", "kr_us_core", "manual_path", "custom_metadata"]) {
    const config = simulationConfig();
    config.universe.preset = preset;
    const resolved = resolvePaperSimulationConfig(config, {});
    assert.equal(resolved.requestedConfig.universe.preset, preset);
    assert.equal(resolved.effectiveConfig.universe.presetApplied, false);
    assert.equal(resolved.effectiveConfig.sourceDataDir, config.sourceDataDir);
    assert.ok(resolved.notices.some((notice) => notice.field === "universe.preset" && notice.code === "preset_not_applied"));
  }
});

test("run counts, fixed dates and fixture-only fields expose effective overrides", () => {
  const config = simulationConfig();
  config.runCount = 8;
  config.window.mode = "fixed_range";
  config.window.windowMonths = 6;
  config.samplingPolicy.maxCodexCallsPerRun = 12;
  const { effectiveConfig, notices } = resolvePaperSimulationConfig(config, {});
  assert.equal(effectiveConfig.runCount, 1);
  assert.equal(effectiveConfig.window.windowMonths, null);
  assert.equal(effectiveConfig.window.fixedWindow?.windowMonths, 6);
  assert.equal(effectiveConfig.window.fixedWindow?.startAt, effectiveConfig.window.rangeStartAt);
  assert.equal(effectiveConfig.window.fixedWindow?.endAt, effectiveConfig.window.rangeEndAt);
  assert.equal(effectiveConfig.samplingPolicy.maxCodexCallsPerRun, 0);
  assert.ok(notices.some((notice) => notice.code === "single_run_count"));
  assert.ok(notices.some((notice) => notice.code === "fixed_range_metadata_only"));
  assert.ok(notices.some((notice) => notice.code === "fixture_provider"));
  config.runType = "batch_replay";
  assert.equal(resolvePaperSimulationConfig(config, {}).effectiveConfig.runCount, 8);
  delete config.runCount;
  assert.equal(resolvePaperSimulationConfig(config, {}).effectiveConfig.runCount, 5);
});

test("sampling, exits, capital and permitted provider fields map without executing a provider", () => {
  for (const [exit, expected] of [
    ["none", null],
    ["take_profit_stop_loss", { takeProfitMode: "full_exit", takeProfitRatio: 0.15, stopLossRatio: 0.08 }],
    ["rebalance_threshold", { takeProfitMode: "full_exit", rebalanceMaxPositionWeightRatio: 0.4 }]
  ] as const) {
    for (const frequency of ["every_tick", "once_per_day", "once_per_week"] as const) {
      const config = simulationConfig();
      config.paperExitPolicy = exit;
      config.samplingPolicy.decisionFrequency = frequency;
      config.samplingPolicy.stepSeconds = 604800;
      config.samplingPolicy.maxDecisionCalls = 31;
      config.samplingPolicy.maxCodexCallsPerRun = 30;
      config.decisionProvider.mode = "codex_paper_only";
      const effective = resolvePaperSimulationConfig(config, {
        AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "paper_only", PAPER_SIMULATION_TICK_DELAY_MS: "125"
      }).effectiveConfig;
      assert.deepEqual(effective.samplingPolicy, config.samplingPolicy);
      assert.deepEqual(effective.decisionProvider, config.decisionProvider);
      assert.deepEqual(effective.capital, config.capital);
      assert.deepEqual(effective.paperExitPolicy, expected);
      assert.equal(effective.tickDelayMs, 125);
    }
  }
});

test("unsupported visible legacy choices and PortfolioPolicy fail explicitly", () => {
  const changes = [
    [{ costModel: "high_cost" }, "unsupported_simulation_cost_model", "costModel"],
    [{ benchmarkPolicy: "cash_only" }, "unsupported_simulation_benchmark_policy", "benchmarkPolicy"],
    [{ portfolioPolicy: { policyId: "policy_not_applied" } }, "unsupported_simulation_portfolio_policy", "portfolioPolicy"]
  ] as const;
  for (const [change, code, field] of changes) {
    assert.throws(() => resolvePaperSimulationConfig({ ...simulationConfig(), ...change }, {}),
      (error: unknown) => error instanceof PaperSimulationRequestError && error.statusCode === 400 && error.code === code && error.message.includes(field));
  }
  // Preserve the previous schema's treatment of unrelated extension metadata.
  assert.deepEqual(parsePaperSimulationRunConfig({ ...simulationConfig(), clientLabel: "legacy" }), simulationConfig());
});

test("validation preserves path, schema, date, pacing and disabled Codex rejection", () => {
  for (const path of ["../outside", "/tmp/source", "data/../../outside", "data/bad\0path"]) {
    assert.throws(() => resolvePaperSimulationConfig({ ...simulationConfig(), sourceDataDir: path }, {}),
      { code: "invalid_source_data_dir" });
  }
  const config = simulationConfig();
  config.window.startAt = "not-a-date";
  assert.throws(() => resolvePaperSimulationConfig(config, {}), { code: "invalid_simulation_date" });
  config.window.startAt = "2025-01-01";
  assert.throws(() => resolvePaperSimulationConfig(config, {}), { code: "invalid_simulation_window" });
  assert.throws(() => resolvePaperSimulationConfig({ ...simulationConfig(), runCount: 21 }, {}), { code: "invalid_simulation_config" });
  assert.throws(() => resolvePaperSimulationConfig(simulationConfig(), { PAPER_SIMULATION_TICK_DELAY_MS: "5001" }), { code: "invalid_simulation_tick_delay" });
  const codex = simulationConfig();
  codex.decisionProvider.mode = "codex_paper_only";
  assert.throws(() => resolvePaperSimulationConfig(codex, {}), { code: "invalid_codex_call_limit" });
  codex.samplingPolicy.maxCodexCallsPerRun = 3;
  assert.throws(() => resolvePaperSimulationConfig(codex, {}), { code: "codex_provider_disabled" });
  assert.throws(() => resolvePaperSimulationConfig(codex, { AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "live" }), { code: "invalid_ai_decision_mode" });
});
