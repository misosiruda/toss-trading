import assert from "node:assert/strict";
import test from "node:test";
import type {ServerResponse} from "node:http";
import type { PaperSimulationRequestRead } from "./paperSimulationRequest.js";
import {writeJson,writeReplayProvenanceJson,writePaperSimulationRequestJson} from "./localOperationsResponse.js";
import {emptyReplayProvenance,type ReplayProvenance} from "./replayProvenanceProjection.js";
function responseCapture(){
  let body="",status=0,headers:unknown;
  const response={writeHead(code:number,value:unknown){status=code;headers=value;},end(value:string){body=value;}} as unknown as ServerResponse;
  return {response,read:()=>({body:JSON.parse(body),status,headers})};
}
test("structured requested replay identity alone survives masking; order and execution remain hidden",()=>{
  for(const id of ["ord_abcdef_run_000000_2026-01","exec_abcdef_run_000000_202601","ord_abcdef","exec_abcdef"]){
    const payload={...emptyReplayProvenance(id,"missing","missing"),orderId:"ord_actual123456",executionId:"exec_actual123456",accountNumber:"123-456-789",token:"fixture_secret",nested:{requestedRunId:"ord_actual123456",text:"ord_actual123456 exec_actual123456",authorization:"fixture_secret"}} as ReplayProvenance;
    const c=responseCapture();writeReplayProvenanceJson(c.response,200,payload);const r=c.read();
    assert.equal(r.body.requestedRunId,id);assert.equal(r.status,200);
    assert.equal(r.body.orderId,"****");assert.equal(r.body.executionId,"****");assert.equal(r.body.accountNumber,"****");assert.equal(r.body.token,"****");
    assert.equal(r.body.nested.requestedRunId,"ord_****");assert.equal(r.body.nested.text,"ord_**** exec_****");assert.equal(r.body.nested.authorization,"****");
    const generic=responseCapture();writeJson(generic.response,200,payload);assert.notEqual(generic.read().body.requestedRunId,id);
  }
});
test("malformed provenance contracts and unsafe requested IDs never receive identity preservation",()=>{
  for(const change of [{mode:"live"},{readOnly:false},{contractVersion:"invented"},{comparability:"available"},{clone:"available"},{requestedRunId:"ord_actual123456/../outside"},{requestedRunId:"exec_actual123456\n"},{requestedRunId:"ord_"+"a".repeat(253)}]){
    const c=responseCapture(),payload={...emptyReplayProvenance("ord_actual123456","missing","missing"),...change} as ReplayProvenance;
    writeReplayProvenanceJson(c.response,200,payload);assert.notEqual(c.read().body.requestedRunId,payload.requestedRunId);
  }
});

test("provenance identity exception retains account and token masking in every DTO status",()=>{
  for(const status of ["partial","missing","invalid","blocked","limit","ambiguous"] as const) {
    for(const [id,masked] of [["123-456-789","****-****-****"],["aaaaaaaaaaaaaaaa.bbbbbbbb.cccccccc","***.***.***"],["ord_abcdef.123-456-789","ord_abcdef.****-****-****"],["exec_aaaaaaaaaaaaaaaa.bbbbbbbb.cccccccc","***.***.***"]]) {
      for(const code of [200,400,500]) {
        const c=responseCapture();writeReplayProvenanceJson(c.response,code,emptyReplayProvenance(id!,status,"missing"));
        assert.equal(c.read().body.requestedRunId,masked);assert.equal(c.read().status,code);
      }
    }
  }
});

function canonicalResponseFixture(): PaperSimulationRequestRead {
  return {
    mode: "paper_only", readOnly: true, status: "available", schemaVersion: "paper_simulation_canonical_request.v1",
    simulationRunId: "paper_sim_20261006120000000_fixture", batchId: "paper_sim_20261006120000000_fixture", acceptedAt: "2026-10-06T12:00:00.000Z",
    sourceRuntime: { schemaVersion: "paper_simulation_source_runtime.v1", sourceRuntimeId: "aaaaaaaa-1234-4567-8123-abcdefabcdef", nodeVersion: "v24.19.0", executionModelVersion: "execution_simulator.v4" },
    canonicalRequestHash: "sha256:" + "a".repeat(64), requestedConfig: { modelId: "abcdefghijklmnop.abcdefgh.ijklmnop", accountNumber: "123-456-789" },
    accountNumber: "123-456-789", token: "private", nested: { sourceRuntimeId: "aaaaaaaa-1234-4567-8123-abcdefabcdef", accountText: "123-456-789", jwtText: "abcdefghijklmnop.abcdefgh.ijklmnop" }
  } as unknown as PaperSimulationRequestRead;
}
test("canonical response preserves only its exact valid runtime UUID while generic, account and JWT masking remain", () => {
  const payload = canonicalResponseFixture(); const c = responseCapture();
  writePaperSimulationRequestJson(c.response, 200, payload); const read = c.read();
  assert.equal(read.body.sourceRuntime.sourceRuntimeId, "aaaaaaaa-1234-4567-8123-abcdefabcdef");
  assert.equal(read.body.canonicalRequestHash, "sha256:" + "a".repeat(64));
  assert.equal(read.body.nested.sourceRuntimeId, "aaaaaaaa-****-****-****-abcdefabcdef");
  assert.equal(read.body.accountNumber, "****"); assert.equal(read.body.token, "****");
  assert.equal(read.body.nested.accountText, "****"); assert.equal(read.body.nested.jwtText, "***.***.***");
  assert.equal(read.body.requestedConfig.modelId, "***.***.***"); assert.equal(read.body.requestedConfig.accountNumber, "****");
  const generic = responseCapture(); writeJson(generic.response, 200, payload);
  assert.equal(generic.read().body.sourceRuntime.sourceRuntimeId, "aaaaaaaa-****-****-****-abcdefabcdef");
});
test("malformed canonical DTOs and non-UUID credentials never receive identity preservation", () => {
  const fixture = canonicalResponseFixture();
  const changes = [ { mode: "live" }, { readOnly: false }, { status: "unavailable" }, { schemaVersion: "future" },
    { sourceRuntime: { ...(fixture.status === "available" ? fixture.sourceRuntime : {}), schemaVersion: "future" } },
    { sourceRuntime: { ...(fixture.status === "available" ? fixture.sourceRuntime : {}), sourceRuntimeId: "123-456-789" } },
    { sourceRuntime: { ...(fixture.status === "available" ? fixture.sourceRuntime : {}), sourceRuntimeId: "abcdefghijklmnop.abcdefgh.ijklmnop" } } ];
  for (const change of changes) {
    const payload = { ...fixture, ...change } as PaperSimulationRequestRead; const c = responseCapture();
    writePaperSimulationRequestJson(c.response, 200, payload);
    const original = (payload as { sourceRuntime: { sourceRuntimeId: string } }).sourceRuntime.sourceRuntimeId;
    assert.notEqual(c.read().body.sourceRuntime.sourceRuntimeId, original);
  }
  const c = responseCapture(); writePaperSimulationRequestJson(c.response, 400, fixture);
  assert.equal(c.read().body.sourceRuntime.sourceRuntimeId, "aaaaaaaa-****-****-****-abcdefabcdef");
});
