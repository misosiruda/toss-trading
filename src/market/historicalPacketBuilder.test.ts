import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import { HistoricalMarketPacketBuilder } from "./historicalPacketBuilder.js";

test("historical packet builder excludes future snapshots from candidates", () => {
  const result = builder().build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_current",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      }),
      snapshot({
        snapshotId: "hist_future",
        symbol: "000660",
        observedAt: "2025-01-02T09:01:00+09:00",
        lastPriceKrw: 120_000
      })
    ]
  });

  assert.equal(result.status, "ok");
  assert.equal(result.excludedFutureCount, 1);
  assert.deepEqual(
    result.status === "ok"
      ? result.packet.candidates.map((candidate) => candidate.symbol)
      : [],
    ["005930"]
  );
  assert.equal(JSON.stringify(result).includes("hist_future"), true);
  assert.equal(
    result.status === "ok" &&
      JSON.stringify(result.packet.candidates).includes("hist_future"),
    false
  );
});

test("historical packet builder selects the latest snapshot per symbol", () => {
  const result = builder().build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_old",
        symbol: "005930",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 69_500
      }),
      snapshot({
        snapshotId: "hist_latest",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      })
    ]
  });

  assert.equal(result.status, "ok");
  assert.equal(result.status === "ok" && result.packet.candidates.length, 1);
  assert.equal(
    result.status === "ok" && result.packet.candidates[0]?.lastPriceKrw,
    70_000
  );
  assert.equal(
    result.status === "ok" &&
      result.packet.candidates[0]?.sourceRefs.includes(
        "historical_snapshot:hist_latest"
      ),
    true
  );
});

test("historical packet builder derives trend and volume reason codes from past snapshots", () => {
  const result = builder().build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_0858",
        symbol: "005930",
        observedAt: "2025-01-02T08:58:00+09:00",
        lastPriceKrw: 68_000,
        volume: 100_000,
        openPriceKrw: 67_500,
        closePriceKrw: 68_000
      }),
      snapshot({
        snapshotId: "hist_0859",
        symbol: "005930",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 69_000,
        volume: 120_000,
        openPriceKrw: 68_500,
        closePriceKrw: 69_000
      }),
      snapshot({
        snapshotId: "hist_0900",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 71_000,
        volume: 300_000,
        openPriceKrw: 70_000,
        closePriceKrw: 71_000
      })
    ]
  });

  assert.equal(result.status, "ok");
  const candidate = result.status === "ok" ? result.packet.candidates[0] : undefined;
  assert.ok(candidate);
  assert.equal(candidate.score !== undefined && candidate.score > 50, true);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_MOMENTUM_UP"), true);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_TREND_UP"), true);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_VOLUME_ABOVE_AVG"), true);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_CANDLE_UP"), true);
  assert.equal(candidate.volume, 300_000);
  assert.equal(candidate.averageVolume, 110_000);
  assert.equal(
    candidate.featureRefs?.includes("candidate.KR.005930.volume"),
    true
  );
  assert.equal(
    candidate.featureRefs?.includes("candidate.KR.005930.averageVolume"),
    true
  );
  assert.equal(
    candidate.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.005930.volume" &&
        featureScore.reasonCode === "VOLUME_AVAILABLE"
    ),
    true
  );
  assert.equal(
    candidate.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.KR.005930.score" &&
        featureScore.score === candidate.score &&
        featureScore.reasonCode === "CANDIDATE_SCORE"
    ),
    true
  );
});

test("historical packet builder preserves snapshot asset metadata in candidates", () => {
  const result = builder().build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_spy",
        market: "US",
        symbol: "SPY",
        name: "SPDR S&P 500 ETF",
        observedAt: "2025-01-02T09:00:00+09:00",
        assetType: "ETF",
        assetClass: "equity",
        region: "US",
        riskTags: ["currency_exposed"],
        strategyBucket: "long_term",
        sector: "Broad Market"
      })
    ]
  });

  const candidate = result.status === "ok" ? result.packet.candidates[0] : null;

  assert.equal(result.status, "ok");
  assert.equal(candidate?.market, "US");
  assert.equal(candidate?.name, "SPDR S&P 500 ETF");
  assert.equal(candidate?.assetType, "ETF");
  assert.equal(candidate?.assetClass, "equity");
  assert.equal(candidate?.region, "US");
  assert.deepEqual(candidate?.riskTags, ["currency_exposed"]);
  assert.equal(candidate?.strategyBucket, "long_term");
  assert.equal(candidate?.sector, "Broad Market");
  assert.equal(
    candidate?.featureRefs?.includes("candidate.US.SPY.assetType"),
    true
  );
  assert.equal(
    candidate?.featureRefs?.includes("candidate.US.SPY.strategyBucket"),
    true
  );
  assert.equal(
    candidate?.featureRefs?.includes("candidate.US.SPY.sector"),
    true
  );
  assert.equal(
    candidate?.featureScores?.some(
      (featureScore) =>
        featureScore.featureRef === "candidate.US.SPY.sector" &&
        featureScore.reasonCode === "SECTOR_AVAILABLE"
    ),
    true
  );
});

test("historical packet builder does not derive features from future snapshots", () => {
  const result = builder().build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_0859",
        symbol: "005930",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 70_000
      }),
      snapshot({
        snapshotId: "hist_current",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      }),
      snapshot({
        snapshotId: "hist_future_rally",
        symbol: "005930",
        observedAt: "2025-01-02T09:01:00+09:00",
        lastPriceKrw: 90_000,
        volume: 900_000
      })
    ]
  });

  assert.equal(result.status, "ok");
  assert.equal(result.excludedFutureCount, 1);
  const candidate = result.status === "ok" ? result.packet.candidates[0] : undefined;
  assert.ok(candidate);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_MOMENTUM_UP"), false);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_TREND_UP"), false);
  assert.equal(candidate.reasonCodes.includes("HISTORICAL_VOLUME_ABOVE_AVG"), false);
  assert.equal(
    candidate.featureScores?.some((featureScore) =>
      featureScore.reasonCode.includes("FUTURE")
    ),
    false
  );
});

test("historical packet builder trims candidates deterministically", () => {
  const result = builder({ maxCandidates: 2 }).build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_005930",
        symbol: "005930",
        observedAt: "2025-01-02T08:59:00+09:00"
      }),
      snapshot({
        snapshotId: "hist_000660",
        symbol: "000660",
        observedAt: "2025-01-02T09:00:00+09:00"
      }),
      snapshot({
        snapshotId: "hist_035420",
        symbol: "035420",
        observedAt: "2025-01-02T09:00:00+09:00"
      })
    ]
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.status === "ok"
      ? result.packet.candidates.map((candidate) => candidate.symbol)
      : [],
    ["000660", "035420"]
  );
});

test("historical packet builder preserves held positions outside screened top candidates", () => {
  const result = builder({ maxCandidates: 2 }).build({
    portfolio: {
      ...portfolio(),
      positions: [
        {
          market: "KR",
          symbol: "999999",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 80_000,
          updatedAt: "2025-01-02T09:00:00+09:00"
        }
      ]
    },
    snapshots: [
      snapshot({
        snapshotId: "hist_000001_prev",
        symbol: "000001",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000
      }),
      snapshot({
        snapshotId: "hist_000001_current",
        symbol: "000001",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 130_000
      }),
      snapshot({
        snapshotId: "hist_000002_prev",
        symbol: "000002",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000
      }),
      snapshot({
        snapshotId: "hist_000002_current",
        symbol: "000002",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 125_000
      }),
      snapshot({
        snapshotId: "hist_999999_prev",
        symbol: "999999",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000
      }),
      snapshot({
        snapshotId: "hist_999999_current",
        symbol: "999999",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 80_000
      })
    ]
  });

  assert.equal(result.status, "ok");
  const candidates = result.status === "ok" ? result.packet.candidates : [];
  assert.deepEqual(
    candidates.map((candidate) => candidate.symbol),
    ["000001", "000002", "999999"]
  );
  assert.equal(result.status === "ok" && result.candidateSnapshotCount, 3);
  const held = candidates.find((candidate) => candidate.symbol === "999999")!;
  assert.equal(held.positionExists, true);
  assert.equal(held.sellEligible, true);
  assert.equal(held.reasonCodes.includes("HISTORICAL_HELD_POSITION"), true);
});

test("historical packet builder screens broad universe with market diversification", () => {
  const result = builder({ maxCandidates: 3 }).build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_us_a_prev",
        market: "US",
        symbol: "AAA",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_us_a_current",
        market: "US",
        symbol: "AAA",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 120_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_us_b_prev",
        market: "US",
        symbol: "BBB",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_us_b_current",
        market: "US",
        symbol: "BBB",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 120_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_us_c_prev",
        market: "US",
        symbol: "CCC",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_us_c_current",
        market: "US",
        symbol: "CCC",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 120_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_kr_prev",
        market: "KR",
        symbol: "005930",
        observedAt: "2025-01-02T08:59:00+09:00",
        lastPriceKrw: 100_000,
        assetType: "STOCK"
      }),
      snapshot({
        snapshotId: "hist_kr_current",
        market: "KR",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 90_000,
        assetType: "STOCK"
      })
    ]
  });

  assert.equal(result.status, "ok");
  const candidates = result.status === "ok" ? result.packet.candidates : [];
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.market}:${candidate.symbol}`),
    ["US:AAA", "US:BBB", "KR:005930"]
  );
  assert.equal(
    candidates.every((candidate) =>
      candidate.reasonCodes.includes("HISTORICAL_SCREENER_DIVERSIFIED")
    ),
    true
  );
});

test("historical packet builder fails closed when all snapshots are stale", () => {
  const result = builder({ maxSnapshotAgeSeconds: 60 }).build({
    portfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_stale",
        symbol: "005930",
        observedAt: "2025-01-02T08:58:00+09:00"
      })
    ]
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "NO_HISTORICAL_CANDIDATES");
  assert.equal(result.excludedStaleCount, 1);
});

test("historical packet builder caps detailed exclusion warnings", () => {
  const staleSnapshots = Array.from({ length: 25 }, (_, index) =>
    snapshot({
      snapshotId: `hist_stale_${index}`,
      symbol: "005930",
      observedAt: `2025-01-02T08:${String(index).padStart(2, "0")}:00+09:00`
    })
  );
  const futureSnapshots = Array.from({ length: 25 }, (_, index) =>
    snapshot({
      snapshotId: `hist_future_${index}`,
      symbol: "000660",
      observedAt: `2025-01-02T10:${String(index).padStart(2, "0")}:00+09:00`
    })
  );

  const result = builder({ maxSnapshotAgeSeconds: 60 }).build({
    portfolio: portfolio(),
    snapshots: [
      ...staleSnapshots,
      snapshot({
        snapshotId: "hist_current",
        symbol: "035420",
        observedAt: "2025-01-02T09:00:00+09:00"
      }),
      ...futureSnapshots
    ]
  });

  assert.equal(result.status, "ok");
  assert.equal(result.excludedStaleCount, 25);
  assert.equal(result.excludedFutureCount, 25);
  assert.equal(result.warnings.length <= 22, true);
  assert.equal(
    result.warnings.some((warning) => warning.includes("additional")),
    true
  );
});

function builder(
  overrides: Partial<{
    maxCandidates: number;
    maxSnapshotAgeSeconds: number;
  }> = {}
): HistoricalMarketPacketBuilder {
  return new HistoricalMarketPacketBuilder({
    packetId: "packet_historical_001",
    simulatedAt: new Date("2025-01-02T09:00:00+09:00"),
    expiresInSeconds: 60,
    maxCandidates: overrides.maxCandidates ?? 10,
    maxSnapshotAgeSeconds: overrides.maxSnapshotAgeSeconds ?? 300,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00"
  };
}

function snapshot(input: {
  snapshotId: string;
  market?: HistoricalMarketSnapshot["market"];
  symbol: string;
  name?: string;
  observedAt: string;
  assetType?: HistoricalMarketSnapshot["assetType"];
  assetClass?: HistoricalMarketSnapshot["assetClass"];
  region?: HistoricalMarketSnapshot["region"];
  riskTags?: HistoricalMarketSnapshot["riskTags"];
  strategyBucket?: HistoricalMarketSnapshot["strategyBucket"];
  sector?: HistoricalMarketSnapshot["sector"];
  lastPriceKrw?: number;
  volume?: number;
  openPriceKrw?: number;
  closePriceKrw?: number;
}): HistoricalMarketSnapshot {
  const output: HistoricalMarketSnapshot = {
    snapshotId: input.snapshotId,
    market: input.market ?? "KR",
    symbol: input.symbol,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.assetType === undefined ? {} : { assetType: input.assetType }),
    ...(input.assetClass === undefined ? {} : { assetClass: input.assetClass }),
    ...(input.region === undefined ? {} : { region: input.region }),
    ...(input.riskTags === undefined ? {} : { riskTags: input.riskTags }),
    ...(input.strategyBucket === undefined
      ? {}
      : { strategyBucket: input.strategyBucket }),
    ...(input.sector === undefined ? {} : { sector: input.sector }),
    observedAt: input.observedAt,
    interval: "1m",
    lastPriceKrw: input.lastPriceKrw ?? 70_000,
    volume: input.volume ?? 100_000,
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-12T09:00:00+09:00"
  };
  if (input.openPriceKrw !== undefined) {
    output.openPriceKrw = input.openPriceKrw;
  }
  if (input.closePriceKrw !== undefined) {
    output.closePriceKrw = input.closePriceKrw;
  }
  return output;
}
