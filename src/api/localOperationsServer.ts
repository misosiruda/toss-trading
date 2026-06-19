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
import {
  isPaperSimulationMutationApiRoutePath,
  isPaperSimulationMutationMethod,
  isReadOnlyHttpMethod
} from "./localOperationsSurface.js";
import {
  createPaperSimulationRun,
  PAPER_SIMULATION_CREATE_OPERATION,
  PAPER_SIMULATION_MUTATION_HEADER_NAME,
  PaperSimulationRequestError
} from "./paperSimulationRuns.js";
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
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      isPaperSimulationMutationApiRoutePath(url.pathname) &&
      isPaperSimulationMutationMethod(request.method)
    ) {
      await handlePaperSimulationCreate(request, response, options);
      return;
    }

    if (!isReadOnlyHttpMethod(request.method)) {
      writeJson(response, 405, {
        error: "method_not_allowed",
        readOnly: true
      });
      return;
    }

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

async function handlePaperSimulationCreate(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalOperationsServerOptions
): Promise<void> {
  const guard = validatePaperSimulationMutationGuard(request);
  if (guard !== null) {
    writeJson(response, guard.statusCode, {
      error: guard.code,
      message: guard.message,
      readOnly: false,
      liveTradingEnabled: false
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const payload = createPaperSimulationRun(body, options);
    writeJson(response, 202, payload);
  } catch (error) {
    if (error instanceof PaperSimulationRequestError) {
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
        readOnly: false,
        liveTradingEnabled: false
      });
      return;
    }

    throw error;
  }
}

function validatePaperSimulationMutationGuard(
  request: IncomingMessage
): { statusCode: number; code: string; message: string } | null {
  if (
    request.headers[PAPER_SIMULATION_MUTATION_HEADER_NAME] !==
    PAPER_SIMULATION_CREATE_OPERATION
  ) {
    return {
      statusCode: 403,
      code: "mutation_guard_required",
      message: "paper simulation create requires an explicit operation header"
    };
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().includes("application/json")) {
    return {
      statusCode: 415,
      code: "unsupported_media_type",
      message: "paper simulation create accepts application/json only"
    };
  }

  if (!isSameOriginRequest(request)) {
    return {
      statusCode: 403,
      code: "origin_not_allowed",
      message: "paper simulation create is limited to same-origin dashboard requests"
    };
  }

  return null;
}

function isSameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host && isLocalHostname(originUrl.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.byteLength;
    if (totalSize > 32_768) {
      throw new PaperSimulationRequestError(
        "paper simulation create body is too large",
        413,
        "request_body_too_large"
      );
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PaperSimulationRequestError(
      "paper simulation create body must be valid JSON",
      400,
      "invalid_json"
    );
  }
}
