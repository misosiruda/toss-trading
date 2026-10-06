const start='2026-10-04T00:00:00.000Z',later='2026-10-04T00:01:00.000Z';
const clone=value=>structuredClone(value);
export function evidenceArtifacts(runId='fixture_evidence_normal',scenario='normal') {
  const packet={mode:'paper_only',packetId:'packet_1',generatedAt:start,expiresAt:'2026-10-04T01:00:00.000Z',candidates:[{market:'KR',symbol:'FIXTURE',lastPriceKrw:100}]};
  const decision={packetId:'packet_1',summary:'합성 fixture 판단',decisions:[{market:'KR',symbol:'FIXTURE',action:'VIRTUAL_BUY',confidence:1,budgetKrw:100,thesis:'합성 자료만 사용',riskFactors:['fixture_limit']}]};
  const risk={riskDecisionId:'risk_1',packetId:'packet_1',symbol:'FIXTURE',approved:true,rejectCodes:[],checkedRules:['fixture_rule'],createdAt:later};
  const trade={tradeId:'trade_1',packetId:'packet_1',decisionId:'risk_1',market:'KR',symbol:'FIXTURE',action:'VIRTUAL_BUY',quantity:1,priceKrw:100,amountKrw:100,status:'VIRTUAL_FILLED',executedAt:later};
  const arrays={packets:[packet],decisions:[decision],riskDecisions:[risk],trades:[trade]};
  if(scenario==='duplicate')for(const key of Object.keys(arrays))arrays[key].push(clone(arrays[key][0]));
  if(scenario==='missing'){decision.packetId='absent_packet';risk.packetId='absent_packet';trade.decisionId='absent_risk';}
  if(scenario==='cross_packet'){risk.packetId='packet_2';arrays.packets.push({...clone(packet),packetId:'packet_2',generatedAt:later});}
  if(scenario==='out_of_order')arrays.packets.push({...clone(packet),packetId:'packet_2',generatedAt:'2026-10-03T23:00:00.000Z'});
  if(scenario==='same_time')arrays.packets.push({...clone(packet),packetId:'packet_2'});
  if(scenario==='same_time_nonadjacent')arrays.packets.push({...clone(packet),packetId:'packet_2',generatedAt:later},{...clone(packet),packetId:'packet_3'});
  if(scenario==='enum_array'){decision.decisions[0].action=['VIRTUAL_BUY'];trade.status=['VIRTUAL_FILLED'];}
  if(scenario==='enum_object'){decision.decisions[0].action={toString:null};trade.action={toString:null};}
  if(scenario==='bad'){packet.generatedAt='invalid';decision.decisions[0].confidence=2;risk.checkedRules=[];trade.quantity=-1;}
  if(scenario==='wrong_run')for(const rows of Object.values(arrays))rows[0].runId='different_child';
  if(scenario==='empty')for(const key of Object.keys(arrays))arrays[key]=[];
  const result={runId:scenario==='mismatch'?'different_child':runId,status:scenario==='blocked'?'blocked':'ok',...arrays};
  for(const [array,status,returned,total,corrupt]of [['packets','packetsStatus','packetCount','totalPacketCount','packetCorruptLineCount'],['decisions','decisionsStatus','decisionCount','totalDecisionCount','decisionCorruptLineCount'],['riskDecisions','riskDecisionsStatus','riskDecisionCount','totalRiskDecisionCount','riskDecisionCorruptLineCount'],['trades','tradesStatus','tradeCount','totalTradeCount','tradeCorruptLineCount']]){
    result[status]=scenario==='corrupt'?'corrupt':scenario==='degraded'?'degraded':'ok';
    result[returned]=result[array].length;result[total]=scenario==='truncated'?120:result[array].length;result[corrupt]=scenario==='corrupt'||scenario==='degraded'?1:0;
  }
  if(scenario==='truncated'){result.decisions[0].packetId='outside_packet';result.trades[0].decisionId='outside_risk';}
  if(scenario==='enum_read_status')result.decisionsStatus={toString:null};
  return result;
}
export function evidencePayload(runId='fixture_evidence_normal',scenario='normal') {
  const run={runId,batchId:'fixture_batch',status:'completed',runIndex:0,startedAt:start,completedAt:later,failedAt:null,skippedAt:null,marketRegime:{label:'fixture'},summary:{totalReturnRatio:0,finalVirtualNetWorthKrw:0,tradeCount:1,rejectedCount:0,aiDecisionFailureCount:0}};
  return {mode:'paper_only',readOnly:true,status:'ok',batchId:'fixture_batch',batchStatus:'completed',sourceRunsPath:'fixture/runs.jsonl',runs:[run],selectedRun:run,activeRun:null,simulationObservation:null,latestRunArtifacts:{...evidenceArtifacts(runId,scenario),runStatus:'completed',reportStatus:'ok',progressStatus:'ok',report:{title:'Synthetic evidence run'},progress:{status:'completed',completedTickCount:1,tickCount:1,simulatedAt:later,currentPortfolio:{virtualNetWorthKrw:0,cashKrw:0,positionCount:0},rejectedCount:0}}};
}
