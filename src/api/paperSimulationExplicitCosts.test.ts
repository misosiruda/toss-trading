import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPaperFill, createPaperExecutionPolicy } from "../paper/executionModel.js";
import { validatePaperSimulationCandidate } from "./paperSimulationConfig.js";
import type { PaperSimulationRunnerInput, PaperSimulationRunnerResult } from "./paperSimulationRuns.js";
import { simulationConfig, simulationHeaders, simulationServer } from "./paperSimulationTestFixtures.js";

// Synthetic caller values, not a market fee preset or recommendation.
const costs = { feeBps: 12.5, taxBps: 25, slippageBps: 5.5 };
const invalidCosts: unknown[] = [
  null, {}, { feeBps: 1, taxBps: 2 }, { ...costs, feeBps: -1 },
  { ...costs, taxBps: -1 }, { ...costs, slippageBps: -1 },
  { ...costs, feeBps: "1" }, { ...costs, taxBps: true },
  { ...costs, slippageBps: null }, { ...costs, halfSpreadBps: 2 },
];

test("explicit caller costs preserve decimals, zero and all remaining execution defaults", () => {
  for (const executionCosts of [costs, { feeBps: 0, taxBps: 0, slippageBps: 0 }]) {
    const validated = validatePaperSimulationCandidate({ ...simulationConfig(), executionCosts }, {});
    assert.deepEqual(validated.requestedConfig.executionCosts, executionCosts);
    assert.deepEqual(validated.effectiveConfig.costModel.executionPolicy, {
      ...createPaperExecutionPolicy(undefined), ...executionCosts,
    });
    assert.equal(validated.replayRunnerStarted, false);
    assert.equal(validated.storageMutationEnabled, false);
    assert.ok(validated.notices.some(n => n.code === "explicit_execution_costs"));
    assert.equal(validated.effectiveConfig.benchmarkPolicy.names.length, 3);
    assert.equal(validated.effectiveConfig.universe.marketFilterApplied, false);
  }
  assert.throws(() => validatePaperSimulationCandidate({ ...simulationConfig(), executionCosts: costs, costModel: "high_cost" }, {}),
    { code: "unsupported_simulation_cost_model" });
});

test("explicit costs reject incomplete, ignored, invalid and nonfinite input before execution", () => {
  for (const executionCosts of [...invalidCosts, ...[NaN, Infinity, -Infinity].flatMap(value => [
    { ...costs, feeBps: value }, { ...costs, taxBps: value }, { ...costs, slippageBps: value },
  ])]) {
    assert.throws(() => validatePaperSimulationCandidate({ ...simulationConfig(), executionCosts }, {}),
      { code: "invalid_simulation_config", statusCode: 400 });
  }
});

test("resolved policy charges synthetic buy/sell fee, sell tax and slippage without other cost changes", () => {
  const policy = validatePaperSimulationCandidate({ ...simulationConfig(), executionCosts: costs }, {}).effectiveConfig.costModel.executionPolicy;
  for (const action of ["VIRTUAL_BUY", "VIRTUAL_SELL"] as const) {
    const fill = buildPaperFill({ action, sourcePriceKrw: 10_000, targetNotionalKrw: 100_000, quantityOverride: 10, policy });
    assert.equal(fill.fillPriceKrw, action === "VIRTUAL_BUY" ? 10_006 : 9_995);
    assert.equal(fill.feeKrw, Math.round(fill.grossAmountKrw * costs.feeBps / 10_000));
    assert.equal(fill.taxKrw, action === "VIRTUAL_SELL" ? Math.round(fill.grossAmountKrw * costs.taxBps / 10_000) : 0);
    assert.equal(fill.slippageKrw, action === "VIRTUAL_BUY" ? 60 : 50);
    assert.equal(fill.spreadCostKrw, 0); assert.equal(fill.impactCostKrw, 0);
    assert.equal(fill.totalCostKrw, fill.feeKrw + fill.taxKrw + fill.slippageKrw);
  }
});

test("HTTP validation and accepted create carry identical explicit costs to one runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "explicit-costs-http-"));
  const storageBaseDir = join(root, "paper");
  const inputs: PaperSimulationRunnerInput[] = [];
  let finish!: (result: PaperSimulationRunnerResult) => void;
  const pending = new Promise<PaperSimulationRunnerResult>(resolve => { finish = resolve; });
  const server = await simulationServer({ storageBaseDir, env: {}, paperSimulationRunner: async input => { inputs.push(input); return pending; } });
  const config = { ...simulationConfig(), executionCosts: costs };
  try {
    for (const executionCosts of invalidCosts) {
      for (const [route, operation] of [["/paper/simulations/validate", "paper-simulation-validate"], ["/paper/simulations", "paper-simulation-create"]]) {
        const response = await fetch(server.baseUrl + route, { method: "POST", headers: simulationHeaders(server.baseUrl, operation), body: JSON.stringify({ ...config, executionCosts }) });
        assert.equal(response.status, 400); await response.text();
        assert.equal(inputs.length, 0); assert.equal(existsSync(storageBaseDir), false);
      }
    }
    const validatedResponse = await fetch(server.baseUrl + "/paper/simulations/validate", { method: "POST", headers: simulationHeaders(server.baseUrl), body: JSON.stringify(config) });
    assert.equal(validatedResponse.status, 200);
    const validated = await validatedResponse.json() as Record<string, unknown>;
    assert.equal(inputs.length, 0); assert.equal(existsSync(storageBaseDir), false);
    const create = await fetch(server.baseUrl + "/paper/simulations", { method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
    assert.equal(create.status, 202);
    const accepted = await create.json() as Record<string, unknown>;
    assert.equal(inputs.length, 1);
    const input = inputs[0]!;
    assert.deepEqual(input.config.executionCosts, costs);
    assert.deepEqual(input.effectiveConfig, validated["effectiveConfig"]);
    assert.deepEqual(accepted["effectiveConfig"], input.effectiveConfig);
    assert.deepEqual(input.effectiveConfig.costModel.executionPolicy, { ...createPaperExecutionPolicy(undefined), ...costs });
    assert.equal(accepted["simulationRunId"], input.simulationRunId);
    finish({ mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId, status: "completed", outputDir: root, manifestPath: join(root, "manifest.json"), runsPath: join(root, "runs.jsonl") });
    await pending;
  } finally {
    await server.close(); await rm(root, { recursive: true, force: true });
  }
});
