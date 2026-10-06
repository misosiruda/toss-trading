import {test,expect} from '@playwright/test';
test('early native detail cancellation keeps initial chunks able to hydrate filters',async({page})=>{
  let releaseChunks!:()=>void;
  const chunks=new Promise<void>(r=>releaseChunks=r);
  let detailRequests=0;
  const failedChunks:string[]=[];
  page.on('requestfailed',r=>{if(new URL(r.url()).pathname.endsWith('.js'))failedChunks.push(r.url());});
  await page.route('**/_next/**/*.js',async route=>{const response=await route.fetch();await chunks;await route.fulfill({response}).catch(()=>{});});
  await page.route('**/dashboard/lab/runs/-_run_000000_202601',async route=>{detailRequests++;await route.continue();});
  try{
    await page.goto('/dashboard?extra=bootstrap',{waitUntil:'commit'});
    await expect(page.locator('#experiment-query')).toBeDisabled();
    const box=await page.locator('a[href="#experiment-source-summary"]').boundingBox();expect(box).not.toBeNull();
    await page.getByTestId('experiment-row').getByRole('link',{name:'-_run_000000_202601',exact:true}).evaluate((anchor:HTMLAnchorElement)=>anchor.click());
    await page.mouse.click(box!.x+box!.width/2,box!.y+box!.height/2);
    releaseChunks();await page.unrouteAll({behavior:'wait'});
    await expect(page).toHaveURL(/\/dashboard\?extra=bootstrap#experiment-source-summary$/);
    await expect(page.locator('#experiment-query')).toBeEnabled();
    expect(failedChunks).toEqual([]);
    expect(detailRequests).toBe(0);
  }finally{releaseChunks();}
});
test('an uninterrupted early row intent activates the exact document after initial load',async({page})=>{
  let releaseChunks!:()=>void;const chunks=new Promise<void>(r=>releaseChunks=r);
  await page.route('**/_next/**/*.js',async route=>{const response=await route.fetch();await chunks;await route.fulfill({response}).catch(()=>{});});
  const documentRequest=page.waitForRequest(r=>r.isNavigationRequest()&&new URL(r.url()).pathname==='/dashboard/lab/runs/-_run_000000_202601');
  try{
    await page.goto('/dashboard',{waitUntil:'commit'});await expect(page.locator('#experiment-query')).toBeDisabled();
    await page.getByTestId('experiment-row').getByRole('link',{name:'-_run_000000_202601',exact:true}).evaluate((anchor:HTMLAnchorElement)=>anchor.click());
    releaseChunks();expect((await documentRequest).method()).toBe('GET');
    await expect(page).toHaveURL(/\/dashboard\/lab\/runs\/-_run_000000_202601$/);
    await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();
  }finally{releaseChunks();}
});
