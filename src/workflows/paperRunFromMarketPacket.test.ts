import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket, VirtualDecision } from "../domain/schemas.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import type { DecisionProvider } from "./paperRunOnce.js";
import {
  FailingMarketPacketDecisionProvider,
  MarketPacketDryRunDecisionProvider,
  runPaperDecisionFromLatestMarketPacket,
  StaticMarketPacketDecisionProvider
} from "./paperRunFromMarketPacket.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-market-packet-run-"));
}

test("market packet paper run records decision, trade, portfolio, and audit chain", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider(virtualDecision()),
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const portfolio = await new FileVirtualPortfolioStore(
    paths.virtualPortfolioPath
  ).read();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.packetId, "packet_market_run_001");
  assert.equal(result.tradeCount, 1);
  assert.equal(result.rejectedCount, 0);
  assert.equal(decisions.records.length, 1);
  assert.equal(trades.records.length, 1);
  assert.equal(portfolio?.cashKrw, 930_000);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    [
      "MARKET_PACKET_SELECTED",
      "VIRTUAL_DECISION_RECORDED",
      "VIRTUAL_RISK_APPROVED",
      "PAPER_ORDER_FILLED"
    ]
  );
});

test("market packet paper run fails closed for stale packet before provider call", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  const provider = new CountingDecisionProvider();
  await new FileMarketPacketStore(paths.marketPacketsPath).append(
    marketPacket({ expiresAt: "2026-06-11T08:59:00+09:00" })
  );

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider,
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "stale_market_packet");
  assert.equal(provider.calls, 0);
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
});

test("market packet paper run rejects decision packet mismatch without saving decision", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider({
      ...virtualDecision(),
      packetId: "packet_other_001"
    }),
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "decision_packet_mismatch");
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
});

test("market packet paper run rejects hallucinated data refs before saving decision", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider({
      ...virtualDecision(),
      decisions: [
        {
          ...virtualDecision().decisions[0]!,
          dataRefs: ["tossinvest_cli:market.ranking:missing"]
        }
      ]
    }),
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "virtual_decision_semantic_invalid");
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    ["MARKET_PACKET_SELECTED", "VIRTUAL_DECISION_REJECTED"]
  );
});

test("market packet dry-run provider builds a paper decision from stored candidates", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new MarketPacketDryRunDecisionProvider(),
    now
  });
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.tradeCount, 1);
  assert.equal(trades.records[0]?.symbol, "005930");
  assert.match(result.report, /stored_market_packet/);
  assert.match(result.report, /not financial advice/);
});

test("market packet paper run records provider failures without paper order", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new FailingMarketPacketDecisionProvider({
      code: "AI_DECISION_DISABLED",
      reason: "disabled in test"
    }),
    now
  });
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "AI_DECISION_DISABLED");
  assert.equal(trades.records.length, 0);
});

class CountingDecisionProvider implements DecisionProvider {
  calls = 0;

  async decide() {
    this.calls += 1;
    return {
      attempted: false,
      decision: virtualDecision(),
      failure: null,
      command: null
    };
  }
}

function marketPacket(overrides: Partial<MarketPacket> = {}): MarketPacket {
  return {
    packetId: "packet_market_run_001",
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
    packetId: "packet_market_run_001",
    summary: "Paper-only market packet decision.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.7,
        budgetKrw: 70_000,
        thesis: "Stored market packet supports a paper-only virtual buy.",
        riskFactors: ["Paper-only simulation risk."],
        dataRefs: ["tossinvest_cli:market.ranking:0:0"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}
