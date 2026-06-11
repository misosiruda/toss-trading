import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import {
  callVirtualPortfolioTool,
  listVirtualPortfolioTools,
  type VirtualPortfolioToolContext
} from "./virtualPortfolioTools.js";

export function createVirtualPortfolioMcpServer(
  context: VirtualPortfolioToolContext
): Server {
  const server = new Server(
    {
      name: "toss-trading",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      },
      instructions:
        "Read-only paper trading operations server. It exposes virtual portfolio state only and cannot place live orders."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listVirtualPortfolioTools()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callVirtualPortfolioTool(
      request.params.name,
      request.params.arguments,
      context
    )
  );

  return server;
}

export async function startVirtualPortfolioMcpServer(
  context: VirtualPortfolioToolContext
): Promise<void> {
  const server = createVirtualPortfolioMcpServer(context);
  await server.connect(new StdioServerTransport());
}
