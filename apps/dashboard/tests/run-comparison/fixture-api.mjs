import http from 'node:http';
import {evidencePayload} from '../run-evidence/fixtures.mjs';
const calls=[];
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture.local');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/health'){res.end('{}');return;}
  if(url.pathname==='/__calls'){res.end(JSON.stringify(calls));return;}
  calls.push({method:req.method,path:url.pathname,id:url.searchParams.get('runId')});
  if(req.method!=='GET'||url.pathname!=='/batch/replay/runs'){res.statusCode=405;res.end('{}');return;}
  const id=url.searchParams.get('runId');
  if(id==='fixture_offline'){res.statusCode=503;res.end('{}');return;}
  const scenario=id==='fixture_empty'?'empty':id==='fixture_clipped'?'truncated':id==='fixture_bad'?'enum_object':id==='fixture_mismatch'?'mismatch':'normal';
  const raw=evidencePayload(id,scenario);
  if(id==='fixture_duplicate')raw.runs.push({...raw.runs[0]});
  if(id==='fixture_alias'){raw.runs[0].runId='fixture_other_child';raw.runs[0].batchId=id;raw.selectedRun=raw.runs[0];raw.batchId=id;}
  if(id==='fixture_running'||id==='fixture_partial'){raw.runs[0].status=id==='fixture_running'?'running':'completed_with_failures';raw.selectedRun=raw.runs[0];}
  if(id==='fixture_missing'){raw.runs=[];raw.selectedRun=null;raw.latestRunArtifacts=null;}
  const send=()=>res.end(JSON.stringify(raw));if(id==='fixture_slow')setTimeout(send,600);else send();
}).listen(8795,'127.0.0.1');
