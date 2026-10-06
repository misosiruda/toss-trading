import {test,expect} from '@playwright/test';
test('replacing held detail closes mobile menu before either document commits',async({page,isMobile})=>{
 test.skip(!isMobile,"Mobile overlay contract.");
 await page.goto('/dashboard');await expect(page.locator('#experiment-query')).toBeEnabled();
 const menu=page.locator('details').filter({has:page.locator('nav[aria-label="모바일 주 메뉴"]')});
 await menu.locator(':scope > summary').click();await menu.locator('details').locator(':scope > summary').click();
 const destination=menu.locator('a[href="/dashboard/operations"]');await expect(destination).toBeVisible();
 const box=await destination.boundingBox();expect(box).not.toBeNull();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Runtime.enable');await cdp.send('Runtime.addBinding',{name:'__reportMenuReplacement'});
 const observed=new Promise(resolve=>cdp.on('Runtime.bindingCalled',e=>{if(e.name==='__reportMenuReplacement')resolve(JSON.parse(e.payload));}));
 let oldReady,newReady,releaseOld,releaseNew;
 const oldReceived=new Promise(r=>oldReady=r),newReceived=new Promise(r=>newReady=r),oldGate=new Promise(r=>releaseOld=r),newGate=new Promise(r=>releaseNew=r);
 await page.route('**/dashboard/lab/runs/-_run_000000_202601',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);oldReady();await oldGate;await route.fulfill({response}).catch(()=>{});});
 await page.route('**/dashboard/operations',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);newReady();await newGate;await route.fulfill({response}).catch(()=>{});});
 // Observe synchronously after React's delegated click handlers, without a
 // Frame evaluation blocked by intentionally pending navigation.
 await page.evaluate(()=>{document.addEventListener('click',event=>{
  const a=event.target instanceof Element?event.target.closest('a'):null;
  if(a?.getAttribute('href')==='/dashboard/operations')requestAnimationFrame(()=>{
   const menu=document.querySelector('nav[aria-label="모바일 주 메뉴"]')?.closest('details');
   const focused=document.activeElement;
   window.__reportMenuReplacement(JSON.stringify({open:menu?.open,focusedHref:focused?.getAttribute('href'),focusInClosedMenu:menu?.contains(focused)}));
  });
 },true);});
 try{
  await page.getByTestId('experiment-row').getByRole('link',{name:'-_run_000000_202601',exact:true}).evaluate((a)=>a.click());await oldReceived;
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await newReceived;
  const state=await observed;expect(state.open).toBe(false);expect(state.focusInClosedMenu).toBe(false);
  releaseOld();releaseNew();await page.unrouteAll({behavior:'wait'});await expect(page).toHaveURL(/\/dashboard\/operations$/);
 }finally{releaseOld();releaseNew();await cdp.detach();}
});

for(const pending of [false,true])test('external native no-referrer anchor with pending='+pending,async({page})=>{
 await page.goto('/dashboard?extra=synthetic-referrer');await expect(page.locator('#experiment-query')).toBeEnabled();
 await page.evaluate(()=>{const a=document.createElement('a');a.href='http://127.0.0.1:8796/__synthetic_external';a.referrerPolicy='no-referrer';a.textContent='Synthetic external';a.id='external-policy-probe';a.style.cssText='position:fixed;left:10px;top:10px;z-index:99999';document.body.append(a);});
 const box=await page.locator('#external-policy-probe').boundingBox();
 let ready,release;const received=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
 if(pending)await page.route('**/dashboard/lab/runs/-_run_000000_202601',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response}).catch(()=>{});});
  const external=page.waitForRequest(r=>r.isNavigationRequest()&&new URL(r.url()).pathname==='/__synthetic_external');
  const externalResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/__synthetic_external');
 await page.route('http://127.0.0.1:8796/__synthetic_external',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><h1>Synthetic external destination</h1>'}));
 try{
  if(pending){await page.getByTestId('experiment-row').getByRole('link',{name:'-_run_000000_202601',exact:true}).evaluate((a)=>a.click());await received;}
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);const request=await external;expect(request.method()).toBe('GET');expect(request.headers().referer).toBeUndefined();
  const response=await externalResponse;expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('text/html');
  release();await expect(page).toHaveURL('http://127.0.0.1:8796/__synthetic_external');await expect(page.getByRole('heading')).toHaveText('Synthetic external destination');await page.unrouteAll({behavior:'wait'});
 }finally{release();}
});
