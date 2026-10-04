import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  BATCH_REPLAY_MANIFEST_FILE_NAME, BATCH_REPLAY_RUNS_FILE_NAME,
  HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME, HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME,
  createBatchReplayRootDirForStorage
} from "../storage/artifactPaths.js";
import { assertExperimentPath, assertExperimentPathSyntax, hasFsCode, PaperExperimentStorageError, readExperimentFile } from "../storage/paperExperimentFilesystem.js";
import { stableStringifyResearchInput } from "../replay/replayRunManifest.js";
import { emptyReplayProvenance, projectReplayProvenance, provenanceRecord, validProvenanceId, type ProvenanceReason, type ReplayProvenance } from "./replayProvenanceProjection.js";
import { LOCAL_OPERATIONS_GET_ONLY_API_ROUTES } from "./localOperationsSurface.js";

export const REPLAY_PROVENANCE_ROUTE = LOCAL_OPERATIONS_GET_ONLY_API_ROUTES[0];
export const REPLAY_PROVENANCE_LIMITS = Object.freeze({entries:256,manifestBytes:256*1024,indexBytes:4*1024*1024,lines:10_000,metadataBytes:512*1024,researchBytes:64*1024,totalBytes:8*1024*1024,deadlineMs:2_000});
class ReadFailure extends Error { constructor(readonly reason: ProvenanceReason) {super(reason);} }
const inside = (child:string,parent:string) => {const r=relative(resolve(parent),resolve(child));return r!=="" && !isAbsolute(r) && r!==".." && !r.startsWith(`..${sep}`);};
const code = (error:unknown): ProvenanceReason => error instanceof ReadFailure ? error.reason : hasFsCode(error,"ENOENT") ? "missing" : error instanceof PaperExperimentStorageError && error.code==="PATH_UNSAFE" ? "blocked" : "invalid";
interface Budget {bytes:number;deadline:number;stopped:boolean}
function check(budget:Budget) {if(budget.stopped || Date.now()>=budget.deadline) throw new ReadFailure("limit");}
async function readText(path:string,cap:number,budget:Budget):Promise<string|null> {
  check(budget);
  try {
    await assertExperimentPath(path);
    const stat=await lstat(path);
    if(!stat.isFile() || stat.nlink!==1) throw new ReadFailure("blocked");
    if(stat.size>cap || stat.size>REPLAY_PROVENANCE_LIMITS.totalBytes-budget.bytes) throw new ReadFailure("limit");
    const text=await readExperimentFile(path,Math.min(cap,REPLAY_PROVENANCE_LIMITS.totalBytes-budget.bytes));
    budget.bytes+=Buffer.byteLength(text,"utf8");check(budget);return text;
  } catch(error) {if(hasFsCode(error,"ENOENT")) return null;throw error;}
}
async function readObject(path:string,cap:number,budget:Budget):Promise<Record<string,unknown>|null> {
  const text=await readText(path,cap,budget);if(text===null) return null;
  const parsed:unknown=JSON.parse(text);if(!provenanceRecord(parsed)) throw new ReadFailure("invalid");return parsed;
}
interface Match {batch:Record<string,unknown>;run:Record<string,unknown>;batchDir:string;active:boolean}
async function scan(storageBaseDir:string,runId:string,budget:Budget):Promise<Match|null> {
  const root=createBatchReplayRootDirForStorage(storageBaseDir);
  try {await assertExperimentPath(root);} catch(error) {if(hasFsCode(error,"ENOENT")) return null;throw error;}
  const directory=await opendir(root);let entries=0;let match:Match|null=null;
  for await(const entry of directory) {
    check(budget);if(++entries>REPLAY_PROVENANCE_LIMITS.entries) throw new ReadFailure("limit");
    const batchDir=join(root,entry.name);await assertExperimentPath(batchDir);
    if(!entry.isDirectory()) continue;
    const batch=await readObject(join(batchDir,BATCH_REPLAY_MANIFEST_FILE_NAME),REPLAY_PROVENANCE_LIMITS.manifestBytes,budget);
    const text=await readText(join(batchDir,BATCH_REPLAY_RUNS_FILE_NAME),REPLAY_PROVENANCE_LIMITS.indexBytes,budget);
    if(batch===null) {if(text!==null) throw new ReadFailure("invalid");continue;}
    if(batch.mode!=="paper_only" || typeof batch.batchId!=="string" || batch.batchId.length===0 || batch.batchId.length>256) throw new ReadFailure("invalid");
    let child:Record<string,unknown>|null=null;
    const lines=text===null ? [] : text.split(/\r?\n/);
    if(lines.length>REPLAY_PROVENANCE_LIMITS.lines+1) throw new ReadFailure("limit");
    for(const line of lines) {
      check(budget);if(!line.trim()) continue;
      const raw:unknown=JSON.parse(line);
      if(!provenanceRecord(raw)) throw new ReadFailure("invalid");
      if(raw.runId!==runId) continue;
      if(child!==null) throw new ReadFailure("ambiguous");
      child=raw;
    }
    const active=provenanceRecord(batch.activeRun) && batch.activeRun.runId===runId ? batch.activeRun : null;
    if(child && active && (active.runIndex!==child.runIndex || active.storageBaseDir!==child.storageBaseDir)) throw new ReadFailure("ambiguous");
    const run=child ?? active;if(!run) continue;
    if(match!==null) throw new ReadFailure("ambiguous");
    if((run.mode!==undefined && run.mode!=="paper_only") || (child ? run.batchId!==batch.batchId : (run.batchId!==undefined && run.batchId!==batch.batchId) || batch.status!=="running") || !Number.isSafeInteger(run.runIndex) || Number(run.runIndex)<0) throw new ReadFailure("invalid");
    match={batch,run,batchDir,active:child===null};
  }
  return match;
}
async function boundRunDir(match:Match):Promise<string> {
  const path=match.run.storageBaseDir;
  if(typeof path!=="string" || path.length>4096 || !isAbsolute(path)) throw new ReadFailure("blocked");
  assertExperimentPathSyntax(path);
  const runsDir=join(match.batchDir,"runs");
  if(!inside(path,runsDir)) throw new ReadFailure("blocked");
  await assertExperimentPath(path);
  if(!(await lstat(path)).isDirectory() || !inside(await realpath(path),await realpath(runsDir))) throw new ReadFailure("blocked");
  return path;
}
function metadataBound(raw:Record<string,unknown>,match:Match,runId:string):boolean {
  const id=raw.identity;return raw.mode==="paper_only" && provenanceRecord(id) && id.runId===runId && id.batchId===match.batch.batchId && id.runIndex===match.run.runIndex;
}
function researchBound(raw:Record<string,unknown>,match:Match,runId:string):boolean {
  return raw.mode==="paper_only" && raw.manifestVersion==="replay_research_manifest.v1" && raw.runId===runId && raw.batchId===match.batch.batchId;
}
async function readBound(storageBaseDir:string,runId:string,budget:Budget):Promise<ReplayProvenance> {
  const match=await scan(storageBaseDir,runId,budget);
  if(!match) return emptyReplayProvenance(runId,"missing","missing");
  const dir=await boundRunDir(match);check(budget);
  let metadata:Record<string,unknown>|null=null;let metadataReason:ProvenanceReason="missing";
  try {
    metadata=await readObject(join(dir,HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME),REPLAY_PROVENANCE_LIMITS.metadataBytes,budget);
    if(metadata && !metadataBound(metadata,match,runId)) return emptyReplayProvenance(runId,"invalid","identity_mismatch");
  } catch(error) {metadataReason=code(error);if(metadataReason==="limit") throw error;}
  let research:Record<string,unknown>|null=null;let researchReason:ProvenanceReason="missing";
  let researchSource:"research_manifest"|"run_metadata"="research_manifest";
  try {
    research=await readObject(join(dir,HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME),REPLAY_PROVENANCE_LIMITS.researchBytes,budget);
    const embedded=metadata?.researchManifest;
    if(research===null && provenanceRecord(embedded)) {research=embedded;researchSource="run_metadata";}
    if(research && (!researchBound(research,match,runId) || (embedded!==undefined && (!provenanceRecord(embedded) || !researchBound(embedded,match,runId) || stableStringifyResearchInput(embedded)!==stableStringifyResearchInput(research))))) {
      research=null;researchReason="identity_mismatch";
    }
  } catch(error) {research=null;researchReason=code(error);if(researchReason==="limit") throw error;}
  check(budget);
  return projectReplayProvenance({runId,batch:match.batch,run:match.run,metadata,metadataReason,research,researchReason,researchSource});
}
export async function readReplayProvenance(storageBaseDir:string,runId:string):Promise<ReplayProvenance> {
  if(!validProvenanceId(runId)) return emptyReplayProvenance(null,"invalid","invalid");
  const budget:Budget={bytes:0,deadline:Date.now()+REPLAY_PROVENANCE_LIMITS.deadlineMs,stopped:false};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const bounded=new Promise<ReplayProvenance>(resolve=>{timer=setTimeout(()=>{budget.stopped=true;resolve(emptyReplayProvenance(runId,"limit","limit"));},REPLAY_PROVENANCE_LIMITS.deadlineMs);});
  try {
    return await Promise.race([readBound(storageBaseDir,runId,budget).catch(error=>{const reason=code(error);return emptyReplayProvenance(runId,reason==="identity_mismatch" ? "invalid" : reason==="blocked" || reason==="limit" || reason==="ambiguous" || reason==="missing" ? reason : "invalid",reason);}),bounded]);
  } finally {budget.stopped=true;if(timer) clearTimeout(timer);}
}
export async function readReplayProvenanceRequest(url:URL,storageBaseDir:string):Promise<{statusCode:number;payload:ReplayProvenance}> {
  const ids=url.searchParams.getAll("runId");
  if(ids.length!==1 || !validProvenanceId(ids[0]) || [...url.searchParams.keys()].some(key=>key!=="runId")) return {statusCode:400,payload:emptyReplayProvenance(null,"invalid","invalid")};
  return {statusCode:200,payload:await readReplayProvenance(storageBaseDir,ids[0])};
}
