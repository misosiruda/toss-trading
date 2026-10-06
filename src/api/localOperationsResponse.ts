import type { ServerResponse } from "node:http";

import { maskObject } from "../security/masking.js";
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
    masked.requestedRunId=value.requestedRunId;
  }
  writeMaskedJson(response,statusCode,masked);
}

function writeMaskedJson(response:ServerResponse,statusCode:number,value:unknown,headOnly=false):void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(headOnly ? undefined : `${body}\n`);
}
