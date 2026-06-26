import { NextResponse, type NextRequest } from "next/server";

import { readOperationsApiConfig } from "@/lib/dashboardViewModels";

const STRATEGY_BUCKET_TEST_CREATE_ENDPOINT =
  "/paper/simulations/strategy-bucket-tests";
const OPERATION_HEADER_NAME = "x-toss-trading-operation";
const STRATEGY_BUCKET_TEST_CREATE_OPERATION =
  "paper-strategy-bucket-test-create";
const DASHBOARD_INTENT_HEADER_NAME = "x-toss-trading-dashboard-intent";
const STRATEGY_BUCKET_TEST_CREATE_INTENT = "strategy-bucket-test-create";

export async function POST(request: NextRequest) {
  const guardResponse = validateCreateProxyRequest(request);
  if (guardResponse !== null) {
    return guardResponse;
  }

  const apiConfig = readOperationsApiConfig();
  const body = await request.text();

  try {
    const response = await fetch(
      `${apiConfig.baseUrl}${STRATEGY_BUCKET_TEST_CREATE_ENDPOINT}`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          [OPERATION_HEADER_NAME]: STRATEGY_BUCKET_TEST_CREATE_OPERATION,
          origin: apiConfig.baseUrl
        },
        body
      }
    );
    const payload: unknown = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: "strategy_bucket_test_create_unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Local Operations API strategy bucket test create request failed",
        readOnly: false,
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false,
        replayRunnerStarted: false
      },
      { status: 502 }
    );
  }
}

function validateCreateProxyRequest(request: NextRequest) {
  if (
    request.headers.get(DASHBOARD_INTENT_HEADER_NAME) !==
    STRATEGY_BUCKET_TEST_CREATE_INTENT
  ) {
    return createGuardFailure(
      "dashboard_intent_required",
      "strategy bucket test create requires a dashboard create intent header"
    );
  }

  if (!isSameOriginDashboardRequest(request)) {
    return createGuardFailure(
      "same_origin_required",
      "strategy bucket test create proxy only accepts same-origin dashboard requests"
    );
  }

  return null;
}

function isSameOriginDashboardRequest(request: NextRequest): boolean {
  const expectedOrigin = readIncomingRequestOrigin(request);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== "null") {
    return readSameOriginMatch(origin, expectedOrigin) === true;
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    const refererMatch = readSameOriginMatch(referer, expectedOrigin);
    if (refererMatch !== null) {
      return refererMatch;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    return fetchSite === "same-origin" || fetchSite === "same-site";
  }

  return true;
}

function readIncomingRequestOrigin(request: NextRequest): string {
  const host = request.headers.get("host");
  if (host === null || host.trim() === "") {
    return request.nextUrl.origin;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : request.nextUrl.protocol.replace(/:$/, "");
  return `${protocol}://${host}`;
}

function readSameOriginMatch(
  value: string,
  expectedOrigin: string
): boolean | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin === expectedOrigin;
  } catch {
    return null;
  }
}

function createGuardFailure(error: string, message: string) {
  return NextResponse.json(
    {
      error,
      message,
      readOnly: false,
      storageMutationEnabled: false,
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      replayRunnerStarted: false
    },
    { status: 403 }
  );
}
