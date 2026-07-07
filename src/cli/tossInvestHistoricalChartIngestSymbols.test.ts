import assert from "node:assert/strict";
import test from "node:test";

import { parseHistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";
import { createTossInvestHistoricalChartSymbols } from "./tossInvestHistoricalChartIngestSymbols.js";

test("TossInvest historical ingest universe adapter preserves strategy bucket metadata", () => {
  const universe = parseHistoricalUniverseManifest({
    mode: "paper_only_historical_universe",
    universeId: "tossinvest-adapter-fixture",
    snapshotDate: "2025-01-01",
    symbols: [
      {
        market: "KR",
        symbol: "114800",
        sourceSymbol: "114800.KS",
        name: "Inverse ETF",
        assetType: "ETF",
        assetClass: "inverse",
        region: "KR",
        riskTags: ["inverse"],
        strategyBucket: "hedge",
        sector: "Broad Market",
        required: true
      }
    ],
    disclaimer: "Paper-only fixture."
  });

  const symbols = createTossInvestHistoricalChartSymbols({
    universe,
    symbols: [],
    market: "KR"
  });

  assert.deepEqual(symbols, [
    {
      market: "KR",
      symbol: "114800",
      sourceSymbol: "114800.KS",
      name: "Inverse ETF",
      assetType: "ETF",
      assetClass: "inverse",
      region: "KR",
      riskTags: ["inverse"],
      strategyBucket: "hedge",
      sector: "Broad Market"
    }
  ]);
});

test("TossInvest historical ingest fallback symbols keep safe paper defaults", () => {
  const symbols = createTossInvestHistoricalChartSymbols({
    universe: null,
    symbols: ["005930"],
    market: "KR"
  });

  assert.deepEqual(symbols, [
    {
      market: "KR",
      symbol: "005930",
      assetType: "STOCK",
      assetClass: "equity",
      region: "KR"
    }
  ]);
});
