import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { readOperationsApiConfig } from "@/lib/dashboardViewModels";
import { cloneCanonicalText, exactSimulationId, faithfulCloneDraft, readCloneSource } from "@/lib/simulationClone";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const LIMIT = 32768;
function unavailable(status = 200) {
  return NextResponse.json({ mode: "paper_only", readOnly: true, status: "unavailable", reasonCode: "canonical_request_unavailable" }, { status, headers: { "cache-control": "no-store" } });
}
export async function HEAD() { return unavailable(405); }
export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.getAll("simulationRunId");
  if (ids.length !== 1 || !exactSimulationId(ids[0]) || [...request.nextUrl.searchParams.keys()].some(key => key !== "simulationRunId")) return unavailable(400);
  const id = ids[0]; const api = readOperationsApiConfig();
  try {
    const response = await fetch(api.baseUrl + "/paper/simulations/request?simulationRunId=" + encodeURIComponent(id), { method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body) { await response.body?.cancel(); return unavailable(); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > LIMIT) { await reader.cancel(); return unavailable(); } chunks.push(next.value); }
    } finally { reader.releaseLock(); }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    const source = readCloneSource(value, id);
    if (!source || !faithfulCloneDraft(source) || "sha256:" + createHash("sha256").update(cloneCanonicalText(source)).digest("hex") !== source.canonicalRequestHash) return unavailable();
    return NextResponse.json(source, { headers: { "cache-control": "no-store" } });
  } catch { return unavailable(); }
}
