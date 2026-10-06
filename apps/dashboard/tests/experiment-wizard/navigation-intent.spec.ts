import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
for(const mode of ['back-leave','step-back','ctrl-click'])test('pending create navigation intent: '+mode,async({page,context,request},info)=>{
 const fixture=JSON.parse(readFileSync(process.env.EXPERIMENT_WIZARD_FIXTURE_FILE ?? ".e2e-data/experiment-wizard/fixture.json", "utf8"));
 const events: Array<Record<string, unknown>>=[];const mark=(name: string,data: Record<string, unknown>={})=>events.push({name,at:new Date().toISOString(),url:page.url(),...data});
 let releaseCreate!: () => void, releaseList!: () => void, listStarted!: () => void;
 let acceptedReady!: (value: { status: number; id: string }) => void;
 const createGate=new Promise<void>(r=>{ releaseCreate=r; }),listGate=new Promise<void>(r=>{ releaseList=r; });
 const acceptedPromise=new Promise<{ status: number; id: string }>(r=>{ acceptedReady=r; }),listPromise=new Promise<void>(r=>{ listStarted=r; });
 let admittedId: string | undefined;
 let posts=0;let popup: Page | undefined;
 let persistedId='';
 await page.exposeBinding('__intentAdmissionObserved',(_source,value)=>{if(typeof value==='string'&&/^paper_sim_[A-Za-z0-9_.-]+$/.test(value))persistedId=value;});
 await page.addInitScript(()=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){original.call(this,key,value);if(this===sessionStorage&&key==='paper-experiment-admission-v1'&&value.startsWith('paper_sim_'))void (window as unknown as {__intentAdmissionObserved:(id:string)=>Promise<void>}).__intentAdmissionObserved(value);};
 });
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/simulations/create'))posts++;});
 page.on('framenavigated',f=>{if(f===page.mainFrame())mark('main-frame-url');});
 await page.route('**/simulations/create',async route=>{
  const response=await route.fetch();const accepted=await response.json();
  mark('backend-accepted',{status:response.status(),id:accepted.simulationRunId});
  if(response.status()===202)admittedId=accepted.simulationRunId;
  acceptedReady({status:response.status(),id:accepted.simulationRunId});
  await createGate;await route.fulfill({response});mark('create-released');
 });
 try{
  if(mode==='back-leave'){
   await page.goto('/dashboard');
   await page.getByRole('link',{name:'새 실험',exact:true}).first().click();
   await expect(page).toHaveURL(/\/dashboard\/experiments\/new$/);
  }else await page.goto('/dashboard/experiments/new');
  await page.getByLabel('초기 모의 자본 (KRW)').fill('500000');
  await page.getByRole('button',{name:'다음',exact:true}).click();
  await page.getByLabel('Source 자료 경로').fill(fixture.sourceDataDir);
  await page.getByLabel('시작 날짜').fill('2026-01-01');await page.getByLabel('종료 날짜').fill('2026-01-02');
  await page.getByLabel('추출 seed').fill('intent-'+mode);
  await page.getByRole('button',{name:'다음',exact:true}).click();
  // Clear the router's in-memory list cache; browser history still holds the real list entry.
  if(mode==='back-leave')await page.reload();
  await page.route('**/dashboard?**',async route=>{
   const r=route.request();if(new URL(r.url()).pathname!=='/dashboard'||r.headers().rsc!=='1')return route.continue();
   mark('list-flight-held',{prefetch:r.headers()['next-router-prefetch']||null});
   if(!r.headers()['next-router-prefetch'])listStarted();
   await listGate;await route.continue();
  });
  await page.getByRole('button',{name:'현재 입력 검증'}).click();
  await expect(page.getByRole('status')).toContainText('입력 검증 완료');
  await page.getByLabel('실행 승인 토큰').fill('playwright-dashboard-mutation-token');
  await page.getByRole('button',{name:'paper 실행 시작'}).click();
  const accepted=await acceptedPromise;expect(accepted.status).toBe(202);
  if(mode==='back-leave'){
   await page.evaluate(()=>history.go(-3));
   await listPromise;
   await expect(page.getByRole('heading',{name:'새 실험',exact:true})).toBeVisible();
   mark('back-destination-pending-wizard-still-mounted');
  }else if(mode==='step-back'){
   await page.goBack();
   await expect(page).toHaveURL(/step=2$/);
   await expect(page.getByRole('heading',{name:'2. 데이터·실행 조건',exact:true})).toBeVisible();
   mark('internal-step-back');
  }else{
   const opened=context.waitForEvent('page');
   await page.getByRole('link',{name:'← 실험 목록',exact:true}).click({modifiers:['Control']});
   popup=await opened;await popup.waitForURL(/\/dashboard$/);
   await expect(page).toHaveURL(/step=3$/);mark('new-tab-open-original-unchanged',{popupPath:new URL(popup.url()).pathname});
  }
  releaseCreate();
  await expect.poll(()=>persistedId).toBe(accepted.id);
  mark('accepted-id-persisted');
  if(mode==='back-leave'){
   await expect(page.getByRole('heading',{name:'새 실험',exact:true})).toBeVisible();
   // React may retain the old committed DOM while the list transition is suspended.
   // The synchronous exact-ID write above proves the mounted response handler ran.
   releaseList();await expect(page).toHaveURL(/\/dashboard$/);
   await expect(page.getByRole('heading',{name:'실험',exact:true})).toBeVisible();
   await page.goForward();
   await expect(page.getByRole('heading',{name:'새 실험',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'다음',exact:true}).click();
   await page.getByRole('button',{name:'다음',exact:true}).click();
   await expect(page.getByRole('link',{name:'같은 ID 상태 조회'})).toHaveAttribute('href','/dashboard/lab/runs/'+accepted.id);
   await expect(page.getByLabel('실행 승인 토큰')).toHaveValue('');
   await expect(page.getByRole('button',{name:'paper 실행 시작'})).toBeDisabled();
  }else{
   releaseList();await expect(page).toHaveURL(new RegExp('/dashboard/lab/runs/'+accepted.id+'$'));
   await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();
  }
  expect(posts).toBe(1);mark('verified',{posts});
 }finally{
  releaseCreate();releaseList();if(popup)await popup.close();mark('final',{posts});
  await info.attach('intent-order',{body:JSON.stringify(events,null,2),contentType:'application/json'});
  // A 202 is admission, not runner completion. Leave the shared fixture idle for the next case.
  if(admittedId)await expect.poll(async()=>{
   const response=await request.get('http://127.0.0.1:8791/batch/replay/runs?runId='+encodeURIComponent(admittedId!));
   return (await response.json()).batchStatus;
  }).toMatch(/^(completed|completed_with_failures|failed|skipped)$/);
 }
});
