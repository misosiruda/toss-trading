import { join } from "node:path";
import { pathToFileURL } from "node:url";

import "./config/loadEnv.js";
import { startVirtualPortfolioMcpServer } from "./mcp/server.js";

export const runtimeInfo = {
  name: "toss-trading",
  tradingEnabledDefault: false,
  aiDecisionModeDefault: "paper_only",
  brokerProviderDefault: "mock"
} as const;

export function getRuntimeInfo(): typeof runtimeInfo {
  return runtimeInfo;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  const storageBaseDir =
    process.env["TOSS_TRADING_DATA_DIR"] ?? join(process.cwd(), "data");

  startVirtualPortfolioMcpServer({ storageBaseDir }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start toss-trading MCP server: ${message}`);
    process.exitCode = 1;
  });
}
