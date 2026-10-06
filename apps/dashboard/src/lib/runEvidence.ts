export type EvidenceKind = 'packet' | 'decision' | 'risk' | 'trade';
export type EvidenceReadStatus = 'ok' | 'missing' | 'corrupt' | 'degraded' | 'blocked' | 'invalid';
export type EvidenceLinkState = 'linked' | 'missing' | 'outside_loaded_range' | 'ambiguous' | 'unavailable' | 'mismatch';
export type EvidenceDetails = Record<string, unknown>;
export interface EvidenceRow { kind: EvidenceKind; id: string; packetId: string; at: string | null; duplicate: boolean; details: EvidenceDetails; }
export interface EvidenceBucket {
  kind: EvidenceKind; status: EvidenceReadStatus; rows: EvidenceRow[];
  returned: number | null; total: number | null; corrupt: number | null;
  invalid: number; wrongRun: number; duplicates: number; truncated: boolean | null; outOfOrder: boolean; sameTime: boolean;
}
export interface RunEvidenceView { runId: string | null; source: 'bound' | 'missing' | 'mismatch' | 'blocked' | 'invalid'; buckets: EvidenceBucket[]; }
export interface EvidenceReference { kind: EvidenceKind; id: string; state: EvidenceLinkState; }
export const EVIDENCE_KINDS: EvidenceKind[] = ['packet','decision','risk','trade'];
const READ = new Set(['ok','missing','corrupt','degraded','blocked','invalid']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000;
const line = (value: unknown): value is string => text(value) && value.trim().length > 0;
const time = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): number | null => number(value) && Number.isSafeInteger(value) ? value : null;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(line);
const market = (value: unknown) => value === 'KR' || value === 'US';
const member = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value);
const action = (value: unknown) => member(value, ['VIRTUAL_BUY','VIRTUAL_SELL','VIRTUAL_HOLD']);
const readStatus = (value: unknown): value is EvidenceReadStatus => typeof value === 'string' && READ.has(value);
const fields: Record<EvidenceKind, {array:string; status:string; returned:string; total:string; corrupt:string}> = {
  packet:{array:'packets',status:'packetsStatus',returned:'packetCount',total:'totalPacketCount',corrupt:'packetCorruptLineCount'},
  decision:{array:'decisions',status:'decisionsStatus',returned:'decisionCount',total:'totalDecisionCount',corrupt:'decisionCorruptLineCount'},
  risk:{array:'riskDecisions',status:'riskDecisionsStatus',returned:'riskDecisionCount',total:'totalRiskDecisionCount',corrupt:'riskDecisionCorruptLineCount'},
  trade:{array:'trades',status:'tradesStatus',returned:'tradeCount',total:'totalTradeCount',corrupt:'tradeCorruptLineCount'}
};

// Project a bounded display contract, never raw provider output, paths or credentials.
function project(kind: EvidenceKind, value: unknown): Omit<EvidenceRow,'duplicate'> | null {
  if (!object(value) || !id(value.packetId)) return null;
  const packetId = value.packetId;
  if (kind === 'packet') {
    if (value.mode !== 'paper_only' || !time(value.generatedAt) || !time(value.expiresAt) ||
        !Array.isArray(value.candidates) || value.candidates.length > 20 ||
        !value.candidates.every(c => object(c) && market(c.market) && id(c.symbol) && (c.lastPriceKrw === undefined || count(c.lastPriceKrw)!==null))) return null;
    return {kind,id:packetId,packetId,at:value.generatedAt,details:{mode:'paper_only',packetId,generatedAt:value.generatedAt,expiresAt:value.expiresAt,candidates:value.candidates.map(c=>({market:c.market,symbol:c.symbol,...(c.lastPriceKrw === undefined ? {} : {lastPriceKrw:c.lastPriceKrw})}))}};
  }
  if (kind === 'decision') {
    if (!line(value.summary) || !Array.isArray(value.decisions) || value.decisions.length > 20 ||
        !value.decisions.every(d => object(d) && id(d.symbol) && market(d.market) && action(d.action) && number(d.confidence) && d.confidence <= 1 && count(d.budgetKrw)!==null && line(d.thesis) && strings(d.riskFactors))) return null;
    return {kind,id:packetId,packetId,at:null,details:{packetId,summary:value.summary,decisions:value.decisions.map(d=>({market:d.market,symbol:d.symbol,action:d.action,confidence:d.confidence,budgetKrw:d.budgetKrw,thesis:d.thesis,riskFactors:d.riskFactors}))}};
  }
  if (kind === 'risk') {
    if (!id(value.riskDecisionId) || typeof value.approved !== 'boolean' || !strings(value.rejectCodes) || !strings(value.checkedRules) || value.checkedRules.length === 0 || !time(value.createdAt) || (value.symbol !== undefined && !id(value.symbol))) return null;
    return {kind,id:value.riskDecisionId,packetId,at:value.createdAt,details:{riskDecisionId:value.riskDecisionId,packetId,...(value.symbol === undefined ? {} : {symbol:value.symbol}),approved:value.approved,rejectCodes:value.rejectCodes,checkedRules:value.checkedRules,createdAt:value.createdAt}};
  }
  if (!id(value.tradeId) || !id(value.decisionId) || !market(value.market) || !id(value.symbol) ||
      !member(value.action, ['VIRTUAL_BUY','VIRTUAL_SELL']) || !number(value.quantity) || value.quantity === 0 || count(value.priceKrw)===null || count(value.amountKrw)===null || !time(value.executedAt) || !member(value.status, ["VIRTUAL_PENDING","VIRTUAL_FILLED","VIRTUAL_REJECTED","VIRTUAL_EXPIRED"])) return null;
  return {kind,id:value.tradeId,packetId,at:value.executedAt,details:{tradeId:value.tradeId,packetId,decisionId:value.decisionId,market:value.market,symbol:value.symbol,action:value.action,quantity:value.quantity,priceKrw:value.priceKrw,amountKrw:value.amountKrw,status:value.status,executedAt:value.executedAt}};
}
function empty(kind: EvidenceKind, status: EvidenceReadStatus): EvidenceBucket {
  return {kind,status,rows:[],returned:null,total:null,corrupt:null,invalid:0,wrongRun:0,duplicates:0,truncated:null,outOfOrder:false,sameTime:false};
}
export function buildRunEvidence(raw: unknown, selectedChildId: string | null): RunEvidenceView {
  const unavailable = (source: RunEvidenceView['source']): RunEvidenceView => ({runId:selectedChildId,source,buckets:EVIDENCE_KINDS.map(kind=>empty(kind,source === 'blocked' ? 'blocked' : source === 'invalid' ? 'invalid' : 'missing'))});
  if (!selectedChildId || raw === null || raw === undefined) return unavailable('missing');
  if (!object(raw) || !id(selectedChildId)) return unavailable('invalid');
  if (raw.runId !== selectedChildId) return unavailable('mismatch');
  if (raw.status === 'blocked' || raw.status === 'invalid') return unavailable(raw.status);
  if (raw.status !== 'ok' && raw.status !== 'missing') return unavailable('invalid');
  const buckets = EVIDENCE_KINDS.map(kind => {
    const f=fields[kind], status=raw[f.status];
    const bucket=empty(kind,readStatus(status) ? status : 'invalid');
    const rows=raw[f.array];bucket.returned=count(raw[f.returned]);bucket.total=count(raw[f.total]);bucket.corrupt=count(raw[f.corrupt]);
    if (!Array.isArray(rows) || rows.length > 100 || bucket.returned !== rows.length || bucket.total === null || bucket.total < rows.length || bucket.corrupt === null) {bucket.status='invalid';bucket.returned=null;bucket.total=null;bucket.corrupt=null;return bucket;}
    bucket.truncated=bucket.total > rows.length;
    if (bucket.status !== 'ok' && bucket.status !== 'degraded') return bucket;
    const counts=new Map<string,number>();
    for (const value of rows) {
      if (object(value) && value.runId !== undefined) {
        if (!id(value.runId)) {bucket.invalid++;continue;}
        if (value.runId !== selectedChildId) {bucket.wrongRun++;continue;}
      }
      const identity=object(value)?value[kind==='risk'?'riskDecisionId':kind==='trade'?'tradeId':'packetId']:undefined;
      if(id(identity))counts.set(identity,(counts.get(identity)??0)+1);
      const row=project(kind,value);if (!row) {bucket.invalid++;continue;}
      bucket.rows.push({...row,duplicate:false});
    }
    bucket.rows=bucket.rows.map(row=>({...row,duplicate:(counts.get(row.id)??0)>1}));
    bucket.duplicates=[...counts.values()].filter(n=>n>1).length;
    const seenTimes=new Set<number>();
    let previous=-Infinity;for (const row of bucket.rows) if(row.at){const stamp=Date.parse(row.at);if(stamp<previous)bucket.outOfOrder=true;if(seenTimes.has(stamp))bucket.sameTime=true;seenTimes.add(stamp);previous=stamp;}
    return bucket;
  });
  return {runId:selectedChildId,source:'bound',buckets};
}
export function evidenceReference(view: RunEvidenceView, kind: EvidenceKind, targetId: string): EvidenceReference {
  const result=(state:EvidenceLinkState)=>({kind,id:targetId,state});
  if (view.source !== 'bound') return result('unavailable');
  const bucket=view.buckets.find(b=>b.kind===kind);
  if (!bucket || !['ok','degraded'].includes(bucket.status)) return result('unavailable');
  const matches=bucket.rows.filter(r=>r.id===targetId);
  if (matches.length>1 || matches.some(r=>r.duplicate)) return result('ambiguous');
  // Rejected rows may contain the target; exclusion does not prove absence.
  if (matches.length===0 && (bucket.invalid>0 || bucket.wrongRun>0 || (bucket.corrupt??0)>0)) return result('unavailable');
  if (matches.length===0) return result(bucket.truncated ? 'outside_loaded_range' : 'missing');
  return result('linked');
}
export function evidenceReferences(view: RunEvidenceView, row: EvidenceRow): EvidenceReference[] {
  if (row.duplicate) return [];
  const refs=row.kind==='packet' ? [] : [evidenceReference(view,'packet',row.packetId)];
  if (row.kind==='trade') {
    const risk=evidenceReference(view,'risk',String(row.details.decisionId));
    const target=view.buckets.find(b=>b.kind==='risk')?.rows.find(r=>r.id===risk.id);
    refs.push(risk.state==='linked' && target?.packetId!==row.packetId ? {...risk,state:'mismatch'} : risk);
  }
  return refs;
}
export function readEvidenceSelection(value: string | null): {kind:EvidenceKind;id:string} | null {
  if (!value || value.length>270) return null;
  const separator=value.indexOf(':');const kind=value.slice(0,separator) as EvidenceKind;const target=value.slice(separator+1);
  return EVIDENCE_KINDS.includes(kind) && id(target) ? {kind,id:target} : null;
}
export function isRunEvidence(value: unknown, selectedChildId: string | null): value is RunEvidenceView {
  if (!object(value) || (value.source==='bound' && !id(selectedChildId)) || value.runId!==selectedChildId || !member(value.source, ['bound','missing','mismatch','blocked','invalid']) || !Array.isArray(value.buckets) || value.buckets.length!==4) return false;
  return value.buckets.every((b,index)=>{
    if (!object(b) || b.kind!==EVIDENCE_KINDS[index] || !readStatus(b.status) || !Array.isArray(b.rows) || b.rows.length>100 || ![b.returned,b.total,b.corrupt].every(n=>n===null||count(n)!==null) || ![b.invalid,b.wrongRun,b.duplicates].every(n=>count(n)!==null) || (b.truncated!==null && typeof b.truncated!=='boolean') || typeof b.outOfOrder!=='boolean' || typeof b.sameTime!=='boolean')return false;
    if(value.source!=='bound' && b.rows.length)return false;
    if((b.status!=='ok' && b.status!=='degraded') && b.rows.length)return false;
    if(b.returned!==null && b.total!==null && (Number(b.returned)>100 || Number(b.total)<Number(b.returned) || b.truncated!==(Number(b.total)>Number(b.returned))))return false;
    if ((b.status==='ok'||b.status==='degraded') && (b.returned===null || b.total===null || b.corrupt===null || b.returned!==b.rows.length+Number(b.invalid)+Number(b.wrongRun)))return false;
    if ([b.invalid,b.wrongRun,b.duplicates].some(n=>Number(n)>100))return false;
    return b.rows.every(r=>object(r) && r.kind===b.kind && id(r.id) && id(r.packetId) && (r.at===null||time(r.at)) && typeof r.duplicate==='boolean' && object(r.details) && (()=>{const parsed=project(r.kind as EvidenceKind,r.details);return parsed?.id===r.id && parsed.packetId===r.packetId && parsed.at===r.at && JSON.stringify(parsed.details)===JSON.stringify(r.details);})());
  });
}

export const BENCHMARK_NAMES = ['cashOnly', 'equalWeightBuyAndHold', 'initialPortfolioBuyAndHold'] as const;
export type BenchmarkName = typeof BENCHMARK_NAMES[number];
export type BenchmarkMetric = { initialNetWorthKrw: number; finalNetWorthKrw: number; totalReturnRatio: number | null };
export type BenchmarkDisplay = { name: BenchmarkName; status: 'available'; metric: BenchmarkMetric } | { name: BenchmarkName; status: 'missing' | 'unavailable' | 'invalid'; metric: null };
export interface RunReportContext {
  runId: string | null;
  source: 'bound' | 'missing' | 'mismatch' | 'blocked' | 'invalid';
  reportStatus: EvidenceReadStatus;
  range: { startAt: string; endAt: string; tickCount: number } | null;
  benchmarks: BenchmarkDisplay[];
}
const reportTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && time(value);
const finiteMetric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const benchmarkMetric = (value: unknown): BenchmarkMetric | null => object(value) &&
  finiteMetric(value.initialNetWorthKrw) && finiteMetric(value.finalNetWorthKrw) &&
  (value.totalReturnRatio === null || finiteMetric(value.totalReturnRatio))
  ? { initialNetWorthKrw: value.initialNetWorthKrw, finalNetWorthKrw: value.finalNetWorthKrw, totalReturnRatio: value.totalReturnRatio } : null;

/** Same selected-child artifact read as evidence. No extra read or calculation. */
export function buildRunReportContext(raw: unknown, selectedChildId: string | null): RunReportContext {
  const empty = (source: RunReportContext['source'], reportStatus: EvidenceReadStatus): RunReportContext => ({runId:selectedChildId,source,reportStatus,range:null,benchmarks:BENCHMARK_NAMES.map(name=>({name,status:'unavailable',metric:null}))});
  if (!selectedChildId || raw === null || raw === undefined) return empty('missing','missing');
  if (!object(raw) || !id(selectedChildId)) return empty('invalid','invalid');
  if (raw.runId !== selectedChildId) return empty('mismatch','invalid');
  if (raw.status === 'blocked' || raw.status === 'invalid') return empty(raw.status,raw.status);
  if (raw.status !== 'ok' && raw.status !== 'missing') return empty('invalid','invalid');
  if (!readStatus(raw.reportStatus)) return empty('invalid','invalid');
  if (raw.status==='missing' && raw.reportStatus==='ok') return empty('invalid','invalid');
  const unavailable = empty('bound',raw.reportStatus);
  if (raw.reportStatus !== 'ok') return unavailable;
  const report = raw.report;
  if (!object(report) || report.mode !== 'paper_only' || (Object.hasOwn(report,'runId') && report.runId !== selectedChildId)) return empty('invalid','invalid');
  const range = report.simulatedRange;
  if (object(range) && reportTime(range.startAt) && reportTime(range.endAt) && Date.parse(range.startAt)<=Date.parse(range.endAt) && count(range.tickCount)!==null)
    unavailable.range = {startAt:range.startAt,endAt:range.endAt,tickCount:range.tickCount as number};
  const benchmarks = object(report.benchmarks) ? report.benchmarks : null;
  unavailable.benchmarks = BENCHMARK_NAMES.map(name=>{
    if (!benchmarks || !Object.hasOwn(benchmarks,name)) return {name,status:'missing',metric:null};
    if (benchmarks[name] === null) return {name,status:'unavailable',metric:null};
    const metric = benchmarkMetric(benchmarks[name]);
    return metric ? {name,status:'available',metric} : {name,status:'invalid',metric:null};
  });
  return unavailable;
}
export function isRunReportContext(value: unknown, selectedChildId: string | null): value is RunReportContext {
  if (!object(value) || value.runId!==selectedChildId || (value.source==='bound'&&!id(selectedChildId)) || !member(value.source,['bound','missing','mismatch','blocked','invalid']) || !readStatus(value.reportStatus) || !Array.isArray(value.benchmarks) || value.benchmarks.length!==3) return false;
  if (value.range!==null && (!object(value.range) || !reportTime(value.range.startAt) || !reportTime(value.range.endAt) || Date.parse(value.range.startAt)>Date.parse(value.range.endAt) || count(value.range.tickCount)===null)) return false;
  if ((value.source!=='bound' || value.reportStatus!=='ok') && value.range!==null) return false;
  return value.benchmarks.every((row,index)=>{
    if (!object(row) || row.name!==BENCHMARK_NAMES[index]) return false;
    if (row.status==='available') return value.source==='bound' && value.reportStatus==='ok' && benchmarkMetric(row.metric)!==null && object(row.metric) && Object.keys(row.metric).length===3;
    return member(row.status,['missing','unavailable','invalid']) && row.metric===null && ((value.source==='bound' && value.reportStatus==='ok') || row.status==='unavailable');
  });
}
export function readBenchmarkSelection(value: string | null): BenchmarkName[] | null {
  if (value===null) return [...BENCHMARK_NAMES];
  if (value==='none') return [];
  const parts=value.split(',');
  if (parts.length>3 || new Set(parts).size!==parts.length || !parts.every(part=>BENCHMARK_NAMES.includes(part as BenchmarkName))) return null;
  return BENCHMARK_NAMES.filter(name=>parts.includes(name));
}