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
    page.getByRole("link", { name: /Strategy lab Buckets/i })
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders strategy bucket test lab with queued create boundary", async ({
  page,
}) => {
  await page.goto("/dashboard/lab/strategy-tests");

  await expect(
    page.getByRole("heading", { name: "Strategy Bucket Test Lab" })
  ).toBeVisible();
  await expect(page.getByText("Strategy Lab")).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("create only")).toBeVisible();
  await expect(page.getByText("not exposed")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Bucket Test Readiness" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Long-term" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Swing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Short-term" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intraday" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hedge" })).toBeVisible();
  await expect(
    page.getByText(
      "paper-only queued record creation is available; replay runner is not connected yet"
    )
  ).toHaveCount(5);

  await expect(
    page.getByRole("heading", { name: "Bucket Test Progress" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bucket Result Matrix" })
  ).toBeVisible();
  await expect(
    page.getByText("No isolated bucket result artifacts are available.")
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Selection Warning" })
  ).toBeVisible();
  await expect(
    page.getByText(/isolated strategy bucket result artifacts are missing/)
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Bucket Test Config" })
  ).toBeVisible();
  await expect(page.locator("#test-bucket")).toHaveValue("long_term");
  await expect(page.locator("#source-data-dir")).toHaveValue(
    "data/replay-2023-01-2026-05-global-yahoo-daily"
  );
  await expect(
    page.getByLabel("Strategy bucket test request preview")
  ).toContainText("strategy-test-lab-long_term-seed");
  await expect(
    page.getByRole("button", { name: "Queue bucket test record" })
  ).toBeDisabled();

  await page.getByRole("button", { name: "Validate bucket config" }).click();
  await expect(page.getByText("Strategy validation valid")).toBeVisible();
  await expect(
    page.getByText(/config sha256:[a-f0-9]{12}.*runner not started/)
  ).toBeVisible();
  await expect(page.getByText("config-valid")).toBeVisible();
  await expect(
    page.getByText(
      "Backend validation passed. A queued paper-only test record can be created; replay runner remains disabled."
    )
  ).toBeVisible();

  await page.getByRole("button", { name: "Queue bucket test record" }).click();
  await expect(page.getByText("Strategy bucket test queued")).toBeVisible();
  await expect(page.getByText("storage mutation enabled")).toBeVisible();
  await expect(page.getByText("live orders disabled")).toBeVisible();
  await expect(page.getByText("order placement disabled")).toBeVisible();

  await page.locator("#start-at").fill("2024/02/31");
  await page.getByRole("button", { name: "Validate bucket config" }).click();
  await expect(page.getByText("Strategy validation invalid")).toBeVisible();
  await expect(page.getByText("INVALID_WINDOW_DATE:")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue bucket test record" })
  ).toBeDisabled();

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
  await expect(page.getByText("not stored", { exact: true })).toBeVisible();
  await expect(page.getByText("required", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Backend validate" }).click();
  await expect(page.getByText("Backend validation valid")).toBeVisible();
  await expect(page.getByText("storage mutation disabled")).toBeVisible();

  await page.getByLabel("Long-term target").fill("60");
  await expect(page.getByText("Total allocation is 125.00%")).toBeVisible();
  await expect(
    page.getByText("long_term target must stay between")
  ).toBeVisible();

  await page.getByRole("button", { name: "Reset draft" }).click();
  await page.getByLabel("Long-term minimum").fill("-10");
  await expect(
    page.getByText("long_term minimum weight must stay between 0% and 100%.")
  ).toBeVisible();
  await expect(page.getByText("backend-ready")).toHaveCount(0);
  await expect(page.getByLabel("PortfolioPolicy preview")).toContainText(
    "BUCKET_MIN_WEIGHT_OUT_OF_RANGE"
  );
  await page.getByRole("button", { name: "Backend validate" }).click();
  await expect(page.getByText("Backend validation invalid")).toBeVisible();
  await expect(
    page.getByText("BUCKET_MIN_WEIGHT_OUT_OF_RANGE:")
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
