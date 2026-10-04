import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {observeRunTimer} from './timerProbe';
const root='/dashboard/lab/runs/';

for(const failure of ['offline','invalid'])test('failed same-run tab replacement preserves last good and isolates different run: '+failure,async({page,request},info)=>{
  await page.clock.install();
  const id='fixture_running_replacement_'+failure+'_'+info.project.name,base=root+id;
  const control=async(status:string)=>{const response=await request.get('http://127.0.0.1:8793/__replacement?id='+encodeURIComponent(id)+'&status='+status,{headers:{'x-ux04-test-runner':'ux04-fixture-v1'}});expect(response.status()).toBe(200);};
  await page.goto(base);await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
  const successTime=await page.getByText('GET 관측 시각:',{exact:false}).textContent();
  let release!:()=>void,ready!:()=>void,handled!:()=>void;
  const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>ready=r),finished=new Promise<void>(r=>handled=r);
  const reads:string[]=[];page.on('request',r=>{if(r.url().endsWith('/snapshot'))reads.push(r.url());});
  await page.route('**/snapshot',async route=>{
    const response=await route.fetch(),value=await response.json();ready();await gate;
    try{await route.fulfill({response,json:value});}catch(error){if(route.request().failure()?.errorText!=='net::ERR_ABORTED')throw error;}finally{handled();}
  });
  try{
    await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();await entered;
    await control(failure);
    const record=page.locator('a[href="'+base+'?tab=record"]');await record.focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(base+'?tab=record');
    await expect(page.getByText('조회: '+failure,{exact:false})).toBeVisible();
    await expect(page.getByRole('status')).toContainText('마지막 정상 조회 자료');
    await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
    await expect(page.getByRole('heading',{name:'선택 실행 기록',exact:true})).toBeVisible();
    await expect(page.getByText('GET 관측 시각:',{exact:false})).toHaveText(successTime!);
    const observation=await page.getByText('최근 서버 관측 시각:',{exact:false}).textContent();
    expect(observation!.split(': ').slice(1).join(': ')).not.toBe(successTime!.split(': ').slice(1).join(': '));
    release();await finished;await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    await expect(page.getByText('조회: '+failure,{exact:false})).toBeVisible();
    await expect(page.getByText('최근 서버 관측 시각:',{exact:false})).toHaveText(observation!);
    await expect(record).toHaveAttribute('aria-current','page');await expect(record).toBeFocused();
    await page.clock.fastForward(20_001);expect(reads).toHaveLength(1);
    await page.goto(root+'fixture_offline?tab=record');
    await expect(page.getByText('조회: offline',{exact:false})).toBeVisible();
    await expect(page.getByText('선택 child: running',{exact:false})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'선택 실행 기록',exact:true})).toHaveCount(0);
    await expect(page.getByRole('status')).not.toContainText('마지막 정상 조회 자료');
    await page.goto(root+'fixture_completed?tab=record');
    await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  }finally{release();await control('ok');}
});
test.afterEach(async({request})=>{
  const response=await request.get('http://127.0.0.1:8793/__requests',{headers:{'x-ux04-test-runner':'ux04-fixture-v1'}});
  expect(response.status()).toBe(200);
  const {requests}=await response.json();expect(requests.every((entry:{method:string})=>entry.method==='GET')).toBe(true);
});
test('legacy active SSR and manual GET agree without scheduling automatic reads',async({page},info)=>{
  await page.clock.install();await observeRunTimer(page);const id='fixture_legacy_active_'+info.project.name,reads:string[]=[];
  page.on('request',r=>{if(r.url().endsWith('/snapshot'))reads.push(r.method());});
  await page.goto(root+id);await expect(page.getByText('선택 child: active',{exact:false})).toBeVisible();
  await expect(page.getByText('산출물 판독: partial',{exact:false})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-test-visibility-listener-ready','true');
  const before=await page.getByText('GET 관측 시각:',{exact:false}).textContent();
  await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();
  await expect(page.getByText('GET 관측 시각:',{exact:false})).not.toHaveText(before!);
  await expect(page.getByText('조회: ok',{exact:false})).toBeVisible();await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByText('선택 child: active',{exact:false})).toBeVisible();
  await page.clock.fastForward(20_001);expect(reads).toEqual(['GET']);
  await page.getByRole('link',{name:'기록',exact:true}).click();await expect(page).toHaveURL(root+id+'?tab=record');
  await expect(page.getByText('선택 child: active',{exact:false})).toBeVisible();await expect(page.getByRole('status')).toHaveCount(0);
  await page.reload();await expect(page.getByText('선택 child: active',{exact:false})).toBeVisible();
});

test('stored nonterminal values cannot poll or hide a valid legacy manifest',async({page},info)=>{
  await page.clock.install();await observeRunTimer(page);const reads:string[]=[];
  page.on('request',r=>{if(r.url().endsWith('/snapshot'))reads.push(r.method());});
  for(const status of ['active','running','queued'])for(const source of ['bad','mixed']){
    const id='fixture_source_'+source+'_'+status+'_'+info.project.name;await page.goto(root+id);
    await expect(page.locator('html')).toHaveAttribute('data-test-visibility-listener-ready','true');
    const observation=source==='bad'?'invalid':'ok',execution=source==='bad'?'unknown':'active';
    await expect(page.getByText('조회: '+observation,{exact:false})).toBeVisible();
    await expect(page.getByText('선택 child: '+execution,{exact:false})).toBeVisible();
    const before=await page.getByText('GET 관측 시각:',{exact:false}).textContent();
    await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();
    await expect(page.getByText('GET 관측 시각:',{exact:false})).not.toHaveText(before!);
    await expect(page.getByText('조회: '+observation,{exact:false})).toBeVisible();
    await expect(page.getByText('선택 child: '+execution,{exact:false})).toBeVisible();
    await page.clock.fastForward(20_001);
  }
  expect(reads).toEqual(Array(6).fill('GET'));
});

test('snapshot BFF rejects mutation and invalid IDs while preserving no-store reads',async({request})=>{
  const snapshot=await request.get(root+'fixture_completed/snapshot');expect(snapshot.status()).toBe(200);
  expect(snapshot.headers()['cache-control']).toBe('no-store');
  const pageData=await snapshot.json();expect(pageData.runDetail.data.requestedId).toBe('fixture_completed');
  expect(pageData.runDetail.data.mode).toBe('paper_only');expect(pageData.runDetail.data.readOnly).toBe(true);
  const mutation=await request.post(root+'fixture_completed/snapshot',{data:{}});expect(mutation.status()).toBe(405);
  const invalid=await request.get(root+'invalid%2Fid/snapshot');expect(invalid.status()).toBe(400);
});
test('batch alias identifies child; URL summary and records survive history and reload',async({page})=>{
  const mutations:string[]=[];page.on('request',r=>{if(r.method()!=='GET')mutations.push(r.method());});
  await page.goto(root+'fixture_batch');await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();
  await expect(page.getByText('fixture_completed',{exact:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'리플레이',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'판단 근거',exact:true})).toBeDisabled();
  await page.getByRole('link',{name:'기록',exact:true}).click();await expect(page).toHaveURL(root+'fixture_batch?tab=record');
  await expect(page.getByRole('heading',{name:'선택 실행 기록',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'전체 운영 기록 · Audit'})).toHaveAttribute('href','/dashboard/audit');
  await page.reload();await expect(page.getByRole('link',{name:'기록',exact:true})).toHaveAttribute('aria-current','page');
  await page.goBack();await expect(page.getByRole('link',{name:'요약',exact:true})).toHaveAttribute('aria-current','page');
  await page.goForward();await expect(page.getByRole('link',{name:'기록',exact:true})).toHaveAttribute('aria-current','page');
  expect(mutations).toEqual([]);
});
test('partial and other-child artifacts preserve execution status without fabricated results',async({page})=>{
  await page.goto(root+'fixture_partial');await expect(page.getByText('선택 child: completed_with_failures',{exact:false})).toBeVisible();
  await expect(page.getByText('산출물 판독: partial',{exact:false})).toBeVisible();
  await expect(page.getByText('AI decision failures',{exact:true})).toBeVisible();
  await page.goto(root+'fixture_artifact_missing');
  await expect(page.getByText('Progress artifact is not available for this run detail view.')).toBeVisible();
  await expect(page.getByText('Decision records',{exact:true}).locator('..')).toContainText('미관측');
  await page.goto(root+'fixture_mismatch');await expect(page.getByText('산출물 판독: missing',{exact:false})).toBeVisible();
  await page.getByRole('link',{name:'기록',exact:true}).click();await expect(page.getByText('latest run artifacts belong to a different run',{exact:false})).toBeVisible();
});
test('missing, accepted unknown, runner failure, offline and invalid remain distinct',async({page})=>{
  await page.goto(root+'fixture_missing');await expect(page.getByRole('heading',{name:'Run artifact unavailable'})).toBeVisible();
  await page.goto(root+'paper_sim_20261004000000000_accepted');await expect(page.getByText('접수 관측 · 이후 실행 상태 미확인',{exact:true})).toBeVisible();
  await page.goto(root+'paper_sim_20261004000000000_failed');await expect(page.getByRole('heading',{name:'Runner 실패 관측'})).toBeVisible();
  for(const kind of ['offline','invalid']){await page.goto(root+'fixture_'+kind);await expect(page.getByText('조회: '+kind,{exact:false})).toBeVisible();await expect(page.getByRole('heading',{name:'Run Detail Unavailable'})).toBeVisible();}
});
test('manual GET refresh retains last successful data through failure and stale warning',async({page})=>{
  await page.clock.install();await page.goto(root+'fixture_completed');
  await page.route('**/snapshot',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();
  await expect(page.getByRole('status')).toContainText('마지막 정상 조회 자료');
  await page.clock.fastForward(16_000);await expect(page.getByRole('status')).toContainText('조회 갱신 지연');
  await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
  await page.unroute('**/snapshot');await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();
  await expect(page.getByRole('status')).toHaveCount(0);
});
test('running GET updates exact child to terminal and stops automatic reads',async({page},info)=>{
  await page.clock.install();await observeRunTimer(page);
  const reads:string[]=[];page.on('request',r=>{if(r.url().endsWith('/snapshot'))reads.push(r.method());});
  await page.goto(root+'fixture_transition_'+info.project.name);
  await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
  // SSR text precedes the client effect: observe registration without issuing a GET.
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-visibility-listener-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','1');
  await page.clock.fastForward(5_001);await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
  expect(reads).toEqual(['GET']);
  const count=reads.length;await page.clock.fastForward(20_000);expect(reads.length).toBe(count);
});
test('hidden document pauses running reads and route departure cleans up the timer',async({page})=>{
  await page.clock.install();await observeRunTimer(page);
  const reads:string[]=[];page.on('request',r=>{if(r.url().endsWith('/snapshot'))reads.push(r.method());});
  await page.goto(root+'fixture_running');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-visibility-listener-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','1');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','0');
  await page.clock.fastForward(10_000);expect(reads).toEqual([]);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','1');
  await page.clock.fastForward(5_001);await expect.poll(()=>reads.length).toBe(1);
  await expect(page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'})).toBeEnabled();
  await page.getByRole('link',{name:'실험 목록',exact:true}).click();await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','0');
  const count=reads.length;await page.clock.fastForward(20_000);expect(reads.length).toBe(count);
});
test('rendered detail is accessible, responsive and free of app errors',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.name));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(root+'fixture_completed');await expect(page).toHaveTitle('Toss Trading Dashboard');
  await expect(page.locator('main')).toHaveCount(1);await expect(page.getByRole('heading',{level:1})).toHaveCount(1);
  await page.screenshot({path:info.outputPath('summary.png'),fullPage:true});
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'실행 상세로 건너뛰기'})).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('main')).toBeFocused();
  const width=info.project.use.viewport?.width??390;
  expect(await page.evaluate(()=>document.documentElement.clientWidth)).toBe(width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  await page.addScriptTag({content:await readFile(require.resolve('axe-core/axe.min.js'),'utf8')});
  const violations=await page.evaluate(async()=>{const result=await (window as unknown as {axe:{run:()=>Promise<{violations:{id:string}[]}>}}).axe.run();return result.violations.map(v=>v.id);});expect(violations).toEqual([]);
  await page.getByRole('link',{name:'기록',exact:true}).click();await expect(page.getByRole('heading',{name:'선택 실행 기록',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('record.png'),fullPage:true});expect(errors).toEqual([]);
});


test('keyboard tab links preserve focus through fresh GET and history',async({page})=>{
  const base=root+'fixture_completed';await page.goto(base);
  const record=page.locator('a[href="'+base+'?tab=record"]');
  // Complete a real client GET before keyboard activation, so SSR hydration cannot replace the focused node.
  const first=await page.getByText('GET 관측 시각:',{exact:false}).textContent();
  await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();
  await expect(page.getByText('GET 관측 시각:',{exact:false})).not.toHaveText(first!);
  const before=await page.getByText('GET 관측 시각:',{exact:false}).textContent();
  await record.focus();await expect(record).toBeFocused();await page.keyboard.press('Enter');await expect(page).toHaveURL(base+'?tab=record');
  await expect(page.getByText('GET 관측 시각:',{exact:false})).not.toHaveText(before!);
  await expect(record).toBeFocused();
  await page.goBack();await expect(page).toHaveURL(base);await expect(record).toBeFocused();
  await page.goForward();await expect(page).toHaveURL(base+'?tab=record');await expect(record).toBeFocused();
});

test('pending running GET becomes stale without declaring execution failure',async({page})=>{
  await page.clock.install();await observeRunTimer(page);await page.goto(root+'fixture_running');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-visibility-listener-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','1');
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
  await page.route('**/snapshot',async route=>{started();await gate;const response=await route.fetch();const value=await response.json();value.fetchedAt=await page.evaluate(()=>new Date().toISOString());value.runDetail.fetchedAt=value.fetchedAt;await route.fulfill({response,json:value});});
  try{await page.clock.fastForward(5_001);await entered;await page.clock.fastForward(16_001);
    await expect(page.getByRole('status')).toContainText('조회 갱신 지연');
    await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
    await expect(page.getByText('조회: ok',{exact:false})).toBeVisible();
    release();await expect(page.getByRole('status')).toHaveCount(0);
  }finally{release();}
});

test('hidden running observation warns on return until a fresh GET completes',async({page})=>{
  await page.clock.install();await observeRunTimer(page);await page.goto(root+'fixture_running');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-visibility-listener-ready','true');
  await expect(page.locator('html')).toHaveAttribute('data-test-run-timer-active','1');
  const reads:string[]=[];page.on('request',r=>{if(r.url().endsWith('/snapshot'))reads.push(r.method());});
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(20_001);expect(reads).toEqual([]);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByRole('status')).toContainText('조회 갱신 지연');
  await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
  await page.route('**/snapshot',async route=>{const response=await route.fetch();const value=await response.json();value.fetchedAt=await page.evaluate(()=>new Date().toISOString());value.runDetail.fetchedAt=value.fetchedAt;await route.fulfill({response,json:value});});
  await page.clock.fastForward(5_001);await expect(page.getByRole('status')).toHaveCount(0);
});


for(const oldResult of ['running','error'])test('fresh terminal tab read retires held same-ID snapshot: '+oldResult,async({page},info)=>{
  await page.clock.install();const id='fixture_race_'+oldResult+'_'+info.project.name,base=root+id;
  await page.goto(base);await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
  let release!:()=>void,ready!:()=>void,handled!:()=>void;
  const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>ready=r),finished=new Promise<void>(r=>handled=r);
  await page.route('**/snapshot',async route=>{
    const response=await route.fetch();const value=await response.json();expect(value.runDetail.data.run.status).toBe('running');ready();
    await gate;
    try{await route.fulfill(oldResult==='error'?{status:503,body:'fixture_read_failure'}:{response,json:value});}
    catch(error){if(route.request().failure()?.errorText!=='net::ERR_ABORTED')throw error;}
    finally{handled();}
  });
  try{
    await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();await entered;
    const before=await page.getByText('GET 관측 시각:',{exact:false}).textContent();
    const record=page.locator('a[href="'+base+'?tab=record"]');await record.focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(base+'?tab=record');await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
    const terminalTime=await page.getByText('GET 관측 시각:',{exact:false}).textContent();expect(terminalTime).not.toBe(before);
    release();await finished;await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
    await expect(page.getByText('GET 관측 시각:',{exact:false})).toHaveText(terminalTime!);
    await expect(record).toHaveAttribute('aria-current','page');await expect(page).toHaveURL(base+'?tab=record');
    await expect(page.getByRole('status')).toHaveCount(0);await page.clock.fastForward(20_001);
    await expect(page.getByText('GET 관측 시각:',{exact:false})).toHaveText(terminalTime!);
    await expect(page.getByRole('status')).toHaveCount(0);
  }finally{release();}
});
