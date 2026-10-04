import http from 'node:http';
import {evidencePayload} from '../run-evidence/fixtures.mjs';
import {createHeldReadGate} from '../held-read-gate.mjs';
const calls=[];
const gates=createHeldReadGate();
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture.local');res.setHeader('Content-Type','application/json');
  if(gates.control(req,res,url))return;
  if(url.pathname==='/health'){res.end('{}');return;}
  if(url.pathname==='/__calls'){res.end(JSON.stringify(calls));return;}
  calls.push({method:req.method,path:url.pathname,id:url.searchParams.get('runId')});
  if(req.method!=='GET'||url.pathname!=='/batch/replay/runs'){res.statusCode=405;res.end('{}');return;}
  const id=url.searchParams.get('runId');
  if(id==='fixture_offline'){res.statusCode=503;res.end('{}');return;}
  const scenario=id==='fixture_empty'?'empty':id==='fixture_clipped'?'truncated':id==='fixture_bad'?'enum_object':id==='fixture_mismatch'?'mismatch':'normal';
  const raw=evidencePayload(id,scenario);
  if(id==='fixture_duplicate'){raw.runs.push({...raw.runs[0]});raw.totalCount=2;}
  if(id==='fixture_alias'){raw.runs[0].runId='fixture_other_child';raw.runs[0].batchId=id;raw.selectedRun=raw.runs[0];raw.batchId=id;}
  if(id==='fixture_running'){raw.activeRun={runId:id,runIndex:0,startedAt:raw.runs[0].startedAt};raw.selectedRun=raw.activeRun;raw.runs=[];raw.totalCount=0;raw.status='running';raw.batchStatus='running';}
  if(id==='fixture_partial'){raw.runs[0].status='completed_with_failures';raw.selectedRun=raw.runs[0];}
  if(id==='fixture_missing'){raw.totalCount=0;raw.runs=[];raw.selectedRun=null;raw.latestRunArtifacts=null;}
  if(id==='fixture_endpoint_blocked')Object.assign(raw,{status:'blocked',runs:[],totalCount:0,selectedRun:null,latestRunArtifacts:null});
  if(id==='fixture_stored_running'){raw.runs[0].status='running';raw.selectedRun=raw.runs[0];}
  if(id==='fixture_no_active_id')Object.assign(raw,{status:'running',batchStatus:'running',runs:[],totalCount:0,activeRun:{runIndex:0},selectedRun:{runIndex:0}});
  if(id==='fixture_outside_duplicate'){
    const first={...raw.runs[0]};const original=[first,...Array.from({length:99},(_,i)=>({...first,runId:'other_'+i})),{...first,status:'failed'}];
    Object.assign(raw,{runs:original.slice(-100),totalCount:original.length,selectedRun:first});
  }
  if(id==='fixture_selected_mismatch')raw.selectedRun={...raw.runs[0],status:'failed'};
  if(id==='fixture_aggregate_fallback')Object.assign(raw,{batchId:null,batchStatus:null,aggregateStatus:'ok'});
  const send=()=>res.end(JSON.stringify(raw));if(!gates.hold(url,res,send))send();
}).listen(8795,'127.0.0.1');
