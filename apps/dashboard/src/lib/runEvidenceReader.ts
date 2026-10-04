import { normalizeRunDetailView, readOperationsApiConfig, type RunDetailPageData } from './dashboardViewModels';
import { buildRunEvidence, type RunEvidenceView } from './runEvidence';
export type RunWorkspacePageData = RunDetailPageData & { evidence?: RunEvidenceView };

/** One bounded no-store read: detail and evidence share the exact selected child. */
export async function readRunWorkspacePageData(runId: string): Promise<RunWorkspacePageData> {
  const config=readOperationsApiConfig(), fetchedAt=new Date().toISOString();
  const endpoint=`/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=${encodeURIComponent(runId)}`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2_000);
  const unavailable=(status:'offline'|'invalid',message:string):RunWorkspacePageData=>({apiBaseLabel:config.label,fetchedAt,runDetail:{status,endpoint,fetchedAt,data:null,message},evidence:buildRunEvidence(null,null)});
  try {
    const response=await fetch(`${config.baseUrl}${endpoint}`,{method:'GET',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok)return unavailable('offline',`Local Operations API returned HTTP ${response.status}`);
    const value:unknown=await response.json();const detail=normalizeRunDetailView(value,runId);
    if(!detail)return unavailable('invalid','Run detail response did not match the dashboard contract');
    const raw=value as Record<string,unknown>;
    return {apiBaseLabel:config.label,fetchedAt,runDetail:{status:'ok',endpoint,fetchedAt,data:detail},evidence:buildRunEvidence(raw.latestRunArtifacts,detail.run?.runId??null)};
  }catch{return unavailable('offline','Read-only observation is unavailable');}
  finally{clearTimeout(timeout);}
}
