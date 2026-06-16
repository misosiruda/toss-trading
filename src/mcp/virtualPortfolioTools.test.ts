import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { TossInvestCliCollectResult } from "../collectors/tossInvestCliCollector.js";
import type { MarketPacket, VirtualDecision, VirtualPortfolio, VirtualTrade } from "../domain/schemas.js";
import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import {
  createStoragePaths,
  FileMarketPacketStore,
  FileTossInvestSourceStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import {
  callVirtualPortfolioTool,
  listVirtualPortfolioTools,
  virtualPortfolioToolNames
} from "./virtualPortfolioTools.js";
import { disabledByDefaultMcpToolNames } from "./toolSurfacePolicy.js";

async function createTempStorageBaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-mcp-test-"));
}

function parseToolJson(result: Awaited<ReturnType<typeof callVirtualPortfolioTool>>) {
  const first = result.content[0];
  assert.equal(first?.type, "text");
  return JSON.parse(first.text) as Record<string, unknown>;
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 900_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        quantity: 2,
        averagePriceKrw: 70_000,
        marketValueKrw: 150_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      },
      {
        market: "KR",
        symbol: "000660",
        quantity: 1,
        averagePriceKrw: 120_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ],
    updatedAt: "2026-06-11T09:00:00+09:00"
  };
}

function decision(): VirtualDecision {
  return {
    packetId: "packet_test_001",
    summary: "Paper-only decision",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.8,
        budgetKrw: 100_000,
        thesis: "Paper thesis references order ord_abcdef123456",
        riskFactors: ["Do not expose account 1234-5678-901234"],
        dataRefs: ["tossinvest_cli:market.ranking:0:0"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}

function trade(): VirtualTrade {
  return {
    tradeId: "trade_test_001",
    packetId: "packet_test_001",
    decisionId: "decision_test_001",
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 70_000,
    amountKrw: 70_000,
    status: "VIRTUAL_FILLED",
    executedAt: "2026-06-11T09:01:00+09:00"
  };
}

function marketPacket(): MarketPacket {
  return {
    packetId: "packet_mcp_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: portfolio(),
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
        collectedAt: "2026-06-11T09:00:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function source(status: TossInvestCliCollectResult["status"]): TossInvestCliCollectResult {
  return {
    status,
    commandKey: "market.ranking",
    data: status === "ok" ? { items: [] } : null,
    metadata: {
      source: "tossinvest_cli",
      sourceKind: "unofficial_read_only",
      official: false,
      commandKey: "market.ranking",
      collectedAt: "2026-06-11T09:00:00+09:00"
    },
    error:
      status === "ok"
        ? null
        : {
            code: "COMMAND_FAILED",
            message: "read-only source degraded"
          }
  };
}

test("virtual portfolio MCP tool list is read-only and excludes forbidden tools", () => {
  const tools = listVirtualPortfolioTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...virtualPortfolioToolNames]
  );
  for (const disabledToolName of disabledByDefaultMcpToolNames) {
    assert.equal(
      tools.some((tool) => tool.name === disabledToolName),
      false,
      disabledToolName
    );
  }
  assert.equal(
    tools.every((tool) => tool.annotations?.readOnlyHint === true),
    true
  );
  assert.equal(
    tools.every((tool) => tool.annotations?.destructiveHint === false),
    true
  );
});

test("get_virtual_positions reads and filters portfolio positions", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());

  const result = await callVirtualPortfolioTool(
    "get_virtual_positions",
    { symbol: "005930" },
    { storageBaseDir }
  );
  const payload = parseToolJson(result);

  assert.equal(result.isError, undefined);
  assert.equal(payload["readOnly"], true);
  assert.equal(payload["count"], 1);
  assert.equal((payload["positions"] as Array<Record<string, unknown>>)[0]?.["symbol"], "005930");
});

test("get_virtual_decisions masks sensitive text", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(decision());

  const result = await callVirtualPortfolioTool(
    "get_virtual_decisions",
    { limit: 5 },
    { storageBaseDir }
  );
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";

  assert.equal(result.isError, undefined);
  assert.equal(text.includes("ord_abcdef123456"), false);
  assert.equal(text.includes("1234-5678-901234"), false);
  assert.match(text, /\*\*\*\*/);
});

test("get_virtual_performance derives paper-only metrics", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  await new FileVirtualTradeStore(paths.virtualTradesPath).append(trade());

  const result = await callVirtualPortfolioTool(
    "get_virtual_performance",
    {},
    { storageBaseDir }
  );
  const payload = parseToolJson(result);
  const metrics = payload["metrics"] as Record<string, unknown>;

  assert.equal(result.isError, undefined);
  assert.equal(payload["mode"], "paper_only");
  assert.equal(metrics["virtualNetWorthKrw"], 1_170_000);
  assert.equal(metrics["filledTradeCount"], 1);
  assert.match(String(payload["disclaimer"]), /not financial advice/);
});

test("get_paper_report returns a read-only daily paper report", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(decision());
  await new FileVirtualTradeStore(paths.virtualTradesPath).append(trade());

  const result = await callVirtualPortfolioTool(
    "get_paper_report",
    { date: "2026-06-11" },
    { storageBaseDir }
  );
  const payload = parseToolJson(result);

  assert.equal(result.isError, undefined);
  assert.equal(payload["mode"], "paper_only");
  assert.equal(payload["title"], "Paper Trading Daily Report");
  assert.match(String(payload["disclaimer"]), /cannot place live orders/);
});

test("get_scheduler_status reads scheduler state and lock metadata only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const schedulerPaths = createPaperSchedulerPaths(storageBaseDir);
  await writeFile(
    schedulerPaths.statePath,
    `${JSON.stringify({
      dayKey: "2026-06-11",
      runsUsed: 1,
      lastRunAt: "2026-06-11T09:00:00+09:00"
    })}\n`,
    "utf8"
  );
  await writeFile(
    schedulerPaths.lockPath,
    `${JSON.stringify({ acquiredAt: "2026-06-11T09:01:00+09:00" })}\n`,
    "utf8"
  );

  const result = await callVirtualPortfolioTool(
    "get_scheduler_status",
    {},
    { storageBaseDir }
  );
  const payload = parseToolJson(result);
  const schedulerState = payload["schedulerState"] as Record<string, unknown>;

  assert.equal(result.isError, undefined);
  assert.equal(payload["readOnly"], true);
  assert.equal(payload["stateStatus"], "ok");
  assert.equal(payload["lockStatus"], "ok");
  assert.equal(schedulerState["runsUsed"], 1);
});

test("get_source_health summarizes stored TossInvest source statuses", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileTossInvestSourceStore(paths.tossInvestSourcesPath).append(
    source("ok")
  );
  await new FileTossInvestSourceStore(paths.tossInvestSourcesPath).append(
    source("degraded")
  );

  const result = await callVirtualPortfolioTool(
    "get_source_health",
    {},
    { storageBaseDir }
  );
  const payload = parseToolJson(result);
  const byStatus = payload["byStatus"] as Record<string, unknown>;

  assert.equal(result.isError, undefined);
  assert.equal(payload["status"], "degraded");
  assert.equal(payload["totalCount"], 2);
  assert.equal(byStatus["ok"], 1);
  assert.equal(byStatus["degraded"], 1);
});

test("get_market_packets returns recent stored packets with a limit", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());
  await new FileMarketPacketStore(paths.marketPacketsPath).append({
    ...marketPacket(),
    packetId: "packet_mcp_002"
  });

  const result = await callVirtualPortfolioTool(
    "get_market_packets",
    { limit: 1 },
    { storageBaseDir }
  );
  const payload = parseToolJson(result);
  const packets = payload["packets"] as Array<Record<string, unknown>>;

  assert.equal(result.isError, undefined);
  assert.equal(payload["count"], 1);
  assert.equal(payload["totalCount"], 2);
  assert.equal(packets[0]?.["packetId"], "packet_mcp_002");
});

test("virtual portfolio MCP tools reject invalid input fields", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const invalidMarket = await callVirtualPortfolioTool(
    "get_virtual_positions",
    { market: "JP" },
    { storageBaseDir }
  );
  const invalidMarketPayload = parseToolJson(invalidMarket);
  const unexpectedField = await callVirtualPortfolioTool(
    "get_virtual_portfolio",
    { limit: 1 },
    { storageBaseDir }
  );
  const unexpectedFieldPayload = parseToolJson(unexpectedField);
  const invalidLimit = await callVirtualPortfolioTool(
    "get_market_packets",
    { limit: 101 },
    { storageBaseDir }
  );
  const invalidLimitPayload = parseToolJson(invalidLimit);
  const invalidDate = await callVirtualPortfolioTool(
    "get_paper_report",
    { date: "2026-6-1" },
    { storageBaseDir }
  );
  const invalidDatePayload = parseToolJson(invalidDate);

  assert.equal(invalidMarket.isError, true);
  assert.match(String(invalidMarketPayload["error"]), /`market`/);
  assert.equal(unexpectedField.isError, true);
  assert.match(String(unexpectedFieldPayload["error"]), /Unexpected input field/);
  assert.equal(invalidLimit.isError, true);
  assert.match(String(invalidLimitPayload["error"]), /`limit`/);
  assert.equal(invalidDate.isError, true);
  assert.match(String(invalidDatePayload["error"]), /`date`/);
});

test("forbidden or unknown tool names return an MCP error result", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  for (const disabledToolName of disabledByDefaultMcpToolNames) {
    const result = await callVirtualPortfolioTool(
      disabledToolName,
      {},
      { storageBaseDir }
    );
    const payload = parseToolJson(result);

    assert.equal(result.isError, true, disabledToolName);
    assert.match(
      String(payload["error"]),
      /Unknown or disabled tool/,
      disabledToolName
    );
  }

  const unknown = await callVirtualPortfolioTool("unknown_tool", {}, { storageBaseDir });
  const unknownPayload = parseToolJson(unknown);

  assert.equal(unknown.isError, true);
  assert.match(String(unknownPayload["error"]), /Unknown or disabled tool/);
});
