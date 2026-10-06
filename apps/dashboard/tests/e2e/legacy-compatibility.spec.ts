import { test, expect } from '@playwright/test';

const legacyOrigin = 'http://127.0.0.1:8789';
for (const [role, path, panel] of [
  ['strategy', '/dashboard/virtual/simulations/current', 'active-simulation'],
  ['data', '/dashboard/virtual/validation', 'validation'],
  ['settings', '/dashboard', 'live'],
] as const) {
  test('fixed legacy compatibility destination preserves '+role+' access and Back', async ({page})=>{
    const writes:string[]=[];const errors:string[]=[];
    page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/dashboard/'+role+'?returnTo=https://untrusted.example.test');
    await expect(page.locator('[data-compatibility-status]')).toHaveAttribute('data-compatibility-status','configured');
    const link=page.locator('a[href="'+legacyOrigin+path+'"]');
    await expect(link).toHaveCount(1);await link.focus();await expect(link).toBeFocused();await link.press('Enter');
    await expect(page).toHaveURL(legacyOrigin+path);
    await expect(page.locator('#legacy-compat-heading')).toBeVisible();
    await expect(page.locator('[data-dashboard-page]').filter({visible:true}).first()).toBeVisible();
    await expect(page.locator('[data-dashboard-page~="'+panel+'"]').first()).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    const geometry=await page.evaluate(()=>({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll("*")].map(e=>({tag:e.tagName,id:e.id,className:e.className,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,overflow:getComputedStyle(e).overflowX})).filter(e=>e.display!=="none"&&e.rect.width>0&&e.rect.right>window.innerWidth+1).slice(0,30)}));
    if(geometry.scrollWidth>geometry.width) console.log(JSON.stringify(geometry));
    expect(geometry.scrollWidth <= geometry.width).toBe(true);
    await page.goBack();await expect(page).toHaveURL(new RegExp('/dashboard/'+role+'\\?returnTo='));
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    expect(writes).toEqual([]);expect(errors).toEqual([]);
  });
}
for(const [path,panel] of [
  ['/dashboard','live'],['/dashboard/virtual','virtual'],
  ['/dashboard/virtual/simulations','history'],
  ['/dashboard/virtual/simulations/new','new-simulation'],
  ['/dashboard/virtual/simulations/current','active-simulation'],
  ['/dashboard/virtual/validation','validation'],
] as const){
  test('legacy fixed route '+path+' serves its existing panel without create',async({page})=>{
    const writes:string[]=[];const errors:string[]=[];
    page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
    page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(legacyOrigin+path);
    expect(response?.status()).toBe(200);expect(response?.headers()['content-type']).toContain('text/html');
    await expect(page).toHaveURL(legacyOrigin+path);
    await expect(page.locator('#legacy-compat-heading')).toBeVisible();
    await expect(page.locator('[data-dashboard-page~="'+panel+'"]').first()).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    const geometry=await page.evaluate(()=>({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll("*")].map(e=>({tag:e.tagName,id:e.id,className:e.className,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,overflow:getComputedStyle(e).overflowX})).filter(e=>e.display!=="none"&&e.rect.width>0&&e.rect.right>window.innerWidth+1).slice(0,30)}));
    if(geometry.scrollWidth>geometry.width) console.log(JSON.stringify(geometry));
    expect(geometry.scrollWidth <= geometry.width).toBe(true);
    expect(writes).toEqual([]);expect(errors).toEqual([]);
  });
}
