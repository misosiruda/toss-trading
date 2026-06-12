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
  symbol: string;
  observedAt: string;
  lastPriceKrw?: number;
  volume?: number;
  openPriceKrw?: number;
  closePriceKrw?: number;
}): HistoricalMarketSnapshot {
  const output: HistoricalMarketSnapshot = {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: input.symbol,
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
