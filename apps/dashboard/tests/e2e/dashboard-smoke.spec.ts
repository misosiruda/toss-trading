import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

type AxeRunResult = {
  violations: Array<{
    id: string;
    impact: string | null;
    nodes: Array<{ target: string[] }>;
  }>;
};

test("renders paper-only dashboard readiness without live mutation controls", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Paper-only Dashboard" })
  ).toBeVisible();
  await expect(page.getByText("Paper-only operations")).toBeVisible();
  await expect(page.getByText("TRADING_ENABLED")).toBeVisible();
  await expect(page.getByText("ViewModel API")).toBeVisible();
  await expect(page.getByText("4/4 online")).toBeVisible();
  await expect(page.getByText("configured operations endpoint")).toBeVisible();
  await expect(page.getByText("127.0.0.1:8789")).toHaveCount(0);
  await expect(page.getByText("OrderRouter")).toBeVisible();
  await expect(page.getByText("Mutation tools")).toBeVisible();

  await expect(
    page.getByText("Dashboard does not expose live broker mutation")
  ).toBeVisible();
  await expect(
    page.getByText("No live OrderIntent path is connected")
  ).toBeVisible();
  await expect(
    page.getByText("No raw command or place_order surface is present")
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Portfolio Compliance" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Strategy Test Lab" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Risk Gate Trace" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Validation Lab" })
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders paper policy builder draft validation without mutation controls", async ({
  page,
}) => {
  await page.goto("/dashboard/lab/policies");

  await expect(
    page.getByRole("heading", { name: "Paper Policy Builder" })
  ).toBeVisible();
  await expect(page.getByText("paper-only draft")).toBeVisible();
  await expect(page.getByText("not stored")).toBeVisible();
  await expect(page.getByText("required later")).toBeVisible();
  await expect(page.getByText("disabled")).toBeVisible();

  await expect(page.getByLabel("Policy name")).toHaveValue(
    "Balanced paper policy draft"
  );
  await expect(page.getByLabel("Long-term target")).toHaveValue("35");
  await expect(page.getByLabel("Target cash reserve")).toHaveValue("15");
  await expect(page.getByText("Draft passes local validation")).toBeVisible();
  await expect(page.getByLabel("PortfolioPolicy preview")).toContainText(
    "backendValidationRequired"
  );

  await page.getByRole("button", { name: "Validate draft" }).click();
  await expect(page.getByText("local checks 1")).toBeVisible();

  await page.getByLabel("Long-term target").fill("60");
  await expect(page.getByText("Total allocation is 125.00%")).toBeVisible();
  await expect(
    page.getByText("long_term target must stay between")
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

async function expectNoAxeViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => {
    const axeApi = (
      window as Window & {
        axe: { run: () => Promise<AxeRunResult> };
      }
    ).axe;
    return axeApi.run();
  });

  expect(accessibility.violations).toEqual([]);
}
