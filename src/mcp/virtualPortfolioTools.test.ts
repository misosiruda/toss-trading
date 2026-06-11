import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualDecision, VirtualPortfolio, VirtualTrade } from "../domain/schemas.js";
import {
  createStoragePaths,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import {
  callVirtualPortfolioTool,
  listVirtualPortfolioTools,
  virtualPortfolioToolNames
} from "./virtualPortfolioTools.js";

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

test("virtual portfolio MCP tool list is read-only and excludes forbidden tools", () => {
  const tools = listVirtualPortfolioTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...virtualPortfolioToolNames]
  );
  assert.equal(tools.some((tool) => tool.name === "place_order"), false);
  assert.equal(tools.some((tool) => tool.name === "run_tossctl"), false);
  assert.equal(tools.some((tool) => tool.name === "run_codex_exec"), false);
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

test("forbidden or unknown tool names return an MCP error result", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const result = await callVirtualPortfolioTool(
    "place_order",
    {},
    { storageBaseDir }
  );
  const payload = parseToolJson(result);

  assert.equal(result.isError, true);
  assert.match(String(payload["error"]), /Unknown or disabled tool/);
});
