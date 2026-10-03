import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import axe from "axe-core";

const validatePath = "/dashboard/experiments/validate";
const createPath = "/dashboard/lab/policies/simulations/create";
const token = "playwright-dashboard-mutation-token";
async function fixture() { return JSON.parse(await readFile(process.env.EXPERIMENT_WIZARD_FIXTURE_FILE ?? ".e2e-data/experiment-wizard/fixture.json", "utf8")); }
async function fill(page: Page, seed = "ux03-browser") {
  await page.goto("/dashboard/experiments/new");
  await page.getByLabel("초기 모의 자본 (KRW)").fill("500000");
  await page.getByLabel("요청 실행 횟수").fill("3");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByLabel("Source 자료 경로").fill((await fixture()).sourceDataDir);
  await page.getByLabel("시작 날짜").fill("2026-01-01");
  await page.getByLabel("종료 날짜").fill("2026-01-02");
  await page.getByLabel("추출 seed").fill(seed);
  await page.getByRole("button", { name: "다음", exact: true }).click();
}
async function validated(page: Page) {
  const response = page.waitForResponse(r => r.url().endsWith(validatePath));
  await page.getByRole("button", { name: "현재 입력 검증", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("입력 검증 완료");
}
async function files(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await files(path));
    else result[path] = (await readFile(path)).toString("base64");
  }
  return result;
}

test("SSR observation fixtures keep accepted, runner failure, child results and unreadable wrappers distinct", async ({ page }) => {
  for (const [scenario, heading] of [
    ["accepted", "접수 관측 · 이후 실행 상태 미확인"], ["failed", "Runner 실패 관측"],
    ["partial", "Runner 실패 관측"], ["terminal", "Runner 실패 관측"],
    ["wrong", "접수 관측 형식 또는 ID 불일치"], ["unreadable", "접수 관측 판독 불가"], ["invalidwrapper", "Run Detail Unavailable"]
  ]) {
    await page.goto(`/dashboard/lab/runs/paper_sim_20261003000000000_${scenario}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (["partial", "terminal"].includes(scenario)) {
      await expect(page.getByRole("heading", { name: `child-${scenario}`, exact: true })).toBeVisible();
      const childPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: `child-${scenario}`, exact: true }) });
      await expect(childPanel.getByText(scenario === "partial" ? "completed_with_failures" : "completed", { exact: true })).toBeVisible();
    }
    if (scenario === "invalidwrapper") await expect(page.getByRole("region", { name: "Simulation 접수 관측" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("current validation is side-effect free; exactly one create runs the real fixture runner and opens its exact ID", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests: string[] = [];
  page.on("request", request => { if (request.method() === "POST") requests.push(new URL(request.url()).pathname); });
  await fill(page, "longseed".repeat(4));
  const before = await files((await fixture()).output);
  const validationResponse = page.waitForResponse(r => r.url().endsWith(validatePath));
  await validated(page);
  const validation = await (await validationResponse).json();
  expect(await files((await fixture()).output)).toEqual(before);
  expect(validation.replayRunnerStarted).toBe(false);
  expect(validation.storageMutationEnabled).toBe(false);
  expect(validation.sourceDataKind).toBe("unknown");
  await expect(page.getByText(/요청 3 → 실제 1회/)).toBeVisible();
  await expect(page.locator("main details")).not.toHaveAttribute("open", "");
  await page.getByLabel("실행 승인 토큰").fill(token);
  await page.screenshot({ path: info.outputPath("confirmation.png"), fullPage: true });
  const layout = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight, width: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
  expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth);
  if (layout.viewportWidth === 390) expect(layout.height / layout.viewport).toBeLessThanOrEqual(3);
  await info.attach("confirmation-size", { body: JSON.stringify(layout), contentType: "application/json" });
  await page.addScriptTag({ content: axe.source });
  const a11y = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run());
  expect(a11y.violations).toEqual([]);
  const acceptedResponse = page.waitForResponse(r => r.url().endsWith(createPath));
  await page.getByRole("button", { name: "paper 실행 시작", exact: true }).dblclick();
  const accepted = await (await acceptedResponse).json();
  expect(accepted.status).toBe("accepted");
  expect(accepted.requestedConfig).toEqual(validation.requestedConfig);
  expect(accepted.effectiveConfig).toEqual(validation.effectiveConfig);
  expect(accepted.simulationRunId).toBe(accepted.batchId);
  await expect(page).toHaveURL(new RegExp(`/dashboard/lab/runs/${accepted.simulationRunId}$`));
  expect(requests.filter(p => p === createPath)).toHaveLength(1);
  const apiUrl = `http://127.0.0.1:8791/batch/replay/runs?runId=${accepted.simulationRunId}&includeLatestRunArtifacts=1`;
  await expect.poll(async () => (await (await page.request.get(apiUrl)).json()).batchStatus).toBe("completed");
  const detail = await (await page.request.get(apiUrl)).json();
  expect(detail.simulationObservation.simulationRunId).toBe(accepted.simulationRunId);
  expect(detail.simulationObservation.outcome).toBe("unknown");
  expect(detail.selectedRun.batchId).toBe(accepted.batchId);
  expect(detail.selectedRun.status).toBe("completed");
  const manifest = JSON.parse(await readFile(join((await fixture()).output, "batch-replay", accepted.batchId, "batch-replay-manifest.json"), "utf8"));
  expect(manifest.sourceDataDir).toBe(validation.effectiveConfig.sourceDataDir);
  expect(manifest.initialCashKrw).toBe(validation.effectiveConfig.capital.initialCashKrw);
  expect(manifest.runCount).toBe(validation.effectiveConfig.runCount);
  expect(manifest.allocationPolicy).toEqual(validation.effectiveConfig.allocationPolicy);
  expect(manifest.paperExitPolicy).toEqual(validation.effectiveConfig.paperExitPolicy);
  const metadata = JSON.parse(await readFile(join((await fixture()).output, "batch-replay", accepted.batchId, "runs", detail.selectedRun.runId, "historical-replay-run-metadata.json"), "utf8"));
  expect(metadata.identity.batchId).toBe(accepted.batchId);
  expect(metadata.configuration.clock.stepSeconds).toBe(validation.effectiveConfig.samplingPolicy.stepSeconds);
  expect(metadata.configuration.samplingPolicy.maxDecisionCalls).toBe(validation.effectiveConfig.samplingPolicy.maxDecisionCalls);
  expect(metadata.configuration.constraints).toEqual(validation.effectiveConfig.constraints);
  expect(metadata.configuration.riskPolicy).toEqual(validation.effectiveConfig.riskPolicy);
  expect(metadata.configuration.executionPolicy).toEqual(validation.effectiveConfig.costModel.executionPolicy);
  await page.getByRole("link", { name: "같은 ID 새로 조회 (GET)" }).click();
  await expect(page.getByRole("heading", { name: detail.selectedRun.runId, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "접수 관측 · 이후 실행 상태 미확인" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("same-id-detail.png"), fullPage: true });
  expect(errors).toEqual([]);
  const stored = await page.evaluate(() => ({ url: location.href, local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
  expect(JSON.stringify(stored)).not.toContain(token);
});

test("all stages support keyboard, menu, pointer focus, visible labels and no overflow", async ({ page }, info) => {
  const consoleErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => consoleErrors.push(error.message));
  await page.goto("/dashboard/experiments/new");
  for (let step = 1; step <= 3; step++) {
    await expect(page.getByRole("heading", { name: `${step}. ${["전략·범위", "데이터·실행 조건", "검증·확인"][step - 1]}`, exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toMatch(/SELECT|INPUT|BUTTON/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ content: axe.source });
    expect((await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run())).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`stage-${step}.png`), fullPage: true });
    if (step < 3) await page.getByRole("button", { name: "다음", exact: true }).click();
  }
  if (page.viewportSize()!.width === 390) {
    const trigger = page.locator("summary").filter({ hasText: /^메뉴$/ });
    await trigger.click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("navigation", { name: "모바일 주 메뉴", exact: true }).getByRole("link", { name: "실험", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("navigation", { name: "모바일 주 메뉴", exact: true })).not.toBeVisible();
  }
  expect(consoleErrors).toEqual([]);
});

test("failed validation preserves raw inputs and a corrected date can be revalidated", async ({ page }) => {
  await fill(page);
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.getByLabel("종료 날짜").fill("2025-01-01");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "현재 입력 검증" }).click();
  await expect(page.getByRole("status")).toContainText("입력 조건이 거절");
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByLabel("종료 날짜")).toHaveValue("2025-01-01");
  await page.getByLabel("종료 날짜").fill("2026-01-02");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await validated(page);
});

test("network failure retains a no-retry barrier across leaving and returning", async ({ page }) => {
  await fill(page); await validated(page);
  let posts = 0;
  await page.route(`**${createPath}`, async route => { posts++; await route.abort("timedout"); });
  await page.getByLabel("실행 승인 토큰").fill(token);
  await page.getByRole("button", { name: "paper 실행 시작" }).click();
  await expect(page.getByRole("status")).toContainText("불확실");
  await page.getByRole("link", { name: "← 실험 목록", exact: true }).click();
  await page.getByRole("link", { name: "새 실험", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  expect(posts).toBe(1);
});

for (const waitForDeadline of [false, true]) test(`pending POST ${waitForDeadline ? "deadline" : "unmount"} never retries`, async ({ page }) => {
  await fill(page); await validated(page);
  await page.clock.install();
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  let handled!: () => void;
  const requestHandled = new Promise<void>(resolve => { handled = resolve; });
  await page.route(`**${createPath}`, async route => { posts++; started(); await gate; await route.fulfill({ status: 502, json: { error: "unavailable" } }); handled(); });
  await page.getByLabel("실행 승인 토큰").fill(token);
  await page.getByRole("button", { name: "paper 실행 시작" }).click();
  await requestStarted;
  if (waitForDeadline) {
    await page.clock.fastForward(20_001);
    await expect(page.getByRole("status")).toContainText("불확실");
  } else {
    await page.getByRole("link", { name: "← 실험 목록", exact: true }).click();
  }
  release(); await requestHandled;
  if (waitForDeadline) await page.getByRole("link", { name: "← 실험 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "실험", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\/experiments\/new\?step=3$/);
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  expect(posts).toBe(1);
});

test("editing invalidates in-flight validation and history/reload never preserve a validation credential", async ({ page }) => {
  await fill(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  let handled!: () => void;
  const requestHandled = new Promise<void>(resolve => { handled = resolve; });
  await page.route(`**${validatePath}`, async route => { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }); handled(); });
  await page.getByRole("button", { name: "현재 입력 검증" }).click();
  await requestStarted;
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.getByLabel("추출 seed").fill("changed-before-response");
  release();
  await requestHandled;
  await page.unroute(`**${validatePath}`);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await expect(page.getByText("서버 notices", { exact: true })).toHaveCount(0);
  await validated(page);
  await page.getByLabel("실행 승인 토큰").fill(token);
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeEnabled();
  await page.goBack();
  await expect(page.getByLabel("추출 seed")).toHaveValue("changed-before-response");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "3. 검증·확인", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByLabel("실행 승인 토큰")).toHaveValue("");
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByLabel("추출 seed")).toHaveValue("changed-before-response");
});

test("uncertain response blocks click, Enter and reload retry while retaining inputs", async ({ page }) => {
  await fill(page); await validated(page);
  let posts = 0;
  await page.route(`**${createPath}`, route => { posts++; return route.fulfill({ status: 202, contentType: "application/json", body: '{"status":"accepted","batchId":"invalid"}' }); });
  await page.getByLabel("실행 승인 토큰").fill(token);
  await page.getByLabel("실행 승인 토큰").press("Enter");
  await expect(page.getByRole("status")).toContainText("생성 응답");
  await expect(page.getByRole("status")).toContainText("불확실");
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("status")).toContainText("이전에 보낸");
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  expect(posts).toBe(1);
});

test("a corrupt saved draft cannot hide an uncertain admission barrier", async ({ page }) => {
  await page.goto("/dashboard/experiments/new?step=3");
  await page.evaluate(() => {
    sessionStorage.setItem("paper-experiment-admission-v1", "response_unknown");
    sessionStorage.setItem("paper-experiment-draft-v1", "{broken");
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText("이전에 보낸 생성 요청");
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await expect(page.getByLabel("실행 승인 토큰")).toBeDisabled();
});

test("incomplete execution conditions cannot authorize a create and can be revalidated", async ({ page }) => {
  await fill(page);
  let creates = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(createPath)) creates++; });
  for (const field of ["allowFractionalShares", "rejectStaleLiquidity"]) {
    for (const missing of [true, false]) {
      await page.route(`**${validatePath}`, async route => {
        const response = await route.fetch();
        const json = await response.json();
        if (missing) delete json.effectiveConfig.costModel.executionPolicy[field];
        else json.effectiveConfig.costModel.executionPolicy[field] = "true";
        await route.fulfill({ response, json });
      });
      await page.getByRole("button", { name: "현재 입력 검증" }).click();
      await expect(page.getByRole("status")).toContainText("검증 응답이 현재 입력 계약과 맞지 않습니다");
      await page.getByLabel("실행 승인 토큰").fill(token);
      await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
      expect(creates).toBe(0);
      await page.unroute(`**${validatePath}`);
    }
  }
  await validated(page);
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeEnabled();
});

test("validation permission and availability errors do not claim a create admission", async ({ page }) => {
  await fill(page);
  for (const status of [403, 503]) {
    await page.route(`**${validatePath}`, route => route.fulfill({ status, json: { error: "unavailable" } }));
    await page.getByRole("button", { name: "현재 입력 검증" }).click();
    await expect(page.getByRole("status")).toContainText(status === 403 ? "입력 검증에는 실행 승인 토큰을 사용하지 않습니다" : "입력 검증 서비스를 사용할 수 없습니다");
    await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
    await page.unroute(`**${validatePath}`);
  }
});

for (const status of [400, 401, 403, 409, 503]) test(`HTTP ${status} rejection preserves input and requires explicit revalidation`, async ({ page }) => {
  await fill(page); await validated(page);
  await page.route(`**${createPath}`, route => route.fulfill({ status, json: { error: status === 503 ? "paper_simulation_admission_failed" : "rejected" } }));
  await page.getByLabel("실행 승인 토큰").fill(token);
  await page.getByRole("button", { name: "paper 실행 시작" }).click();
  await expect(page.getByRole("status")).toContainText("입력을 유지했어요");
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByLabel("Source 자료 경로")).toHaveValue((await fixture()).sourceDataDir);
});
