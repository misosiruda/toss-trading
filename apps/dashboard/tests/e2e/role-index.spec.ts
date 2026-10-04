import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const status = process.env.UX07_LEGACY_STATUS ?? 'missing';
for (const [role, title, destination, label] of [
  ['strategy','전략·정책','/dashboard/lab/policies','정책 작성·검증'],
  ['data','데이터','/dashboard/validation#data-universe-coverage','데이터 범위·coverage'],
  ['settings','설정·운영','/dashboard/operations','기존 운영 요약']
]) {
  test(`UX07 ${role} ${status}: accessible index, fixed compatibility and native history`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const route = `/dashboard/${role}?returnTo=https://evil.example.test#untrusted`;
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/dashboard/${role}\\?returnTo=`));
    await expect(page).toHaveTitle(/dashboard/i);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('[data-compatibility-status]')).toHaveAttribute('data-compatibility-status', status);
    const external = page.locator('a[href^="http"]');
    if (status === 'configured') {
      await expect(external).toHaveCount(1);
      const href = await external.getAttribute('href');
      expect(new URL(href!).origin).toBe('https://legacy.example.test');
      expect(new URL(href!).pathname).toMatch(/^\/dashboard(?:\/|$)/);
      await external.focus(); await expect(external).toBeFocused();
    } else {
      await expect(external).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText(status === 'missing' ? '설정되지 않았습니다' : '유효하지 않아');
      await expect(page.locator('body')).not.toContainText('fixture-secret');
    }
    const summary = page.getByText('문서와 접근 조건', { exact: true });
    await summary.focus(); await expect(summary).toBeFocused(); await summary.press('Enter');
    await expect(page.getByText('docs/runbooks/ai-paper-trading-runbook.md')).toBeVisible();
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (root: Document, options: object) => Promise<{ violations: unknown[] }> } }).axe;
      return (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } })).violations;
    });
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${role}-${status}.png`), fullPage: true });
    const link = page.getByRole('link', { name: label, exact: true });
    await link.focus(); await expect(link).toBeFocused(); await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(page.getByRole('main')).toHaveCount(1);
    if (role === 'data') await expect(page.locator('#data-universe-coverage')).toBeFocused();
    await page.goBack(); await expect(page).toHaveURL(new RegExp(`/dashboard/${role}\\?returnTo=.*#untrusted$`));
    await page.reload(); await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('[data-compatibility-status]')).toHaveAttribute('data-compatibility-status', status);
    expect(errors).toEqual([]);
  });
}
