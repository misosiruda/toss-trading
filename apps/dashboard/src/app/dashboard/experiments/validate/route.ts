import { NextResponse, type NextRequest } from "next/server";
import { readOperationsApiConfig } from "@/lib/dashboardViewModels";

export const runtime = "nodejs";
const LIMIT = 32_768;
function failure(error: string, status: number) {
  return NextResponse.json({ error, readOnly: true, storageMutationEnabled: false, replayRunnerStarted: false }, { status });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("x-toss-trading-dashboard-intent") !== "paper-simulation-validate") return failure("dashboard_intent_required", 403);
  // Validation has no mutation token. An explicit matching browser Origin is required.
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto");
  const origin = host ? `${proto === "https" || proto === "http" ? proto : request.nextUrl.protocol.slice(0, -1)}://${host}` : request.nextUrl.origin;
  if (request.headers.get("origin") !== origin || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return failure("same_origin_required", 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return failure("unsupported_media_type", 415);
  const reader = request.body?.getReader();
  if (!reader) return failure("invalid_json", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) { await reader.cancel(); return failure("body_too_large", 413); }
      chunks.push(value);
    }
  } catch { return failure("invalid_body", 400); }
  const bytes = Buffer.concat(chunks);
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return failure("invalid_json_object", 400);
  } catch { return failure("invalid_json", 400); }
  const api = readOperationsApiConfig();
  try {
    const response = await fetch(`${api.baseUrl}/paper/simulations/validate`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json", "content-type": "application/json", origin: api.baseUrl, "x-toss-trading-operation": "paper-simulation-validate" }, body
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return failure("paper_simulation_validation_unavailable", 502); }
}
