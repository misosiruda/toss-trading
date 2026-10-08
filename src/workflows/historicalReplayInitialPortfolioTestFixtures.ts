import type { VirtualPortfolio } from "../domain/schemas.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import type { HistoricalReplayWorkflowOptions } from "./historicalReplayWorkflow.js";
export const initialTime = "2025-01-02T00:00:00.000Z";
export function initialOptions(storageBaseDir: string): HistoricalReplayWorkflowOptions {
  return { storageBaseDir, runId: "batch_fixture_run_000001", batchId: "batch_fixture", batchRunIndex: 1,
    generatedAt: new Date("2026-10-07T00:00:00.000Z"), initialCashKrw: 100_000,
    clock: new SimulatedClock({ startAt: new Date(initialTime), endAt: new Date(initialTime), stepSeconds: 60 }),
    packetIdPrefix: "initial_fixture", packetExpiresInSeconds: 60, maxCandidates: 10, maxSnapshotAgeSeconds: 300,
    constraints: { maxNewPositions: 3, maxBudgetPerSymbolKrw: 100_000, allowedActions: ["VIRTUAL_HOLD"] }
  };
}
export function initialPortfolio(): VirtualPortfolio {
  return { portfolioId: "portfolio_fixture", cashKrw: 0, updatedAt: initialTime, positions: [{
    market: "KR", symbol: "005930", assetType: "STOCK", assetClass: "equity", region: "KR",
    riskTags: ["currency_exposed"], strategyBucket: "swing", sector: "technology", quantity: 2.5,
    averagePriceKrw: 100, marketPriceKrw: 90, marketValueKrw: 225, unrealizedPnlKrw: -25,
    priceUpdatedAt: initialTime, priceStaleAfter: "2025-01-02T00:05:00.000Z", priceSourceRefs: ["fixture:initial"],
    isPriceStale: false, updatedAt: initialTime
  }] };
}
export async function seedInitialSnapshot(storageBaseDir: string) {
  await new FileHistoricalMarketSnapshotStore(createStoragePaths(storageBaseDir).historicalMarketSnapshotsPath).append({
    snapshotId: "hist_initial_fixture", market: "KR", symbol: "005930", observedAt: initialTime,
    interval: "1m", lastPriceKrw: 110, sourceRefs: ["fixture:initial"], createdAt: initialTime
  });
}
