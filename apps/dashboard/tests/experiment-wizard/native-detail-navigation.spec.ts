import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const createPath = '/dashboard/lab/policies/simulations/create';
const admissionKey = 'paper-experiment-admission-v1';
async function prepare(page: Page, seed: string) {
  const fixture = JSON.parse(readFileSync(process.env.EXPERIMENT_WIZARD_FIXTURE_FILE ?? '.e2e-data/experiment-wizard/fixture.json', 'utf8'));
  await page.goto('/dashboard/experiments/new');
  await page.getByLabel('초기 모의 자본 (KRW)').fill('500000');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('Source 자료 경로').fill(fixture.sourceDataDir);
  await page.getByLabel('시작 날짜').fill('2026-01-01'); await page.getByLabel('종료 날짜').fill('2026-01-02');
  await page.getByLabel('추출 seed').fill(seed);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '현재 입력 검증' }).click();
  await expect(page.getByRole('status')).toContainText('입력 검증 완료');
  await page.getByLabel('실행 승인 토큰').fill('playwright-dashboard-mutation-token');
}
async function restored(page: Page, id: string) {
  await expect(page.getByRole('link', { name: '같은 ID 상태 조회' })).toHaveAttribute('href', '/dashboard/lab/runs/' + id);
  await expect(page.getByLabel('실행 승인 토큰')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'paper 실행 시작' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '현재 입력 검증' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('접수');
}
test('native exact accepted ID document GET ignores failed soft RSC and preserves Back/reload barrier', async ({ page }, info) => {
  let posts = 0; let acceptedId = ''; const documents: string[] = []; const soft: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(createPath)) posts++; if (r.isNavigationRequest() && r.resourceType() === 'document') documents.push(r.url()); });
  await page.route('**/dashboard/lab/runs/**', async route => {
    if (route.request().headers().rsc === '1') { soft.push(route.request().url()); await route.abort(); } else await route.continue();
  });
  await page.route(`**${createPath}`, async route => {
    const response = await route.fetch();
    const id = (await response.json()).simulationRunId;
    acceptedId = id;
    await page.evaluate(async id => { try { await fetch('/dashboard/lab/runs/' + id + '?_rsc=synthetic-native-proof', { headers: { RSC: '1' } }); } catch { /* Deliberate failed old transport. */ } }, id);
    await route.fulfill({ response });
  });
  await prepare(page, 'native-soft-failure');
  const accepted = page.waitForResponse(r => r.url().endsWith(createPath));
  await page.getByRole('button', { name: 'paper 실행 시작' }).click();
  const response = await accepted; expect(response.status()).toBe(202); const id = acceptedId;
  await expect(page).toHaveURL(new RegExp('/dashboard/lab/runs/' + id + '$'));
  await expect(page.getByRole('heading', { name: 'Run Detail', exact: true })).toBeVisible();
  expect(documents.some(url => new URL(url).pathname === '/dashboard/lab/runs/' + id)).toBe(true);
  expect(soft.length).toBeGreaterThan(0);
  await page.goBack({ waitUntil: 'commit' }); await restored(page, id); await page.reload(); await restored(page, id);
  const nextDocument = page.waitForRequest(r => r.isNavigationRequest() && new URL(r.url()).pathname === '/dashboard/lab/runs/' + id);
  await page.getByRole('link', { name: '같은 ID 상태 조회' }).click(); await nextDocument;
  await expect(page.getByRole('heading', { name: 'Run Detail', exact: true })).toBeVisible();
  expect(posts).toBe(1); await info.attach('native-observation', { body: JSON.stringify({ id, posts, documents, soft }), contentType: 'application/json' });
});
for (const navigation of ['list', 'back']) test(`pending native detail GET yields to newer ${navigation}`, async ({ page, request }, info) => {
  let posts = 0; let id = ''; let released = false; let observedId='';
  let releaseAccepted!:()=>void;const acceptedGate=new Promise<void>(resolve=>{releaseAccepted=resolve;});
  const generation=info.project.name+'-'+navigation;
  const control=async(op:string)=>{
    const response=await request.get('http://127.0.0.1:3004/__native_gate?'+new URLSearchParams({generation,id,op}),{headers:{'x-native-test-runner':'native-document-fixture-v1'}});
    expect(response.status()).toBe(200);return response.json();
  };
  await page.exposeBinding('__nativeAdmissionObserved',(_source,value)=>{if(typeof value==='string'&&/^paper_sim_[A-Za-z0-9_.-]+$/.test(value))observedId=value;});
  await page.addInitScript(key=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){original.call(this,k,v);if(this===sessionStorage&&k===key&&v.startsWith('paper_sim_'))void (window as unknown as {__nativeAdmissionObserved:(id:string)=>Promise<void>}).__nativeAdmissionObserved(v);};
  },admissionKey);
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(createPath)) posts++; });
  await page.route(`**${createPath}`,async route=>{
    const response=await route.fetch();expect(response.status()).toBe(202);id=(await response.json()).simulationRunId;
    await control('arm');await acceptedGate;await route.fulfill({response});
  });
  try {
    await prepare(page, 'native-held-' + navigation);
    const session=await page.context().newCDPSession(page);
    const history=await session.send('Page.getNavigationHistory');
    const backEntry=history.entries[history.currentIndex-1];expect(backEntry.url).toMatch(/step=2$/);
    await page.getByRole('button', { name: 'paper 실행 시작' }).click({ noWaitAfter: true });
    await expect.poll(()=>id).not.toBe('');
    await expect(page.getByRole('heading',{name:'새 실험',exact:true})).toBeVisible();
    const list=page.getByRole('link',{name:'← 실험 목록',exact:true});await expect(list).toHaveAttribute('href','/dashboard');
    await list.scrollIntoViewIfNeeded();const box=await list.boundingBox();expect(box).not.toBeNull();
    releaseAccepted();
    await expect.poll(async()=>id?(await control('state')).started:false).toBe(true);
    expect(await control('state')).toMatchObject({started:true,released:false,closed:false,finished:false});
    await expect.poll(()=>observedId).toBe(id);
    if (navigation === 'list') {
      const x=box!.x+box!.width/2,y=box!.y+box!.height/2;
      await session.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
      await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    } else await session.send('Page.navigateToHistoryEntry',{entryId:backEntry.id});
    const latest = navigation === 'list' ? /\/dashboard$/ : /step=2$/;
    await expect(page).toHaveURL(latest);await control('release');released=true;
    await expect.poll(async()=>{const state=await control('state');return state.finished||state.closed;}).toBe(true);await expect(page).toHaveURL(latest);
    if (navigation === 'list') await expect(page.getByRole('heading', { name: '실험', exact: true })).toBeVisible();
    else { await page.getByRole('button', { name: '다음', exact: true }).click(); await restored(page, id); }
    expect(posts).toBe(1);
  } finally { releaseAccepted();if(id)await control('release');await info.attach('native-race', { body: JSON.stringify({ navigation, id, observedId, posts, released, latest: page.url(),gate:id?await control('state'):null }), contentType: 'application/json' }); }
});
for(const navigation of ['list','back','step']) test(`manual same-ID pending document yields to newer ${navigation}`,async({page,request},info)=>{
  let posts=0,id='';const generation=info.project.name+'-manual-'+navigation;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith(createPath))posts++;});
  const control=async(op:string)=>{const response=await request.get('http://127.0.0.1:3004/__native_gate?'+new URLSearchParams({generation,id,op}),{headers:{'x-native-test-runner':'native-document-fixture-v1'}});expect(response.status()).toBe(200);return response.json();};
  await prepare(page,'native-manual-'+navigation);await page.getByRole('button',{name:'paper \uC2E4\uD589 \uC2DC\uC791'}).click();
  await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();id=new URL(page.url()).pathname.split('/').at(-1)!;
  await page.goBack({waitUntil:'commit'});await restored(page,id);await page.reload();await restored(page,id);
  const session=await page.context().newCDPSession(page);const history=await session.send('Page.getNavigationHistory');const previous=history.entries[history.currentIndex-1];expect(previous.url).toMatch(/step=2$/);
  const target=navigation==='step'?page.getByRole('button',{name:'\uC774\uC804',exact:true}):page.getByRole('link',{name:'\u2190 \uC2E4\uD5D8 \uBAA9\uB85D',exact:true});
  await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();expect(box).not.toBeNull();
  await page.getByRole('link',{name:'\uAC19\uC740 ID \uC0C1\uD0DC \uC870\uD68C'}).evaluate(anchor=>(anchor as HTMLElement).focus({preventScroll:true}));
  await control('arm');
  try {
    await session.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await session.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await expect.poll(async()=>(await control('state')).started).toBe(true);expect(await control('state')).toMatchObject({released:false,closed:false,finished:false});
    if(navigation==='back')await session.send('Page.navigateToHistoryEntry',{entryId:previous.id});
    else {const x=box!.x+box!.width/2,y=box!.y+box!.height/2;await session.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});}
    const latest=navigation==='list'?/\/dashboard$/:/step=2$/;await expect(page).toHaveURL(latest);
    await control('release');await expect.poll(async()=>{const state=await control('state');return state.closed||state.finished;}).toBe(true);
    await expect(page).toHaveURL(latest);if(navigation!=='list'){await page.getByRole('button',{name:'\uB2E4\uC74C',exact:true}).click();await restored(page,id);}expect(posts).toBe(1);
  } finally {await control('release');await info.attach('manual-native-race',{body:JSON.stringify({id,navigation,posts,url:page.url(),gate:await control('state')}),contentType:'application/json'});}
});
for(const replacement of ['list','step','back'])test(`held replacement native ${replacement} document yields to a newer wizard navigation`,async({page,request},info)=>{
  let posts=0,id='';page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith(createPath))posts++;});
  const control=async(which:string,op:string)=>{const response=await request.get('http://127.0.0.1:3004/__native_gate?'+new URLSearchParams({generation:info.project.name+'-chain-'+replacement+'-'+which,id,op,destination:which==='replacement'?(replacement==='list'?'list':'step2'):'detail'}),{headers:{'x-native-test-runner':'native-document-fixture-v1'}});expect(response.status()).toBe(200);return response.json();};
  await prepare(page,'native-chain-'+replacement);await page.getByRole('button',{name:'paper \uC2E4\uD589 \uC2DC\uC791'}).click();await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();id=new URL(page.url()).pathname.split('/').at(-1)!;
  await page.goBack({waitUntil:'commit'});await restored(page,id);await page.reload();await restored(page,id);
  const session=await page.context().newCDPSession(page),history=await session.send('Page.getNavigationHistory'),previous=history.entries[history.currentIndex-1];expect(previous.url).toMatch(/step=2$/);
  const list=page.getByRole('link',{name:'\u2190 \uC2E4\uD5D8 \uBAA9\uB85D',exact:true}),step=page.getByRole('button',{name:'\uC774\uC804',exact:true});
  // Measure each target at its own visible scroll position before a GET is pending.
  await list.scrollIntoViewIfNeeded();const listBox=await list.boundingBox(),listScroll=await page.evaluate(()=>window.scrollY);
  await step.scrollIntoViewIfNeeded();const stepBox=await step.boundingBox(),stepScroll=await page.evaluate(()=>window.scrollY);let scroll=stepScroll;
  expect(listBox).not.toBeNull();expect(stepBox).not.toBeNull();
  await page.getByRole('link',{name:'\uAC19\uC740 ID \uC0C1\uD0DC \uC870\uD68C'}).evaluate(anchor=>(anchor as HTMLElement).focus({preventScroll:true}));
  const click=async(box:NonNullable<typeof listBox>)=>{const targetScroll=box===listBox?listScroll:stepScroll;if(scroll!==targetScroll){await session.send('Input.synthesizeScrollGesture',{x:100,y:300,yDistance:scroll-targetScroll,speed:10000,gestureSourceType:'mouse'});scroll=targetScroll;}const x=box.x+box.width/2,y=box.y+box.height/2;await session.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await session.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
  await control('detail','arm');await control('replacement','arm');
  try {
    await session.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await session.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await expect.poll(async()=>(await control('detail','state')).started).toBe(true);
    if(replacement==='back')await session.send('Page.navigateToHistoryEntry',{entryId:previous.id});else await click(replacement==='list'?listBox!:stepBox!);
    await expect.poll(async()=>(await control('replacement','state')).started).toBe(true);expect(await control('replacement','state')).toMatchObject({released:false,closed:false,finished:false});
    await click(replacement==='list'?stepBox!:listBox!);const latest=replacement==='list'?/step=2$/:/\/dashboard$/;
    await expect(page).toHaveURL(latest);
    for(const which of ['replacement','detail']){await control(which,'release');await expect.poll(async()=>{const state=await control(which,'state');return state.closed||state.finished;}).toBe(true);await expect(page).toHaveURL(latest);}
    if(replacement==='list'){await expect(page.getByRole('heading',{name:/^2\./})).toBeVisible();await page.getByRole('button',{name:'\uB2E4\uC74C',exact:true}).click();await restored(page,id);}else await expect(page.getByRole('heading',{name:'\uC2E4\uD5D8',exact:true})).toBeVisible();
    expect(posts).toBe(1);
  } finally {await control('replacement','release');await control('detail','release');await info.attach('native-replacement-chain',{body:JSON.stringify({replacement,id,posts,url:page.url(),detail:await control('detail','state'),next:await control('replacement','state')}),contentType:'application/json'});}
});
test('native document completes while old synthetic RSC response remains held',async({page},info)=>{
  let posts=0,id='',held=0,released=false;const events:string[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith(createPath))posts++;if(r.isNavigationRequest()&&r.url().includes('/dashboard/lab/runs/'))events.push('document:'+held+':'+released);});
  page.on('requestfailed',r=>{if(r.headers().rsc==='1')events.push('rsc-requestfailed');});
  await page.route('**/dashboard/lab/runs/**',async route=>{if(route.request().headers().rsc==='1'){held++;events.push('rsc-held');await gate;await route.abort().catch(()=>{});}else await route.continue();});
  await page.route(`**${createPath}`,async route=>{const response=await route.fetch();expect(response.status()).toBe(202);id=(await response.json()).simulationRunId;await page.evaluate(id=>{void fetch('/dashboard/lab/runs/'+id+'?_rsc=synthetic-held-proof',{headers:{RSC:'1'}}).catch(()=>{});},id);await expect.poll(()=>held).toBe(1);await route.fulfill({response});});
  try {
    await prepare(page,'native-held-rsc');const accepted=page.waitForResponse(r=>r.url().endsWith(createPath));await page.getByRole('button',{name:'paper \uC2E4\uD589 \uC2DC\uC791'}).click();expect((await accepted).status()).toBe(202);
    await expect(page).toHaveURL(new RegExp('/dashboard/lab/runs/'+id+'$'));await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();
    expect(events).toContain('document:1:false');expect(released).toBe(false);expect(held).toBe(1);expect(posts).toBe(1);
  } finally {released=true;release();await info.attach('held-rsc-native',{body:JSON.stringify({id,posts,held,events,released}),contentType:'application/json'});}
});
for(const restoration of ['actual-bfcache','synthetic-pageshow'])test(`filled validation receipt and token clear on ${restoration}`,async({page},info)=>{
  let posts=0,validations=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith(createPath))posts++;if(r.method()==='POST'&&r.url().endsWith('/experiments/validate'))validations++;});
  await page.addInitScript(()=>window.addEventListener('pageshow',event=>{const events=JSON.parse(sessionStorage.getItem('synthetic-filled-pageshow')??'[]');events.push({persisted:event.persisted,path:location.pathname});sessionStorage.setItem('synthetic-filled-pageshow',JSON.stringify(events));}));
  await prepare(page,'native-filled-'+restoration);const token=page.getByLabel('\uC2E4\uD589 \uC2B9\uC778 \uD1A0\uD070'),create=page.getByRole('button',{name:'paper \uC2E4\uD589 \uC2DC\uC791'});
  await expect(create).toBeEnabled();await expect(token).not.toHaveValue('');
  if(restoration==='actual-bfcache'){await page.goto('/dashboard');await page.goBack({waitUntil:'commit'});}else await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await expect(token).toHaveValue('');await expect(create).toBeDisabled();
  // Re-entering only a token proves the old receipt itself was invalidated.
  await token.fill('synthetic-new-token');await expect(create).toBeDisabled();await expect(page.getByRole('button',{name:'\uD604\uC7AC \uC785\uB825 \uAC80\uC99D'})).toBeEnabled();
  const events=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('synthetic-filled-pageshow')??'[]'));
  if(restoration==='actual-bfcache')expect(events.some((e:{persisted:boolean;path:string})=>e.persisted&&e.path==='/dashboard/experiments/new')).toBe(true);
  expect(posts).toBe(0);expect(validations).toBe(1);await info.attach('filled-restoration',{body:JSON.stringify({restoration,posts,validations,events}),contentType:'application/json'});
});
test('accepted ID storage failure stays accepted and pageshow retains the in-memory ID', async ({ page }) => {
  let posts = 0; let detailDocuments = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(createPath)) posts++; if (r.isNavigationRequest() && new URL(r.url()).pathname.startsWith('/dashboard/lab/runs/')) detailDocuments++; });
  await prepare(page, 'native-storage-failure');
  await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (this === sessionStorage && k === key && v.startsWith('paper_sim_')) throw new Error('synthetic storage rejection'); return original.call(this, k, v); }; }, admissionKey);
  const accepted = page.waitForResponse(r => r.url().endsWith(createPath));
  await page.getByRole('button', { name: 'paper 실행 시작' }).click(); const id = (await (await accepted).json()).simulationRunId;
  await expect(page.getByRole('status')).toContainText('ID를 저장하지 못했습니다'); await restored(page, id);
  expect(detailDocuments).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await restored(page, id); expect(posts).toBe(1);
});
test('failed detail document GET preserves accepted ID and barrier on recovery', async ({ page }, info) => {
  let posts = 0; let id = ''; page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(createPath)) posts++; if (r.isNavigationRequest() && new URL(r.url()).pathname.startsWith('/dashboard/lab/runs/')) id = new URL(r.url()).pathname.split('/').at(-1)!; });
  await page.route('**/dashboard/lab/runs/**', route => route.request().isNavigationRequest() ? route.abort('connectionfailed') : route.continue());
  await prepare(page, 'native-get-failure');
  const accepted = page.waitForResponse(r => r.url().endsWith(createPath));
  await page.getByRole('button', { name: 'paper 실행 시작' }).click(); expect((await accepted).status()).toBe(202);
  await expect.poll(() => page.url()).toMatch(/(?:chrome-error|\/dashboard\/lab\/runs\/)/);
  await page.goBack({ waitUntil: 'commit' }).catch(() => {});
  if (!page.url().includes('/experiments/new')) await page.goto('/dashboard/experiments/new?step=3');
  await restored(page, id); expect(posts).toBe(1);
  await info.attach('failed-get-recovery', { body: JSON.stringify({ id, posts, url: page.url() }), contentType: 'application/json' });
});
test('actual BFCache pageshow synchronizes exact ID, empty token, invalid validation and lock', async ({ page }, info) => {
  let posts = 0; page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(createPath)) posts++; });
  await page.addInitScript(() => window.addEventListener('pageshow', event => {
    const events = JSON.parse(sessionStorage.getItem('synthetic-pageshow-events') ?? '[]');
    events.push({ persisted: event.persisted, path: location.pathname }); sessionStorage.setItem('synthetic-pageshow-events', JSON.stringify(events));
  }));
  await prepare(page, 'native-bfcache');
  const accepted = page.waitForResponse(r => r.url().endsWith(createPath));
  await page.getByRole('button', { name: 'paper 실행 시작' }).click(); expect((await accepted).status()).toBe(202);
  await expect(page.getByRole('heading', { name: 'Run Detail', exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(await page.evaluate(key => sessionStorage.getItem(key), admissionKey)).toBe(id);
  await page.goBack({ waitUntil: 'commit' }); await restored(page, id);
  const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('synthetic-pageshow-events') ?? '[]'));
  await info.attach('actual-pageshow', { body: JSON.stringify({ id, posts, events }), contentType: 'application/json' });
  expect(events.some((e: { persisted: boolean; path: string }) => e.persisted && e.path === '/dashboard/experiments/new')).toBe(true);
  await page.goForward({ waitUntil: 'commit' }); await expect(page.getByRole('heading', { name: 'Run Detail', exact: true })).toBeVisible();
  await page.goBack({ waitUntil: 'commit' }); await restored(page, id); expect(posts).toBe(1);
});
