import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { validatePaperSimulationCandidate } from "./paperSimulationConfig.js";
import {
  PAPER_SIMULATION_VALIDATION_API_ROUTES,
  PAPER_SIMULATION_VALIDATION_METHODS
} from "./localOperationsSurface.js";
import type { PaperSimulationRunnerInput, PaperSimulationRunnerResult } from "./paperSimulationRuns.js";
import { simulationConfig, simulationHeaders, simulationServer } from "./paperSimulationTestFixtures.js";

const validationRoute = "/paper/simulations/validate";

test("guarded validation is side-effect-free even with enabled Codex and a missing source", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "simulation-validation-"));
  const storageBaseDir = join(root, "storage-must-not-exist");
  await writeFile(join(root, "marker"), "unchanged");
  let runnerCalls = 0;
  const provider = context.mock.method(CodexCliDecisionProvider.prototype, "decide", async () => {
    throw new Error("validation must not call a provider");
  });
  const env = { AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "paper_only" };
  const server = await simulationServer({
    storageBaseDir, env,
    paperSimulationRunner: async () => {
      runnerCalls += 1;
      throw new Error("validation must not start a runner");
    }
  });
  try {
    assert.deepEqual(PAPER_SIMULATION_VALIDATION_API_ROUTES, [validationRoute]);
    assert.deepEqual(PAPER_SIMULATION_VALIDATION_METHODS, ["POST"]);
    for (const mode of ["dry_run_fixture", "codex_paper_only"] as const) {
      const config = simulationConfig();
      config.decisionProvider.mode = mode;
      config.samplingPolicy.maxCodexCallsPerRun = 3;
      const response = await fetch(`${server.baseUrl}${validationRoute}`, {
        method: "POST", headers: simulationHeaders(server.baseUrl), body: JSON.stringify(config)
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), validatePaperSimulationCandidate(config, env));
    }
    assert.equal(runnerCalls, 0);
    assert.equal(provider.mock.callCount(), 0);
    assert.deepEqual(await readdir(root), ["marker"]);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("validation rejects missing/wrong intent, cross origin, media, malformed and oversized bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-validation-guards-"));
  let runnerCalls = 0;
  const server = await simulationServer({
    storageBaseDir: join(root, "untouched"), env: {},
    paperSimulationRunner: async () => { runnerCalls += 1; throw new Error("must not run"); }
  });
  const headers = simulationHeaders(server.baseUrl);
  try {
    for (const [overrides, body, status, error] of [
      [{ "x-toss-trading-operation": "" }, JSON.stringify(simulationConfig()), 403, "validation_guard_required"],
      [{ "x-toss-trading-operation": "paper-simulation-create" }, JSON.stringify(simulationConfig()), 403, "validation_guard_required"],
      [{ origin: "http://evil.example" }, JSON.stringify(simulationConfig()), 403, "origin_not_allowed"],
      [{ origin: "" }, JSON.stringify(simulationConfig()), 403, "origin_not_allowed"],
      [{ "content-type": "text/plain" }, JSON.stringify(simulationConfig()), 415, "unsupported_media_type"],
      [{}, "{", 400, "invalid_json"],
      [{}, "x".repeat(32769), 413, "request_body_too_large"]
    ] as const) {
      const response = await fetch(`${server.baseUrl}${validationRoute}`, {
        method: "POST", headers: { ...headers, ...overrides }, body
      });
      const result = await response.json() as Record<string, unknown>;
      assert.equal(response.status, status, error);
      assert.equal(result["error"], error);
      assert.equal(result["storageMutationEnabled"], false);
      assert.equal(result["replayRunnerStarted"], false);
      assert.equal(result["dataAvailabilityChecked"], false);
    }
    for (const method of ["GET", "HEAD", "PUT"]) {
      const response = await fetch(`${server.baseUrl}${validationRoute}`, { method, headers });
      assert.equal(response.status, method === "PUT" ? 405 : 404);
      await response.text();
    }
    const createWithValidationIntent = await fetch(`${server.baseUrl}/paper/simulations`, {
      method: "POST", headers, body: JSON.stringify(simulationConfig())
    });
    assert.equal(createWithValidationIntent.status, 403);
    assert.equal(runnerCalls, 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("create rejects unsupported options before runner admission using the same validation errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-rejected-"));
  let runnerCalls = 0;
  const server = await simulationServer({
    storageBaseDir: join(root, "untouched"), env: {},
    paperSimulationRunner: async () => { runnerCalls += 1; throw new Error("must not run"); }
  });
  try {
    for (const change of [
      { costModel: "high_cost" }, { benchmarkPolicy: "cash_only" },
      { portfolioPolicy: {} }
    ]) {
      let validationError: unknown;
      for (const [route, operation] of [
        [validationRoute, "paper-simulation-validate"], ["/paper/simulations", "paper-simulation-create"]
      ]) {
        const response = await fetch(`${server.baseUrl}${route}`, {
          method: "POST", headers: simulationHeaders(server.baseUrl, operation),
          body: JSON.stringify({ ...simulationConfig(), ...change })
        });
        assert.equal(response.status, 400);
        const result = await response.json() as Record<string, unknown>;
        if (validationError === undefined) validationError = result["error"];
        assert.equal(result["error"], validationError);
      }
    }
    assert.equal(runnerCalls, 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("validate and accepted create share the exact runner contract without claiming admission on validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-contract-"));
  const inputs: PaperSimulationRunnerInput[] = [];
  let finish!: (result: PaperSimulationRunnerResult) => void;
  const running = new Promise<PaperSimulationRunnerResult>((resolve) => { finish = resolve; });
  const server = await simulationServer({
    storageBaseDir: join(root, "paper"), env: { PAPER_SIMULATION_TICK_DELAY_MS: "25" },
    paperSimulationRunner: async (input) => { inputs.push(input); return running; }
  });
  const config = simulationConfig();
  config.universe.market = "us";
  config.runType = "batch_replay";
  config.runCount = 3;
  config.paperExitPolicy = "take_profit_stop_loss";
  try {
    const validate = async () => {
      const response = await fetch(`${server.baseUrl}${validationRoute}`, {
        method: "POST", headers: simulationHeaders(server.baseUrl), body: JSON.stringify(config)
      });
      assert.equal(response.status, 200);
      return response.json() as Promise<Record<string, unknown>>;
    };
    const validation = await validate();
    assert.equal(inputs.length, 0);
    const response = await fetch(`${server.baseUrl}/paper/simulations`, {
      method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config)
    });
    assert.equal(response.status, 202);
    const accepted = await response.json() as Record<string, unknown>;
    const input = inputs[0];
    assert.ok(input);
    assert.equal(inputs.length, 1);
    assert.equal(accepted["simulationRunId"], input.simulationRunId);
    assert.equal(accepted["batchId"], input.batchId);
    assert.equal(accepted["requestedRunCount"], 3);
    assert.deepEqual(accepted["requestedConfig"], input.config);
    assert.deepEqual(accepted["effectiveConfig"], validation["effectiveConfig"]);
    assert.deepEqual(accepted["effectiveConfig"], input.effectiveConfig);
    assert.deepEqual(accepted["notices"], validation["notices"]);
    assert.equal(input.tickDelayMs, input.effectiveConfig.tickDelayMs);
    // Validation does not reserve a slot, inspect running state, or promise creation will succeed.
    assert.deepEqual(await validate(), validation);
    const conflict = await fetch(`${server.baseUrl}/paper/simulations`, {
      method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config)
    });
    assert.equal(conflict.status, 409);
    await conflict.text();
    assert.equal(inputs.length, 1);
    finish({
      mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId,
      status: "completed", outputDir: root, manifestPath: join(root, "manifest.json"), runsPath: join(root, "runs.jsonl")
    });
    await running;
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});


test("invalid calendar days reject validation and creation without runner, provider or storage effects", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "simulation-invalid-calendar-"));
  await writeFile(join(root, "marker"), "unchanged");
  let runnerCalls = 0;
  const provider = context.mock.method(CodexCliDecisionProvider.prototype, "decide", async () => {
    throw new Error("invalid dates must not call a provider");
  });
  const server = await simulationServer({
    storageBaseDir: join(root, "untouched"),
    env: { AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "paper_only" },
    paperSimulationRunner: async () => {
      runnerCalls += 1;
      throw new Error("invalid dates must not run");
    }
  });
  try {
    for (const value of [
      "2025-02-29", "2025-02-30", "2024-02-30", "2025-04-31",
      "2025-02-30T12:00:00Z"
    ]) {
      for (const boundary of ["startAt", "endAt"] as const) {
        const config = simulationConfig();
        config.window.startAt = "2024-01-01";
        config.window.endAt = "2026-12-31";
        config.window[boundary] = value;
        config.decisionProvider.mode = "codex_paper_only";
        config.samplingPolicy.maxCodexCallsPerRun = 3;
        for (const [route, operation] of [
          [validationRoute, "paper-simulation-validate"],
          ["/paper/simulations", "paper-simulation-create"]
        ]) {
          const response = await fetch(`${server.baseUrl}${route}`, {
            method: "POST", headers: simulationHeaders(server.baseUrl, operation),
            body: JSON.stringify(config)
          });
          const result = await response.json() as Record<string, unknown>;
          assert.equal(response.status, 400, `${route}: ${boundary}: ${value}`);
          assert.equal(result["error"], "invalid_simulation_date");
          if (route === validationRoute) {
            assert.equal(result["storageMutationEnabled"], false);
            assert.equal(result["replayRunnerStarted"], false);
            assert.equal(result["dataAvailabilityChecked"], false);
          }
        }
      }
    }
    assert.equal(runnerCalls, 0);
    assert.equal(provider.mock.callCount(), 0);
    assert.deepEqual(await readdir(root), ["marker"]);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
