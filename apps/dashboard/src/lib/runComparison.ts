import { normalizeRunDetailView, readOperationsApiConfig } from './dashboardViewModels';
import { buildRunEvidence, type EvidenceKind, type EvidenceReadStatus } from './runEvidence';

export type ComparisonSelection = { status: 'empty' | 'invalid'; baseline: string; candidate: string; reason: string } | { status: 'valid'; baseline: string; candidate: string };
export type ComparisonReadStatus = 'available' | 'missing' | 'offline' | 'invalid' | 'identity_mismatch' | 'ambiguous';
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
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(value);
const timestamp = (value: string | null): string | null => value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19) ? value : null;
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
  return {requestedId,status,fetchedAt,runStatus:null,startedAt:null,endedAt:null,sourceStatus:null,artifactBinding:'missing',reportStatus:null,progressStatus:null,scopes:[],comparability:'unavailable',clone:'unavailable'};
}

/** Exact child observations only. Never infer provenance or expose source paths. */
export function projectComparisonObservation(value: unknown, requestedId: string, fetchedAt: string): ComparisonObservation {
  if (!validId(requestedId) || !record(value) || !Array.isArray(value.runs) || value.runs.length > 100) return unavailable(requestedId,fetchedAt,'invalid');
  const exactRows = value.runs.filter(row => record(row) && row.runId === requestedId);
  if (exactRows.length > 1) return unavailable(requestedId,fetchedAt,'ambiguous');
  const detail = normalizeRunDetailView(value,requestedId);
  if (!detail) return unavailable(requestedId,fetchedAt,'invalid');
  if (!detail.run) return unavailable(requestedId,fetchedAt,'missing');
  if (detail.run.runId !== requestedId) return unavailable(requestedId,fetchedAt,'identity_mismatch');
  const status = member(detail.run.status,['running','completed','completed_with_failures','failed','skipped']);
  if (!status) return unavailable(requestedId,fetchedAt,'invalid');
  // A malformed exact source row cannot be replaced by a selected/active fallback.
  if (exactRows.some(row => !record(row) || row.status !== status)) return unavailable(requestedId,fetchedAt,'invalid');
  const evidence = buildRunEvidence(value.latestRunArtifacts,requestedId);
  const artifact = detail.artifacts;
  const readStatuses = ['ok','missing','corrupt','degraded','blocked','invalid'];
  return {
    requestedId,status:'available',fetchedAt,runStatus:status,
    startedAt:timestamp(detail.run.startedAt),endedAt:timestamp(status === 'running' ? null : status === 'failed' ? detail.run.failedAt : status === 'skipped' ? detail.run.skippedAt : detail.run.completedAt),
    sourceStatus:member(detail.endpointStatus,['ok','running','missing','blocked','degraded']),artifactBinding:evidence.source,
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
