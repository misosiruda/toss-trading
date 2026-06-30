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
  isPaperPolicyValidationApiRoutePath,
  isPaperPolicyValidationMethod,
  isPaperPolicyMutationApiRoutePath,
  isPaperPolicyMutationMethod,
  isPaperSimulationMutationApiRoutePath,
  isPaperSimulationMutationMethod,
  isReadOnlyHttpMethod,
  isStrategyBucketTestValidationApiRoutePath,
  isStrategyBucketTestValidationMethod,
  isStrategyBucketTestMutationApiRoutePath,
  isStrategyBucketTestMutationMethod
} from "./localOperationsSurface.js";
import {
  PAPER_POLICY_VALIDATION_HEADER_NAME,
  PAPER_POLICY_VALIDATION_OPERATION,
  PaperPolicyValidationRequestError,
  validatePaperPolicyCandidate
} from "./paperPolicyValidation.js";
import {
  PAPER_POLICY_CREATE_HEADER_NAME,
  PAPER_POLICY_CREATE_OPERATION,
  PaperPolicyCreateRequestError,
  createPaperPolicyRecord
} from "./paperPolicyRecords.js";
import {
  createPaperSimulationRun,
  PAPER_SIMULATION_CREATE_OPERATION,
  PAPER_SIMULATION_MUTATION_HEADER_NAME,
  PaperSimulationRequestError
} from "./paperSimulationRuns.js";
import {
  STRATEGY_BUCKET_TEST_VALIDATION_HEADER_NAME,
  STRATEGY_BUCKET_TEST_VALIDATION_OPERATION,
  StrategyBucketTestValidationRequestError,
  validateStrategyBucketTestCandidate
} from "./strategyBucketTestValidation.js";
import {
  STRATEGY_BUCKET_TEST_CREATE_HEADER_NAME,
  STRATEGY_BUCKET_TEST_CREATE_OPERATION,
  STRATEGY_BUCKET_TEST_MATRIX_CREATE_OPERATION,
  STRATEGY_BUCKET_TEST_MATRIX_CREATE_ROUTE,
  StrategyBucketTestCreateRequestError,
  createStrategyBucketTestMatrixRun,
  createStrategyBucketTestRun
} from "./strategyBucketTestRuns.js";
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
    if (
      isPaperPolicyValidationApiRoutePath(url.pathname) &&
      isPaperPolicyValidationMethod(request.method)
    ) {
      await handlePaperPolicyValidation(request, response, options);
      return;
    }
    if (
      isPaperPolicyMutationApiRoutePath(url.pathname) &&
      isPaperPolicyMutationMethod(request.method)
    ) {
      await handlePaperPolicyCreate(request, response, options);
      return;
    }
    if (
      isStrategyBucketTestValidationApiRoutePath(url.pathname) &&
      isStrategyBucketTestValidationMethod(request.method)
    ) {
      await handleStrategyBucketTestValidation(request, response, options);
      return;
    }
    if (
      isStrategyBucketTestMutationApiRoutePath(url.pathname) &&
      isStrategyBucketTestMutationMethod(request.method)
    ) {
      await handleStrategyBucketTestCreate(request, response, options);
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

async function handlePaperPolicyCreate(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalOperationsServerOptions
): Promise<void> {
  const guard = validatePaperPolicyCreateGuard(request);
  if (guard !== null) {
    writeJson(response, guard.statusCode, {
      error: guard.code,
      message: guard.message,
      readOnly: false,
      storageMutationEnabled: false,
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      replayRunnerStarted: false
    });
    return;
  }

  try {
    const body = await readJsonBody(request, {
      operationName: "paper policy create",
      maxBytes: 32_768,
      createError: (message, statusCode, code) =>
        new PaperPolicyCreateRequestError(message, statusCode, code)
    });
    const payload = await createPaperPolicyRecord(body, options);
    writeJson(response, 202, payload);
  } catch (error) {
    if (error instanceof PaperPolicyCreateRequestError) {
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
        ...(error.issues === undefined ? {} : { issues: error.issues }),
        readOnly: false,
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false,
        replayRunnerStarted: false
      });
      return;
    }

    throw error;
  }
}

function validatePaperPolicyCreateGuard(
  request: IncomingMessage
): { statusCode: number; code: string; message: string } | null {
  if (
    request.headers[PAPER_POLICY_CREATE_HEADER_NAME] !==
    PAPER_POLICY_CREATE_OPERATION
  ) {
    return {
      statusCode: 403,
      code: "mutation_guard_required",
      message: "paper policy create requires an explicit operation header"
    };
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().includes("application/json")) {
    return {
      statusCode: 415,
      code: "unsupported_media_type",
      message: "paper policy create accepts application/json only"
    };
  }

  if (!isSameOriginRequest(request)) {
    return {
      statusCode: 403,
      code: "origin_not_allowed",
      message: "paper policy create is limited to same-origin dashboard requests"
    };
  }

  return null;
}

async function handleStrategyBucketTestCreate(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalOperationsServerOptions
): Promise<void> {
  const guard = validateStrategyBucketTestCreateGuard(request);
  if (guard !== null) {
    writeJson(response, guard.statusCode, {
      error: guard.code,
      message: guard.message,
      readOnly: false,
      storageMutationEnabled: false,
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      replayRunnerStarted: false
    });
    return;
  }

  try {
    const body = await readJsonBody(request, {
      operationName: "strategy bucket test create",
      maxBytes: 65_536,
      createError: (message, statusCode, code) =>
        new StrategyBucketTestCreateRequestError(message, statusCode, code)
    });
    const payload =
      readRequestPathname(request) === STRATEGY_BUCKET_TEST_MATRIX_CREATE_ROUTE
        ? await createStrategyBucketTestMatrixRun(body, options)
        : await createStrategyBucketTestRun(body, options);
    writeJson(response, 202, payload);
  } catch (error) {
    if (error instanceof StrategyBucketTestCreateRequestError) {
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
        ...(error.issues === undefined ? {} : { issues: error.issues }),
        readOnly: false,
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false,
        replayRunnerStarted: false
      });
      return;
    }

    throw error;
  }
}

function validateStrategyBucketTestCreateGuard(
  request: IncomingMessage
): { statusCode: number; code: string; message: string } | null {
  if (
    request.headers[STRATEGY_BUCKET_TEST_CREATE_HEADER_NAME] !==
    expectedStrategyBucketTestCreateOperation(request)
  ) {
    return {
      statusCode: 403,
      code: "mutation_guard_required",
      message: "strategy bucket test create requires an explicit operation header"
    };
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().includes("application/json")) {
    return {
      statusCode: 415,
      code: "unsupported_media_type",
      message: "strategy bucket test create accepts application/json only"
    };
  }

  if (!isSameOriginRequest(request)) {
    return {
      statusCode: 403,
      code: "origin_not_allowed",
      message:
        "strategy bucket test create is limited to same-origin dashboard requests"
    };
  }

  return null;
}

function expectedStrategyBucketTestCreateOperation(
  request: IncomingMessage
): string {
  return readRequestPathname(request) === STRATEGY_BUCKET_TEST_MATRIX_CREATE_ROUTE
    ? STRATEGY_BUCKET_TEST_MATRIX_CREATE_OPERATION
    : STRATEGY_BUCKET_TEST_CREATE_OPERATION;
}

function readRequestPathname(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

async function handleStrategyBucketTestValidation(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalOperationsServerOptions
): Promise<void> {
  const guard = validateStrategyBucketTestValidationGuard(request);
  if (guard !== null) {
    writeJson(response, guard.statusCode, {
      error: guard.code,
      message: guard.message,
      readOnly: true,
      storageMutationEnabled: false,
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      replayRunnerStarted: false
    });
    return;
  }

  try {
    const body = await readJsonBody(request, {
      operationName: "strategy bucket test validation",
      maxBytes: 65_536,
      createError: (message, statusCode, code) =>
        new StrategyBucketTestValidationRequestError(
          message,
          statusCode,
          code
        )
    });
    const payload = validateStrategyBucketTestCandidate(
      body,
      options.now?.() ?? new Date(),
      options.env ?? process.env
    );
    writeJson(response, 200, payload);
  } catch (error) {
    if (error instanceof StrategyBucketTestValidationRequestError) {
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
        readOnly: true,
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false,
        replayRunnerStarted: false
      });
      return;
    }

    throw error;
  }
}

function validateStrategyBucketTestValidationGuard(
  request: IncomingMessage
): { statusCode: number; code: string; message: string } | null {
  if (
    request.headers[STRATEGY_BUCKET_TEST_VALIDATION_HEADER_NAME] !==
    STRATEGY_BUCKET_TEST_VALIDATION_OPERATION
  ) {
    return {
      statusCode: 403,
      code: "validation_guard_required",
      message:
        "strategy bucket test validation requires an explicit operation header"
    };
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().includes("application/json")) {
    return {
      statusCode: 415,
      code: "unsupported_media_type",
      message: "strategy bucket test validation accepts application/json only"
    };
  }

  if (!isSameOriginRequest(request)) {
    return {
      statusCode: 403,
      code: "origin_not_allowed",
      message:
        "strategy bucket test validation is limited to same-origin dashboard requests"
    };
  }

  return null;
}

async function handlePaperPolicyValidation(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalOperationsServerOptions
): Promise<void> {
  const guard = validatePaperPolicyValidationGuard(request);
  if (guard !== null) {
    writeJson(response, guard.statusCode, {
      error: guard.code,
      message: guard.message,
      readOnly: true,
      storageMutationEnabled: false,
      liveTradingEnabled: false,
      orderPlacementEnabled: false
    });
    return;
  }

  try {
    const body = await readJsonBody(request, {
      operationName: "paper policy validation",
      maxBytes: 32_768,
      createError: (message, statusCode, code) =>
        new PaperPolicyValidationRequestError(message, statusCode, code)
    });
    const payload = validatePaperPolicyCandidate(
      body,
      options.now?.() ?? new Date()
    );
    writeJson(response, 200, payload);
  } catch (error) {
    if (error instanceof PaperPolicyValidationRequestError) {
      writeJson(response, error.statusCode, {
        error: error.code,
        message: error.message,
        readOnly: true,
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false
      });
      return;
    }

    throw error;
  }
}

function validatePaperPolicyValidationGuard(
  request: IncomingMessage
): { statusCode: number; code: string; message: string } | null {
  if (
    request.headers[PAPER_POLICY_VALIDATION_HEADER_NAME] !==
    PAPER_POLICY_VALIDATION_OPERATION
  ) {
    return {
      statusCode: 403,
      code: "validation_guard_required",
      message: "paper policy validation requires an explicit operation header"
    };
  }

  const contentType = request.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().includes("application/json")) {
    return {
      statusCode: 415,
      code: "unsupported_media_type",
      message: "paper policy validation accepts application/json only"
    };
  }

  if (!isSameOriginRequest(request)) {
    return {
      statusCode: 403,
      code: "origin_not_allowed",
      message: "paper policy validation is limited to same-origin dashboard requests"
    };
  }

  return null;
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
    const body = await readJsonBody(request, {
      operationName: "paper simulation create",
      maxBytes: 32_768,
      createError: (message, statusCode, code) =>
        new PaperSimulationRequestError(message, statusCode, code)
    });
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

async function readJsonBody(
  request: IncomingMessage,
  options: {
    operationName: string;
    maxBytes: number;
    createError: (
      message: string,
      statusCode: number,
      code: string
    ) => Error;
  }
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.byteLength;
    if (totalSize > options.maxBytes) {
      throw options.createError(
        `${options.operationName} body is too large`,
        413,
        "request_body_too_large"
      );
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw options.createError(
      `${options.operationName} body must be valid JSON`,
      400,
      "invalid_json"
    );
  }
}
