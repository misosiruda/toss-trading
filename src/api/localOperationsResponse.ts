import type { ServerResponse } from "node:http";
import { z } from "zod";
import type { PaperSimulationRequestRead } from "./paperSimulationRequest.js";

import { maskObject, maskReplayRunIdentity } from "../security/masking.js";
import { validProvenanceId, type ReplayProvenance } from "./replayProvenanceProjection.js";

export function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headOnly = false
): void {
  writeMaskedJson(response,statusCode,maskObject(value),headOnly);
}

// 검증된 GET provenance DTO의 최상위 요청 identity만 보존한다.
// 다른 필드와 다른 endpoint에는 기존 order/execution 마스킹을 유지한다.
export function writeReplayProvenanceJson(response:ServerResponse,statusCode:number,value:ReplayProvenance):void {
  const masked=maskObject(value);
  if(value.mode==="paper_only"&&value.readOnly===true&&value.contractVersion==="replay_provenance_read.v1"&&
      value.comparability==="unavailable"&&value.clone==="unavailable"&&validProvenanceId(value.requestedRunId)){
    masked.requestedRunId=maskReplayRunIdentity(value.requestedRunId);
  }
  writeMaskedJson(response,statusCode,masked);
}

const canonicalRuntimeIdentitySchema = z.object({
  mode: z.literal("paper_only"), readOnly: z.literal(true), status: z.literal("available"),
  schemaVersion: z.literal("paper_simulation_canonical_request.v1"),
  sourceRuntime: z.object({ schemaVersion: z.literal("paper_simulation_source_runtime.v1"), sourceRuntimeId: z.uuid() })
});
// Preserve only the validated non-secret namespace UUID of the canonical read DTO.
// All other fields and generic endpoints keep account/token masking unchanged.
export function writePaperSimulationRequestJson(response: ServerResponse, statusCode: number, value: PaperSimulationRequestRead): void {
  const masked = maskObject(value);
  const identity = canonicalRuntimeIdentitySchema.safeParse(value);
  if (statusCode === 200 && identity.success && masked.status === "available") {
    masked.sourceRuntime.sourceRuntimeId = identity.data.sourceRuntime.sourceRuntimeId;
  }
  writeMaskedJson(response, statusCode, masked);
}

function writeMaskedJson(response:ServerResponse,statusCode:number,value:unknown,headOnly=false):void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(headOnly ? undefined : `${body}\n`);
}
