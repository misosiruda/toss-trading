import {test,expect} from '@playwright/test';
// header 배치는 PR805 소유이며 provenance adapter와 독립적으로 검증한다.
test('header comparison link has independent spacing and compact keyboard grid',async({page})=>{
  await page.goto('/dashboard');
  const compare=page.locator('header a[href="/dashboard/experiments/compare"]');
  const create=page.locator('header a[href="/dashboard/experiments/new"]');
  await expect(page.getByText('Dashboard data loading', { exact: true })).toHaveCount(0);
  await expect(compare).toBeVisible();
  await expect(create).toBeVisible();
  await expect(compare).toHaveCSS('margin-top','0px');
  expect((await compare.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  if(page.viewportSize()!.width<=450){
    await expect(compare).toHaveCSS('grid-column-start','1');
    await expect(compare).toHaveCSS('grid-column-end','-1');
    await expect(compare).toHaveCSS('grid-row-start','3');
    await expect(create).toHaveCSS('grid-column-start','2');
    await expect(create).toHaveCSS('grid-row-start','1');
    const a=(await compare.boundingBox())!,b=(await create.boundingBox())!;
    expect(a.y).toBeGreaterThanOrEqual(b.y+b.height);
  }
  await create.focus();await page.keyboard.press('Tab');await expect(compare).toBeFocused();
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/dashboard\/experiments\/compare$/);
  await page.goBack();await expect(compare).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
