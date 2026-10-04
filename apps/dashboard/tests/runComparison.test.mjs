import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {evidencePayload} from './run-evidence/fixtures.mjs';
const moduleUrl=async path=>'data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(await readFile(new URL(path,import.meta.url),'utf8')));
const vmUrl=await moduleUrl('../src/lib/dashboardViewModels.ts'), evidenceUrl=await moduleUrl('../src/lib/runEvidence.ts');
let source=await readFile(new URL('../src/lib/runComparison.ts',import.meta.url),'utf8');
source=source.replace("'./dashboardViewModels'",JSON.stringify(vmUrl)).replace("'./runEvidence'",JSON.stringify(evidenceUrl));
const {readComparisonSelection,projectComparisonObservation,readComparisonObservation,readComparisonPage}=await import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(source)));
const at='2026-10-04T01:00:00.000Z';
const project=(value)=>projectComparisonObservation(value,'child',at);

test('selection requires two different exact IDs and rejects duplicate parameters',()=>{
  assert.equal(readComparisonSelection({}).status,'empty');
  assert.deepEqual(readComparisonSelection({baseline:'child',candidate:'other'}),{status:'valid',baseline:'child',candidate:'other'});
  for(const params of [{baseline:'child'},{baseline:'child',candidate:'child'},{baseline:['child','other'],candidate:'third'},{baseline:'child',candidate:['other','third']},{baseline:'../child',candidate:'other'},{baseline:' child ',candidate:'other'},{baseline:'child',candidate:'x'.repeat(257)}])assert.equal(readComparisonSelection(params).status,'invalid');
});
test('projection exposes independent status and bounded evidence, never metrics or raw paths',()=>{
  const raw=evidencePayload('child');raw.latestRunArtifacts.secret='DO_NOT_FORWARD';raw.runs[0].error='DO_NOT_FORWARD';
  const result=project(raw);assert.equal(result.status,'available');assert.equal(result.runStatus,'completed');assert.equal(result.artifactBinding,'bound');assert.equal(result.scopes.length,4);assert.ok(result.scopes.every(s=>s.returned===1&&s.total===1&&s.displayed===1));
  assert.equal(result.comparability,'unavailable');assert.equal(result.clone,'unavailable');assert.doesNotMatch(JSON.stringify(result),/DO_NOT_FORWARD|sourceRunsPath|reportPath|storageBaseDir|totalReturnRatio|NetWorth|provider|packet_1/);
});
test('both missing provenance remain unavailable, never equal or comparable',()=>{
  for(const child of ['child','other']){const o=projectComparisonObservation(evidencePayload(child),child,at);assert.equal(o.comparability,'unavailable');assert.equal(o.clone,'unavailable');}
});
test('exact child lookup rejects aliases, duplicate source rows and malformed exact rows',()=>{
  const raw=evidencePayload('different');raw.selectedRun.batchId='child';raw.batchId='child';assert.equal(project(raw).status,'identity_mismatch');
  const duplicate=evidencePayload('child');duplicate.runs.push({...duplicate.runs[0],status:'invented'});assert.equal(project(duplicate).status,'ambiguous');
  const bad=evidencePayload('child');bad.runs[0]={runId:'child',status:'invented'};assert.equal(project(bad).status,'invalid');
});
test('missing run does not become zero or terminal success',()=>{
  const raw=evidencePayload('child');raw.runs=[];raw.selectedRun=null;raw.latestRunArtifacts=null;const o=project(raw);assert.equal(o.status,'missing');assert.equal(o.runStatus,null);assert.deepEqual(o.scopes,[]);
});
test('running and partial failure remain original states',()=>{
  for(const status of ['running','completed_with_failures','failed','skipped']){const raw=evidencePayload('child');raw.runs[0].status=status;raw.selectedRun=raw.runs[0];assert.equal(project(raw).runStatus,status);}
});
test('ended time follows the observed lifecycle field rather than a stale completion date',()=>{
  const raw=evidencePayload('child');raw.runs[0].status='running';assert.equal(project(raw).endedAt,null);raw.runs[0].status='failed';raw.runs[0].failedAt='2026-10-04T00:03:00.000Z';assert.equal(project(raw).endedAt,raw.runs[0].failedAt);
});
test('unbound or blocked artifacts are unavailable, not empty scope',()=>{
  for(const scenario of ['mismatch','blocked']){const o=project(evidencePayload('child',scenario));assert.equal(o.status,'available');assert.equal(o.artifactBinding,scenario);assert.deepEqual(o.scopes,[]);assert.equal(o.reportStatus,null);}
});
test('genuine zero, clipping, corruption and malformed evidence remain distinct',()=>{
  const empty=project(evidencePayload('child','empty'));assert.ok(empty.scopes.every(s=>s.status==='ok'&&s.returned===0&&s.total===0&&s.truncated===false));
  assert.ok(project(evidencePayload('child','truncated')).scopes.every(s=>s.truncated===true&&s.total===120));
  assert.ok(project(evidencePayload('child','corrupt')).scopes.every(s=>s.status==='corrupt'&&s.displayed===0));
  const malformed=project(evidencePayload('child','enum_object'));assert.equal(malformed.status,'available');assert.equal(malformed.scopes[0].displayed,1);assert.equal(malformed.scopes[1].excluded,1);assert.equal(malformed.scopes[1].displayed,0);
});
test('invalid dates and unknown endpoint statuses do not become provenance',()=>{
  const raw=evidencePayload('child');raw.runs[0].startedAt='2026-02-31T00:00:00Z';raw.status='invented';const o=project(raw);assert.equal(o.startedAt,null);assert.equal(o.sourceStatus,null);assert.equal(o.comparability,'unavailable');
});
test('invalid selection performs no GET',async t=>{const original=global.fetch;t.after(()=>global.fetch=original);global.fetch=async()=>{throw Error('must not fetch');};assert.deepEqual(await readComparisonPage(readComparisonSelection({baseline:'child',candidate:'child'})),[]);assert.equal((await readComparisonObservation('../child')).status,'invalid');});
test('a stalled read aborts at the existing two-second bound',async t=>{
  const original=global.fetch;t.after(()=>global.fetch=original);let signal;global.fetch=async(_url,options)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
  const result=await readComparisonObservation('child');assert.equal(signal.aborted,true);assert.equal(result.status,'offline');assert.equal(result.runStatus,null);
});
test('two no-store GETs isolate one offline run and preserve ordering',async t=>{
  const original=global.fetch;t.after(()=>global.fetch=original);const calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});const id=new URL(url).searchParams.get('runId');if(id==='other')return new Response('{}',{status:503});return new Response(JSON.stringify(evidencePayload(id)));};
  const result=await readComparisonPage(readComparisonSelection({baseline:'child',candidate:'other'}));assert.deepEqual(result.map(o=>[o.requestedId,o.status]),[['child','available'],['other','offline']]);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.cache==='no-store'&&c.options.signal instanceof AbortSignal));
});
test('read errors do not disclose exception bodies and invalid payload differs from offline',async t=>{
  const original=global.fetch;t.after(()=>global.fetch=original);global.fetch=async()=>new Response('{}');assert.equal((await readComparisonObservation('child')).status,'invalid');global.fetch=async()=>{throw Error('private token path');};const result=await readComparisonObservation('child');assert.equal(result.status,'offline');assert.doesNotMatch(JSON.stringify(result),/private|token|path/);
});
