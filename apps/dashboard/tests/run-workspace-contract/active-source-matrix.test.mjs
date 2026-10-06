import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const evidenceUrl='data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(await readFile(new URL('../../src/lib/runEvidence.ts',import.meta.url),'utf8')));
const load=async n=>import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes((await readFile(new URL('../../src/lib/'+n+'.ts',import.meta.url),'utf8')).replace("'./runEvidence'",JSON.stringify(evidenceUrl)))));
const {readRunDetailPageData}=await load('dashboardViewModels'),{isRunSnapshot,runWorkspaceState}=await load('runWorkspace');
const stamp='2026-01-01T00:00:00.000Z',base={mode:'paper_only',readOnly:true,status:'ok',batchId:'batch',batchStatus:'unknown',runs:[],selectedRun:null,activeRun:null,latestRunArtifacts:null};
const active={runId:'child',runIndex:0,startedAt:stamp};
const stored=status=>({runId:'child',batchId:'batch',status,runIndex:0,startedAt:stamp});
test('raw source matrix distinguishes legacy active from persisted or contradictory nonterminal rows',async t=>{
  const saved=process.env.DASHBOARD_OPS_API_BASE_URL;process.env.DASHBOARD_OPS_API_BASE_URL='http://source-matrix.test';t.after(()=>{if(saved===undefined)delete process.env.DASHBOARD_OPS_API_BASE_URL;else process.env.DASHBOARD_OPS_API_BASE_URL=saved;});
  let payload=base;t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}}));
  const cases=[
    ...['completed','completed_with_failures','failed','skipped'].map(status=>({name:'stored '+status,raw:{...base,runs:[stored(status)],selectedRun:stored(status)},execution:status,source:'persisted',poll:false})),
    {name:'legacy missing batch status',raw:{...base,batchStatus:null,activeRun:active,selectedRun:active},execution:'active',source:'legacy_active',poll:false},
    {name:'legacy unknown batch status',raw:{...base,activeRun:active,selectedRun:active},execution:'active',source:'legacy_active',poll:false},
    {name:'manifest running',raw:{...base,batchStatus:'running',activeRun:active,selectedRun:active},execution:'running',source:'active_manifest',poll:true},
    {name:'missing active ID',raw:{...base,activeRun:{runIndex:0},selectedRun:{runIndex:0}},execution:'unknown',source:null,poll:false},
    {name:'other active ID',raw:{...base,activeRun:{...active,runId:'other'},selectedRun:{...active,runId:'other'}},execution:'unknown',source:null,poll:false},
    {name:'stored active',raw:{...base,runs:[stored('active')],selectedRun:stored('active')},invalid:true},
    {name:'stored unknown',raw:{...base,runs:[stored('unknown')],selectedRun:stored('unknown')},invalid:true},
    {name:'stored running',raw:{...base,runs:[stored('running')],selectedRun:stored('running')},invalid:true},
    {name:'stored active plus matching valid manifest',raw:{...base,runs:[stored('active')],activeRun:active,selectedRun:active},execution:'active',source:'legacy_active',poll:false},
    {name:'stored unknown other child plus valid manifest',raw:{...base,runs:[{...stored('unknown'),runId:'other'}],activeRun:active,selectedRun:active},execution:'active',source:'legacy_active',poll:false},
    {name:'explicit active instead of legacy fallback',raw:{...base,activeRun:{...active,status:'active'},selectedRun:{...active,status:'active'}},invalid:true},
    {name:'selected arbitrary status',raw:{...base,selectedRun:stored('arbitrary')},invalid:true}
  ];
  for(const bad of ['active','running','unknown','queued','arbitrary','']){
    for(const status of ['completed','completed_with_failures','failed','skipped'])cases.push({name:bad+' stored cannot hide selected '+status,raw:{...base,runs:[stored(bad)],selectedRun:stored(status)},execution:status,source:'persisted',poll:false});
    for(const batchStatus of ['unknown','running'])cases.push({name:bad+' stored cannot hide '+batchStatus+' manifest',raw:{...base,batchStatus,runs:[stored(bad)],selectedRun:stored(bad),activeRun:active},execution:batchStatus==='running'?'running':'active',source:batchStatus==='running'?'active_manifest':'legacy_active',poll:batchStatus==='running'});
  }
  for(const status of ['completed','completed_with_failures','failed','skipped'])for(const batchStatus of ['unknown','running'])cases.push({name:'same ID '+status+' outranks '+batchStatus+' active manifest',raw:{...base,batchStatus,runs:[stored(status)],selectedRun:active,activeRun:active},execution:status,source:'persisted',poll:false});
  for(const bad of ['active','running','unknown','queued','arbitrary','']){
    for(const status of ['completed','completed_with_failures','failed','skipped'])cases.push({name:bad+' cannot hide stored '+status,raw:{...base,runs:[stored(bad),stored(status)],selectedRun:stored(bad)},execution:status,source:'persisted',poll:false});
    cases.push({name:bad+' with other selected terminal keeps exact manifest',raw:{...base,runs:[stored(bad)],selectedRun:{...stored('completed'),runId:'other',batchId:'other_batch'},activeRun:active},execution:'active',source:'legacy_active',poll:false});
  }
  for(const status of [42,true,{},[]]){
    cases.push({name:'malformed active status '+JSON.stringify(status),raw:{...base,activeRun:{...active,status},selectedRun:{...active,status}},invalid:true});
    cases.push({name:'malformed selected status '+JSON.stringify(status),raw:{...base,selectedRun:{...stored('completed'),status}},invalid:true});
  }
  cases.push({name:'selected missing terminal status without active source',raw:{...base,selectedRun:{...stored('completed'),status:null}},invalid:true});
  t.diagnostic('raw source cases='+cases.length+'; transport origin negatives=9');
  for(const c of cases){payload=c.raw;const page=await readRunDetailPageData('child');if(c.invalid){assert.equal(page.runDetail.status,'invalid',c.name);assert.equal(page.runDetail.data,null,c.name);assert.equal(runWorkspaceState(page.runDetail).poll,false,c.name);}else{assert.equal(page.runDetail.status,'ok',c.name);assert.equal(page.runDetail.data.runSource,c.source,c.name);assert.equal(runWorkspaceState(page.runDetail).execution,c.execution,c.name);assert.equal(runWorkspaceState(page.runDetail).poll,c.poll,c.name);}assert.equal(isRunSnapshot(page,'child'),true,c.name+' valid transport/error envelope');}
  payload={...base,batchStatus:'running',activeRun:active};const running=await readRunDetailPageData('child');for(const origin of [undefined,'persisted','legacy_active','invented']){const bad=structuredClone(running);bad.runDetail.data.runSource=origin;assert.equal(isRunSnapshot(bad,'child'),false,'running origin '+origin);}
  payload={...base,activeRun:active};const good=await readRunDetailPageData('child');for(const origin of [undefined,null,'persisted','active_manifest','invented']){const bad=structuredClone(good);bad.runDetail.data.runSource=origin;assert.equal(isRunSnapshot(bad,'child'),false,'active transport origin '+origin);}
});
