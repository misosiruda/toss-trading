import { NextResponse, type NextRequest } from "next/server";

import { readOperationsApiConfig } from "@/lib/dashboardViewModels";

const POLICY_VALIDATION_ENDPOINT = "/paper/policies/validate";
const OPERATION_HEADER_NAME = "x-toss-trading-operation";
const POLICY_VALIDATION_OPERATION = "paper-policy-validate";

export async function POST(request: NextRequest) {
  const apiConfig = readOperationsApiConfig();
  const body = await request.text();

  try {
    const response = await fetch(
      `${apiConfig.baseUrl}${POLICY_VALIDATION_ENDPOINT}`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          [OPERATION_HEADER_NAME]: POLICY_VALIDATION_OPERATION,
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
        error: "policy_validation_unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Local Operations API policy validation request failed",
        readOnly: true,
        storageMutationEnabled: false,
        liveTradingEnabled: false,
        orderPlacementEnabled: false
      },
      { status: 502 }
    );
  }
}
