import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import {
  readDashboardAsset,
  writeDashboardAsset
} from "./localOperationsDashboardAssets.js";
import { writeJson } from "./localOperationsResponse.js";
import { routeRequest } from "./localOperationsRouting.js";
import { isReadOnlyHttpMethod } from "./localOperationsSurface.js";
import type {
  LocalOperationsServerOptions,
  StartLocalOperationsServerOptions
} from "./localOperationsTypes.js";

export type {
  LocalOperationsServerOptions,
  StartLocalOperationsServerOptions
} from "./localOperationsTypes.js";

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
    if (!isReadOnlyHttpMethod(request.method)) {
      writeJson(response, 405, {
        error: "method_not_allowed",
        readOnly: true
      });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const dashboardAsset = readDashboardAsset(url.pathname);
    if (dashboardAsset) {
      await writeDashboardAsset(
        response,
        dashboardAsset,
        request.method === "HEAD"
      );
      return;
    }

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
