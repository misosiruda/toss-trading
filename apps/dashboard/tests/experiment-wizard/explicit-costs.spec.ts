import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import axe from "axe-core";
const validatePath = "/dashboard/experiments/validate";
const createPath = "/dashboard/lab/policies/simulations/create";
const token = "playwright-dashboard-mutation-token";

async function fill(page: import("@playwright/test").Page) {
  const fixture = JSON.parse(await readFile(".e2e-data/experiment-wizard/fixture.json", "utf8"));
  await page.goto("/dashboard/experiments/new");
  await page.getByLabel("초기 모의 자본 (KRW)").fill("500000");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByLabel("Source 자료 경로").fill(fixture.sourceDataDir);
  await page.getByLabel("시작 날짜").fill("2026-01-01");
  await page.getByLabel("종료 날짜").fill("2026-01-02");
  await page.getByLabel("추출 seed").fill("direct-cost-browser");
}

test("direct decimal costs validate exactly, editing invalidates, create once and Back/reload preserve barrier", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let posts = 0;
  let acceptedReady!: (value: { simulationRunId: string }) => void;
  const acceptedResponse = new Promise<{ simulationRunId: string }>(resolve => { acceptedReady = resolve; });
  // Read the real response before the native document navigation disposes its CDP body.
  await page.route(`**${createPath}`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    acceptedReady(await response.json());
    await route.fulfill({ response });
  });
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(createPath)) posts++; });
  await fill(page);
  await page.getByLabel("수수료 (bps)").fill("");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("button", { name: "현재 입력 검증" })).toBeDisabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.getByLabel("수수료 (bps)").fill("12.5");
  await page.getByLabel("매도세 (bps)").fill("0");
  await page.getByLabel("슬리피지 (bps)").fill("5.5");
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run());
  expect(accessibility.violations).toEqual([]);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.client).toBe(page.viewportSize()!.width); expect(width.scroll).toBeLessThanOrEqual(width.client);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  const validate = async () => {
    const pending = page.waitForResponse(r => r.url().endsWith(validatePath));
    await page.getByRole("button", { name: "현재 입력 검증" }).click();
    const response = await pending; expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.requestedConfig.executionCosts).toEqual({ feeBps: 12.5, taxBps: 0, slippageBps: 5.5 });
    for (const [key, value] of Object.entries(json.requestedConfig.executionCosts)) expect(json.effectiveConfig.costModel.executionPolicy[key]).toBe(value);
    await expect(page.getByRole("status")).toContainText("입력 검증 완료");
  };
  await validate();
  await page.getByLabel("실행 승인 토큰").fill(token);
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeEnabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.getByLabel("매도세 (bps)").fill("-1");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("button", { name: "현재 입력 검증" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.getByLabel("매도세 (bps)").fill("0");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await validate();
  const pending = page.waitForResponse(r => r.url().endsWith(createPath));
  await page.getByRole("button", { name: "paper 실행 시작" }).click();
  const response = await pending; expect(response.status()).toBe(202);
  expect(response.request().postDataJSON().executionCosts).toEqual({ feeBps: 12.5, taxBps: 0, slippageBps: 5.5 });
  const accepted = await acceptedResponse;
  await expect(page).toHaveURL(new RegExp(`/dashboard/lab/runs/${accepted.simulationRunId}$`));
  await page.goBack();
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(page.getByRole("link", { name: "같은 ID 상태 조회" })).toHaveAttribute("href", `/dashboard/lab/runs/${accepted.simulationRunId}`);
    await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
    await expect(page.getByLabel("실행 승인 토큰")).toHaveValue("");
    expect(posts).toBe(1);
  }
  expect(errors).toEqual([]);
});

test("legacy raw draft restores zero defaults; partial costs fail closed without weakening admission", async ({ page }) => {
  await fill(page);
  await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem("paper-experiment-draft-v1")!);
    for (const key of ["feeBps", "taxBps", "slippageBps"]) delete draft[key];
    draft.token = "never-restore";
    sessionStorage.setItem("paper-experiment-draft-v1", JSON.stringify(draft));
  });
  await page.reload();
  await expect(page.getByLabel("추출 seed")).toHaveValue("direct-cost-browser");
  for (const label of ["수수료 (bps)", "매도세 (bps)", "슬리피지 (bps)"]) await expect(page.getByLabel(label)).toHaveValue("0");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByLabel("실행 승인 토큰")).toHaveValue("");
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem("paper-experiment-draft-v1")!);
    draft.feeBps = "1"; delete draft.taxBps; delete draft.slippageBps;
    sessionStorage.setItem("paper-experiment-draft-v1", JSON.stringify(draft));
    sessionStorage.setItem("paper-experiment-admission-v1", "response_unknown");
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("결과는 미확인");
});