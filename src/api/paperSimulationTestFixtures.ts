import type { AddressInfo } from "node:net";

import type { PaperSimulationRunConfig } from "./paperSimulationConfig.js";
import { createLocalOperationsServer } from "./localOperationsServer.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";

export function simulationConfig(): PaperSimulationRunConfig {
  return {
    mode: "paper_only",
    runType: "single_replay",
    runCount: 1,
    sourceDataDir: "data/ux02a-not-collected",
    universe: { preset: "global_broad", market: "mixed_global" },
    window: {
      mode: "random_month", seed: "ux02a-fixture", startAt: "2024-01-01",
      endAt: "2024-12-31", windowMonths: 1
    },
    samplingPolicy: {
      decisionFrequency: "once_per_day", stepSeconds: 86400,
      maxDecisionCalls: 5, maxCodexCallsPerRun: 0
    },
    capital: { initialCashKrw: 10_000_000 },
    decisionProvider: {
      mode: "dry_run_fixture", modelId: "static-decision-provider",
      outputSchema: "schemas/virtual-decision.schema.json"
    },
    riskProfile: "conservative",
    paperExitPolicy: "none",
    costModel: "standard",
    benchmarkPolicy: "cash_equal_weight_initial_hold"
  };
}

export async function simulationServer(options: LocalOperationsServerOptions) {
  const server = createLocalOperationsServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    })
  };
}

export function simulationHeaders(baseUrl: string, operation = "paper-simulation-validate") {
  return {
    origin: baseUrl,
    "content-type": "application/json",
    "x-toss-trading-operation": operation
  };
}
