import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import type { Dir } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, stat, link, symlink, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { createLocalOperationsServer } from "./localOperationsServer.js";
import { runHistoricalBatchReplay } from "../workflows/historicalBatchReplayWorkflow.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import type { MarketPacket } from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import {historicalReplayRunConfigurationSchema} from '../replay/historicalReplayAuditLog.js';
import {isStoredProvenanceTimestamp,validProvenanceId} from './replayProvenanceProjection.js';
import { readReplayProvenance, readReplayProvenanceRequest, provenanceReadBudgetMs, REPLAY_PROVENANCE_ROUTE, REPLAY_PROVENANCE_LIMITS } from "./replayProvenanceReader.js";
import { BATCH_REPLAY_MANIFEST_FILE_NAME as manifestName, BATCH_REPLAY_RUNS_FILE_NAME as runsName, HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME as metadataName, HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME as researchName } from "../storage/artifactPaths.js";
const hash=`sha256:${"1".repeat(64)}`;
test("requested ID keeps generic grammar and admits only canonical leading-hyphen writer children",()=>{
  for(const id of ['child','a.b-c_1','-synthetic_run_000000_2026-01','--_run_000001_2026-01','-_run_999999_2026-12','-a_b-_run_1000000_2026-01'])assert.equal(validProvenanceId(id),true,id);
  for(const id of ['-synthetic','--','-_run_1_2026-01','-_run_0000000_2026-01','-_run_000000_2026-00','-_run_000000_2026-13','-a._run_000000_2026-01','-_run_9007199254740992_2026-01','_child','../child','a/child','a%2Fchild','a?child','a#child','a'.repeat(257)])assert.equal(validProvenanceId(id),false,id);
  for(const character of [0,9,10,13,32,92,0x2028,0xD55C])for(const id of ['child','-synthetic_run_000000_2026-01'])assert.equal(validProvenanceId(id+String.fromCharCode(character)),false);
});
test("legacy completed activeRun omission is compatible but cannot hide an incomplete index",async()=>{
  const f=await fixture();const legacy={...f.batch} as Record<string,unknown>;delete legacy.activeRun;await writeFile(f.paths.manifest,JSON.stringify(legacy));
  assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
  const other=join(f.root,"batch-replay","legacy_other");await mkdir(other);await writeFile(join(other,manifestName),JSON.stringify({...legacy,batchId:"legacy_other"}));await writeFile(join(other,runsName),JSON.stringify({...f.run,batchId:"legacy_other",runId:"legacy_child",storageBaseDir:join(other,"runs","legacy_child")}));
  assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");assert.equal((await readReplayProvenance(f.storage,"legacy_child")).status,"partial");
  await writeFile(join(other,manifestName),JSON.stringify({...legacy,batchId:"legacy_other",status:"running",completedAt:null,completedCount:0,runCount:2}));
  assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");assert.equal((await readReplayProvenance(f.storage,"unindexed_legacy_active")).status,"missing");
  await writeFile(join(other,manifestName),JSON.stringify({...legacy,batchId:"legacy_other"}));
  await writeFile(join(other,runsName),"");assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
});
test("running active must match a terminal row or be exactly the next index of its prefix",async()=>{
  const f=await fixture();Object.assign(f.batch,{status:"running",completedAt:null,completedCount:0,runCount:4});await f.save();
  for(const terminalCount of [0,1,2]) {
    const rows=Array.from({length:terminalCount},(_,i)=>({...f.run,runId:i===0?"child":`terminal_${i}`,runIndex:i}));await writeFile(f.paths.runs,rows.map(row=>JSON.stringify(row)).join("\n"));
    for(const index of [terminalCount,terminalCount+1]) {
      Object.assign(f.batch,{activeRun:{...f.run,runId:"active_child",runIndex:index,storageBaseDir:join(f.batchDir,"runs","active_child")}});await writeFile(f.paths.manifest,JSON.stringify(f.batch));
      for(const id of ["active_child","child","absent"])assert.equal((await readReplayProvenance(f.storage,id)).status,index>terminalCount?"invalid":id==="active_child" || (id==="child"&&terminalCount>0)?"partial":"missing");
    }
  }
  await f.save();
  for(const change of [{runSeed:"contradictory_seed"},{startedAt:"2026-01-01T00:00:02.000Z"}]){Object.assign(f.batch,{activeRun:{...f.run,...change}});await writeFile(f.paths.manifest,JSON.stringify(f.batch));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");}
});
async function writerFixture(batchId:string,sharedRoot?:string) {
  const root=sharedRoot??await mkdtemp(join(tmpdir(),"provenance-writer-"));const storage=join(root,"paper"),source=join(root,"source"),outputBaseDir=join(root,"batch-replay");
  await mkdir(storage,{recursive:true});await mkdir(source,{recursive:true});let providers=0;
  const result=await runHistoricalBatchReplay({sourceDataDir:source,outputBaseDir,batchId,seed:"s".repeat(4097),runCount:2,rangeStart:new Date("2026-01-01T00:00:00+09:00"),rangeEnd:new Date("2026-01-31T23:59:59.999+09:00"),generatedAt:new Date("2026-02-01T00:00:00Z"),minWindowSnapshots:1,decisionProviderFactory:()=>{providers++;throw Error("provider must never run");}});
  const rows=(await readFile(result.runsPath,"utf8")).trim().split("\n").map(line=>JSON.parse(line) as Record<string,unknown>);const manifest=JSON.parse(await readFile(result.manifestPath,"utf8")) as Record<string,unknown>;
  assert.equal(providers,0);assert.equal(rows.length,2);assert.equal(dirname(result.outputDir),outputBaseDir);
  for(const row of rows){assert.equal(row.batchId,batchId.trim());assert.equal(row.status,"skipped");assert.equal(dirname(String(row.storageBaseDir)),join(result.outputDir,"runs"));}
  const writeIndex=async(values:unknown[])=>writeFile(result.runsPath,values.map(row=>JSON.stringify(row)).join("\n")+"\n");
  return {root,storage,result,rows,manifest,writeIndex};
}
test("actual writer child character boundary crosses exact HTTP query without widening unsafe identity",async()=>{
  const batchIds=["-synthetic","--","-","-a_b-","__synthetic__","synthetic.dot","../outside","foo"+String.fromCharCode(92)+"bar","foo%2Fbar","foo?bar#x",String.fromCharCode(0xD55C,0xAE00),"synthetic"+String.fromCharCode(0)+"suffix","synthetic"+String.fromCharCode(10)+"suffix"," !@#$%^&*()+=[]{}:;'<> ,?/~ "];
  for(const batchId of batchIds){
    const f=await writerFixture(batchId);let runnerCalls=0;
    const server=createLocalOperationsServer({storageBaseDir:f.storage,paperSimulationRunner:async()=>{runnerCalls++;throw Error("must not run");}});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    try{
      const base='http://127.0.0.1:'+String((server.address() as AddressInfo).port)+REPLAY_PROVENANCE_ROUTE;
      for(const row of f.rows){const id=String(row.runId),response=await fetch(base+'?'+new URLSearchParams({runId:id}));assert.equal(response.status,200,id);assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json() as {status:string;requestedRunId:string};assert.equal(result.status,'partial',id);assert.equal(result.requestedRunId,id);assert.ok(!JSON.stringify(result).includes(f.root));}
      const id=String(f.rows[0]!.runId);
      for(const query of [new URLSearchParams({runId:id+'/../escape'}),new URLSearchParams({runId:id+String.fromCharCode(92)+'escape'}),new URLSearchParams({runId:id+String.fromCharCode(10)}),new URLSearchParams({runId:id+'%2Fescape'}),new URLSearchParams({runId:id+String.fromCharCode(0)}),new URLSearchParams([['runId',id],['runId',id]])])assert.equal((await fetch(base+'?'+query)).status,400);
      for(const character of [10,13,0,92,47,37]){
        await f.writeIndex([f.rows[0],{...f.rows[1],runId:String(f.rows[1]!.runId)+String.fromCharCode(character)}]);
        const invalid=await fetch(base+'?'+new URLSearchParams({runId:id}));assert.equal(invalid.status,200);assert.equal((await invalid.json() as {status:string}).status,'invalid');
      }
      await f.writeIndex(f.rows);
      assert.equal(runnerCalls,0);
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  }
});

test("actual writer relationship matrix accepts raw IDs and rejects corrupt unrelated rows without path escape or disclosure",async()=>{
  for(const batchId of [" synthetic writer ","synthetic:writer / segment"," \uD55C\uAE00 \uC2E4\uD5D8 ","../synthetic:../outside"]) {
    const f=await writerFixture(batchId),first=f.rows[0]!,other=f.rows[1]!;
    for(const row of f.rows){const observed=await readReplayProvenance(f.storage,String(row.runId));assert.equal(observed.status,"partial");assert.equal(observed.requestedRunId,row.runId);assert.ok(!JSON.stringify(observed).includes(batchId.trim()));assert.ok(!JSON.stringify(observed).includes(f.root));assert.doesNotMatch(JSON.stringify(observed),/ssssssssss/);}
    assert.equal((await readReplayProvenance(f.storage,"unrelated_child")).status,"missing");
    const cases:Array<{rows:unknown[];status:string}>=[
      {rows:[first,{}],status:"invalid"},{rows:[first,{runId:"other"}],status:"invalid"},
      {rows:[first,{...other,batchId:"wrong_batch"}],status:"invalid"},{rows:[first,{...other,mode:"live"}],status:"invalid"},
      {rows:[first,{...other,runId:first.runId}],status:"ambiguous"},{rows:[first,{...other,runIndex:first.runIndex}],status:"ambiguous"},
      {rows:[first,{...other,runIndex:2}],status:"invalid"},{rows:[first],status:"invalid"},
      {rows:[first,{...other,storageBaseDir:join(f.root,"outside_missing")}],status:"blocked"},
      {rows:[first,{...other,storageBaseDir:join(f.result.outputDir,"runs")+sep+".."+sep+"escape"}],status:"blocked"}
    ];
    for(const item of cases){await f.writeIndex(item.rows);for(const requested of [String(first.runId),"unrelated_child"]){const observed=await readReplayProvenance(f.storage,requested);assert.equal(observed.status,item.status);assert.ok(Object.values(observed.fields).every(field=>field.status==="unavailable"));assert.ok(!JSON.stringify(observed).includes(f.root));}}
    await f.writeIndex(f.rows);const legacy={...f.manifest};delete legacy.activeRun;await writeFile(f.result.manifestPath,JSON.stringify(legacy));assert.equal((await readReplayProvenance(f.storage,String(other.runId))).status,"partial");
    await writeFile(f.result.manifestPath,JSON.stringify({...f.manifest,status:"running",completedAt:null,completedCount:0,skippedCount:0,failedCount:0}));assert.equal((await readReplayProvenance(f.storage,String(other.runId))).status,"partial");
    await writeFile(f.result.manifestPath,JSON.stringify({...f.manifest,skippedCount:1}));assert.equal((await readReplayProvenance(f.storage,String(first.runId))).status,"invalid");
    await f.writeIndex(f.rows.map(row=>({...row,batchId:"different:batch"})));await writeFile(f.result.manifestPath,JSON.stringify({...f.manifest,batchId:"different:batch"}));assert.equal((await readReplayProvenance(f.storage,String(first.runId))).status,"invalid");
  }
});
test("actual writer batches bind different children and reject a duplicate child across batches",async()=>{
  const first=await writerFixture("first:batch"),other=await writerFixture("other / batch",first.root);
  for(const row of [...first.rows,...other.rows])assert.equal((await readReplayProvenance(first.storage,String(row.runId))).status,"partial");
  await other.writeIndex([{...other.rows[0],runId:first.rows[0]!.runId},other.rows[1]]);
  const observed=await readReplayProvenance(first.storage,String(first.rows[0]!.runId));assert.equal(observed.status,"ambiguous");assert.ok(!JSON.stringify(observed).includes(first.root));
  const upper=await writerFixture("CASE / batch"),lower=await writerFixture("case:batch",upper.root);
  for(const row of lower.rows)assert.equal((await readReplayProvenance(lower.storage,String(row.runId))).status,"partial");
});
test("actual writer running, completed, completed-with-failures and failed contracts remain readable with synthetic providers",async()=>{
  for(const kind of ["completed","completed_with_failures","failed"] as const) {
    const root=await mkdtemp(join(tmpdir(),"provenance-terminal-")),storage=join(root,"paper"),source=join(root,"source");await mkdir(storage);await mkdir(source);
    const store=new FileHistoricalMarketSnapshotStore(createStoragePaths(source).historicalMarketSnapshotsPath);
    for(const day of [3,10]){const at=`2026-02-${String(day).padStart(2,"0")}T09:00:00+09:00`;await store.append({snapshotId:`synthetic_${day}`,market:"KR",symbol:"005930",observedAt:at,interval:"1d",lastPriceKrw:70_000,volume:100_000,sourceRefs:[`fixture:synthetic_${day}`],createdAt:at});}
    let activeReads=0;
    const result=await runHistoricalBatchReplay({sourceDataDir:source,outputBaseDir:join(root,"batch-replay"),batchId:`terminal ${kind}: / \uD55C`,seed:"synthetic_seed",runCount:1,rangeStart:new Date("2026-02-01T00:00:00+09:00"),rangeEnd:new Date("2026-02-28T23:59:59.999+09:00"),generatedAt:new Date("2026-03-01T00:00:00Z"),stepSeconds:604_800,maxDecisionCalls:1,maxSnapshotAgeSeconds:31*86400,minWindowSnapshots:1,decisionProviderFactory:context=>{
      if(kind==="failed")throw Error("synthetic_private_factory_failure");
      return {decide:async(packet:MarketPacket):Promise<CodexCliDecisionResult>=>{
        const active=await readReplayProvenance(storage,context.runId);assert.equal(active.status,"partial");assert.equal(active.requestedRunId,context.runId);activeReads++;
        if(kind==="completed_with_failures")return {attempted:true,decision:null,failure:{code:"AI_DECISION_FAILED",reason:"synthetic_private_provider_failure"},command:null};
        const dataRef=packet.candidates[0]?.sourceRefs[0]??"fixture:synthetic_3";
        return {attempted:true,failure:null,command:null,decision:{packetId:packet.packetId,summary:"Synthetic hold only",decisions:[{market:"KR",symbol:"005930",action:"VIRTUAL_HOLD",confidence:0.5,budgetKrw:0,thesis:"Synthetic hold only",riskFactors:["Synthetic fixture"],dataRefs:[dataRef],claimSupport:[{claim:"Synthetic hold only",dataRefs:[dataRef]}],expiresAt:packet.expiresAt}]}};
      }};
    }});
    const row=JSON.parse((await readFile(result.runsPath,"utf8")).trim()) as Record<string,unknown>;assert.equal(row.status,kind);assert.equal(activeReads,kind==="failed"?0:1);
    const observed=await readReplayProvenance(storage,String(row.runId));assert.equal(observed.status,"partial");assert.doesNotMatch(JSON.stringify(observed),/synthetic_private|provenance-terminal-/);
    const manifest=JSON.parse(await readFile(result.manifestPath,"utf8"));delete manifest.activeRun;await writeFile(result.manifestPath,JSON.stringify(manifest));assert.equal((await readReplayProvenance(storage,String(row.runId))).status,"partial");
  }
});
test("every row identity and terminal contract is validated before requested-ID filtering",async()=>{
  const changes:Record<string,unknown>[]=[{}, {runId:"other"}, {mode:"live"}, {batchId:"wrong"}, {runId:"../bad"}, {runId:42}, {runIndex:-1}, {runIndex:1.5}, {runIndex:2}, {runSeed:null}, {storageBaseDir:null}, {status:"running"}, {status:["completed"],completedAt:null}, {status:42}, {startedAt:"garbage"}, {completedAt:null}, {skippedAt:"2026-01-01T00:00:01.000Z"}];
  for(let i=0;i<changes.length;i++) {
    const f=await fixture();f.batch.runCount=2;f.batch.completedCount=2;await f.save();
    const other=i<2?changes[i]:{...f.run,runId:"other",runIndex:1,...changes[i]};
    for(const requested of ["child","absent"]) {
      await writeFile(f.paths.runs,JSON.stringify(f.run)+"\n"+JSON.stringify(other)+"\n");
      const result=await readReplayProvenance(f.storage,requested);assert.equal(result.status,"invalid",JSON.stringify(changes[i]));
      assert.ok(Object.values(result.fields).every(field=>field.status==="unavailable"));
    }
  }
});
test("completed manifests require complete distinct bounded indexes and exact terminal counts",async()=>{
  for(const change of [{runCount:2},{completedCount:0},{skippedCount:1},{failedCount:1},{runCount:0},{runCount:-1},{runCount:1.5},{status:"running",completedAt:"2026-01-01T00:00:01.000Z"},{status:"completed_with_failures"},{activeRun:{runId:"other"}}]) {
    const f=await fixture();Object.assign(f.batch,change);await f.save();assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid",JSON.stringify(change));
  }
  const f=await fixture();f.batch.runCount=3;f.batch.completedCount=3;await f.save();
  const rows=[f.run,{...f.run,runId:"second",runIndex:1},{...f.run,runId:"third",runIndex:2}];
  await writeFile(f.paths.runs,rows.map(row=>JSON.stringify(row)).join("\n")+"\n");assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
  for(const subset of [[],[rows[0]],[rows[0],rows[2]],[rows[1],rows[2]]]) {
    await writeFile(f.paths.runs,subset.map(row=>JSON.stringify(row)).join("\n"));assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
  }
  await writeFile(f.paths.runs,[rows[0],{...rows[1],runIndex:0},rows[2]].map(row=>JSON.stringify(row)).join("\n"));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");
});
test("running prefix, lagging counters, active-only and terminal-active overlap remain legitimate",async()=>{
  const f=await fixture();Object.assign(f.batch,{status:"running",completedAt:null,completedCount:0,runCount:3,activeRun:f.run});await f.save();
  await writeFile(f.paths.runs,"");assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
  await f.save();assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
  const skipped={...f.run,runId:"skipped",runIndex:1,status:"skipped",completedAt:null,skippedAt:"2026-01-01T00:00:01.000Z",storageBaseDir:join(f.batchDir,"runs","skipped")};
  await writeFile(f.paths.runs,[f.run,skipped].map(row=>JSON.stringify(row)).join("\n"));
  assert.equal((await readReplayProvenance(f.storage,"skipped")).status,"partial");
  assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
  f.batch.completedCount=2;await writeFile(f.paths.manifest,JSON.stringify(f.batch));assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
  f.batch.completedCount=0;await writeFile(f.paths.manifest,JSON.stringify(f.batch));
  await writeFile(f.paths.runs,JSON.stringify({...skipped,runIndex:2})+"\n");assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
  await f.save();Object.assign(f.batch,{activeRun:{...f.run,runId:"other",storageBaseDir:f.storage}});await writeFile(f.paths.manifest,JSON.stringify(f.batch));assert.equal((await readReplayProvenance(f.storage,"child")).status,"blocked");
  Object.assign(f.batch,{activeRun:{...f.run,runId:"other"}});await writeFile(f.paths.manifest,JSON.stringify(f.batch));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");
});
test("completed failure and skipped buckets are checked independently",async()=>{
  const f=await fixture();Object.assign(f.batch,{status:"completed_with_failures",runCount:3,completedCount:1,skippedCount:1,failedCount:1});await f.save();
  const rows=[{...f.run,status:"completed_with_failures"},{...f.run,runId:"skipped",runIndex:1,status:"skipped",completedAt:null,skippedAt:"2026-01-01T00:00:01.000Z"},{...f.run,runId:"failed",runIndex:2,status:"failed",completedAt:null,failedAt:"2026-01-01T00:00:01.000Z"}];
  await writeFile(f.paths.runs,rows.map(row=>JSON.stringify(row)).join("\r\n")+"\r\n");assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
  Object.assign(f.batch,{completedCount:2,failedCount:0});await writeFile(f.paths.manifest,JSON.stringify(f.batch));assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
});
test("directory opening beyond the deadline closes before any directory read",async t=>{
  const f=await fixture();let now=0,readCalls=0,closeCalls=0;
  const original=filesystem.opendir;
  t.mock.timers.enable({apis:["setTimeout"]});t.mock.method(performance,"now",()=>now);
  t.mock.method(filesystem,"opendir",async()=>{
    now=40;
    return {close:async()=>{closeCalls++;},read:async()=>{readCalls++;return null;}} as unknown as Dir;
  });syncBuiltinESMExports();t.after(()=>{filesystem.opendir=original;syncBuiltinESMExports();});
  const result=await readReplayProvenance(f.storage,"child","515");
  assert.equal(result.status,"limit");assert.equal(readCalls,0);assert.equal(closeCalls,1);
  assert.ok(Object.values(result.fields).every(field=>field.status==="unavailable"));
});
test("deadline reached while inspecting an entry prevents the next directory read and closes",async t=>{
  const f=await fixture();let now=0,readCalls=0,closeCalls=0;
  const original=filesystem.opendir;t.mock.timers.enable({apis:["setTimeout"]});t.mock.method(performance,"now",()=>now);
  t.mock.method(filesystem,"opendir",async()=>({
    close:async()=>{closeCalls++;},read:async()=>{readCalls++;return {name:"fixture_batch",isDirectory:()=>{now=40;return false;}};}
  } as unknown as Dir));syncBuiltinESMExports();t.after(()=>{filesystem.opendir=original;syncBuiltinESMExports();});
  assert.equal((await readReplayProvenance(f.storage,"child","515")).status,"limit");assert.equal(readCalls,1);assert.equal(closeCalls,1);
});
test("indexed skipped child with no artifact directory remains partial and cannot bypass path boundaries",async()=>{
  const f=await fixture();f.run.runId="skipped_child";f.run.status="skipped";f.run.completedAt=null;f.run.skippedAt="2026-01-01T00:00:01.000Z";f.batch.completedCount=0;f.batch.skippedCount=1;f.run.storageBaseDir=join(f.batchDir,"runs","skipped_child");await f.save();
  const result=await readReplayProvenance(f.storage,"skipped_child");assert.equal(result.status,"partial");assert.equal(result.requestedRunId,"skipped_child");
  assert.deepEqual(result.fields["configuration.initialCashKrw"],{status:"unavailable",reason:"missing",value:null});
  assert.deepEqual(result.fields["research.configHash"],{status:"unavailable",reason:"missing",value:null});
  assert.equal(result.fields["batch.seed"]?.status,"unavailable");assert.equal(result.fields["child.runSeed"]?.status,"unavailable");
  assert.equal((await readReplayProvenance(f.storage,"unknown_child")).status,"missing");
  f.run.storageBaseDir=join(f.root,"outside_missing");await f.save();assert.equal((await readReplayProvenance(f.storage,"skipped_child")).status,"blocked");
  f.run.storageBaseDir=join(f.batchDir,"runs","missing","..","skipped_child");
  // Preserve the raw traversal in the persisted record rather than normalizing it.
  f.run.storageBaseDir=join(f.batchDir,"runs")+"/missing/../skipped_child";await f.save();assert.equal((await readReplayProvenance(f.storage,"skipped_child")).status,"blocked");
});
async function fixture(parent=tmpdir()) {
  const root=await mkdtemp(join(parent,"provenance-fixture-")),storage=join(root,"paper"),batchDir=join(root,"batch-replay","fixture_batch"),childDir=join(batchDir,"runs","child");
  await mkdir(storage);await mkdir(childDir,{recursive:true});
  const batch={mode:"paper_only",batchId:"fixture_batch",status:"completed",seed:"synthetic_private_seed",startedAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:01.000Z",activeRun:null,runCount:1,completedCount:1,skippedCount:0,failedCount:0,completedAt:"2026-01-01T00:00:01.000Z" as string|null};
  const run={mode:"paper_only",batchId:"fixture_batch",runId:"child",runIndex:0,status:"completed",storageBaseDir:childDir,runSeed:"synthetic_private_seed:0",startedAt:"2026-01-01T00:00:00.000Z",completedAt:"2026-01-01T00:00:01.000Z" as string|null,skippedAt:null as string|null,failedAt:null as string|null};
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
  await writeFile(join(other,manifestName),JSON.stringify({...f.batch,batchId:"other_batch",status:"running",completedAt:null,completedCount:0}));
  await writeFile(join(other,runsName),"");Object.assign(f.batch,{status:"running",completedAt:null,completedCount:0,activeRun:f.run});await f.save();await writeFile(f.paths.runs,"");assert.equal((await readReplayProvenance(f.storage,"child")).status,"partial");
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
test("full index duplicates beyond row 100 are ambiguous and malformed exact duplicates invalid",async()=>{
  const f=await fixture();f.batch.runCount=101;f.batch.completedCount=101;await f.save();
  const rows=[f.run,...Array.from({length:99},(_,i)=>({...f.run,runId:`other_${i}`,runIndex:i+1})),{...f.run,runIndex:100}];await writeFile(f.paths.runs,rows.map(row=>JSON.stringify(row)).join("\n"));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");
  rows[100]={runId:"child",status:"malformed"} as typeof f.run;await writeFile(f.paths.runs,rows.map(row=>JSON.stringify(row)).join("\n"));assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
});
test("malformed index does not salvage an unproven unique child",async()=>{
  const f=await fixture();await writeFile(f.paths.runs,JSON.stringify(f.run)+"\n{malformed");assert.equal((await readReplayProvenance(f.storage,"child")).status,"invalid");
});
test("cross-batch duplicate exact child is ambiguous",async()=>{
  const f=await fixture(),other=join(f.root,"batch-replay","other_batch");await mkdir(other);await writeFile(join(other,manifestName),JSON.stringify({...f.batch,batchId:"other_batch"}));await writeFile(join(other,runsName),JSON.stringify({...f.run,batchId:"other_batch",storageBaseDir:join(other,"runs","child")}));assert.equal((await readReplayProvenance(f.storage,"child")).status,"ambiguous");
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
  for(let i=0;i<3;i++){const dir=join(f.root,"batch-replay",`padding_${i}`);await mkdir(dir);await writeFile(join(dir,manifestName),JSON.stringify({...f.batch,batchId:`padding_${i}`}));await writeFile(join(dir,runsName),JSON.stringify({...f.run,batchId:`padding_${i}`,runId:`other_${i}`,storageBaseDir:join(dir,"runs",`other_${i}`),padding:"x".repeat(3*1024*1024)}));}
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
