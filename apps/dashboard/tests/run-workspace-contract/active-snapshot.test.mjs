import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {runHistoricalBatchReplay} from '../../../../dist/workflows/historicalBatchReplayWorkflow.js';
import {createLocalOperationsServer} from '../../../../dist/api/localOperationsServer.js';
const load=async name=>import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(await readFile(new URL('../../src/lib/'+name+'.ts',import.meta.url),'utf8'))));
const {readRunDetailPageData}=await load('dashboardViewModels');
const {isRunSnapshot,runWorkspaceState}=await load('runWorkspace');
test('actual batch writer and HTTP reader preserve legacy active identity without promoting execution',async t=>{
  const saved=Object.fromEntries(['DASHBOARD_OPS_API_BASE_URL','OPS_API_BASE_URL'].map(k=>[k,process.env[k]]));t.after(()=>{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const root=await mkdtemp(join(tmpdir(),'ux04-active-contract-')),storage=join(root,'paper'),source=join(root,'source');await mkdir(storage);await mkdir(source);
  let providers=0,runnerCalls=0;
  const written=await runHistoricalBatchReplay({sourceDataDir:source,outputBaseDir:join(root,'batch-replay'),batchId:'fixture_active_contract',seed:'synthetic_only',runCount:2,rangeStart:new Date('2026-01-01T00:00:00+09:00'),rangeEnd:new Date('2026-01-31T23:59:59.999+09:00'),generatedAt:new Date('2026-02-01T00:00:00Z'),minWindowSnapshots:1,decisionProviderFactory:()=>{providers++;throw Error('provider prohibited');}});
  const manifest=JSON.parse(await readFile(written.manifestPath,'utf8')),rows=(await readFile(written.runsPath,'utf8')).trim().split('\n').map(JSON.parse),child=rows[0];assert.equal(providers,0);
  const server=createLocalOperationsServer({storageBaseDir:storage,paperSimulationRunner:async()=>{runnerCalls++;throw Error('runner prohibited');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    process.env.DASHBOARD_OPS_API_BASE_URL='http://127.0.0.1:'+server.address().port;delete process.env.OPS_API_BASE_URL;
    const terminal=await readRunDetailPageData(child.runId);assert.equal(terminal.runDetail.data.run.status,'skipped');assert.equal(isRunSnapshot(terminal,child.runId),true);assert.equal(runWorkspaceState(terminal.runDetail).poll,false);
    const active={runId:child.runId,runIndex:child.runIndex,runSeed:child.runSeed,startedAt:child.startedAt,storageBaseDir:child.storageBaseDir,window:child.window,marketRegime:child.marketRegime};
    await writeFile(written.runsPath,JSON.stringify(rows[1])+'\n');
    for(const batchStatus of [null,'unknown']){
      await writeFile(written.manifestPath,JSON.stringify({...manifest,status:batchStatus,activeRun:active}));
      const page=await readRunDetailPageData(child.runId);assert.equal(page.runDetail.status,'ok');assert.equal(page.runDetail.data.run.status,'active');assert.equal(page.runDetail.data.runId,child.runId);assert.equal(isRunSnapshot(page,child.runId),true);assert.equal(runWorkspaceState(page.runDetail).poll,false);assert.equal(runWorkspaceState(page.runDetail).completeness,'partial');
      assert.equal(isRunSnapshot(page,'other_child'),false);
      for(const id of ['', 'other_child']){const damaged=structuredClone(page);damaged.runDetail.data.artifacts=null;damaged.runDetail.data.run.runId=id;damaged.runDetail.data.runId=id;assert.equal(isRunSnapshot(damaged,child.runId),false);}
    }
    await mkdir(child.storageBaseDir,{recursive:true});await writeFile(join(child.storageBaseDir,'historical-replay-progress.json'),JSON.stringify({status:'running',completedTickCount:1,tickCount:3,currentPortfolio:{virtualNetWorthKrw:100,cashKrw:100,positionCount:0}}));
    const partial=await readRunDetailPageData(child.runId);assert.equal(partial.runDetail.data.artifacts.progressStatus,'ok');assert.equal(partial.runDetail.data.run.status,'active');assert.equal(isRunSnapshot(partial,child.runId),true);assert.equal(runWorkspaceState(partial.runDetail).poll,false);
    for(const name of ['decisions','risk-decisions','trades'])await writeFile(join(child.storageBaseDir,'historical-replay-'+name+'.jsonl'),'');await writeFile(join(child.storageBaseDir,'historical-replay-report.json'),JSON.stringify({title:'synthetic report'}));
    const complete=await readRunDetailPageData(child.runId);assert.equal(runWorkspaceState(complete.runDetail).completeness,'complete');assert.equal(isRunSnapshot(complete,child.runId),true);assert.equal(complete.runDetail.data.run.status,'active');
    await writeFile(written.manifestPath,JSON.stringify({...manifest,status:'running',activeRun:active}));const running=await readRunDetailPageData(child.runId);assert.equal(running.runDetail.data.run.status,'running');assert.equal(runWorkspaceState(running.runDetail).poll,true);assert.equal(isRunSnapshot(running,child.runId),true);
    for(const activeRun of [null,{...active,runId:'other_child'},Object.fromEntries(Object.entries(active).filter(([key])=>key!=='runId'))]){
      await writeFile(written.manifestPath,JSON.stringify({...manifest,status:'unknown',activeRun}));const absent=await readRunDetailPageData(child.runId);assert.equal(absent.runDetail.data.run,null);assert.equal(absent.runDetail.data.artifacts,null);assert.equal(absent.runDetail.data.status,'missing');assert.equal(isRunSnapshot(absent,child.runId),true);assert.equal(runWorkspaceState(absent.runDetail).poll,false);
    }
    for(const status of ['active','running','unknown','queued']){
      await writeFile(written.runsPath,[{...child,status},rows[1]].map(JSON.stringify).join('\n')+'\n');
      await writeFile(written.manifestPath,JSON.stringify({...manifest,status:'unknown',activeRun:null}));
      const rejected=await readRunDetailPageData(child.runId);assert.equal(rejected.runDetail.status,'invalid');assert.equal(rejected.runDetail.data,null);assert.equal(runWorkspaceState(rejected.runDetail).poll,false);
      await writeFile(written.manifestPath,JSON.stringify({...manifest,status:'unknown',activeRun:active}));
      const fallback=await readRunDetailPageData(child.runId);assert.equal(fallback.runDetail.data.run.status,'active');assert.equal(fallback.runDetail.data.runSource,'legacy_active');assert.equal(isRunSnapshot(fallback,child.runId),true);assert.equal(runWorkspaceState(fallback.runDetail).poll,false);
    }
    assert.equal(runnerCalls,0);
  }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});