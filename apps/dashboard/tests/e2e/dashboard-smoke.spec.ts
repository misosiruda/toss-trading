import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

const DASHBOARD_MUTATION_TOKEN = "playwright-dashboard-mutation-token";

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
    page.getByRole("heading", { name: "Compliance Analytics" })
  ).toBeVisible();
  await expect(page.getByText("Strategy Bucket Mix")).toBeVisible();
  await expect(page.getByText("Cash Reserve")).toBeVisible();
  await expect(page.getByText("Hedge Effectiveness")).toBeVisible();
  await expect(page.getByText("Cost & Turnover")).toBeVisible();
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
    page.getByRole("heading", { name: "Policy Candidate Comparison" })
  ).toBeVisible();
  await expect(
    page.getByText("prompt sha256:prompt-alpha-differentiator")
  ).toBeVisible();
  await expect(
    page.getByText("prompt sha256:prompt-beta-differentiator")
  ).toBeVisible();
  await expect(page.getByText("config sha256:config-alpha")).toBeVisible();
  await expect(page.getByText("config sha256:config-beta")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Strategy lab Buckets/i })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Portfolio Compliance/i })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Live Readiness Status/i })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Risk Gate Trace/i })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Validation Lab/i })
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders portfolio compliance detail without mutation controls", async ({
  page,
}) => {
  await page.goto("/dashboard/portfolio");

  await expect(
    page.getByRole("heading", { name: "Portfolio Compliance", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Paper-only portfolio")).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("read-only", { exact: true })).toBeVisible();
  await expect(page.getByText("not exposed")).toBeVisible();

  await expect(page.getByText("Net worth")).toBeVisible();
  await expect(page.getByText("Cash ratio")).toBeVisible();
  await expect(page.getByText("Risk rejects")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bucket Allocation Matrix" })
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Bucket allocation compliance table" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Compliance Breaches" })
  ).toBeVisible();
  await expect(page.getByTestId("portfolio-breach-hedge")).toContainText(
    "coverage missing"
  );
  await expect(
    page.getByRole("heading", { name: "Compliance Analytics" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Strategy Bucket Mix" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cash Reserve" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hedge Effectiveness" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cost & Turnover" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Exposure Compliance" })
  ).toBeVisible();
  await expect(page.getByText("Market Exposure")).toBeVisible();
  await expect(page.getByText("Strategy Bucket Exposure")).toBeVisible();
  await expect(page.getByText("Max Symbol Exposure")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cost and Turnover" })
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Bucket cost and turnover table" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Risk Gate Summary" })
  ).toBeVisible();
  await expect(page.getByText("Reject Codes")).toBeVisible();
  await expect(
    page.getByText(
      "portfolio policy artifact is not available; target weights are reported as missing"
    )
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders live readiness detail without live mutation controls", async ({
  page,
}) => {
  await page.goto("/dashboard/live-readiness");

  await expect(
    page.getByRole("heading", { name: "Live Readiness", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Paper-only readiness")).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("read-only", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Live readiness safety boundary")
      .getByText("not exposed")
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Live Readiness Detail" })
  ).toBeVisible();
  await expect(page.getByText("TRADING_ENABLED").first()).toBeVisible();
  await expect(page.getByText("BROKER_PROVIDER").first()).toBeVisible();
  await expect(page.getByText("AI_DECISION_MODE").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Official Read-only API" })
  ).toBeVisible();
  await expect(page.getByText("Credential values are not included")).toBeVisible();

  const gatewayPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Gateway Exposure" }),
  });
  await expect(gatewayPanel.getByText("disabled").first()).toBeVisible();
  await expect(gatewayPanel.getByText("not_connected")).toBeVisible();
  await expect(gatewayPanel.getByText("not_exposed")).toBeVisible();
  await expect(gatewayPanel.getByText("false").first()).toBeVisible();

  await expect(page.getByText("Readiness Checks")).toBeVisible();
  await expect(page.getByRole("heading", { name: "TRADING_ENABLED" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OrderRouter" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "MCP mutation tools" })
  ).toBeVisible();
  await expect(
    page.getByText("No place_order, raw tossctl, or raw codex exec tool is exposed.")
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders risk gate trace detail without treating rejects as fills", async ({
  page,
}) => {
  await page.goto("/dashboard/risk-gate");

  await expect(
    page.getByRole("heading", { name: "Risk Gate Trace", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Paper-only risk")).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("read-only", { exact: true })).toBeVisible();
  await expect(page.getByText("not exposed")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Decision to Risk Gate Trace" })
  ).toBeVisible();
  await expect(page.getByText("AI decision", { exact: true })).toBeVisible();
  await expect(page.getByText("deterministic verdict", { exact: true })).toBeVisible();
  await expect(page.getByText("simulated status", { exact: true })).toBeVisible();

  const riskTraceTable = page.getByRole("table", {
    name: "Risk gate trace table",
  });
  const rejectedTraceRow = riskTraceTable.getByRole("row").filter({
    hasText: "packet_replay_001",
  });
  await expect(rejectedTraceRow).toContainText("KR:035420");
  await expect(rejectedTraceRow).toContainText("VIRTUAL_BUY");
  await expect(rejectedTraceRow).toContainText("risk rejected");
  await expect(rejectedTraceRow).toContainText("not executed by risk gate");
  await expect(rejectedTraceRow).toContainText("raw status rejected");
  await expect(rejectedTraceRow).toContainText("VIRTUAL_CASH_EXCEEDED");
  await expect(rejectedTraceRow).toContainText("audit_replay_e2e_001");
  await expect(rejectedTraceRow).not.toContainText("filled");

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders validation lab detail without strategy recommendation controls", async ({
  page,
}) => {
  await page.goto("/dashboard/validation");

  await expect(
    page.getByRole("heading", { name: "Validation Lab", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Paper-only validation", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("read-only", { exact: true })).toBeVisible();
  await expect(page.getByText("not exposed")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Validation Lab Detail" })
  ).toBeVisible();
  await expect(page.getByText("train evidence only")).toBeVisible();
  await expect(page.getByText("Candidate rows")).toBeVisible();
  await expect(page.getByText("Policy Candidate Comparison")).toBeVisible();

  const comparisonTable = page.getByRole("table", {
    name: "Policy candidate comparison table",
  });
  await expect(
    comparisonTable.getByText("sha256:prompt-alpha-differentiator")
  ).toBeVisible();
  await expect(
    comparisonTable.getByText("sha256:prompt-beta-differentiator")
  ).toBeVisible();
  await expect(comparisonTable.getByText("sha256:config-alpha")).toBeVisible();
  await expect(comparisonTable.getByText("sha256:config-beta")).toBeVisible();
  await expect(comparisonTable.getByText("selected in train")).toBeVisible();
  await expect(
    page.getByText(
      "Candidate comparison is paper-only validation evidence. It is not a strategy recommendation or performance guarantee."
    )
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

test("renders audit event review without mutation controls", async ({ page }) => {
  await page.goto("/dashboard/audit");

  await expect(
    page.getByRole("heading", { name: "Audit Event Review" })
  ).toBeVisible();
  await expect(page.getByText("Paper-only audit")).toBeVisible();
  await expect(page.getByText("backend ViewModel", { exact: true })).toBeVisible();
  await expect(page.getByText("read-only", { exact: true })).toBeVisible();
  await expect(page.getByText("not exposed")).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Audit Summary" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Audit Events" })
  ).toBeVisible();
  await expect(page.getByText("Total events")).toBeVisible();
  await expect(page.getByText("Rejected actions")).toBeVisible();
  await expect(page.getByText("Failure traces")).toBeVisible();
  await expect(page.getByText("Event Type Counts")).toBeVisible();
  const auditTable = page.getByRole("table");
  await expect(auditTable.getByText("VIRTUAL_RISK_REJECTED")).toHaveCount(2);
  await expect(auditTable.getByText("AI_PROVIDER_FAILURE")).toBeVisible();
  await expect(auditTable.getByText("risk_gate")).toHaveCount(2);
  await expect(auditTable.getByText("simulation")).toBeVisible();
  await expect(auditTable.getByText("failure", { exact: true })).toBeVisible();
  await expect(auditTable.getByText("warning", { exact: true })).toHaveCount(2);
  await expect(auditTable.getByText("ord_****")).toHaveCount(2);
  await expect(page.getByText("ord_abcdef123456")).toHaveCount(0);
  await expect(page.getByText("1234-5678-901234")).toHaveCount(0);

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
  request,
}) => {
  await page.goto("/dashboard/lab/strategy-tests");
  const dashboardOrigin = new URL(page.url()).origin;

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
  const resultMatrix = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Bucket Result Matrix" }),
  });
  await expect(resultMatrix.getByRole("cell", { name: "Swing" })).toBeVisible();
  await expect(
    resultMatrix.getByRole("cell", { name: "completed" })
  ).toBeVisible();
  await expect(
    resultMatrix.getByText(
      "bucket result is compared against full portfolio baseline"
    )
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Full Portfolio Baseline Comparison" })
  ).toBeVisible();
  const comparisonPanel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Full Portfolio Baseline Comparison",
    }),
  });
  await expect(
    comparisonPanel.getByText(
      "comparison uses completed strategy bucket result records and batch aggregate overall return; it is paper-only evidence, not strategy selection advice"
    )
  ).toBeVisible();
  await expect(comparisonPanel.getByText("batch_aggregate_overall")).toBeVisible();
  await expect(comparisonPanel.getByText("0.9%")).toBeVisible();

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
  const requestPreviewText = await page
    .getByLabel("Strategy bucket test request preview")
    .textContent();
  expect(requestPreviewText).toBeTruthy();
  const createRequestBody = JSON.parse(requestPreviewText ?? "{}") as Record<
    string,
    unknown
  >;
  const matrixCreateRequestBody = {
    mode: "paper_only",
    mutation: "strategy_bucket_test_matrix_create",
    matrixId: "strategy-test-lab-matrix-validation",
    candidate: createRequestBody
  };
  const missingIntentCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: createRequestBody
    }
  );
  expect(missingIntentCreate.status()).toBe(403);
  const missingIntentPayload = await missingIntentCreate.json();
  expect(missingIntentPayload).toMatchObject({
    error: "dashboard_intent_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const missingIntentMatrixCreate = await request.post(
    "/dashboard/lab/strategy-tests/matrix-create",
    {
      data: matrixCreateRequestBody
    }
  );
  expect(missingIntentMatrixCreate.status()).toBe(403);
  expect(await missingIntentMatrixCreate.json()).toMatchObject({
    error: "dashboard_intent_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const missingMutationTokenMatrixCreate = await request.post(
    "/dashboard/lab/strategy-tests/matrix-create",
    {
      data: matrixCreateRequestBody,
      headers: {
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-intent":
          "strategy-bucket-test-matrix-create"
      }
    }
  );
  expect(missingMutationTokenMatrixCreate.status()).toBe(403);
  expect(await missingMutationTokenMatrixCreate.json()).toMatchObject({
    error: "mutation_token_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const missingMutationTokenCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: createRequestBody,
      headers: {
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-intent": "strategy-bucket-test-create"
      }
    }
  );
  expect(missingMutationTokenCreate.status()).toBe(403);
  const missingMutationTokenPayload = await missingMutationTokenCreate.json();
  expect(missingMutationTokenPayload).toMatchObject({
    error: "mutation_token_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const invalidMutationTokenCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: createRequestBody,
      headers: {
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-mutation-token": "wrong-token",
        "x-toss-trading-dashboard-intent": "strategy-bucket-test-create"
      }
    }
  );
  expect(invalidMutationTokenCreate.status()).toBe(403);
  const invalidMutationTokenPayload = await invalidMutationTokenCreate.json();
  expect(invalidMutationTokenPayload).toMatchObject({
    error: "mutation_token_invalid",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const nonJsonContentTypeCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: JSON.stringify(createRequestBody),
      headers: {
        "content-type": "text/plain",
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "strategy-bucket-test-create"
      }
    }
  );
  expect(nonJsonContentTypeCreate.status()).toBe(415);
  const nonJsonContentTypePayload = await nonJsonContentTypeCreate.json();
  expect(nonJsonContentTypePayload).toMatchObject({
    error: "unsupported_media_type",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const missingMetadataCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: createRequestBody,
      headers: {
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "strategy-bucket-test-create"
      }
    }
  );
  expect(missingMetadataCreate.status()).toBe(403);
  const missingMetadataPayload = await missingMetadataCreate.json();
  expect(missingMetadataPayload).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const sameSiteMetadataCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: createRequestBody,
      headers: {
        "sec-fetch-site": "same-site",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "strategy-bucket-test-create"
      }
    }
  );
  expect(sameSiteMetadataCreate.status()).toBe(403);
  const sameSiteMetadataPayload = await sameSiteMetadataCreate.json();
  expect(sameSiteMetadataPayload).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const crossOriginCreate = await request.post(
    "/dashboard/lab/strategy-tests/create",
    {
      data: createRequestBody,
      headers: {
        origin: "http://evil.example",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "strategy-bucket-test-create"
      }
    }
  );
  expect(crossOriginCreate.status()).toBe(403);
  const crossOriginPayload = await crossOriginCreate.json();
  expect(crossOriginPayload).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  await expect(
    page.getByRole("button", { name: "Queue bucket test record" })
  ).toBeDisabled();

  await activateButton(page, "Validate bucket config");
  await expect(page.getByText("Strategy validation valid")).toBeVisible();
  await expect(
    page.getByText(/config sha256:[a-f0-9]{12}.*runner not started/)
  ).toBeVisible();
  await expect(page.getByText("config-valid")).toBeVisible();
  await expect(
    page.getByText(
      "Backend validation passed. A queued paper-only test record can be created; replay runner remains disabled."
    )
  ).toHaveCount(0);
  await page.locator("#mutation-token").fill(DASHBOARD_MUTATION_TOKEN);
  await expect(
    page.getByLabel("Strategy bucket test request preview")
  ).not.toContainText(DASHBOARD_MUTATION_TOKEN);
  await expect(
    page.getByText(
      "Backend validation passed. A queued paper-only test record can be created; replay runner remains disabled."
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      "Backend validation passed. Enabled buckets can be queued as independent paper-only records."
    )
  ).toBeVisible();

  await activateButton(page, "Queue enabled bucket matrix");
  await expect(page.getByText("Strategy bucket matrix queued")).toBeVisible();
  const matrixCreatedLine = page.getByTestId(
    "strategy-bucket-matrix-created-id"
  );
  await expect(matrixCreatedLine).toContainText(
    "strategy-test-lab-matrix-validation"
  );
  await expect(matrixCreatedLine).toContainText("5 bucket records");
  await expect(matrixCreatedLine).toContainText("runner not started");
  await expect(
    page.getByTestId("strategy-bucket-matrix-test-long_term")
  ).toContainText("Long-term");
  await expect(
    page.getByTestId("strategy-bucket-matrix-test-swing")
  ).toContainText("Swing");
  await expect(
    page.getByTestId("strategy-bucket-matrix-test-short_term")
  ).toContainText("Short-term");
  await expect(
    page.getByTestId("strategy-bucket-matrix-test-intraday")
  ).toContainText("Intraday");
  await expect(
    page.getByTestId("strategy-bucket-matrix-test-hedge")
  ).toContainText("Hedge");

  await activateButton(page, "Queue bucket test record");
  await expect(page.getByText("Strategy bucket test queued")).toBeVisible();
  await expect(
    page.getByText("storage mutation enabled").first()
  ).toBeVisible();
  await expect(page.getByText("live orders disabled").first()).toBeVisible();
  await expect(page.getByText("order placement disabled").first()).toBeVisible();
  const createdTestIdLine = page.getByTestId("strategy-bucket-created-test-id");
  await expect(createdTestIdLine).toContainText(/^strategy_bucket_test_/);
  const createdTestIdText = await createdTestIdLine.textContent();
  const createdTestId = createdTestIdText?.split(" · ")[0] ?? "";
  expect(createdTestId).toMatch(/^strategy_bucket_test_/);
  const activeTestRow = page
    .getByTestId(`strategy-bucket-active-test-${createdTestId}`)
    .first();
  await expect(activeTestRow).toBeVisible();
  await expect(activeTestRow).toContainText("Long-term");
  await expect(activeTestRow).toContainText("queued");
  await expect(page.getByText("polling fallback")).toBeVisible();
  await expect(
    activeTestRow.getByRole("progressbar", {
      name: "Bucket test progress ratio"
    })
  ).toBeVisible();
  const progressUrl = `/dashboard/lab/strategy-tests/tests/${encodeURIComponent(
    createdTestId
  )}/progress`;
  let progressResponse = await request.get(progressUrl);
  for (
    let attempt = 0;
    attempt < 5 && progressResponse.status() !== 200;
    attempt += 1
  ) {
    await page.waitForTimeout(200);
    progressResponse = await request.get(progressUrl);
  }
  expect(progressResponse.status()).toBe(200);
  const progressPayload = await progressResponse.json();
  expect(progressPayload).toMatchObject({
    mode: "paper_only",
    readOnly: true,
    viewModel: "strategy-test-progress",
    testId: createdTestId,
    status: "ok",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  expect(progressPayload.test).toMatchObject({
    testId: createdTestId,
    bucket: "long_term",
    status: "queued",
    progress: {
      phase: "queued",
      decisionCount: 0,
      simulatedTradeCount: 0
    },
    heartbeat: {
      status: "fresh"
    }
  });

  await page.locator("#start-at").fill("2024/02/31");
  await activateButton(page, "Validate bucket config");
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

test("renders paper policy builder draft validation without live mutation controls", async ({
  page,
  request,
}) => {
  await page.goto("/dashboard/lab/policies");
  const dashboardOrigin = new URL(page.url()).origin;

  await expect(
    page.getByRole("heading", { name: "Paper Policy Builder" })
  ).toBeVisible();
  await expect(page.getByText("paper-only draft")).toBeVisible();
  await expect(page.getByText("guarded save", { exact: true })).toBeVisible();
  await expect(page.getByText("required", { exact: true })).toBeVisible();
  await expect(page.getByText("guarded create", { exact: true })).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "Paper Simulation Create" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Policy Artifact Save" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save policy artifact" })
  ).toBeDisabled();
  await expect(
    page.getByLabel("Policy paper simulation config preview")
  ).toContainText("Backend validation is required");
  await expect(
    page.getByRole("button", { name: "Create paper simulation" })
  ).toBeDisabled();

  await page.getByRole("button", { name: "Validate draft" }).click();
  await expect(page.getByText("local checks 1")).toBeVisible();
  await page.getByRole("button", { name: "Backend validate" }).click();
  await expect(page.getByText("Backend validation valid")).toBeVisible();
  await expect(page.getByText("storage mutation disabled")).toBeVisible();
  await expect(
    page.getByLabel("Policy paper simulation config preview")
  ).toContainText('"seed": "policy-');
  const policyPreviewText = await page
    .getByLabel("PortfolioPolicy preview")
    .textContent();
  expect(policyPreviewText).toBeTruthy();
  const createPolicyBody = JSON.parse(policyPreviewText ?? "{}") as Record<
    string,
    unknown
  >;
  const missingPolicyIntentCreate = await request.post(
    "/dashboard/lab/policies/create",
    {
      data: createPolicyBody
    }
  );
  expect(missingPolicyIntentCreate.status()).toBe(403);
  expect(await missingPolicyIntentCreate.json()).toMatchObject({
    error: "dashboard_intent_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const invalidPolicyMutationTokenCreate = await request.post(
    "/dashboard/lab/policies/create",
    {
      data: createPolicyBody,
      headers: {
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-mutation-token": "wrong-token",
        "x-toss-trading-dashboard-intent": "paper-policy-create"
      }
    }
  );
  expect(invalidPolicyMutationTokenCreate.status()).toBe(403);
  expect(await invalidPolicyMutationTokenCreate.json()).toMatchObject({
    error: "mutation_token_invalid",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const nonJsonPolicyCreate = await request.post(
    "/dashboard/lab/policies/create",
    {
      data: JSON.stringify(createPolicyBody),
      headers: {
        "content-type": "text/plain",
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "paper-policy-create"
      }
    }
  );
  expect(nonJsonPolicyCreate.status()).toBe(415);
  expect(await nonJsonPolicyCreate.json()).toMatchObject({
    error: "unsupported_media_type",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const missingPolicyMetadataCreate = await request.post(
    "/dashboard/lab/policies/create",
    {
      data: createPolicyBody,
      headers: {
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "paper-policy-create"
      }
    }
  );
  expect(missingPolicyMetadataCreate.status()).toBe(403);
  expect(await missingPolicyMetadataCreate.json()).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false
  });
  const simulationPreviewText = await page
    .getByLabel("Policy paper simulation config preview")
    .textContent();
  expect(simulationPreviewText).toBeTruthy();
  const createSimulationBody = JSON.parse(
    simulationPreviewText ?? "{}"
  ) as Record<string, unknown>;
  expect(createSimulationBody).toMatchObject({
    mode: "paper_only",
    runType: "batch_replay",
    riskProfile: "balanced",
    decisionProvider: {
      mode: "dry_run_fixture"
    }
  });
  const missingIntentCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: createSimulationBody
    }
  );
  expect(missingIntentCreate.status()).toBe(403);
  expect(await missingIntentCreate.json()).toMatchObject({
    error: "dashboard_intent_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  const missingMutationTokenCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: createSimulationBody,
      headers: {
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-intent": "paper-simulation-create"
      }
    }
  );
  expect(missingMutationTokenCreate.status()).toBe(403);
  expect(await missingMutationTokenCreate.json()).toMatchObject({
    error: "mutation_token_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  const invalidMutationTokenCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: createSimulationBody,
      headers: {
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-mutation-token": "wrong-token",
        "x-toss-trading-dashboard-intent": "paper-simulation-create"
      }
    }
  );
  expect(invalidMutationTokenCreate.status()).toBe(403);
  expect(await invalidMutationTokenCreate.json()).toMatchObject({
    error: "mutation_token_invalid",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  const nonJsonContentTypeCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: JSON.stringify(createSimulationBody),
      headers: {
        "content-type": "text/plain",
        origin: dashboardOrigin,
        "sec-fetch-site": "same-origin",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "paper-simulation-create"
      }
    }
  );
  expect(nonJsonContentTypeCreate.status()).toBe(415);
  expect(await nonJsonContentTypeCreate.json()).toMatchObject({
    error: "unsupported_media_type",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  const missingMetadataCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: createSimulationBody,
      headers: {
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "paper-simulation-create"
      }
    }
  );
  expect(missingMetadataCreate.status()).toBe(403);
  expect(await missingMetadataCreate.json()).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  const sameSiteMetadataCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: createSimulationBody,
      headers: {
        "sec-fetch-site": "same-site",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "paper-simulation-create"
      }
    }
  );
  expect(sameSiteMetadataCreate.status()).toBe(403);
  expect(await sameSiteMetadataCreate.json()).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  const crossOriginCreate = await request.post(
    "/dashboard/lab/policies/simulations/create",
    {
      data: createSimulationBody,
      headers: {
        origin: "http://evil.example",
        "x-toss-trading-dashboard-mutation-token": DASHBOARD_MUTATION_TOKEN,
        "x-toss-trading-dashboard-intent": "paper-simulation-create"
      }
    }
  );
  expect(crossOriginCreate.status()).toBe(403);
  expect(await crossOriginCreate.json()).toMatchObject({
    error: "same_origin_required",
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false
  });
  await page.locator("#paper-policy-mutation-token").fill(
    DASHBOARD_MUTATION_TOKEN
  );
  await expect(
    page.getByRole("button", { name: "Save policy artifact" })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save policy artifact" }).click();
  await expect(page.getByText("Paper policy artifact stored")).toBeVisible();
  await expect(page.getByTestId("paper-policy-created-record-id")).toContainText(
    /^portfolio_policy_/
  );
  await expect(page.getByText("replay runner not started")).toBeVisible();
  await expect(
    page.getByLabel("Policy paper simulation config preview")
  ).not.toContainText(DASHBOARD_MUTATION_TOKEN);
  await expect(page.getByLabel("PortfolioPolicy preview")).not.toContainText(
    DASHBOARD_MUTATION_TOKEN
  );
  await expect(
    page.getByRole("button", { name: "Create paper simulation" })
  ).toBeEnabled();

  await page.getByLabel("Long-term target").fill("60");
  await expect(page.getByText("Total allocation is 125.00%")).toBeVisible();
  await expect(
    page.getByText("long_term target must stay between")
  ).toBeVisible();
  await expect(
    page.getByLabel("Policy paper simulation config preview")
  ).toContainText("Backend validation is required");
  await expect(
    page.getByRole("button", { name: "Create paper simulation" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save policy artifact" })
  ).toBeDisabled();

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
    page.getByRole("button", { name: "Create paper simulation" })
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save policy artifact" })
  ).toBeDisabled();

  await expect(
    page.getByRole("button", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /order|trade|buy|sell/i })
  ).toHaveCount(0);

  await expectNoAxeViolations(page);
});

async function activateButton(page: Page, buttonName: string) {
  const button = page.getByRole("button", { name: buttonName });
  await button.focus();
  await page.keyboard.press("Enter");
}

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
