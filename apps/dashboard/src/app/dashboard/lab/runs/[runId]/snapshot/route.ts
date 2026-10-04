import { NextResponse } from "next/server";
import { readRunWorkspacePageData } from "@/lib/runEvidenceReader";
import { validRunLookupId } from "@/lib/runWorkspace";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!validRunLookupId(runId)) return NextResponse.json({ error: "invalid_run_id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(await readRunWorkspacePageData(runId), { headers: { "Cache-Control": "no-store" } });
}
