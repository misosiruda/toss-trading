import { NextResponse, type NextRequest } from "next/server";

import { readOperationsApiConfig } from "@/lib/dashboardViewModels";

const STRATEGY_BUCKET_TEST_CREATE_ENDPOINT =
  "/paper/simulations/strategy-bucket-tests";
const OPERATION_HEADER_NAME = "x-toss-trading-operation";
const STRATEGY_BUCKET_TEST_CREATE_OPERATION =
  "paper-strategy-bucket-test-create";

export async function POST(request: NextRequest) {
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
