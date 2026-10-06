// In-memory, loopback-only read fixtures. No filesystem, credentials, provider,
// runner, outbound network, CORS, or mutation routes.
import { createServer } from 'node:http';
const host='127.0.0.1', port=8793, marker='ux04-fixture-v1';
const requests=[];
const replacementFailures=new Map();
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
  if(url.pathname==='/__replacement'){
    const id=url.searchParams.get('id'),status=url.searchParams.get('status');
    if(request.method!=='GET'||request.headers['x-ux04-test-runner']!==marker||request.headers.origin||request.headers['sec-fetch-mode']||
      !id?.startsWith('fixture_running_replacement_')||!['ok','offline','invalid'].includes(status))return send(response,403,{error:'test_runner_required'});
    replacementFailures.set(id,status);return send(response,200,{id,status});
  }
  if(url.pathname==='/__requests') {
    if(request.method!=='GET'||request.headers['x-ux04-test-runner']!==marker||request.headers.origin||request.headers['sec-fetch-mode'])return send(response,403,{error:'test_runner_required'});
    return send(response,200,{requests});
  }
  requests.push({method:request.method,path:url.pathname,id:url.searchParams.get('runId')});
  if(request.method!=='GET'||url.pathname!=='/batch/replay/runs')return send(response,404,{error:'fixture_read_only'});
  const id=url.searchParams.get('runId')??'fixture_completed';
  if(replacementFailures.get(id)==='offline')return send(response,503,{error:'synthetic_replacement_offline'});
  if(id==='fixture_offline')return send(response,503,{error:'fixture_offline'});
  const data=payload(id);
  if(id.startsWith('fixture_benchmark_')) {
    const raw=data.latestRunArtifacts;
    raw.report={title:'Synthetic benchmark report',mode:'paper_only',simulatedRange:{startAt:start,endAt:end,tickCount:2},benchmarks:{
      cashOnly:{initialNetWorthKrw:500000,finalNetWorthKrw:500000,totalReturnRatio:0},
      equalWeightBuyAndHold:{initialNetWorthKrw:500000,finalNetWorthKrw:510000,totalReturnRatio:0.02},
      initialPortfolioBuyAndHold:{initialNetWorthKrw:500000,finalNetWorthKrw:490000,totalReturnRatio:-0.02}}};
    raw.packetsStatus='ok';raw.packetCount=2;raw.totalPacketCount=2;raw.packetCorruptLineCount=0;
    raw.packets=[{packetId:'fixture_packet_kr',mode:'paper_only',generatedAt:start,expiresAt:end,candidates:[{market:'KR',symbol:'005930',lastPriceKrw:70000}]},{packetId:'fixture_packet_us',mode:'paper_only',generatedAt:start,expiresAt:end,candidates:[{market:'US',symbol:'AAPL',lastPriceKrw:70000}]}];
    if(id.endsWith('_unavailable'))raw.report.benchmarks.equalWeightBuyAndHold=null;
    if(id.endsWith('_missing')){delete raw.report.benchmarks.cashOnly;delete raw.report.simulatedRange;raw.packetsStatus='missing';raw.packets=[];raw.packetCount=0;raw.totalPacketCount=0;}
    if(id.endsWith('_invalid'))raw.report.benchmarks.initialPortfolioBuyAndHold.totalReturnRatio='0.02';
    if(id.endsWith('_mismatch'))raw.runId='other-child';
    if(id.endsWith('_degraded')){raw.packetsStatus='degraded';raw.totalPacketCount=5;raw.packetCorruptLineCount=1;}
  }
  if(data.activeRun !== null){data.runs=[];data.selectedRun={...data.activeRun};}
  if(id.startsWith('fixture_source_bad_')||id.startsWith('fixture_source_mixed_')){
    const status=id.includes('_running_')?'running':id.includes('_queued_')?'queued':'active';
    const invalid={...data.selectedRun,status};data.runs=[invalid];data.batchStatus='unknown';data.latestRunArtifacts=null;
    if(id.startsWith('fixture_source_mixed_')){data.activeRun={...invalid};delete data.activeRun.status;data.selectedRun=data.activeRun;}
    else{data.activeRun=null;data.selectedRun=invalid;}
  }
  if(id.startsWith('fixture_legacy_active_')){
    data.batchStatus='unknown';data.activeRun={...data.selectedRun};delete data.activeRun.status;
    data.selectedRun=null;data.runs=[];data.latestRunArtifacts.runStatus=null;
    data.latestRunArtifacts.reportStatus='missing';data.latestRunArtifacts.report=null;
  }
  if(replacementFailures.get(id)==='invalid')data.mode='invalid';
  // Independent provenance reads must not advance simulated runner state.
  const stateReads=requests.filter(r=>r.id===id&&r.path==='/batch/replay/runs').length;
  if((id.startsWith('fixture_transition_')&&stateReads>1)||(id.startsWith('fixture_race_')&&stateReads>2)){data.batchStatus='completed';data.activeRun=null;data.runs=[run(id,'completed')];data.selectedRun=data.runs[0];data.status='ok';data.latestRunArtifacts.runStatus='completed';}
  send(response,200,data);
});
server.listen(port,host,()=>process.stdout.write(`${marker} http://${host}:${port}\n`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
