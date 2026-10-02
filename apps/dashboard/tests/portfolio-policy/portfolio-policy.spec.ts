import { test, expect } from "@playwright/test";
import {
  expectNoAxeViolations, expectPortfolioHedgeDisplay, expectPortfolioPolicyApi,
  expectPortfolioTableKeyboardAccess
} from "./assertions";
import { missingPolicyWarning, readPortfolioScenario } from "./scenarios.mjs";

const scenario = readPortfolioScenario(process.env.PORTFOLIO_E2E_SCENARIO);

test(`portfolio hedge contract with ${scenario} policy stays read-only and accessible`, async ({ page, request }) => {
  await expectPortfolioPolicyApi(request, "http://127.0.0.1:8790", scenario);
  await page.goto("/dashboard/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio Compliance", exact: true })).toBeVisible();
  await expect(page.getByText("Paper-only portfolio")).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("read-only", { exact: true })).toBeVisible();
  await expect(page.getByText("not exposed", { exact: true })).toBeVisible();
  await expectPortfolioHedgeDisplay(page, scenario);
  if (scenario === "missing") {
    await expect(page.getByText(missingPolicyWarning)).toBeVisible();
  } else {
    await expect(page.getByText(missingPolicyWarning)).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /order|trade|buy|sell/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /order|trade|buy|sell/i })).toHaveCount(0);
  await expectPortfolioTableKeyboardAccess(page);
  await expectNoAxeViolations(page);
});
