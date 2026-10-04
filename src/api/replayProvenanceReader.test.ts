import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, writeFile, readFile, stat, link, symlink, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { AddressInfo } from "node:net";
import { createLocalOperationsServer } from "./localOperationsServer.js";
import {historicalReplayRunConfigurationSchema} from '../replay/historicalReplayAuditLog.js';
import {isStoredProvenanceTimestamp} from './replayProvenanceProjection.js';
import { readReplayProvenance, readReplayProvenanceRequest, provenanceReadBudgetMs, REPLAY_PROVENANCE_ROUTE, REPLAY_PROVENANCE_LIMITS } from "./replayProvenanceReader.js";
import { BATCH_REPLAY_MANIFEST_FILE_NAME as manifestName, BATCH_REPLAY_RUNS_FILE_NAME as runsName, HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME as metadataName, HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME as researchName } from "../storage/artifactPaths.js";
const hash=`sha256:${"1".repeat(64)}`;
async function fixture(parent=tmpdir()) {
  const root=await mkdtemp(join(parent,"provenance-fixture-")),storage=join(root,"paper"),batchDir=join(root,"batch-replay","fixture_batch"),childDir=join(batchDir,"runs","child");
  await mkdir(storage);await mkdir(childDir,{recursive:true});
  const batch={mode:"paper_only",batchId:"fixture_batch",status:"completed",seed:"synthetic_private_seed",activeRun:null};
  const run={mode:"paper_only",batchId:"fixture_batch",runId:"child",runIndex:0,status:"completed",storageBaseDir:childDir,runSeed:"synthetic_private_seed:0"};
  const research={mode:"paper_only",manifestVersion:"replay_research_manifest.v1",runId:"child",batchId:"fixture_batch",configHash:hash,dataSnapshotHash:hash,universeHash:hash,coverageHash:hash,promptHash:hash,schemaHash:hash,riskPolicyHash:hash,costModelHash:hash,executionModelVersion:"execution_simulator.v4"};
  const metadata={mode:"paper_only",identity:{runId:"child",batchId:"fixture_batch",runIndex:0},window:{source:"explicit",startAt:"2026-01-01T00:00:00.000Z",endAt:"2026-02-01T00:00:00.000Z",timezoneOffsetMinutes:540,seed:"synthetic_private_seed"},configuration:{initialCashKrw:0,clock:{stepSeconds:60,speedMultiplier:10},samplingPolicy:null,executionPolicy:{slippageBps:2},riskProfile:"balanced",strategyPreset:"synthetic_private_preset"},researchManifest:research};
  const paths={manifest:join(batchDir,manifestName),runs:join(batchDir,runsName),metadata:join(childDir,metadataName),research:join(childDir,researchName)};
  const save=async()=>{await Promise.all([writeFile(paths.manifest,JSON.stringify(batch)),writeFile(paths.runs,JSON.stringify(run)+"\n"),writeFile(paths.metadata,JSON.stringify(metadata)),writeFile(paths.research,JSON.stringify(research))]);};
  await save();return {root,storage,batchDir,childDir,batch,run,metadata,research,paths,save};
}
test("contained project-relative CLI run paths preserve identity and reject traversal or another batch",async()=>{
  const parent=join(process.cwd(),"data");await mkdir(parent,{recursive:true});
  const f=await fixture(parent);f.run.storageBaseDir=relative(process.cwd(),f.childDir);await f.save();
  const result=await readReplayProvenance(f.storage,"child");assert.equal(result.status,"partial");assert.equal(result.fields["configuration.initialCashKrw"]?.value,0);
  assert.doesNotMatch(JSON.stringify(result),/storageBaseDir|provenance-fixture-/);
  for(const path of [relative(process.cwd(),f.storage),"../outside","data/nonexistent/runs/child"]){f.run.storageBaseDir=path;await f.save();assert.equal((await readReplayProvenance(f.storage,"child")).status,"blocked");}
  f.run.storageBaseDir=relative(process.cwd(),f.childDir);f.metadata.identity.runId="other";await f.save();assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
});
test("missing established batch indexes cannot prove uniqueness, while explicit empty active indexes remain valid",async()=>{
  const f=await fixture();await unlink(f.paths.runs);assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
  await f.save();const other=join(f.root,"batch-replay","other_batch");await mkdir(other);await writeFile(join(other,manifestName),JSON.stringify({...f.batch,batchId:"other_batch"}));
  for(const id of ["child","absent"]){const result=await readReplayProvenance(f.storage,id);assert.equal(result.status,"invalid");assert.doesNotMatch(JSON.stringify(result),/other_batch|provenance-fixture-/);}
  await writeFile(join(other,runsName),"");Object.assign(f.batch,{status:"running",activeRun:f.run});await f.save();await writeFile(f.paths.runs,"");assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
});
test("stored scalar/hash observations remain partial, absent defaults are not fabricated and free text stays redacted",async()=>{
  const f=await fixture(),result=await readReplayProvenance(f.storage,"child");
  assert.equal(result.status,"partial");assert.deepEqual(result.fields["configuration.initialCashKrw"],{status:"recorded",source:"run_metadata",verification:"stored_observation",value:0});
  assert.equal(result.fields["configuration.clock.stepSeconds"]?.value,60);
  assert.deepEqual(result.fields["configuration.executionPolicy.halfSpreadBps"],{status:"unavailable",reason:"not_present",value:null});
  assert.equal(result.fields["research.configHash"]?.value,hash);assert.equal(result.comparability,"unavailable");assert.equal(result.clone,"unavailable");
  for(const key of ["requestedConfig","effectiveConfig","notices","runtime.gitRevision","runtime.dependencyLockHash","runtime.nodeVersion"]) assert.deepEqual(result.fields[key],{status:"unavailable",reason:"not_persisted",value:null});
  assert.doesNotMatch(JSON.stringify(result),/synthetic_private|storageBaseDir|sourceDataDir|manifestPath|logPaths|warnings/);
});
test("GET validation rejects malformed and duplicate identity before storage lookup",async()=>{
  for(const query of ["","runId=child&runId=child","runId=..%2Fchild","runId=%00child","runId="+"x".repeat(257),"runId=child&path=anything"]){
    const result=await readReplayProvenanceRequest(new URL(REPLAY_PROVENANCE_ROUTE+"?"+query,"http://fixture"),"not-a-real-directory");assert.equal(result.statusCode,400);assert.equal(result.payload.requestedRunId,null);
  }
});
test("exact lookup never accepts a batch alias or another child",async()=>{
  const f=await fixture();assert.equal((await readReplayProvenance(f.storage,"fixture_batch")).status,"missing");assert.equal((await readReplayProvenance(f.storage,"other_child")).status,"missing");
});
test("metadata wrong child, batch or index suppresses all child observations",async()=>{
  for(const change of [{runId:"other_child"},{batchId:"other_batch"},{runIndex:1}]){
    const f=await fixture();Object.assign(f.metadata.identity,change);await f.save();const result=await readReplayProvenance(f.storage,"child");assert.equal(result.status,"invalid");assert.deepEqual(result.fields["configuration.initialCashKrw"],{status:"unavailable",reason:"identity_mismatch",value:null});
  }
});
test("research wrong-child or contradictory embedded hashes cannot contaminate bound configuration",async()=>{
  const f=await fixture();await writeFile(f.paths.research,JSON.stringify({...f.research,runId:"other_child"}));let result=await readReplayProvenance(f.storage,"child");assert.equal(result.fields["configuration.initialCashKrw"]?.status,"recorded");assert.equal(result.fields["research.configHash"]?.status,"unavailable");
  await writeFile(f.paths.research,JSON.stringify({...f.research,configHash:`sha256:${"2".repeat(64)}`}));result=await readReplayProvenance(f.storage,"child");assert.deepEqual(result.fields["research.configHash"],{status:"unavailable",reason:"identity_mismatch",value:null});
});
test("partial invalid fields do not become defaults or erase independent valid fields",async()=>{
  const f=await fixture();await writeFile(f.paths.metadata,JSON.stringify({...f.metadata,configuration:{initialCashKrw:-1,clock:{stepSeconds:60},riskPolicy:{minCashReserveRatio:2},executionPolicy:{halfSpreadBps:0}}}));
  const result=await readReplayProvenance(f.storage,"child");assert.equal(result.fields["configuration.initialCashKrw"]?.status,"unavailable");assert.equal(result.fields["configuration.riskPolicy.minCashReserveRatio"]?.status,"unavailable");assert.equal(result.fields["configuration.clock.stepSeconds"]?.value,60);assert.equal(result.fields["configuration.executionPolicy.halfSpreadBps"]?.value,0);
});
test("projected enum collections remain bounded rather than forwarding arbitrary repeated input",async()=>{
  const f=await fixture();await writeFile(f.paths.metadata,JSON.stringify({...f.metadata,configuration:{constraints:{allowedActions:Array.from({length:17},()=>"VIRTUAL_BUY")}}}));const result=await readReplayProvenance(f.storage,"child");assert.deepEqual(result.fields["configuration.constraints.allowedActions"],{status:"unavailable",reason:"invalid",value:null});
});
test('raw collection limit rejects before Zod parses any array member',async t=>{
  const f=await fixture();let parses=0;t.mock.method(historicalReplayRunConfigurationSchema.shape.constraints.shape.allowedActions,'safeParse',()=>{parses++;throw Error('must reject raw oversized input first');});
  await writeFile(f.paths.metadata,JSON.stringify({...f.metadata,configuration:{constraints:{allowedActions:Array.from({length:17},()=>0)}}}));const result=await readReplayProvenance(f.storage,'child');assert.equal(parses,0);assert.equal(result.fields['configuration.constraints.allowedActions']?.status,'unavailable');
});
test('reader timestamp grammar rejects Date.parse free text and calendar overflow without normalization',()=>{
  for(const value of ['2026-01-01 (/home/synthetic_private/token.txt)','2026-01-01T00:00:00Z (SYNTHETIC_SECRET)','2026-02-31T00:00:00Z','2026-01-01','2026-01-01T24:00:00Z','2026-01-01T00:00:60Z'])assert.equal(isStoredProvenanceTimestamp(value),false);
  for(const value of ['2026-01-01T00:00:00.000Z','2024-02-29T00:00:00+09:00'])assert.equal(isStoredProvenanceTimestamp(value),true);
});
test('all six projected dates reject private free text in actual HTTP responses',async t=>{
  const f=await fixture(),server=createLocalOperationsServer({storageBaseDir:f.storage});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const endpoint=`http://127.0.0.1:${(server.address() as AddressInfo).port}${REPLAY_PROVENANCE_ROUTE}?runId=child`;
  for(const path of ['window.startAt','window.endAt','window.rangeStart','window.rangeEnd','configuration.clock.startAt','configuration.clock.endAt']){
    const raw=JSON.parse(JSON.stringify(f.metadata)) as Record<string,unknown>;const parts=path.split('.');let parent=raw;for(const part of parts.slice(0,-1))parent=parent[part] as Record<string,unknown>;parent[parts.at(-1)!]='2026-01-01 (/home/synthetic_private/token.txt)';
    await writeFile(f.paths.metadata,JSON.stringify(raw));const response=await fetch(endpoint);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.text();assert.doesNotMatch(body,/synthetic_private|token\.txt/);const result=JSON.parse(body) as {fields:Record<string,unknown>};assert.deepEqual(result.fields[path],{status:'unavailable',reason:'invalid',value:null});
  }
});
test("malformed metadata is per-field unavailable and does not disclose parser body",async()=>{
  const f=await fixture();await writeFile(f.paths.metadata,"{synthetic_secret_invalid");const result=await readReplayProvenance(f.storage,"child");assert.equal(result.fields["configuration.initialCashKrw"]?.status,"unavailable");assert.equal(result.fields["research.configHash"]?.value,hash);assert.doesNotMatch(JSON.stringify(result),/synthetic_secret_invalid/);
});
test("missing metadata and research leave fields missing rather than restoring original input",async()=>{
  const f=await fixture();f.run.storageBaseDir=join(f.batchDir,"runs","empty_child");await mkdir(f.run.storageBaseDir);await f.save();const result=await readReplayProvenance(f.storage,"child");assert.equal(result.status,"partial");assert.deepEqual(result.fields["configuration.initialCashKrw"],{status:"unavailable",reason:"missing",value:null});assert.equal(result.fields["research.configHash"]?.status,"unavailable");
});
test("full index duplicates beyond row 100 and malformed exact duplicates are ambiguous",async()=>{
  const f=await fixture(),rows=[f.run,...Array.from({length:99},(_,i)=>({...f.run,runId:`other_${i}`})),{runId:"child",status:"malformed"}];await writeFile(f.paths.runs,rows.map(row=>JSON.stringify(row)).join("\n"));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");
});
test("malformed index does not salvage an unproven unique child",async()=>{
  const f=await fixture();await writeFile(f.paths.runs,JSON.stringify(f.run)+"\n{malformed");assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
});
test("cross-batch duplicate exact child is ambiguous",async()=>{
  const f=await fixture(),other=join(f.root,"batch-replay","other_batch");await mkdir(other);await writeFile(join(other,manifestName),JSON.stringify({...f.batch,batchId:"other_batch"}));await writeFile(join(other,runsName),JSON.stringify({...f.run,batchId:"other_batch"}));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");
});
test("outside-root and other-batch run storage paths are blocked without exposing path",async()=>{
  const f=await fixture();f.run.storageBaseDir=f.storage;await f.save();const result=await readReplayProvenance(f.storage,"child");assert.equal(result.status,"blocked");assert.ok(!JSON.stringify(result).includes(f.root));
});
test("metadata hardlink and run-directory junction/symlink are rejected",async()=>{
  const f=await fixture(),hard=join(f.childDir,"linked-metadata.json");await link(f.paths.metadata,hard);let result=await readReplayProvenance(f.storage,"child");assert.deepEqual(result.fields["configuration.initialCashKrw"],{status:"unavailable",reason:"blocked",value:null});
  const alias=join(f.batchDir,"runs","alias");await symlink(f.childDir,alias,process.platform==="win32"?"junction":"dir");f.run.storageBaseDir=alias;await f.save();result=await readReplayProvenance(f.storage,"child");assert.equal(result.status,"blocked");
});
test("metadata bytes and index line limits return limit instead of partial data",async()=>{
  const f=await fixture();await writeFile(f.paths.metadata," ".repeat(REPLAY_PROVENANCE_LIMITS.metadataBytes+1));assert.equal((await readReplayProvenance(f.storage,"child")).status,"limit");
  await f.save();await writeFile(f.paths.runs,Array.from({length:REPLAY_PROVENANCE_LIMITS.lines+2},()=>"{}").join("\n"));assert.equal((await readReplayProvenance(f.storage,"child")).status,"limit");
});
test("valid reads leave synthetic fixture bytes, mtime and entries unchanged",async()=>{
  const f=await fixture();const paths=Object.values(f.paths);const before=await Promise.all(paths.map(async path=>({text:await readFile(path,"utf8"),mtime:(await stat(path)).mtimeMs})));const entries=await readdir(f.childDir);
  await readReplayProvenance(f.storage,"child");assert.deepEqual(await Promise.all(paths.map(async path=>({text:await readFile(path,"utf8"),mtime:(await stat(path)).mtimeMs}))),before);assert.deepEqual(await readdir(f.childDir),entries);
});
test("directory-entry, individual index bytes and cumulative byte budgets fail closed",async()=>{
  const f=await fixture();await writeFile(f.paths.runs," ".repeat(REPLAY_PROVENANCE_LIMITS.indexBytes+1));assert.equal((await readReplayProvenance(f.storage,"child")).status,"limit");await f.save();
  const padded=JSON.stringify({runId:"other",padding:"x".repeat(3*1024*1024)});
  for(let i=0;i<3;i++){const dir=join(f.root,"batch-replay",`padding_${i}`);await mkdir(dir);await writeFile(join(dir,manifestName),JSON.stringify({...f.batch,batchId:`padding_${i}`}));await writeFile(join(dir,runsName),padded);}
  assert.equal((await readReplayProvenance(f.storage,"child")).status,"limit");
  const empty=await fixture();await Promise.all(Array.from({length:REPLAY_PROVENANCE_LIMITS.entries},(_,i)=>mkdir(join(empty.root,"batch-replay",`empty_${i}`))));assert.equal((await readReplayProvenance(empty.storage,"child")).status,"limit");
});
test("deadline check stops further observation rather than extending the timeout",async t=>{
  const f=await fixture();let elapsed=0;t.mock.method(performance,"now",()=>{elapsed+=1_001;return elapsed;});assert.equal((await readReplayProvenance(f.storage,"child")).status,"limit");
});
test("exact monotonic deadline returns only limit with serialization reserve",async t=>{
  const f=await fixture();let now=0;let calls=0;
  t.mock.method(performance,"now",()=>{calls++;return calls===1?0:(now=1_500);});
  const result=await readReplayProvenance(f.storage,"child");
  assert.equal(result.status,"limit");assert.equal(now,REPLAY_PROVENANCE_LIMITS.deadlineMs);
  assert.equal(REPLAY_PROVENANCE_LIMITS.transportMs-now,REPLAY_PROVENANCE_LIMITS.responseReserveMs);
  assert.ok(Object.values(result.fields).every(field=>field.status==="unavailable"));
});
test("caller remaining budget can shorten but never extend reads",async()=>{
  for(const [header,expected] of [[undefined,1500],["2000",1500],["1800",1300],["500",0],["0",0],["2001",1500],["-1",1500],["1.5",1500],["0999",1500],[["1800"],1500]] as const)assert.equal(provenanceReadBudgetMs(header),expected);
  const f=await fixture();assert.equal((await readReplayProvenanceRequest(new URL("http://localhost/batch/replay/runs/provenance?runId=child"),f.storage,"0")).payload.status,"limit");
});
test("unsafe identity, invalid UTF8 and untrusted error strings never escape field contract",async()=>{
  const f=await fixture();await writeFile(f.paths.metadata,Buffer.from([0xff]));let result=await readReplayProvenance(f.storage,"child");assert.equal(result.fields["configuration.initialCashKrw"]?.status,"unavailable");
  await writeFile(f.paths.research,"{synthetic_private_token");result=await readReplayProvenance(f.storage,"child");assert.equal(result.fields["research.configHash"]?.status,"unavailable");assert.ok(!JSON.stringify(result).includes(f.root));assert.doesNotMatch(JSON.stringify(result),/synthetic_private_token/);
});
test("HTTP route is GET-only, no-store, rejects missing ID and never invokes runner",async t=>{
  const f=await fixture();let runs=0;const server=createLocalOperationsServer({storageBaseDir:f.storage,paperSimulationRunner:async()=>{runs++;throw Error("must not run");}});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}${REPLAY_PROVENANCE_ROUTE}`;
  for(const method of ["HEAD","POST","PUT","DELETE"]) {const response=await fetch(base+"?runId=child",{method});assert.equal(response.status,405);assert.equal(response.headers.get("cache-control"),"no-store");}
  assert.equal((await fetch(base)).status,400);const response=await fetch(base+"?runId=child");assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal((await response.json() as {status:string}).status,"partial");assert.equal(runs,0);
  const exhausted=await fetch(base+"?runId=child",{headers:{"x-provenance-budget-ms":"0"}});assert.equal(exhausted.status,200);assert.equal((await exhausted.json() as {status:string}).status,"limit");assert.equal(runs,0);
});
