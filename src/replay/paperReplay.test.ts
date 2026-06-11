import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket, VirtualDecision } from "../domain/schemas.js";
import {
  createStoragePaths,
  FileMarketPacketStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import { replayPaperDecisions, runStoredPaperReplay } from "./paperReplay.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-replay-"));
}

test("paper replay is deterministic for the same packet and decision fixture", () => {
  const first = replayPaperDecisions({
    packet: marketPacket(),
    decision: virtualDecision(),
    now,
    promptVersion: "paper-v1"
  });
  const second = replayPaperDecisions({
    packet: marketPacket(),
    decision: virtualDecision(),
    now,
    promptVersion: "paper-v1"
  });

  assert.deepEqual(first, second);
  assert.equal(first.status, "completed");
  assert.equal(first.tradeCount, 1);
  assert.equal(first.rejectedCount, 0);
  assert.equal(first.finalPortfolio?.cashKrw, 930_000);
  assert.equal(first.trades[0]?.tradeId, "vtrade_packet_replay_001_005930_VIRTUAL_BUY");
});

test("paper replay rejects stale market packets before simulating trades", () => {
  const result = replayPaperDecisions({
    packet: marketPacket({ expiresAt: "2026-06-11T08:59:59+09:00" }),
    decision: virtualDecision(),
    now
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "stale_packet");
  assert.equal(result.tradeCount, 0);
  assert.equal(result.finalPortfolio, null);
});

test("paper replay rejects decisions for a different packet", () => {
  const result = replayPaperDecisions({
    packet: marketPacket(),
    decision: { ...virtualDecision(), packetId: "packet_other_001" },
    now
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "packet_mismatch");
  assert.equal(result.tradeCount, 0);
});

test("stored paper replay reads latest fixtures without mutating paper stores", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(
    virtualDecision()
  );

  const result = await runStoredPaperReplay({
    storageBaseDir: dir,
    now,
    promptVersion: "paper-v1"
  });
  const portfolio = await new FileVirtualPortfolioStore(
    paths.virtualPortfolioPath
  ).read();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.packetRecordCount, 1);
  assert.equal(result.decisionRecordCount, 1);
  assert.equal(result.tradeCount, 1);
  assert.equal(portfolio, null);
  assert.equal(trades.records.length, 0);
});

function marketPacket(overrides: Partial<MarketPacket> = {}): MarketPacket {
  return {
    packetId: "packet_replay_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T08:59:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-06-11T08:59:00+09:00"
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Samsung",
        lastPriceKrw: 70_000,
        ranking: 1,
        score: 90,
        reasonCodes: ["ranking"],
        sourceRefs: ["tossinvest_cli:market.ranking:0:0"],
        collectedAt: "2026-06-11T08:59:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    ...overrides
  };
}

function virtualDecision(): VirtualDecision {
  return {
    packetId: "packet_replay_001",
    summary: "Paper-only replay fixture.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.75,
        budgetKrw: 70_000,
        thesis: "Replay fixture cites the stored candidate source.",
        riskFactors: ["Virtual portfolio simulation can diverge from live markets."],
        dataRefs: ["tossinvest_cli:market.ranking:0:0"],
        expiresAt: "2026-06-11T09:04:00+09:00"
      }
    ]
  };
}
