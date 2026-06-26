import { NextResponse, type NextRequest } from "next/server";

import { readOperationsApiConfig } from "@/lib/dashboardViewModels";

const STRATEGY_BUCKET_TEST_PROGRESS_PREFIX =
  "/dashboard/view-model/strategy-test-lab/tests";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ testId: string }> }
) {
  const { testId } = await context.params;
  const apiConfig = readOperationsApiConfig();
  const endpoint = `${STRATEGY_BUCKET_TEST_PROGRESS_PREFIX}/${encodeURIComponent(
    testId
  )}/progress`;

  try {
    const response = await fetch(`${apiConfig.baseUrl}${endpoint}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json"
      }
    });
    const payload: unknown = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        mode: "paper_only",
        readOnly: true,
        viewModel: "strategy-test-progress",
        testId,
        test: null,
        sourceStatus: {
          strategyBucketTestRecords: "missing"
        },
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false,
        replayRunnerStarted: false,
        status: "missing",
        error: "strategy_bucket_test_progress_unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Local Operations API strategy bucket test progress request failed"
      },
      { status: 502 }
    );
  }
}
