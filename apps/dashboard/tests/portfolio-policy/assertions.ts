import { expect, type APIRequestContext, type Page } from "@playwright/test";
import axe, { type AxeResults } from "axe-core";
import { missingPolicyWarning } from "./scenarios.mjs";

export async function expectPortfolioPolicyApi(
  request: APIRequestContext, baseUrl: string, scenario: string
) {
  const response = await request.get(`${baseUrl}/dashboard/view-model/portfolio-compliance`);
  expect(response.ok()).toBe(true);
  const view = await response.json();
  const active = scenario !== "missing";
  expect(view.mode).toBe("paper_only");
  expect(view.readOnly).toBe(true);
  expect(view.policyStatus).toBe(active ? "active" : "missing");
  expect(view.hedgeCompliance.policyEnabled).toBe(active ? scenario === "enabled" : null);
  expect(view.hedgeCompliance.status).toBe("ineffective");
  expect(view.complianceAnalytics.hedgeEffectiveness.status).toBe("ineffective");
  if (active) {
    expect(view.sourceStatus.policyArtifacts).toBe("ok");
    expect(view.activePolicy).toMatchObject({ effectiveFrom: "2026-06-27T00:00:00.000Z" });
    expect(view.activePolicy.policyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(view.warnings).not.toContain(missingPolicyWarning);
  } else {
    expect(view.activePolicy).toBeNull();
    expect(view.warnings).toContain(missingPolicyWarning);
  }
}

export async function expectPortfolioHedgeDisplay(page: Page, scenario: string) {
  const breach = page.getByTestId("portfolio-breach-hedge");
  if (scenario === "enabled") {
    await expect(breach).toContainText("ineffective");
    await expect(breach.getByText("ineffective")).toHaveClass(/text-\[var\(--danger\)\]/);
  } else {
    await expect(breach).toHaveCount(0);
  }
  const analytics = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Hedge Effectiveness", exact: true })
  });
  await expect(analytics.getByText("ineffective", { exact: true })).toBeVisible();
}

export async function expectNoAxeViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => (
    window as typeof window & { axe: { run: () => Promise<AxeResults> } }
  ).axe.run());
  expect(accessibility.violations).toEqual([]);
}

export async function expectPortfolioTableKeyboardAccess(page: Page) {
  const allocation = page.getByRole("region", { name: "Bucket allocation table scroll area", exact: true });
  const costs = page.getByRole("region", { name: "Bucket cost and turnover table scroll area", exact: true });
  // Enter from the preceding navigation control using the native tab order.
  await page.getByRole("navigation", { name: "Portfolio compliance navigation" })
    .getByRole("link", { name: "Audit", exact: true }).focus();
  for (const area of [allocation, costs]) {
    await page.keyboard.press("Tab");
    await expect(area).toBeFocused();
    await expect(area).toHaveAttribute("tabindex", "0");
    await expect(area).toHaveCSS("outline-style", "solid");
    await expect(area).toHaveCSS("outline-width", "2px");
    const overflow = await area.evaluate((element) => element.scrollWidth > element.clientWidth);
    // Both fixtures overflow on mobile; desktop may fit the narrower cost table.
    if ((page.viewportSize()?.width ?? 0) < 500) expect(overflow).toBe(true);
    if (overflow) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => area.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
  }
  // Focus can leave the second region in reverse order without a scroll trap.
  await page.keyboard.press("Shift+Tab");
  await expect(allocation).toBeFocused();
}
