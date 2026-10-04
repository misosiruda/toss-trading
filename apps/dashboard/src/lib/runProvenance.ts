import { readOperationsApiConfig } from './dashboardViewModels';
import type {ProvenanceReason as ApiReason,ProvenanceSource as ApiSource,ProvenanceField as ApiField,ReplayProvenance as ApiObservation} from '../../../../src/api/replayProvenanceProjection';

// Keep the transport adapter separate from the display model: backend review
// may change its DTO without changing workspace polling or evidence selection.
export type ProvenanceReason = ApiReason;
export type ProvenanceSource = ApiSource;
export type ObservedField = ApiField;
export interface ProvenanceObservation {requestedId:string;fetchedAt:string;status:ApiObservation['status']|'offline';fields:Record<string,ObservedField>;comparability:'unavailable';clone:'unavailable'}
export const provenanceFieldGroups = {
  '숨긴 실행 설정': ['configuration.strategyPreset','configuration.packetIdPrefix'],
  '실행 자료 설정': ['configuration.packetExpiresInSeconds','configuration.maxCandidates','configuration.maxSnapshotAgeSeconds'],
  '관측 기간': ['window.source','window.startAt','window.endAt','window.rangeStart','window.rangeEnd','window.windowMonths','window.timezoneOffsetMinutes','window.seed'],
  '실행 설정': ['configuration.initialCashKrw','configuration.clock.startAt','configuration.clock.endAt','configuration.clock.stepSeconds','configuration.clock.speedMultiplier','configuration.samplingPolicy.everyNSteps','configuration.samplingPolicy.candidateChangedOnly','configuration.samplingPolicy.decisionFrequency','configuration.samplingPolicy.maxDecisionCalls','configuration.samplingPolicy.timezoneOffsetMinutes','configuration.constraints.maxNewPositions','configuration.constraints.maxBudgetPerSymbolKrw','configuration.constraints.allowedActions','configuration.riskProfile','batch.seed','child.runSeed'],
  '비용·체결': ['configuration.executionPolicy.fillPriceRule','configuration.executionPolicy.slippageBps','configuration.executionPolicy.feeBps','configuration.executionPolicy.taxBps','configuration.executionPolicy.halfSpreadBps','configuration.executionPolicy.fillRatio','configuration.executionPolicy.allowFractionalShares','configuration.executionPolicy.maxVolumeParticipationRate','configuration.executionPolicy.minLiquidityFillRatio','configuration.executionPolicy.rejectStaleLiquidity','configuration.executionPolicy.marketImpactBpsPerParticipationRate'],
  'Risk·배분·종료': ['configuration.riskPolicy.maxBudgetPerDecisionKrw','configuration.riskPolicy.maxSymbolExposureKrw','configuration.riskPolicy.targetExposureRatio','configuration.riskPolicy.maxPositionWeightRatio','configuration.riskPolicy.maxSectorExposureKrw','configuration.riskPolicy.maxSectorExposureRatio','configuration.riskPolicy.maxCountryExposureKrw','configuration.riskPolicy.maxCountryExposureRatio','configuration.riskPolicy.maxCurrencyExposureKrw','configuration.riskPolicy.maxCurrencyExposureRatio','configuration.riskPolicy.maxUnknownMetadataExposureKrw','configuration.riskPolicy.maxUnknownMetadataExposureRatio','configuration.riskPolicy.minCashReserveRatio','configuration.riskPolicy.minCashReserveKrw','configuration.allocationPolicy.targetExposureRatio','configuration.allocationPolicy.minCashReserveRatio','configuration.allocationPolicy.maxBudgetPerDecisionRatio','configuration.allocationPolicy.maxSymbolExposureRatio','configuration.allocationPolicy.deploymentRampDays','configuration.allocationPolicy.rampDayIndex','configuration.allocationPolicy.maxInitialDeploymentRatio','configuration.allocationPolicy.maxDailyGrossBuyRatio','configuration.allocationPolicy.maxInitialOpenPositions','configuration.allocationPolicy.maxNewPositionsPerDay','configuration.allocationPolicy.maxConcurrentPositions','configuration.allocationPolicy.positionSlotRampDays','configuration.paperExitPolicy.takeProfitRatio','configuration.paperExitPolicy.stopLossRatio','configuration.paperExitPolicy.rebalanceMaxPositionWeightRatio','configuration.paperExitPolicy.takeProfitMode','configuration.paperExitPolicy.takeProfitSellRatio','configuration.paperExitPolicy.trailingStopFromPeakRatio'],
  '저장 hash': ['research.manifestVersion','research.configHash','research.dataSnapshotHash','research.universeHash','research.coverageHash','research.promptHash','research.schemaHash','research.riskPolicyHash','research.costModelHash','research.executionModelVersion'],
  '복원되지 않은 입력·runtime': ['requestedConfig','effectiveConfig','notices','runtime.gitRevision','runtime.dependencyLockHash','runtime.nodeVersion']
} as const;
const keys=Object.values(provenanceFieldGroups).flat();
const reasons:readonly string[]=['not_persisted','not_present','invalid','missing','blocked','limit','ambiguous','identity_mismatch','redacted_text'];
const sourceAllowed=(key:string,source:unknown)=>key.startsWith('research.') ? source==='research_manifest'||source==='run_metadata' : source==='run_metadata';
const structuralFields=['requestedConfig','effectiveConfig','notices','runtime.gitRevision','runtime.dependencyLockHash','runtime.nodeVersion'];
const seedFields=['batch.seed','child.runSeed','window.seed','configuration.strategyPreset','configuration.packetIdPrefix'];
function reasonAllowed(key:string,status:ProvenanceObservation['status'],reason:string):boolean {
  if(structuralFields.includes(key))return reason==='not_persisted';
  if(status!=='partial')return reason===status||(status==='invalid'&&reason==='identity_mismatch');
  if(key==='batch.seed'||key==='child.runSeed')return reason==='redacted_text'||reason==='not_present';
  if(seedFields.includes(key)&&reason==='redacted_text')return true;
  if(key.startsWith('research.')&&(reason==='identity_mismatch'||(key==='research.executionModelVersion'&&reason==='redacted_text')))return true;
  return ['not_present','invalid','missing','blocked'].includes(reason);
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const validProvenanceId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(v);
// The backend caps reads at 1500ms and reserves 500ms for serialization/transport.
// Propagate remaining duration, never an absolute clock across processes.
export const PROVENANCE_TRANSPORT_TIMEOUT_MS=2_000;
const unavailable=(reason:ProvenanceReason):ObservedField=>({status:'unavailable',reason,value:null});
const empty=(id:string,at:string,status:ProvenanceObservation['status']):ProvenanceObservation=>({requestedId:id,fetchedAt:at,status,fields:{},comparability:'unavailable',clone:'unavailable'});
function safeValue(key:string,value:unknown):boolean {
  if(key.startsWith('research.')&&key.endsWith('Hash'))return typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
  if(key==='research.manifestVersion')return value==='replay_research_manifest.v1';
  if(key==='research.executionModelVersion')return value==='execution_simulator.v4'||value==='execution_simulator.v5';
  if(key.endsWith('At')||key==='window.rangeStart'||key==='window.rangeEnd')return (value===null&&(key==='window.rangeStart'||key==='window.rangeEnd'))||strictTimestamp(value);
  const enums:Record<string,readonly string[]>={'window.source':['explicit','random_window'],'configuration.samplingPolicy.decisionFrequency':['every_tick','once_per_day','once_per_week'],'configuration.executionPolicy.fillPriceRule':['current_candidate_last_price'],'configuration.riskProfile':['balanced','conservative','aggressive_paper']};
  if(enums[key])return (value===null&&key==='configuration.riskProfile')||(typeof value==='string'&&enums[key].includes(value));
  if(key==='configuration.constraints.allowedActions')return Array.isArray(value)&&value.length>0&&value.length<=16&&value.every(v=>['VIRTUAL_BUY','VIRTUAL_SELL','VIRTUAL_HOLD'].includes(v));
  if(key==='configuration.paperExitPolicy.takeProfitMode')return value==='full_exit'||value==='partial_then_trail';
  if(key.endsWith('candidateChangedOnly')||key.endsWith('allowFractionalShares')||key.endsWith('rejectStaleLiquidity'))return typeof value==='boolean';
  if(value===null)return ['window.windowMonths','configuration.samplingPolicy.everyNSteps','configuration.samplingPolicy.maxDecisionCalls'].includes(key);
  if(typeof value!=='number'||!Number.isFinite(value))return false;
  if(key.endsWith('timezoneOffsetMinutes'))return Number.isSafeInteger(value);
  if(key==='configuration.maxSnapshotAgeSeconds')return Number.isSafeInteger(value)&&value>=0;
  if(['configuration.packetExpiresInSeconds','configuration.maxCandidates'].includes(key))return Number.isSafeInteger(value)&&value>0;
  if(key.endsWith('Krw')||key.endsWith('maxNewPositions')||key.endsWith('maxNewPositionsPerDay')||/Positions$/.test(key))return Number.isSafeInteger(value)&&value>=0;
  if(/(?:Months|Steps|Calls|Days|DayIndex|stepSeconds)$/.test(key))return Number.isSafeInteger(value)&&value>0;
  if(key.endsWith('takeProfitRatio'))return value>0&&value<=10;
  if(key.startsWith('configuration.paperExitPolicy.')&&key.endsWith('Ratio'))return value>0&&value<=1;
  if(key.endsWith('Ratio')&&key!=='configuration.executionPolicy.fillRatio'||key.endsWith('maxVolumeParticipationRate'))return value>=0&&value<=1;
  return value>=0&&(key!=='configuration.clock.speedMultiplier'||value>0);
}
export function strictTimestamp(value:unknown):value is string {
  if(typeof value!=='string'||value.length>40)return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);if(!m)return false;
  const calendar=new Date(0);calendar.setUTCFullYear(Number(m[1]),Number(m[2]),0);
  return Number(m[2])>=1&&Number(m[2])<=12&&Number(m[3])>=1&&Number(m[3])<=calendar.getUTCDate()&&Number(m[4])<=23&&Number(m[5])<=59&&Number(m[6])<=59&&Number(m[7]??0)<=23&&Number(m[8]??0)<=59&&Number.isFinite(Date.parse(value));
}
export function projectRunProvenance(raw:unknown,id:string,at:string):ProvenanceObservation {
  if(!validProvenanceId(id)||!record(raw)||raw.mode!=='paper_only'||raw.readOnly!==true||raw.contractVersion!=='replay_provenance_read.v1'||raw.requestedRunId!==id||raw.comparability!=='unavailable'||raw.clone!=='unavailable'||typeof raw.status!=='string'||!['partial','missing','invalid','blocked','limit','ambiguous'].includes(raw.status)||!record(raw.fields))return empty(id,at,'invalid');
  const status=raw.status as ProvenanceObservation['status'],fields:Record<string,ObservedField>={};
  for(const key of keys){
    const field=raw.fields[key];
    if(!record(field)){fields[key]=unavailable('invalid');continue;}
    if(field.status==='unavailable'&&field.value===null&&!Object.hasOwn(field,'source')&&!Object.hasOwn(field,'verification')&&typeof field.reason==='string'&&reasons.includes(field.reason)&&reasonAllowed(key,status,field.reason)){fields[key]=unavailable(field.reason as ProvenanceReason);continue;}
    // Full input/runtime and free text never become reconstructed values, even
    // if a future or malformed response claims they are recorded.
    const forbidden=[...structuralFields,...seedFields];
    if(status==='partial'&&!forbidden.includes(key)&&field.status==='recorded'&&field.verification==='stored_observation'&&sourceAllowed(key,field.source)&&!Object.hasOwn(field,'reason')&&safeValue(key,field.value))fields[key]={status:'recorded',source:field.source as ProvenanceSource,verification:'stored_observation',value:field.value as Extract<ObservedField,{status:'recorded'}>['value']};
    else fields[key]=unavailable('invalid');
  }
  return {requestedId:id,fetchedAt:at,status,fields,comparability:'unavailable',clone:'unavailable'};
}
export async function readRunProvenance(id:string):Promise<ProvenanceObservation>{
  const at=new Date().toISOString();if(!validProvenanceId(id))return empty(id,at,'invalid');
  const deadline=performance.now()+PROVENANCE_TRANSPORT_TIMEOUT_MS;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),PROVENANCE_TRANSPORT_TIMEOUT_MS);
  try{const remaining=Math.max(0,Math.floor(deadline-performance.now()));const response=await fetch(`${readOperationsApiConfig().baseUrl}/batch/replay/runs/provenance?runId=${encodeURIComponent(id)}`,{method:'GET',cache:'no-store',signal:controller.signal,headers:{accept:'application/json','x-provenance-budget-ms':String(remaining)}});if(!response.ok)return empty(id,at,response.status===400?'invalid':'offline');return projectRunProvenance(await response.json(),id,at);}
  catch{return empty(id,at,'offline');}finally{clearTimeout(timer);}
}
