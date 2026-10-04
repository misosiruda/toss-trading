import assert from "node:assert/strict";
import test from "node:test";
import type {ServerResponse} from "node:http";
import {writeJson,writeReplayProvenanceJson} from "./localOperationsResponse.js";
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
