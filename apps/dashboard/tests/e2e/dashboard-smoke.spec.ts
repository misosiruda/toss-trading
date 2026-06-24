import { expect, test } from "@playwright/test";

test("renders paper-only dashboard readiness without live mutation controls", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Live Readiness" })).toBeVisible();
  await expect(page.getByText("Paper-only operations")).toBeVisible();
  await expect(page.getByText("TRADING_ENABLED")).toBeVisible();
  await expect(page.getByText("BROKER_PROVIDER")).toBeVisible();
  await expect(page.getByText("OrderRouter")).toBeVisible();
  await expect(page.getByText("MCP mutation tools")).toBeVisible();

  await expect(page.getByText("Live trading is not enabled")).toBeVisible();
  await expect(page.getByText("No live OrderIntent path is exposed")).toBeVisible();
  await expect(page.getByText("No place_order or raw command surface is available")).toBeVisible();

  await expect(page.getByRole("button", { name: /order|trade|buy|sell/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /order|trade|buy|sell/i })).toHaveCount(0);
});
