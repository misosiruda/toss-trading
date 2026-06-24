import { expect, test } from "@playwright/test";
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
});
