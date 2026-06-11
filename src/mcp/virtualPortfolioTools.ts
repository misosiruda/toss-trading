import { readFile } from "node:fs/promises";

import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import type { Market } from "../domain/schemas.js";
import { buildPaperDailyReport } from "../reports/paperDailyReport.js";
import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import { maskObject } from "../security/masking.js";
import {
  createStoragePaths,
  FileMarketPacketStore,
  FileTossInvestSourceStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";

export const virtualPortfolioToolNames = [
  "get_virtual_portfolio",
  "get_virtual_positions",
  "get_virtual_decisions",
  "get_virtual_trades",
  "get_virtual_performance",
  "get_paper_report",
  "get_scheduler_status",
  "get_source_health",
  "get_market_packets"
] as const;

export type VirtualPortfolioToolName = (typeof virtualPortfolioToolNames)[number];

export interface VirtualPortfolioToolContext {
  storageBaseDir: string;
}

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

const limitInputSchema = {
  type: "object",
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100
    }
  },
  additionalProperties: false
} as const;

const reportInputSchema = {
  type: "object",
  properties: {
    date: {
      type: "string",
      minLength: 10,
      maxLength: 10
    }
  },
  additionalProperties: false
} as const;

const positionInputSchema = {
  type: "object",
  properties: {
    market: {
      type: "string",
      enum: ["KR", "US"]
    },
    symbol: {
      type: "string",
      minLength: 1
    }
  },
  additionalProperties: false
} as const;

export function listVirtualPortfolioTools(): Tool[] {
  return [
    readOnlyTool(
      "get_virtual_portfolio",
      "Read the current paper-only virtual portfolio snapshot.",
      emptyInputSchema
    ),
    readOnlyTool(
      "get_virtual_positions",
      "Read current paper-only virtual positions, optionally filtered by market or symbol.",
      positionInputSchema
    ),
    readOnlyTool(
      "get_virtual_decisions",
      "Read recent paper-only AI virtual decisions from local storage.",
      limitInputSchema
    ),
    readOnlyTool(
      "get_virtual_trades",
      "Read recent paper-only virtual trades from local storage.",
      limitInputSchema
    ),
    readOnlyTool(
      "get_virtual_performance",
      "Read derived paper-only virtual portfolio metrics without claiming investment performance.",
      emptyInputSchema
    ),
    readOnlyTool(
      "get_paper_report",
      "Read the local paper trading daily report for operations review.",
      reportInputSchema
    ),
    readOnlyTool(
      "get_scheduler_status",
      "Read local paper scheduler state and lock metadata without triggering a run.",
      emptyInputSchema
    ),
    readOnlyTool(
      "get_source_health",
      "Read stored TossInvest read-only source health summary.",
      emptyInputSchema
    ),
    readOnlyTool(
      "get_market_packets",
      "Read recent stored paper-only market packets.",
      limitInputSchema
    )
  ];
}

export async function callVirtualPortfolioTool(
  name: string,
  args: Record<string, unknown> | undefined,
  context: VirtualPortfolioToolContext
): Promise<CallToolResult> {
  if (!isVirtualPortfolioToolName(name)) {
    return errorResult(`Unknown or disabled tool: ${name}`);
  }

  const repositories = createReadOnlyRepositories(context.storageBaseDir);
  const toolArgs = args ?? {};

  switch (name) {
    case "get_virtual_portfolio":
      return jsonResult(await readVirtualPortfolio(repositories.portfolioStore));
    case "get_virtual_positions":
      return jsonResult(
        await readVirtualPositions(repositories.portfolioStore, toolArgs)
      );
    case "get_virtual_decisions": {
      const limit = readLimit(toolArgs);
      if (typeof limit === "string") {
        return errorResult(limit);
      }
      return jsonResult(await readVirtualDecisions(repositories.decisionStore, limit));
    }
    case "get_virtual_trades": {
      const limit = readLimit(toolArgs);
      if (typeof limit === "string") {
        return errorResult(limit);
      }
      return jsonResult(await readVirtualTrades(repositories.tradeStore, limit));
    }
    case "get_virtual_performance":
      return jsonResult(
        await readVirtualPerformance(
          repositories.portfolioStore,
          repositories.tradeStore
        )
      );
    case "get_paper_report": {
      const date = readDateArg(toolArgs);
      if (typeof date !== "string") {
        return errorResult(date.error);
      }
      return jsonResult(
        await buildPaperDailyReport({
          storageBaseDir: context.storageBaseDir,
          date,
          generatedAt: new Date()
        })
      );
    }
    case "get_scheduler_status":
      return jsonResult(await readSchedulerStatus(context.storageBaseDir));
    case "get_source_health":
      return jsonResult(await readSourceHealth(repositories.sourceStore));
    case "get_market_packets": {
      const limit = readLimit(toolArgs);
      if (typeof limit === "string") {
        return errorResult(limit);
      }
      return jsonResult(await readMarketPackets(repositories.packetStore, limit));
    }
  }
}

function readOnlyTool(
  name: VirtualPortfolioToolName,
  description: string,
  inputSchema: Tool["inputSchema"]
): Tool {
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  };
}

function createReadOnlyRepositories(storageBaseDir: string) {
  const paths = createStoragePaths(storageBaseDir);
  return {
    portfolioStore: new FileVirtualPortfolioStore(paths.virtualPortfolioPath),
    decisionStore: new FileVirtualDecisionStore(paths.virtualDecisionsPath),
    tradeStore: new FileVirtualTradeStore(paths.virtualTradesPath),
    sourceStore: new FileTossInvestSourceStore(paths.tossInvestSourcesPath),
    packetStore: new FileMarketPacketStore(paths.marketPacketsPath)
  };
}

async function readVirtualPortfolio(
  portfolioStore: FileVirtualPortfolioStore
): Promise<Record<string, unknown>> {
  const portfolio = await portfolioStore.read();
  return {
    tool: "get_virtual_portfolio",
    mode: "paper_only",
    readOnly: true,
    portfolio,
    sourceStatus: portfolio ? "ok" : "missing",
    disclaimer: virtualDisclaimer()
  };
}

async function readVirtualPositions(
  portfolioStore: FileVirtualPortfolioStore,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const portfolio = await portfolioStore.read();
  const market = readMarketArg(args);
  const symbol = readSymbolArg(args);
  const positions = (portfolio?.positions ?? []).filter((position) => {
    if (market && position.market !== market) {
      return false;
    }
    if (symbol && position.symbol !== symbol) {
      return false;
    }
    return true;
  });

  return {
    tool: "get_virtual_positions",
    mode: "paper_only",
    readOnly: true,
    positions,
    count: positions.length,
    sourceStatus: portfolio ? "ok" : "missing",
    disclaimer: virtualDisclaimer()
  };
}

async function readVirtualDecisions(
  decisionStore: FileVirtualDecisionStore,
  limit: number
): Promise<Record<string, unknown>> {
  const result = await decisionStore.readAll();
  return {
    tool: "get_virtual_decisions",
    mode: "paper_only",
    readOnly: true,
    decisions: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount,
    disclaimer: virtualDisclaimer()
  };
}

async function readVirtualTrades(
  tradeStore: FileVirtualTradeStore,
  limit: number
): Promise<Record<string, unknown>> {
  const result = await tradeStore.readAll();
  return {
    tool: "get_virtual_trades",
    mode: "paper_only",
    readOnly: true,
    trades: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount,
    disclaimer: virtualDisclaimer()
  };
}

async function readVirtualPerformance(
  portfolioStore: FileVirtualPortfolioStore,
  tradeStore: FileVirtualTradeStore
): Promise<Record<string, unknown>> {
  const portfolio = await portfolioStore.read();
  const trades = await tradeStore.readAll();
  const positionMarketValueKrw =
    portfolio?.positions.reduce(
      (sum, position) =>
        sum +
        (position.marketValueKrw ??
          Math.round(position.quantity * position.averagePriceKrw)),
      0
    ) ?? 0;
  const virtualBuyAmountKrw = trades.records
    .filter((trade) => trade.action === "VIRTUAL_BUY")
    .reduce((sum, trade) => sum + trade.amountKrw, 0);
  const virtualSellAmountKrw = trades.records
    .filter((trade) => trade.action === "VIRTUAL_SELL")
    .reduce((sum, trade) => sum + trade.amountKrw, 0);

  return {
    tool: "get_virtual_performance",
    mode: "paper_only",
    readOnly: true,
    metrics: {
      portfolioPresent: portfolio !== null,
      virtualNetWorthKrw: portfolio
        ? portfolio.cashKrw + positionMarketValueKrw
        : null,
      cashKrw: portfolio?.cashKrw ?? null,
      positionMarketValueKrw,
      positionCount: portfolio?.positions.length ?? 0,
      filledTradeCount: trades.records.length,
      virtualBuyAmountKrw,
      virtualSellAmountKrw,
      corruptTradeLineCount: trades.corruptLineCount
    },
    disclaimer: virtualDisclaimer()
  };
}

async function readSchedulerStatus(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createPaperSchedulerPaths(storageBaseDir);
  const [state, lock] = await Promise.all([
    readJsonFile(paths.statePath),
    readJsonFile(paths.lockPath)
  ]);

  return {
    tool: "get_scheduler_status",
    mode: "paper_only",
    readOnly: true,
    statePath: paths.statePath,
    lockPath: paths.lockPath,
    stateStatus: state.status,
    lockStatus: lock.status,
    schedulerState: state.value,
    lock: lock.value,
    disclaimer: virtualDisclaimer()
  };
}

async function readSourceHealth(
  sourceStore: FileTossInvestSourceStore
): Promise<Record<string, unknown>> {
  const result = await sourceStore.readAll();
  const byStatus: Record<string, number> = { ok: 0, degraded: 0, blocked: 0 };
  const byCommandKey: Record<string, number> = {};
  let lastCollectedAt: string | null = null;

  for (const source of result.records) {
    byStatus[source.status] = (byStatus[source.status] ?? 0) + 1;
    byCommandKey[source.commandKey] = (byCommandKey[source.commandKey] ?? 0) + 1;
    const collectedAt = source.metadata.collectedAt;
    if (!lastCollectedAt || Date.parse(collectedAt) > Date.parse(lastCollectedAt)) {
      lastCollectedAt = collectedAt;
    }
  }

  return {
    tool: "get_source_health",
    mode: "paper_only",
    readOnly: true,
    status:
      result.corruptLineCount > 0 ||
      (byStatus.degraded ?? 0) > 0 ||
      (byStatus.blocked ?? 0) > 0
        ? "degraded"
        : result.records.length > 0
          ? "ok"
          : "unknown",
    totalCount: result.records.length,
    byStatus,
    byCommandKey,
    lastCollectedAt,
    corruptLineCount: result.corruptLineCount,
    disclaimer: virtualDisclaimer()
  };
}

async function readMarketPackets(
  packetStore: FileMarketPacketStore,
  limit: number
): Promise<Record<string, unknown>> {
  const result = await packetStore.readAll();
  return {
    tool: "get_market_packets",
    mode: "paper_only",
    readOnly: true,
    packets: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount,
    disclaimer: virtualDisclaimer()
  };
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(maskObject(value), null, 2)
      }
    ]
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: message,
            readOnly: true
          },
          null,
          2
        )
      }
    ]
  };
}

function isVirtualPortfolioToolName(
  name: string
): name is VirtualPortfolioToolName {
  return virtualPortfolioToolNames.includes(name as VirtualPortfolioToolName);
}

function readLimit(args: Record<string, unknown>): number | string {
  const raw = args["limit"];
  if (raw === undefined) {
    return 20;
  }

  if (!Number.isInteger(raw) || typeof raw !== "number") {
    return "`limit` must be an integer";
  }

  if (raw < 1 || raw > 100) {
    return "`limit` must be between 1 and 100";
  }

  return raw;
}

function readDateArg(args: Record<string, unknown>): string | { error: string } {
  const raw = args["date"];
  if (raw === undefined) {
    return new Date().toISOString().slice(0, 10);
  }

  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { error: "`date` must use YYYY-MM-DD format" };
  }

  return raw;
}

function readMarketArg(args: Record<string, unknown>): Market | null {
  const raw = args["market"];
  if (raw === "KR" || raw === "US") {
    return raw;
  }

  return null;
}

function readSymbolArg(args: Record<string, unknown>): string | null {
  const raw = args["symbol"];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  return raw.trim().toUpperCase();
}

function takeRecent<T>(records: T[], limit: number): T[] {
  return records.slice(-limit).reverse();
}

async function readJsonFile(
  filePath: string
): Promise<{ status: "missing" | "ok" | "corrupt"; value: unknown | null }> {
  try {
    return { status: "ok", value: JSON.parse(await readFile(filePath, "utf8")) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing", value: null };
    }
    if (error instanceof SyntaxError) {
      return { status: "corrupt", value: null };
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function virtualDisclaimer(): string {
  return "Paper-only virtual portfolio data. This is not financial advice and cannot place live orders.";
}
