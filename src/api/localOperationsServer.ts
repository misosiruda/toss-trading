import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import { buildPaperDailyReport } from "../reports/paperDailyReport.js";
import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import { maskObject } from "../security/masking.js";
import {
  createStoragePaths,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";

export interface LocalOperationsServerOptions {
  storageBaseDir: string;
  now?: () => Date;
}

export interface StartLocalOperationsServerOptions
  extends LocalOperationsServerOptions {
  host: string;
  port: number;
}

export function createLocalOperationsServer(
  options: LocalOperationsServerOptions
): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, options);
  });
}

export async function startLocalOperationsServer(
  options: StartLocalOperationsServerOptions
): Promise<Server> {
  const server = createLocalOperationsServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalOperationsServerOptions
): Promise<void> {
  try {
    if (!isReadOnlyMethod(request.method)) {
      writeJson(response, 405, {
        error: "method_not_allowed",
        readOnly: true
      });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const payload = await routeRequest(url, options);
    if (!payload) {
      writeJson(response, 404, {
        error: "not_found",
        readOnly: true
      });
      return;
    }

    writeJson(response, 200, payload, request.method === "HEAD");
  } catch (error) {
    writeJson(response, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
      readOnly: true
    });
  }
}

async function routeRequest(
  url: URL,
  options: LocalOperationsServerOptions
): Promise<unknown | null> {
  switch (url.pathname) {
    case "/health":
      return healthResponse();
    case "/virtual/portfolio":
      return readVirtualPortfolio(options.storageBaseDir);
    case "/virtual/decisions":
      return readVirtualDecisions(options.storageBaseDir, readLimit(url));
    case "/virtual/trades":
      return readVirtualTrades(options.storageBaseDir, readLimit(url));
    case "/paper/report":
      return buildPaperDailyReport({
        storageBaseDir: options.storageBaseDir,
        date: readDate(url, options),
        generatedAt: readNow(options)
      });
    case "/scheduler/status":
      return readSchedulerStatus(options.storageBaseDir);
    default:
      return null;
  }
}

function healthResponse(): Record<string, unknown> {
  return {
    status: "ok",
    service: "toss-trading-local-operations-api",
    mode: "paper_only",
    readOnly: true,
    tradingEnabled: false
  };
}

async function readVirtualPortfolio(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const portfolio = await new FileVirtualPortfolioStore(
    paths.virtualPortfolioPath
  ).read();

  return {
    mode: "paper_only",
    readOnly: true,
    portfolio,
    sourceStatus: portfolio ? "ok" : "missing"
  };
}

async function readVirtualDecisions(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();

  return {
    mode: "paper_only",
    readOnly: true,
    decisions: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount
  };
}

async function readVirtualTrades(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  return {
    mode: "paper_only",
    readOnly: true,
    trades: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount
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
    mode: "paper_only",
    readOnly: true,
    stateStatus: state.status,
    lockStatus: lock.status,
    schedulerState: state.value,
    lock: lock.value
  };
}

function isReadOnlyMethod(method: string | undefined): boolean {
  return method === "GET" || method === "HEAD";
}

function readLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return 20;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return 20;
  }
  return parsed;
}

function readDate(url: URL, options: LocalOperationsServerOptions): string {
  const raw = url.searchParams.get("date");
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return readNow(options).toISOString().slice(0, 10);
}

function readNow(options: LocalOperationsServerOptions): Date {
  return options.now?.() ?? new Date();
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

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headOnly = false
): void {
  const body = JSON.stringify(maskObject(value), null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(headOnly ? undefined : `${body}\n`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
