import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { runHistoricalBatchReplay } from '../../../../dist/workflows/historicalBatchReplayWorkflow.js';
import { createLocalOperationsServer } from '../../../../dist/api/localOperationsServer.js';

const models='data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(await readFile(new URL('../../src/lib/dashboardViewModels.ts',import.meta.url),'utf8')));
const source=(await readFile(new URL('../../src/lib/runProvenance.ts',import.meta.url),'utf8')).replace("'./dashboardViewModels'",JSON.stringify(models));
const { readRunProvenance }=await import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(source)));

test('UI-owned actual writer HTTP adapter matrix preserves twenty-eight exact children',async t=>{
  const saved=Object.fromEntries(['DASHBOARD_OPS_API_BASE_URL','OPS_API_BASE_URL'].map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const originalFetch=globalThis.fetch,requests=[];
  t.mock.method(globalThis,'fetch',async(...args)=>{requests.push(String(args[0]));return originalFetch(...args);});
  const batchIds=['-synthetic','--','-','-a_b-','__synthetic__','synthetic.dot','../outside','foo'+String.fromCharCode(92)+'bar','foo%2Fbar','foo?bar#x',String.fromCharCode(0xD55C,0xAE00),'synthetic'+String.fromCharCode(0)+'suffix','synthetic'+String.fromCharCode(10)+'suffix'," !@#$%^&*()+=[]{}:;'<> ,?/~ "];
  let children=0;
  for(const batchId of batchIds){
    const root=await mkdtemp(join(tmpdir(),'provenance-ui-writer-')),storage=join(root,'paper'),sourceDataDir=join(root,'source');
    await mkdir(storage);await mkdir(sourceDataDir);let providers=0,runnerCalls=0;
    const written=await runHistoricalBatchReplay({sourceDataDir,outputBaseDir:join(root,'batch-replay'),batchId,seed:'s'.repeat(4097),runCount:2,rangeStart:new Date('2026-01-01T00:00:00+09:00'),rangeEnd:new Date('2026-01-31T23:59:59.999+09:00'),generatedAt:new Date('2026-02-01T00:00:00Z'),minWindowSnapshots:1,decisionProviderFactory:()=>{providers++;throw Error('provider must never run');}});
    const rows=(await readFile(written.runsPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows.length,2);assert.equal(providers,0);
    const server=createLocalOperationsServer({storageBaseDir:storage,paperSimulationRunner:async()=>{runnerCalls++;throw Error('read must never run');}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      process.env.DASHBOARD_OPS_API_BASE_URL='';process.env.OPS_API_BASE_URL='http://127.0.0.1:'+server.address().port;
      for(const row of rows){const id=row.runId,display=await readRunProvenance(id);assert.equal(display.status,'partial',id);assert.equal(display.requestedId,id);assert.equal(display.comparability,'unavailable');assert.equal(display.clone,'unavailable');assert.ok(!JSON.stringify(display).includes(root));assert.doesNotMatch(JSON.stringify(display),/ssssssssss/);const url=new URL(requests.at(-1));assert.equal(url.searchParams.get('runId'),id);assert.deepEqual([...url.searchParams.keys()],['runId']);children++;}
      const before=requests.length,id=rows[0].runId;
      for(const suffix of ['/../escape','%2Fescape',String.fromCharCode(92),String.fromCharCode(0),String.fromCharCode(10)])assert.equal((await readRunProvenance(id+suffix)).status,'invalid');
      assert.equal((await readRunProvenance('a'.repeat(257))).status,'invalid');assert.equal(requests.length,before);assert.equal(runnerCalls,0);
    }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  }
  assert.equal(children,28);assert.equal(requests.length,28);
});
