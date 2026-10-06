import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {createLocalOperationsServer} from '../../../../dist/api/localOperationsServer.js';
import {evidenceArtifacts,evidencePayload} from '../run-evidence/fixtures.mjs';
const models='data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(await readFile(new URL('../../src/lib/dashboardViewModels.ts',import.meta.url),'utf8')));
const evidence='data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(await readFile(new URL('../../src/lib/runEvidence.ts',import.meta.url),'utf8')));
const {evidenceReference,evidenceReferences}=await import(evidence);
const source=(await readFile(new URL('../../src/lib/runEvidenceReader.ts',import.meta.url),'utf8')).replace("'./dashboardViewModels'",JSON.stringify(models)).replace("'./runEvidence'",JSON.stringify(evidence));
const {readRunWorkspacePageData}=await import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(source)));
test('actual JSONL syntax corruption survives real HTTP and UI reference projection',async t=>{
  const saved=process.env.DASHBOARD_OPS_API_BASE_URL;
  t.after(()=>{if(saved===undefined)delete process.env.DASHBOARD_OPS_API_BASE_URL;else process.env.DASHBOARD_OPS_API_BASE_URL=saved;});
  for(const truncated of [false,true]){
    const root=await mkdtemp(join(tmpdir(),'evidence-corrupt-ui-')),storage=join(root,'paper'),batch=join(root,'batch-replay','fixture_batch'),runDir=join(batch,'runs','child');
    await mkdir(storage);await mkdir(runDir,{recursive:true});
    const runsPath=join(batch,'batch-replay-runs.jsonl'),run={...evidencePayload('child').runs[0],storageBaseDir:runDir};
    await writeFile(runsPath,JSON.stringify(run)+'\n');
    await writeFile(join(batch,'batch-replay-manifest.json'),JSON.stringify({batchId:'fixture_batch',status:'completed',runsPath,completedAt:run.completedAt}));
    const raw=evidenceArtifacts('child');raw.trades[0].decisionId='syntax_corrupt_risk';
    const riskCount=truncated?120:1;
    const risks=Array.from({length:riskCount},(_,index)=>({...raw.riskDecisions[0],riskDecisionId:'risk_'+(index+1)}));
    for(const [name,rows] of [['packets',raw.packets],['decisions',raw.decisions],['risk-decisions',risks],['trades',raw.trades]]){
      await writeFile(join(runDir,'historical-replay-'+name+'.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+(name==='risk-decisions'?'\n{"riskDecisionId":"syntax_corrupt_risk",':'')+'\n');
    }
    const server=createLocalOperationsServer({storageBaseDir:storage});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      process.env.DASHBOARD_OPS_API_BASE_URL='http://127.0.0.1:'+server.address().port;
      const rawResponse=await (await fetch(process.env.DASHBOARD_OPS_API_BASE_URL+'/batch/replay/runs?includeLatestRunArtifacts=1&runId=child')).json();
      assert.equal(rawResponse.latestRunArtifacts.riskDecisionsStatus,'degraded');
      assert.equal(rawResponse.latestRunArtifacts.riskDecisionCorruptLineCount,1);
      const read=await readRunWorkspacePageData('child'),view=read.evidence;
      assert.equal(view.source,'bound');assert.equal(view.buckets[2].corrupt,1);
      assert.equal(view.buckets[2].truncated,truncated);
      assert.equal(evidenceReferences(view,view.buckets[3].rows[0])[1].state,'unavailable');
      assert.equal(evidenceReference(view,'risk','risk_'+riskCount).state,'linked');
      assert.equal(evidenceReference(view,'packet','packet_1').state,'linked');
    }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  }
});
