import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalOperationsServer } from "../../../../dist/api/localOperationsServer.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../../../../dist/storage/repositories.js";

import { acceptPaperSimulation } from "../../../../dist/storage/paperSimulationObservationStore.js";
import { paperSimulationRequestPath, readPaperSimulationRequest } from "../../../../dist/storage/paperSimulationRequestStore.js";

const app = fileURLToPath(new URL("../../", import.meta.url));
const repo = resolve(app, "../..");
process.chdir(repo);
const root = resolve(app, ".e2e-data/experiment-wizard");
await mkdir(root, { recursive: true });
await mkdir(resolve(repo, "data"), { recursive: true });
const source = await mkdtemp(resolve(repo, "data/ux03-browser-fixture-"));
const output = await mkdtemp(resolve(root, "execution-"));
const storage = resolve(output, "paper");
await mkdir(storage);
const snapshots = new FileHistoricalMarketSnapshotStore(createStoragePaths(source).historicalMarketSnapshotsPath);
for (const market of ["KR", "US"]) await snapshots.append({
  snapshotId: `hist_ux03_${market}`, market, symbol: market === "KR" ? "005930" : "AAPL",
  observedAt: "2026-01-01T00:00:00+09:00", interval: "1d", lastPriceKrw: 70000, volume: 100000,
  sourceRefs: [`fixture:ux03_${market}`], createdAt: "2026-01-01T00:00:00+09:00"
});
const sourceDataDir = relative(repo, source).replaceAll("\\", "/");
const original = { mode: "paper_only", runType: "batch_replay", runCount: 3, sourceDataDir,
  universe: { preset: "synthetic-original-preset", market: "mixed_global" },
  window: { mode: "random_month", seed: "synthetic-original-seed", startAt: "2026-01-01", endAt: "2026-01-31", windowMonths: 1 },
  samplingPolicy: { decisionFrequency: "once_per_week", stepSeconds: 86400, maxDecisionCalls: 5, maxCodexCallsPerRun: 7 }, capital: { initialCashKrw: 500000 },
  decisionProvider: { mode: "dry_run_fixture", modelId: "synthetic-original-model", outputSchema: "schemas/virtual-decision.schema.json" }, riskProfile: "balanced", paperExitPolicy: "none",
  executionCosts: { feeBps: 12.5, taxBps: 0, slippageBps: 0.125 }, costModel: "standard", benchmarkPolicy: "cash_equal_weight_initial_hold" };
const clones = {};
for (const kind of ["whole", "omitted", "legacy", "redacted", "corrupt", "codex"]) {
  const id = "paper_sim_20261001000000000_clone-" + kind;
  const requestedConfig = structuredClone(original);
  if (kind === "omitted") { delete requestedConfig.runCount; delete requestedConfig.executionCosts; }
  if (kind === "codex") requestedConfig.decisionProvider.mode = "codex_paper_only";
  if (kind === "redacted") requestedConfig.decisionProvider.modelId = "abcdefghijklmnop.abcdefgh.ijklmnop";
  await acceptPaperSimulation(storage, id, "2026-10-01T00:00:00.000Z", kind === "legacy" ? undefined : { requestedConfig });
  const path = kind === "legacy" ? null : paperSimulationRequestPath(storage, id);
  if (kind === "corrupt") { const record = JSON.parse(await readFile(path, "utf8")); record.requestedConfig.window.seed = "tampered"; await writeFile(path, JSON.stringify(record) + "\n"); }
  clones[kind] = { id, requestedConfig, path, dto: await readPaperSimulationRequest(storage, id) };
}
await writeFile(resolve(root, "fixture.json"), JSON.stringify({ sourceDataDir, output, storage, clones }));
const server = createLocalOperationsServer({ storageBaseDir: storage, env: { AI_DECISION_ENABLED: "false", AI_DECISION_MODE: "paper_only", TRADING_ENABLED: "false", BROKER_PROVIDER: "mock" } });
// Explicit read-contract fixtures. Ordinary validation/create/GET still use the real API and runner.
const realRequestHandler = server.listeners("request")[0];
server.removeListener("request", realRequestHandler);
server.on("request", (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:8791");
  const id = url.searchParams.get("runId");
  const scenario = id?.replace("paper_sim_20261003000000000_", "");
  if (request.method !== "GET" || url.pathname !== "/batch/replay/runs" || !["accepted", "failed", "partial", "terminal", "wrong", "unreadable", "invalidwrapper"].includes(scenario) || id !== `paper_sim_20261003000000000_${scenario}`) {
    realRequestHandler(request, response); return;
  }
  const failed = ["failed", "partial", "terminal"].includes(scenario);
  const observation = { status: "available", schemaVersion: "paper_simulation_observation.v1", simulationRunId: id, batchId: scenario === "wrong" ? "wrong-id" : id,
    acceptedAt: "2026-10-03T00:00:00.000Z", outcome: failed ? "runner_failed" : "unknown",
    runnerFailure: failed ? { observedAt: "2026-10-03T00:00:01.000Z", reasonCode: "runner_rejected" } : null };
  const child = ["partial", "terminal"].includes(scenario) ? { runId: `child-${scenario}`, batchId: id, status: scenario === "partial" ? "completed_with_failures" : "completed", totalReturnRatio: 0.02 } : null;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ mode: scenario === "invalidwrapper" ? "invalid" : "paper_only", readOnly: true, status: child ? "ok" : "missing",
    batchId: child ? id : null, batchStatus: child ? "completed_with_failures" : null, runs: child ? [child] : [], selectedRun: child,
    simulationObservation: scenario === "unreadable" ? { status: "unavailable", simulationRunId: id } : observation }));
});
server.listen(8791, "127.0.0.1");
