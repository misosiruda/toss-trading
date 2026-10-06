import { test, expect, type Page } from '@playwright/test';

const legacyOrigin = 'http://127.0.0.1:8789';
const batchResponse = (page: Page) => page.waitForResponse(response => {
  const url = new URL(response.url());
  return url.origin === legacyOrigin && url.pathname === '/batch/replay/runs';
});
async function assertBatchReady(page: Page, response: Awaited<ReturnType<typeof batchResponse>>) {
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  await expect(page.locator('#batch-run-source')).toContainText('batch-replay-runs.jsonl');
}
const panelSelector = (heading: string) => `section.panel[aria-labelledby="${heading}"]`;
async function assertLegacyPanel(page: Page, heading: string) {
  const panel = page.locator(panelSelector(heading));
  expect(await panel.count()).toBe(1);
  expect(await panel.isVisible()).toBe(true);
  expect(await panel.locator(`#${heading}`).isVisible()).toBe(true);
}
async function assertGeometry(page: Page) {
  const geometry = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(geometry.scrollWidth <= geometry.width).toBe(true);
}
for (const [role, path, heading] of [
  ['strategy', '/dashboard/virtual/simulations/current', 'replay-heading'],
  ['data', '/dashboard/virtual/validation', 'validation-center-heading'],
  ['settings', '/dashboard', 'live-status-heading'],
] as const) {
  test(`fixed legacy compatibility preserves ${role} panel and Back`, async ({ page }) => {
    const writes: string[] = []; const errors: string[] = [];
    page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/dashboard/' + role + '?returnTo=https://untrusted.example.test');
    await expect(page.locator('[data-compatibility-status]')).toHaveAttribute('data-compatibility-status', 'configured');
    const link = page.locator(`a[href="${legacyOrigin}${path}"]`);
    await expect(link).toHaveCount(1); await link.focus(); await expect(link).toBeFocused();
    const batch = batchResponse(page); await link.press('Enter');
    await expect(page).toHaveURL(legacyOrigin + path);
    await expect(page.locator('#legacy-compat-heading')).toBeVisible();
    await expect(page.locator(panelSelector(heading))).toBeVisible();
    await assertLegacyPanel(page, heading);
    await expect(page.locator('main')).toHaveCount(1);
    await assertBatchReady(page, await batch);
    await assertGeometry(page);
    await page.goBack(); await expect(page).toHaveURL(new RegExp('/dashboard/' + role + '\\?returnTo='));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}
for (const [path, heading] of [
  ['/dashboard', 'live-status-heading'], ['/dashboard/virtual', 'simulation-home-heading'],
  ['/dashboard/virtual/simulations', 'simulation-history-heading'],
  ['/dashboard/virtual/simulations/new', 'new-simulation-heading'],
  ['/dashboard/virtual/simulations/current', 'replay-heading'],
  ['/dashboard/virtual/validation', 'validation-center-heading'],
] as const) {
  test(`legacy fixed route ${path} serves its actual panel without create`, async ({ page }) => {
    const writes: string[] = []; const errors: string[] = [];
    page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    page.on('pageerror', e => errors.push(e.message));
    const batch = batchResponse(page);
    const response = await page.goto(legacyOrigin + path);
    expect(response?.status()).toBe(200); expect(response?.headers()['content-type']).toContain('text/html');
    await expect(page).toHaveURL(legacyOrigin + path);
    await expect(page.locator('#legacy-compat-heading')).toBeVisible();
    await expect(page.locator(panelSelector(heading))).toBeVisible();
    await assertLegacyPanel(page, heading);
    await expect(page.locator('main')).toHaveCount(1);
    await assertBatchReady(page, await batch);
    await assertGeometry(page);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}
test('panel oracle rejects hidden or removed sections even when the html page marker remains', async ({ page }) => {
  const batch = batchResponse(page);
  await page.goto(legacyOrigin + '/dashboard/virtual/simulations/current');
  await assertBatchReady(page, await batch);
  const panel = page.locator(panelSelector('replay-heading'));
  await expect(panel).toBeVisible(); await assertLegacyPanel(page, 'replay-heading');
  await panel.evaluate(element => { (element as HTMLElement).style.setProperty('display', 'none', 'important'); });
  await expect(page.locator('html')).toBeVisible();
  await expect(assertLegacyPanel(page, 'replay-heading')).rejects.toThrow();
  await panel.evaluate(element => element.remove());
  await expect(page.locator('html')).toBeVisible();
  await expect(assertLegacyPanel(page, 'replay-heading')).rejects.toThrow();
});
