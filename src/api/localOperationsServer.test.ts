import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditEvent,
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio,
  VirtualTrade
} from "../domain/schemas.js";
import type { TossInvestCliCollectResult } from "../collectors/tossInvestCliCollector.js";
import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileTossInvestSourceStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import { createLocalOperationsServer } from "./localOperationsServer.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function createTempStorageBaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-api-test-"));
}

async function startTestServer(
  storageBaseDir: string
): Promise<{ server: Server; baseUrl: string }> {
  const server = createLocalOperationsServer({
    storageBaseDir,
    now: () => now
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function fetchJson(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = (await response.json()) as Record<string, unknown>;
  return { response, payload };
}

async function fetchText(
  baseUrl: string,
  path: string
): Promise<{ response: Response; text: string }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { response, text };
}

test("local operations API serves health and virtual portfolio JSON", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const health = await fetchJson(baseUrl, "/health");
    const portfolioResponse = await fetchJson(baseUrl, "/virtual/portfolio");

    assert.equal(health.response.status, 200);
    assert.match(
      health.response.headers.get("content-type") ?? "",
      /application\/json/
    );
    assert.equal(health.payload["mode"], "paper_only");
    assert.equal(health.payload["readOnly"], true);
    assert.equal(health.payload["tradingEnabled"], false);
    assert.equal(portfolioResponse.payload["sourceStatus"], "ok");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves read-only dashboard assets", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const html = await fetchText(baseUrl, "/dashboard");
    const script = await fetchText(baseUrl, "/dashboard/app.js");

    assert.equal(html.response.status, 200);
    assert.match(html.response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html.text, /가상 투자 대시보드/);
    assert.match(html.text, /id="daily-report-heading"/);
    assert.match(html.text, /id="performance-heading"/);
    assert.match(html.text, /id="net-worth-chart"/);
    assert.match(html.text, /id="allocation-list"/);
    assert.match(html.text, /id="benchmark-heading"/);
    assert.match(html.text, /id="benchmark-alpha"/);
    assert.match(html.text, /id="execution-cost-heading"/);
    assert.match(html.text, /id="execution-cost-fee-drag"/);
    assert.match(html.text, /id="execution-cost-detail"/);
    assert.match(html.text, /id="market-monitor-heading"/);
    assert.match(html.text, /id="market-monitor-gainers"/);
    assert.match(html.text, /id="market-monitor-extremes"/);
    assert.match(html.text, /id="exposure-heading"/);
    assert.match(html.text, /id="exposure-sector-list"/);
    assert.match(html.text, /id="exposure-coverage-detail"/);
    assert.match(html.text, /id="event-heading"/);
    assert.match(html.text, /id="event-signal-list"/);
    assert.match(html.text, /id="event-gap-detail"/);
    assert.match(html.text, /id="income-goal-heading"/);
    assert.match(html.text, /id="goal-target-progress"/);
    assert.match(html.text, /id="income-goal-detail"/);
    assert.match(html.text, /id="report-detail"/);
    assert.match(html.text, /id="replay-heading"/);
    assert.match(html.text, /id="replay-progress-status"/);
    assert.match(html.text, /id="replay-progress-events-body"/);
    assert.match(html.text, /id="replay-timeline-body"/);
    assert.match(html.text, /id="batch-replay-heading"/);
    assert.match(html.text, /id="batch-replay-average-return"/);
    assert.match(html.text, /id="batch-regime-list"/);
    assert.match(html.text, /data-action-filter="BUY"/);
    assert.match(html.text, /id="symbol-filter"/);
    assert.match(html.text, /id="decision-performance-list"/);
    assert.match(html.text, /id="decision-performance-average"/);
    assert.match(html.text, /id="portfolio-risk-status"/);
    assert.match(html.text, /id="portfolio-risk-detail"/);
    assert.equal(script.response.status, 200);
    assert.match(script.text, /\/virtual\/portfolio/);
    assert.match(script.text, /\/paper\/report/);
    assert.match(script.text, /\/replay\/report/);
    assert.match(script.text, /\/replay\/progress/);
    assert.match(script.text, /\/batch\/replay\/report/);
    assert.match(script.text, /\/audit\/events/);
    assert.match(script.text, /fetchEndpointData/);
    assert.match(script.text, /endpointFailures/);
    assert.match(script.text, /renderDailyReport/);
    assert.match(script.text, /renderReplayReport/);
    assert.match(script.text, /renderReplayProgress/);
    assert.match(script.text, /renderBatchReplayReport/);
    assert.match(script.text, /renderPortfolioPerformance/);
    assert.match(script.text, /renderNetWorthChart/);
    assert.match(script.text, /renderAllocationList/);
    assert.match(script.text, /renderBenchmarkComparison/);
    assert.match(script.text, /equalWeightBenchmarkReturn/);
    assert.match(script.text, /renderExecutionCostDiagnostics/);
    assert.match(script.text, /buildExecutionCostSummary/);
    assert.match(script.text, /renderExposureBreakdown/);
    assert.match(script.text, /renderEventCoverage/);
    assert.match(script.text, /renderIncomeGoalPanel/);
    assert.match(script.text, /scheduleReplayProgressPolling/);
    assert.match(script.text, /renderReplayTimeline/);
    assert.match(script.text, /renderDecisionTimeline/);
    assert.match(script.text, /renderDecisionPerformance/);
    assert.match(script.text, /buildDecisionPerformanceOutcomes/);
    assert.match(script.text, /renderPortfolioRiskMetrics/);
    assert.match(script.text, /buildPortfolioRiskMetrics/);
    assert.match(script.text, /decisionOutcomeRow/);
    assert.match(script.text, /decisionRationale/);
    assert.match(script.text, /리스크 요인/);
    assert.doesNotMatch(script.text, /\bPOST\b|\bPUT\b|\bDELETE\b/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves stored historical replay report read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.historicalReplayReportPath,
    `${JSON.stringify(historicalReplayReport())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/replay/report");
    const report = result.payload["report"] as Record<string, unknown>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "ok");
    assert.equal(report["title"], "Historical Replay Paper Report");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves stored batch replay aggregate report read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(batchReplayAggregateReport())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/batch/replay/report");
    const report = result.payload["report"] as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "ok");
    assert.equal(report["title"], "Batch Replay Paper Aggregate Report");
    assert.equal(summary["runCount"], 4);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves stored historical replay progress read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.historicalReplayProgressPath,
    `${JSON.stringify(historicalReplayProgress())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/replay/progress");
    const progress = result.payload["progress"] as Record<string, unknown>;
    const events = progress["recentEvents"] as Array<Record<string, unknown>>;
    const progressPortfolio = progress["currentPortfolio"] as Record<string, unknown>;
    const positions = progressPortfolio["positions"] as Array<Record<string, unknown>>;
    const portfolioTimeline = progress["portfolioTimeline"] as Array<
      Record<string, unknown>
    >;
    const recentDecisions = progress["recentDecisions"] as Array<Record<string, unknown>>;
    const recentTrades = progress["recentTrades"] as Array<Record<string, unknown>>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "running");
    assert.equal(result.payload["fileStatus"], "ok");
    assert.equal(progress["mode"], "paper_only");
    assert.equal(progress["riskDecisionCount"], 2);
    assert.equal(progress["riskApprovedCount"], 1);
    assert.equal(positions[0]?.["symbol"], "005930");
    assert.equal(portfolioTimeline[0]?.["virtualNetWorthKrw"], 1_000_000);
    assert.equal(recentDecisions[0]?.["packetId"], "packet_api_001");
    assert.equal(recentTrades[0]?.["tradeId"], "trade_api_001");
    assert.equal(events[0]?.["eventType"], "RISK_REJECTED");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves source health and market packets", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileTossInvestSourceStore(paths.tossInvestSourcesPath).append(
    sourceResult()
  );
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const source = await fetchJson(baseUrl, "/source/health");
    const packets = await fetchJson(baseUrl, "/market/packets?limit=1");
    const byCommandKey = source.payload["byCommandKey"] as Record<string, unknown>;
    const packetRecords = packets.payload["packets"] as Array<Record<string, unknown>>;

    assert.equal(source.response.status, 200);
    assert.equal(source.payload["readOnly"], true);
    assert.equal(source.payload["status"], "ok");
    assert.equal(byCommandKey["market.ranking"], 1);
    assert.equal(packets.response.status, 200);
    assert.equal(packets.payload["count"], 1);
    assert.equal(packetRecords[0]?.["packetId"], "packet_api_001");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves recent masked audit events", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileAuditLog(paths.auditLogPath).append(auditEvent());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/audit/events?limit=1");
    const events = result.payload["events"] as Array<Record<string, unknown>>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["count"], 1);
    assert.equal(events[0]?.["eventType"], "VIRTUAL_RISK_APPROVED");
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API returns decisions and masks sensitive text", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(decision());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/virtual/decisions?limit=1");
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["count"], 1);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves paper report and scheduler status", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const schedulerPaths = createPaperSchedulerPaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  await new FileVirtualTradeStore(paths.virtualTradesPath).append(trade());
  await writeFile(
    schedulerPaths.statePath,
    `${JSON.stringify({ dayKey: "2026-06-11", runsUsed: 1 })}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const report = await fetchJson(baseUrl, "/paper/report?date=2026-06-11");
    const scheduler = await fetchJson(baseUrl, "/scheduler/status");
    const schedulerState = scheduler.payload["schedulerState"] as Record<
      string,
      unknown
    >;

    assert.equal(report.response.status, 200);
    assert.equal(report.payload["title"], "Paper Trading Daily Report");
    assert.match(String(report.payload["disclaimer"]), /cannot place live orders/);
    assert.equal(scheduler.response.status, 200);
    assert.equal(scheduler.payload["stateStatus"], "ok");
    assert.equal(scheduler.payload["lockStatus"], "missing");
    assert.equal(schedulerState["runsUsed"], 1);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API rejects mutation methods and has no live order endpoint", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const mutation = await fetchJson(baseUrl, "/virtual/portfolio", {
      method: "POST"
    });
    const liveOrder = await fetchJson(baseUrl, "/place_order");

    assert.equal(mutation.response.status, 405);
    assert.equal(mutation.payload["readOnly"], true);
    assert.equal(liveOrder.response.status, 404);
    assert.equal(liveOrder.payload["error"], "not_found");
  } finally {
    await stopTestServer(server);
  }
});

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
      }
    ],
    updatedAt: "2026-06-11T09:00:00+09:00"
  };
}

function decision(): VirtualDecision {
  return {
    packetId: "packet_api_001",
    summary: "Paper-only decision",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.8,
        budgetKrw: 70_000,
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
    tradeId: "trade_api_001",
    packetId: "packet_api_001",
    decisionId: "decision_api_001",
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

function sourceResult(): TossInvestCliCollectResult {
  return {
    status: "ok",
    commandKey: "market.ranking",
    data: { items: [{ symbol: "005930" }] },
    metadata: {
      source: "tossinvest_cli",
      sourceKind: "unofficial_read_only",
      official: false,
      commandKey: "market.ranking",
      collectedAt: "2026-06-11T09:00:00+09:00"
    },
    error: null
  };
}

function marketPacket(): MarketPacket {
  return {
    packetId: "packet_api_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Sample Corp",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["RANKING"],
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

function auditEvent(): AuditEvent {
  return {
    eventId: "audit_api_001",
    eventType: "VIRTUAL_RISK_APPROVED",
    actor: "system",
    summary: "KR:005930 VIRTUAL_BUY ord_abcdef123456",
    maskedRefs: [],
    createdAt: "2026-06-11T09:02:00+09:00"
  };
}

function historicalReplayReport(): Record<string, unknown> {
  return {
    title: "Historical Replay Paper Report",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    simulatedRange: {
      startAt: "2025-01-02T00:00:00.000Z",
      endAt: "2025-01-02T00:02:00.000Z",
      tickCount: 3
    },
    replaySummary: {
      packetCount: 3,
      decisionProviderCallCount: 2,
      decisionSkippedCount: 1,
      decisionRecordCount: 2,
      decisionItemCount: 2,
      tradeCount: 2,
      rejectedCount: 0
    },
    portfolio: {
      finalCashKrw: 830_000,
      finalPositionCount: 2,
      finalVirtualNetWorthKrw: 1_000_000
    },
    tradeSummary: {
      tradeCount: 2,
      virtualBuyAmountKrw: 170_000,
      virtualSellAmountKrw: 0,
      symbols: ["005930", "035420"]
    },
    riskSummary: {
      approvedCount: 2,
      rejectedCount: 0,
      rejectCodes: {}
    },
    samplingSummary: {
      decisionsRequested: 2,
      decisionsSkipped: 1,
      skipReasons: {
        STEP_INTERVAL_SKIPPED: 1
      }
    },
    sourceWarningSummary: {
      lookaheadGuardStatus: "future_snapshots_excluded",
      warningCount: 1,
      futureSnapshotWarningCount: 1,
      staleSnapshotWarningCount: 0,
      recentWarnings: ["account 1234-5678-901234 order ord_abcdef123456"]
    },
    portfolioTimeline: [
      {
        simulatedAt: "2025-01-02T00:00:00.000Z",
        cashKrw: 930_000,
        positionCount: 1,
        positionMarketValueKrw: 70_000,
        virtualNetWorthKrw: 1_000_000
      }
    ],
    disclaimer:
      "Paper-only historical replay simulation. This is not financial advice, not a performance guarantee, and cannot place live orders."
  };
}

function batchReplayAggregateReport(): Record<string, unknown> {
  return {
    title: "Batch Replay Paper Aggregate Report",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    sourceRunsPath: "data/batch-replay/batch-smoke/batch-replay-runs.jsonl",
    summary: {
      runCount: 4,
      completedCount: 3,
      skippedCount: 1,
      failedCount: 0,
      returnSampleCount: 3,
      regimeCounts: {
        bull: 2,
        bear: 1,
        insufficient_data: 1
      }
    },
    overall: {
      key: "overall",
      runCount: 4,
      completedCount: 3,
      skippedCount: 1,
      failedCount: 0,
      returnSampleCount: 3,
      averageTotalReturnRatio: 0.015,
      medianTotalReturnRatio: 0.01,
      minTotalReturnRatio: -0.01,
      maxTotalReturnRatio: 0.045,
      winRate: 0.666667,
      averageFinalVirtualNetWorthKrw: 1_015_000,
      totalTradeCount: 8,
      averageTradeCount: 2.666667,
      totalRejectedCount: 1,
      runIds: ["run_0", "run_1", "run_2", "run_3"]
    },
    byRegime: {
      bull: {
        key: "bull",
        runCount: 2,
        completedCount: 2,
        skippedCount: 0,
        failedCount: 0,
        returnSampleCount: 2,
        averageTotalReturnRatio: 0.025,
        medianTotalReturnRatio: 0.025,
        minTotalReturnRatio: 0.005,
        maxTotalReturnRatio: 0.045,
        winRate: 1,
        averageFinalVirtualNetWorthKrw: 1_025_000,
        totalTradeCount: 6,
        averageTradeCount: 3,
        totalRejectedCount: 0,
        runIds: ["run_0", "run_1"]
      },
      bear: {
        key: "bear",
        runCount: 1,
        completedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        returnSampleCount: 1,
        averageTotalReturnRatio: -0.01,
        medianTotalReturnRatio: -0.01,
        minTotalReturnRatio: -0.01,
        maxTotalReturnRatio: -0.01,
        winRate: 0,
        averageFinalVirtualNetWorthKrw: 990_000,
        totalTradeCount: 2,
        averageTradeCount: 2,
        totalRejectedCount: 1,
        runIds: ["run_2"]
      },
      insufficient_data: {
        key: "insufficient_data",
        runCount: 1,
        completedCount: 0,
        skippedCount: 1,
        failedCount: 0,
        returnSampleCount: 0,
        averageTotalReturnRatio: null,
        medianTotalReturnRatio: null,
        minTotalReturnRatio: null,
        maxTotalReturnRatio: null,
        winRate: null,
        averageFinalVirtualNetWorthKrw: null,
        totalTradeCount: 0,
        averageTradeCount: null,
        totalRejectedCount: 0,
        runIds: ["run_3"]
      }
    },
    disclaimer:
      "Batch replay aggregate reports are paper-only. They are not investment advice, guaranteed performance, or live trading signals."
  };
}

function historicalReplayProgress(): Record<string, unknown> {
  return {
    mode: "paper_only",
    status: "running",
    startedAt: "2026-06-11T09:00:00+09:00",
    updatedAt: "2025-01-02T00:01:00.000Z",
    completedAt: null,
    failedAt: null,
    simulatedAt: "2025-01-02T00:01:00.000Z",
    tickIndex: 1,
    completedTickCount: 2,
    tickCount: 3,
    packetCount: 2,
    decisionProviderCallCount: 2,
    decisionSkippedCount: 0,
    decisionRecordCount: 2,
    tradeCount: 1,
    riskDecisionCount: 2,
    riskApprovedCount: 1,
    rejectedCount: 1,
    currentPortfolio: {
      simulatedAt: "2025-01-02T00:01:00.000Z",
      cashKrw: 930_000,
      positionCount: 1,
      positionMarketValueKrw: 70_000,
      virtualNetWorthKrw: 1_000_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 70_000,
          marketValueKrw: 70_000,
          unrealizedPnlKrw: 0,
          updatedAt: "2025-01-02T00:01:00.000Z"
        }
      ]
    },
    portfolioTimeline: [
      {
        simulatedAt: "2025-01-02T00:00:00.000Z",
        cashKrw: 1_000_000,
        positionCount: 0,
        positionMarketValueKrw: 0,
        virtualNetWorthKrw: 1_000_000,
        positions: []
      },
      {
        simulatedAt: "2025-01-02T00:01:00.000Z",
        cashKrw: 930_000,
        positionCount: 1,
        positionMarketValueKrw: 70_000,
        virtualNetWorthKrw: 1_000_000,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 1,
            averagePriceKrw: 70_000,
            marketValueKrw: 70_000,
            unrealizedPnlKrw: 0,
            updatedAt: "2025-01-02T00:01:00.000Z"
          }
        ]
      }
    ],
    recentEvents: [
      {
        eventId: "replay_event_1_2_packet_api_001_005930_risk_rejected",
        eventType: "RISK_REJECTED",
        simulatedAt: "2025-01-02T00:01:00.000Z",
        tickIndex: 1,
        packetId: "packet_api_001",
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        approved: false,
        rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
        summary: "KR:005930 VIRTUAL_BUY rejected account 1234-5678-901234 order ord_abcdef123456"
      }
    ],
    recentPackets: [marketPacket()],
    recentDecisions: [decision()],
    recentRiskDecisions: [
      {
        riskDecisionId: "risk_api_002",
        packetId: "packet_api_001",
        symbol: "005930",
        approved: false,
        rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
        checkedRules: ["cash_available"],
        createdAt: "2025-01-02T00:01:00.000Z"
      },
      {
        riskDecisionId: "risk_api_001",
        packetId: "packet_api_001",
        symbol: "005930",
        approved: true,
        rejectCodes: [],
        checkedRules: ["cash_available"],
        createdAt: "2025-01-02T00:00:00.000Z"
      }
    ],
    recentTrades: [trade()],
    finalReportPath: null,
    error: null,
    disclaimer:
      "Paper-only historical replay progress. This is not financial advice, not a performance guarantee, and cannot place live orders."
  };
}
