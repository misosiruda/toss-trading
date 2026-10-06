import {test,expect,type Page} from '@playwright/test';
const id='-_run_000000_202601',detail='/dashboard/lab/runs/'+id;
async function point(page:Page,selector:string){const target=page.locator(selector);await expect(target).toBeVisible();const box=await target.boundingBox();expect(box).not.toBeNull();return {x:box!.x+box!.width/2,y:box!.y+box!.height/2};}
async function hold(page:Page){
  let ready!:()=>void,release!:()=>void;
  const received=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>release=r);
  const failed=page.waitForEvent('requestfailed',r=>r.isNavigationRequest()&&new URL(r.url()).pathname===detail);
  await page.route('**'+detail,async route=>{const response=await route.fetch();expect(response.status()).toBe(200);expect(await response.text()).toContain('Run Detail');ready();await gate;await route.fulfill({response}).catch(()=>{});});
  return {received,release,failed};
}
for(const action of ['query','status','clear','fragment','back','forward','new-document'] as const){
  test('held detail yields to newer '+action,async({page,request})=>{
    await page.goto('/dashboard?extra=retained');await expect(page.locator('#experiment-query')).toBeEnabled();
    if(action==='back'||action==='forward'){
      await page.locator('#experiment-query').fill('run');await page.locator('form[role=search] button[type=submit]').click();
      if(action==='forward'){await page.goBack();await expect(page).toHaveURL(/extra=retained$/);}
    }
    const input=await point(page,'#experiment-query'),status=await point(page,'#experiment-status');
    const clear=await point(page,'form[role=search] button[type=button]');
    const fragment=await point(page,'a[href="#experiment-source-summary"]');
    const other=await point(page,'a[href="/dashboard/experiments/new"]');
    const fetchedAt=await page.getByTestId('source-fetched-at').textContent();
    const cdp=(action==='back'||action==='forward')?await page.context().newCDPSession(page):null;
    const history=cdp?await cdp.send('Page.getNavigationHistory'):null;
    const historyTarget=history?.entries[history.currentIndex+(action==='back'?-1:1)].id;
    const held=await hold(page);
    const link=page.getByTestId('experiment-row').getByRole('link',{name:id,exact:true});
    await link.evaluate((anchor:HTMLAnchorElement)=>anchor.click());await held.received;
    const beforeCalls=await(await request.get('http://127.0.0.1:8796/__calls')).json();
    const beforeListReads=beforeCalls.filter((c:{path:string,id:string|null})=>c.path==='/batch/replay/runs'&&c.id===null).length;
    // No Frame.evaluate/locator RPC while native navigation is pending.
    if(action==='query'){await page.mouse.click(input.x,input.y);await page.keyboard.type('latest');await page.keyboard.press('Enter');}
    if(action==='status'){await page.mouse.click(status.x,status.y);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
    if(action==='clear')await page.mouse.click(clear.x,clear.y);
    if(action==='fragment')await page.mouse.click(fragment.x,fragment.y);
    if(action==='new-document')await page.mouse.click(other.x,other.y);
    if(action==='back'||action==='forward'){
      // Browser history command, without JavaScript evaluation waiting behind
      // the retained document's pending navigation.
      await cdp!.send('Page.navigateToHistoryEntry',{entryId:historyTarget!});await cdp!.detach();
    }
    held.release();await page.unrouteAll({behavior:'wait'});
    expect((await held.failed).failure()?.errorText).toContain('ABORTED');
    if(action==='new-document'){await expect(page).toHaveURL(/\/dashboard\/experiments\/new$/);return;}
    await expect(page).toHaveURL(url=>url.pathname==='/dashboard'&&url.searchParams.get('extra')==='retained');
    await expect(page.getByTestId('source-fetched-at')).toHaveText(fetchedAt!);
    if(action==='query'){await expect(page).toHaveURL(url=>url.searchParams.get('q')==='latest');await expect(page.locator('#experiment-query')).toBeFocused();}
    if(action==='status')await expect(page).toHaveURL(url=>url.searchParams.get('status')==='running');
    if(action==='clear'){await expect(page).toHaveURL(url=>!url.searchParams.has('q')&&!url.searchParams.has('status'));await expect(page.locator('#experiment-query')).toBeFocused();}
    if(action==='fragment'){await expect(page).toHaveURL(/#experiment-source-summary$/);await expect(page.locator('#experiment-source-summary')).toBeFocused();}
    if(action==='back')await expect(page).toHaveURL(url=>!url.searchParams.has('q'));
    if(action==='forward')await expect(page).toHaveURL(url=>url.searchParams.get('q')==='run');
    const calls=await(await request.get('http://127.0.0.1:8796/__calls')).json();expect(calls.every((c:{method:string})=>c.method==='GET')).toBe(true);
    expect(calls.filter((c:{path:string,id:string|null})=>c.path==='/batch/replay/runs'&&c.id===null).length).toBe(beforeListReads);
  });
}
test('modifier opens a separate native detail and preserves draft and list URL',async({page,context})=>{
  await page.goto('/dashboard?extra=retained');await expect(page.locator('#experiment-query')).toBeEnabled();await page.locator('#experiment-query').fill('draft');
  const popup=context.waitForEvent('page');
  await page.getByTestId('experiment-row').getByRole('link',{name:id,exact:true}).click({modifiers:['Control']});
  const target=await popup;await target.waitForLoadState('domcontentloaded');await expect(target).toHaveURL(new RegExp(detail+'$'));
  await expect(target.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();await expect(page).toHaveURL(/\/dashboard\?extra=retained$/);await expect(page.locator('#experiment-query')).toHaveValue('draft');await target.close();
});
for(const action of ['fragment','new-document'] as const){
  test('SSR before hydration retains pending ownership for '+action,async({page})=>{
    await page.route('**/_next/**/*.js',route=>route.abort());
    await page.goto('/dashboard?extra=early');
    await expect(page.locator('#experiment-query')).toBeDisabled();
    const destination=await point(page,action==='fragment'?'a[href="#experiment-source-summary"]':'a[href="/dashboard/experiments/new"]');
    const held=await hold(page);
    await page.getByTestId('experiment-row').getByRole('link',{name:id,exact:true}).evaluate((anchor:HTMLAnchorElement)=>anchor.click());await held.received;
    await page.mouse.click(destination.x,destination.y);
    held.release();await page.unrouteAll({behavior:'wait'});
    expect((await held.failed).failure()?.errorText).toContain('ABORTED');
    if(action==='new-document')await expect(page).toHaveURL(/\/dashboard\/experiments\/new$/);
    else {await expect(page).toHaveURL(/\/dashboard\?extra=early#experiment-source-summary$/);await expect(page.locator('#experiment-query')).toBeDisabled();}
  });
}
