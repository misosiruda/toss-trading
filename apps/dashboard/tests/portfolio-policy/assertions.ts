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
