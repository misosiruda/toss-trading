// In-memory, loopback-only read fixtures. No filesystem, credentials, provider,
// runner, outbound network, CORS, or mutation routes.
import { createServer } from 'node:http';
const host='127.0.0.1', port=8793, marker='ux04-fixture-v1';
const requests=[];
const start='2026-10-04T00:00:00.000Z', end='2026-10-04T00:01:00.000Z';
function run(runId,status,batchId='fixture_batch') {
  return {mode:'paper_only',runId,batchId,status,runIndex:0,startedAt:start,completedAt:status.startsWith('completed')?end:null,failedAt:status==='failed'?end:null,skippedAt:status==='skipped'?end:null,
    marketRegime:{label:'fixture'},summary:{totalReturnRatio:0,finalVirtualNetWorthKrw:0,tradeCount:0,rejectedCount:0,aiDecisionFailureCount:status==='completed_with_failures'?1:0}};
}
function payload(id) {
  const batch=id.startsWith('paper_sim_')?id:'fixture_batch';
  const observation=id.startsWith('paper_sim_')?{status:'available',schemaVersion:'paper_simulation_observation.v1',simulationRunId:id,batchId:id,acceptedAt:start,outcome:id.endsWith('_failed')?'runner_failed':'unknown',runnerFailure:id.endsWith('_failed')?{observedAt:end,reasonCode:'runner_rejected'}:null}:null;
  const empty=['fixture_missing','paper_sim_20261004000000000_accepted','paper_sim_20261004000000000_failed'].includes(id);
  const status=id==='fixture_partial'?'completed_with_failures':id==='fixture_failed'?'failed':id==='fixture_skipped'?'skipped':id.startsWith('fixture_running')||id.startsWith('fixture_transition_')||id.startsWith('fixture_race_')?'running':'completed';
  const childId=id==='fixture_batch'?'fixture_completed':id;
  const selected=run(childId,status,batch);
  const active=status==='running'?{runId:childId,runIndex:0,startedAt:start,window:{startAt:start,endAt:end},storageBaseDir:'fixture/run',reportPath:'fixture/report',marketRegime:{label:'fixture'}}:null;
  return {mode:id==='fixture_invalid'?'invalid':'paper_only',readOnly:true,status:empty?'missing':status==='running'?'running':'ok',batchId:empty?null:batch,batchStatus:empty?null:status==='running'?'running':'completed_with_failures',sourceRunsPath:'fixture/runs.jsonl',runs:empty||active?[]:[selected],selectedRun:empty||active?null:selected,activeRun:active,simulationObservation:observation,
    latestRunArtifacts:empty?null:{status:'ok',runId:id==='fixture_mismatch'?'other-child':childId,runStatus:status,reportStatus:id==='fixture_partial'||id==='fixture_artifact_missing'?'missing':'ok',progressStatus:id==='fixture_artifact_missing'?'missing':'ok',decisionsStatus:id==='fixture_partial'?'degraded':id==='fixture_artifact_missing'?'missing':'ok',riskDecisionsStatus:'ok',tradesStatus:'ok',report:{title:'Synthetic run report'},progress:{status,completedTickCount:0,tickCount:0,simulatedAt:start,currentPortfolio:{virtualNetWorthKrw:0,cashKrw:0,positionCount:0},rejectedCount:0},decisionCount:0,totalDecisionCount:0,riskDecisionCount:0,totalRiskDecisionCount:0,tradeCount:0,totalTradeCount:0}};
}
function send(response,status,data) {response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(data));}
const server=createServer((request,response)=>{
  const url=new URL(request.url,`http://${host}:${port}`);
  if(request.method==='GET'&&url.pathname==='/health')return send(response,200,{fixture:marker});
  if(url.pathname==='/__requests') {
    if(request.method!=='GET'||request.headers['x-ux04-test-runner']!==marker||request.headers.origin||request.headers['sec-fetch-mode'])return send(response,403,{error:'test_runner_required'});
    return send(response,200,{requests});
  }
  requests.push({method:request.method,path:url.pathname,id:url.searchParams.get('runId')});
  if(request.method!=='GET'||url.pathname!=='/batch/replay/runs')return send(response,404,{error:'fixture_read_only'});
  const id=url.searchParams.get('runId')??'fixture_completed';
  if(id==='fixture_offline')return send(response,503,{error:'fixture_offline'});
  const data=payload(id);
  if((id.startsWith('fixture_transition_')&&requests.filter(r=>r.id===id).length>1)||(id.startsWith('fixture_race_')&&requests.filter(r=>r.id===id).length>2)){data.batchStatus='completed';data.activeRun=null;data.runs=[run(id,'completed')];data.selectedRun=data.runs[0];data.status='ok';data.latestRunArtifacts.runStatus='completed';}
  send(response,200,data);
});
server.listen(port,host,()=>process.stdout.write(`${marker} http://${host}:${port}\n`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
