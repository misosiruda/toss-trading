import {test,expect} from '@playwright/test';

const ids=['-synthetic_run_000000_2026-01','--_run_000000_202601','-_run_000000_202601'];
test('safe current and legacy child IDs survive list detail Back and reload',async({page})=>{
  for(const id of ids){
    await page.goto('/dashboard');
    await page.getByTestId('experiment-row').getByRole('link',{name:id,exact:true}).click();
    await expect(page).toHaveURL(new RegExp('/dashboard/lab/runs/'+id+'$'));
    await expect(page.getByRole('heading',{name:'Run Detail',exact:true})).toBeVisible();
    await expect(page.getByTestId('run-provenance')).toContainText(id);
    await page.reload();
    await expect(page.getByTestId('run-provenance')).toContainText(id);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('experiment-row').getByRole('link',{name:id,exact:true})).toBeVisible();
  }
});
test('comparison form accepts safe legacy child IDs and preserves exact GET identity',async({page,request})=>{
  await page.goto('/dashboard/experiments/compare');
  await page.locator('input[name=baseline]').fill(ids[0]);
  await page.locator('input[name=candidate]').fill(ids[1]);
  expect(await page.locator('form').evaluate((form:HTMLFormElement)=>form.checkValidity())).toBe(true);
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(url=>url.searchParams.get('baseline')===ids[0]&&url.searchParams.get('candidate')===ids[1]);
  for(const [role,id] of [['baseline',ids[0]],['candidate',ids[1]]]){
    await expect(page.getByTestId('comparison-'+role).getByTestId('run-provenance')).toContainText(id);
  }
  await page.reload();
  await expect(page.getByTestId('comparison-candidate').getByTestId('run-provenance')).toContainText(ids[1]);
  await page.getByTestId('comparison-candidate').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp('/dashboard/lab/runs/'+ids[1]+'$'));
  await page.goBack();
  await expect(page.getByTestId('comparison-baseline').getByTestId('run-provenance')).toContainText(ids[0]);
  const calls=await (await request.get('http://127.0.0.1:8796/__calls')).json();
  expect(calls.filter((call:{id:string})=>ids.includes(call.id)).every((call:{method:string})=>call.method==='GET')).toBe(true);
});
