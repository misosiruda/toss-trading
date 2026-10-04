import { readOperationsApiConfig } from './dashboardViewModels';
import { buildRunEvidence, type EvidenceKind, type EvidenceReadStatus } from './runEvidence';

export type ComparisonSelection = { status: 'empty' | 'invalid'; baseline: string; candidate: string; reason: string } | { status: 'valid'; baseline: string; candidate: string };
export type ComparisonReadStatus = 'available' | 'missing' | 'offline' | 'invalid' | 'identity_mismatch' | 'ambiguous' | 'blocked' | 'incomplete';
export interface ComparisonEvidenceScope {
  kind: EvidenceKind; status: EvidenceReadStatus; returned: number | null; total: number | null;
  displayed: number; excluded: number; corrupt: number | null; truncated: boolean | null;
}
export interface ComparisonObservation {
  requestedId: string; status: ComparisonReadStatus; fetchedAt: string; runStatus: string | null;
  startedAt: string | null; endedAt: string | null; sourceStatus: string | null;
  artifactBinding: 'bound' | 'missing' | 'mismatch' | 'blocked' | 'invalid';
  reportStatus: string | null; progressStatus: string | null; scopes: ComparisonEvidenceScope[];
  comparability: 'unavailable'; clone: 'unavailable';
  observationSource: 'stored_terminal' | 'manifest_active' | null;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(value);
const timestamp = (value: unknown): string | null => typeof value === 'string' && value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19) ? value : null;
const member = (value: unknown, values: readonly string[]): string | null => typeof value === 'string' && values.includes(value) ? value : null;

export function readComparisonSelection(params: Record<string, string | string[] | undefined>): ComparisonSelection {
  const baseline = typeof params.baseline === 'string' ? params.baseline.slice(0,256) : '';
  const candidate = typeof params.candidate === 'string' ? params.candidate.slice(0,256) : '';
  if (params.baseline === undefined && params.candidate === undefined) return {status:'empty',baseline,candidate,reason:'기준과 후보의 정확한 실행 ID를 입력해 주세요.'};
  if (!validId(params.baseline) || !validId(params.candidate)) return {status:'invalid',baseline,candidate,reason:'기준 1개와 후보 1개의 정확한 실행 ID가 필요해요. 중복 파라미터나 경로 문자는 사용할 수 없어요.'};
  if (baseline === candidate) return {status:'invalid',baseline,candidate,reason:'기준과 후보에 서로 다른 실행을 선택해 주세요.'};
  return {status:'valid',baseline,candidate};
}

function unavailable(requestedId: string, fetchedAt: string, status: ComparisonReadStatus): ComparisonObservation {
  return {requestedId,status,fetchedAt,runStatus:null,startedAt:null,endedAt:null,sourceStatus:null,artifactBinding:'missing',reportStatus:null,progressStatus:null,scopes:[],observationSource:null,comparability:'unavailable',clone:'unavailable'};
}

/** Exact child observations only. Never infer provenance or expose source paths. */
export function projectComparisonObservation(value: unknown, requestedId: string, fetchedAt: string): ComparisonObservation {
  if (!validId(requestedId) || !record(value) || !Array.isArray(value.runs) || value.runs.length > 100) return unavailable(requestedId,fetchedAt,'invalid');
  if (value.mode !== 'paper_only' || value.readOnly !== true) return unavailable(requestedId,fetchedAt,'invalid');
  if (value.status === 'blocked') return {...unavailable(requestedId,fetchedAt,'blocked'),sourceStatus:'blocked',artifactBinding:'blocked'};
  if (!member(value.status,['ok','running','missing','degraded'])) return unavailable(requestedId,fetchedAt,'invalid');
  // The legacy reader selects artifacts before taking the last 100 rows. A
  // partial or corrupt index cannot prove uniqueness of that selected record.
  if (!Number.isSafeInteger(value.totalCount) || value.totalCount !== value.runs.length ||
      !Number.isSafeInteger(value.corruptLineCount) || value.corruptLineCount !== 0) return unavailable(requestedId,fetchedAt,'incomplete');
  const exactRows = value.runs.filter(row => record(row) && row.runId === requestedId);
  if (exactRows.length > 1) return unavailable(requestedId,fetchedAt,'ambiguous');
  const active = record(value.activeRun) ? value.activeRun : null;
  const exactActive = active?.runId === requestedId ? active : null;
  if (exactRows.length && exactActive) return unavailable(requestedId,fetchedAt,'ambiguous');
  const run = exactRows[0] ?? exactActive;
  if (!record(run)) {
    if (record(value.selectedRun) || active || record(value.latestRunArtifacts)) return unavailable(requestedId,fetchedAt,'identity_mismatch');
    return unavailable(requestedId,fetchedAt,'missing');
  }
  if (run.mode !== undefined && run.mode !== 'paper_only') return unavailable(requestedId,fetchedAt,'invalid');
  const isActive = exactRows.length === 0;
  if (!validId(value.batchId) || (isActive ? value.batchStatus !== 'running' || (run.batchId !== undefined && run.batchId !== value.batchId) || (run.status !== undefined && run.status !== 'running') : run.batchId !== value.batchId)) return unavailable(requestedId,fetchedAt,'invalid');
  const status = isActive ? 'running' : member(run.status,['completed','completed_with_failures','failed','skipped']);
  if (!status) return unavailable(requestedId,fetchedAt,'invalid');
  // No legacy selected/active identity fallback. Selected evidence must describe
  // the same source record, including its index, lifecycle and storage binding.
  const selected = value.selectedRun;
  const bindingKeys = ['runId','batchId','runIndex','status','startedAt','completedAt','failedAt','skippedAt','storageBaseDir','reportPath'];
  if (!record(selected) || bindingKeys.some(key => selected[key] !== run[key])) return unavailable(requestedId,fetchedAt,'identity_mismatch');
  const evidence = buildRunEvidence(value.latestRunArtifacts,requestedId);
  const artifact = record(value.latestRunArtifacts) ? value.latestRunArtifacts : null;
  const readStatuses = ['ok','missing','corrupt','degraded','blocked','invalid'];
  return {
    requestedId,status:'available',fetchedAt,runStatus:status,
    observationSource:isActive ? 'manifest_active' : 'stored_terminal',
    startedAt:timestamp(run.startedAt),endedAt:timestamp(status === 'running' ? null : status === 'failed' ? run.failedAt : status === 'skipped' ? run.skippedAt : run.completedAt),
    sourceStatus:member(value.status,['ok','running','missing','blocked','degraded']),artifactBinding:evidence.source,
    reportStatus:evidence.source === 'bound' ? member(artifact?.reportStatus,readStatuses) : null,
    progressStatus:evidence.source === 'bound' ? member(artifact?.progressStatus,readStatuses) : null,
    scopes:evidence.source === 'bound' ? evidence.buckets.map(b=>({kind:b.kind,status:b.status,returned:b.returned,total:b.total,displayed:b.rows.filter(r=>!r.duplicate).length,excluded:b.invalid+b.wrongRun+b.rows.filter(r=>r.duplicate).length,corrupt:b.corrupt,truncated:b.truncated})) : [],
    comparability:'unavailable',clone:'unavailable'
  };
}

export async function readComparisonObservation(runId: string): Promise<ComparisonObservation> {
  const fetchedAt = new Date().toISOString();
  if (!validId(runId)) return unavailable(runId,fetchedAt,'invalid');
  const config = readOperationsApiConfig(), controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),2_000);
  try {
    const endpoint = `/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=${encodeURIComponent(runId)}`;
    const response = await fetch(`${config.baseUrl}${endpoint}`,{method:'GET',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
    if (!response.ok) return unavailable(runId,fetchedAt,'offline');
    return projectComparisonObservation(await response.json(),runId,fetchedAt);
  } catch { return unavailable(runId,fetchedAt,'offline'); }
  finally { clearTimeout(timeout); }
}

export async function readComparisonPage(selection: ComparisonSelection): Promise<ComparisonObservation[]> {
  return selection.status === 'valid' ? Promise.all([readComparisonObservation(selection.baseline),readComparisonObservation(selection.candidate)]) : [];
}
