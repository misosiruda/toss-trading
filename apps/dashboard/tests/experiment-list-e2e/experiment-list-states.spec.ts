import { expect, test as base, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import axe from "axe-core";

// UI contract-state coverage only. The default e2e/experiment-list.spec.ts
// independently exercises the existing real isolated Operations API.
const FIXTURE_ORIGIN = "http://127.0.0.1:8791";
const CONTROL_PATH = "/__experiment-list-fixture";
const MARKER = "experiment-list-ssr-fixture-v1";
const CONTROL_HEADERS = { "x-experiment-list-test-runner": MARKER };
const LIST_PATH = "/batch/replay/runs?limit=100";

const test = base.extend<{ browserHealth: void }>({
  browserHealth: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const forbiddenRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
      if (message.type() === "warning") warnings.push(message.text());
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith(CONTROL_PATH) ||
        /(?:^|\/)(?:place_order|place_market_order|enable_live_trading|orders?|broker|tossctl|codex[-_/]exec|natural-language-order)(?:\/|$)/i.test(url.pathname) ||
        (url.origin === FIXTURE_ORIGIN && request.method() !== "GET")) {
        forbiddenRequests.push(`${request.method()} ${url.pathname}`);
      }
    });
    await use();
    await testInfo.attach("browser-health", { body: JSON.stringify({ errors, warnings, forbiddenRequests }, null, 2), contentType: "application/json" });
    expect(errors, "browser console and uncaught page errors").toEqual([]);
    expect(forbiddenRequests, "UI must not call test control or live mutation endpoints").toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ request }) => {
  const health = await request.get(`${FIXTURE_ORIGIN}/health`);
  expect(await health.json()).toEqual({ fixture: MARKER });
  expect(health.headers()["cache-control"]).toBe("no-store");
  await setScenario(request, "valid-terminal");
});

type ScenarioExpectation = {
  name: string;
  rows: number;
  sourceState?: string;
  warnings?: string[];
  unavailable?: "offline" | "invalid";
  raw?: number;
  terminal?: number;
  active?: number;
};

const scenarios: ScenarioExpectation[] = [
  { name: "valid-terminal", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0 },
  { name: "all-statuses", rows: 5, sourceState: "running · 실행 중", raw: 4, terminal: 4, active: 1 },
  { name: "empty", rows: 0, sourceState: "ok · 정상", raw: 0, terminal: 0, active: 0 },
  { name: "active-only", rows: 1, sourceState: "running · 실행 중", raw: 0, terminal: 0, active: 1 },
  { name: "active-terminal-dedup", rows: 1, sourceState: "running · 실행 중", raw: 1, terminal: 1, active: 0, warnings: ["진행 기록보다 종료 기록 우선 표시"] },
  { name: "running-corrupt", rows: 2, sourceState: "running · 실행 중", raw: 1, terminal: 1, active: 1, warnings: ["손상된 JSONL 줄 · 2건"] },
  { name: "missing", rows: 0, sourceState: "missing · 소스 없음", raw: 0, terminal: 0, active: 0 },
  { name: "blocked", rows: 0, sourceState: "blocked · 소스 차단", raw: 0, terminal: 0, active: 0 },
  { name: "degraded", rows: 1, sourceState: "degraded · 일부 기록만 사용", raw: 1, terminal: 1, active: 0, warnings: ["손상된 JSONL 줄 · 1건"] },
  { name: "no-manifest", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0, warnings: ["batch 연결이 확인되지 않은 저장 행"] },
  { name: "terminal-stale-active", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0, warnings: ["진행 중 실행 정보 불일치"] },
  { name: "null-batch-stale-active", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0, warnings: ["진행 중 실행 정보 불일치"] },
  { name: "unknown-batch-stale-active", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0, warnings: ["batch 상태 미확인", "진행 중 실행 정보 불일치"] },
  { name: "mismatched-row", rows: 1, sourceState: "ok · 정상", raw: 2, terminal: 1, active: 0, warnings: ["선택 batch와 다른 행 제외 · 1건"] },
  { name: "unknown-row", rows: 1, sourceState: "ok · 정상", raw: 2, terminal: 1, active: 0, warnings: ["상태가 확인되지 않은 행 제외 · 1건", "원본 상태 집계 일부 미확인 · 1건"] },
  { name: "nullable-zero", rows: 2, sourceState: "ok · 정상", raw: 2, terminal: 2, active: 0 },
  { name: "bounded-window", rows: 100, sourceState: "ok · 정상", raw: 150, terminal: 100, active: 0 },
  { name: "long-identifiers", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0 },
  { name: "legacy-batch-id", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0, warnings: ["batch 메타데이터 확인 필요", "batch 연결이 확인되지 않은 저장 행"] },
  { name: "partial-manifest-metadata", rows: 1, sourceState: "ok · 정상", raw: 1, terminal: 1, active: 0, warnings: ["batch 메타데이터 확인 필요"] },
  { name: "unknown-endpoint", rows: 0, unavailable: "invalid" },
  { name: "malformed-envelope", rows: 0, unavailable: "invalid" },
  { name: "malformed-json", rows: 0, unavailable: "invalid" },
  { name: "offline-500", rows: 0, unavailable: "offline" },
  { name: "timeout", rows: 0, unavailable: "offline" },
];

for (const scenario of scenarios) {
  test(`SSR fixture: ${scenario.name} preserves source, row, and availability semantics`, async ({ page, request }, testInfo) => {
    await setScenario(request, scenario.name);
    await page.goto("/dashboard");
    await expectIdentity(page);
    await expect(page.getByTestId("experiment-row")).toHaveCount(scenario.rows);
    await expect(page.getByRole("button", { name: /order|trade|buy|sell/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /order|trade|buy|sell/i })).toHaveCount(0);
    await expect(page.getByLabel("실험 ID 검색", { exact: true })).toBeInViewport();
    await captureViewport(page, testInfo, "first-viewport");

    if (scenario.unavailable) {
      await expect(page.getByLabel("조회 상태")).toContainText(scenario.unavailable === "offline" ? "API에 연결할 수 없어요" : "API 응답을 확인할 수 없어요");
      await expect(page.getByText("실험 개수 미확인", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "실험 목록을 불러오지 못했어요" })).toBeVisible();
      await expect(page.getByLabel("실험 데이터 출처")).toHaveCount(0);
      await expect(page.getByText("표시 0개", { exact: true })).toHaveCount(0);
    } else {
      const source = page.getByLabel("실험 데이터 출처");
      await expect(source).toContainText(`원본 저장 행 전체 ${scenario.raw}개`);
      await expect(source.getByText("진행 중은 저장된 상태예요. 현재 실행 여부를 실시간 확인한 값은 아니에요.", { exact: true })).toBeVisible();
      await expect(source).toContainText(`terminal ${scenario.terminal}개 · 진행 중 ${scenario.active}개`);
      await expect(page.getByTestId("experiment-list")).toContainText(`표시 ${scenario.rows}개 / 불러온 child ${scenario.rows}개`);
      if (scenario.rows === 0) {
        await expect(page.getByRole("heading", { name: "표시할 실험 기록이 없어요" })).toBeVisible();
        await expect(page.getByText(/전체 기록이 없다는 뜻은 아니에요/)).toBeVisible();
      }
      await page.locator("summary").filter({ hasText: "조회 정보와 기록 상태" }).click();
      await expect(source.getByText(scenario.sourceState!, { exact: true })).toBeVisible();
      for (const warning of scenario.warnings ?? []) await expect(source).toContainText(warning);
      await assertScenarioDetails(page, scenario.name);
    }
    await expectNoOverflow(page);
    await expectAccessible(page, testInfo, "source-state");
    expect(await fixtureRequests(request)).toEqual([LIST_PATH]);
  });
}

test("status and ID filters stay within loaded rows with reload, Back/Forward, clear, and no refetch", async ({ page, request }, testInfo) => {
  await setScenario(request, "all-statuses");
  await page.goto("/dashboard");
  const status = page.getByLabel("실험 상태", { exact: true });
  const search = page.getByLabel("실험 ID 검색", { exact: true });
  const cases = [
    ["running", "fixture_running", "진행 중"],
    ["completed", "fixture_completed", "완료"],
    ["partial", "fixture_completed_with_failures", "부분 실패"],
    ["failed", "fixture_failed", "실패"],
    ["skipped", "fixture_skipped", "건너뜀"],
  ] as const;
  for (const [value, id, label] of cases) {
    await status.selectOption(value);
    await expect(page).toHaveURL(new RegExp(`status=${value}$`));
    await expect(page.getByTestId("experiment-row")).toHaveCount(1);
    await expect(row(page, id).getByRole("cell").nth(1)).toHaveText(label);
  }
  expect(await fixtureRequests(request), "client filters reuse the loaded SSR snapshot").toEqual([LIST_PATH]);
  await status.selectOption("all");
  await search.fill("FIXTURE_COMPLETED");
  await search.press("Enter");
  await expect(page.getByTestId("experiment-row")).toHaveCount(2);
  await status.selectOption("partial");
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await page.goBack();
  await expect(status).toHaveValue("all");
  await expect(search).toHaveValue("FIXTURE_COMPLETED");
  await expect(page.getByTestId("experiment-row")).toHaveCount(2);
  await page.goForward();
  await expect(status).toHaveValue("partial");
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await page.reload();
  await expect(status).toHaveValue("partial");
  await expect(search).toHaveValue("FIXTURE_COMPLETED");
  await expect(row(page, "fixture_completed_with_failures")).toBeVisible();
  expect(await fixtureRequests(request)).toEqual([LIST_PATH, LIST_PATH]);

  await search.fill("no_such_run");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("heading", { name: "조건에 맞는 실험이 없어요" })).toBeVisible();
  await expect(page.getByLabel("실험 데이터 출처")).toContainText("전체 4개");
  await expect(page.getByTestId("experiment-list")).toContainText("표시 0개 / 불러온 child 5개");
  await expectAccessible(page, testInfo, "empty-filter");
  await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(status).toHaveValue("all");
  await expect(page.getByTestId("experiment-row")).toHaveCount(5);
  expect(await fixtureRequests(request)).toEqual([LIST_PATH, LIST_PATH]);
});

test("direct query entry normalizes unknown status and preserves unrelated query and history", async ({ page, request }) => {
  await setScenario(request, "all-statuses");
  await page.goto("/dashboard?q=fixture_failed&status=future_status&keep=visible");
  await expect(page.getByLabel("실험 상태", { exact: true })).toHaveValue("all");
  await expect(row(page, "fixture_failed")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\?keep=visible&q=fixture_failed$/);
  await page.reload();
  await expect(page.getByLabel("실험 ID 검색", { exact: true })).toHaveValue("fixture_failed");
  await page.getByRole("button", { name: "초기화", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?keep=visible$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\?keep=visible&q=fixture_failed$/);
  await expect(row(page, "fixture_failed")).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("experiment-row")).toHaveCount(5);
});

test("keyboard skip, filter, clear, disclosure and child navigation retain exact identity", async ({ page, request }, testInfo) => {
  await setScenario(request, "all-statuses");
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.getByLabel("실험 ID 검색", { exact: true }).focus();
  await page.keyboard.type("fixture_failed");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await expect(page.getByLabel("실험 ID 검색", { exact: true })).toBeFocused();
  const clear = page.getByRole("button", { name: "초기화", exact: true });
  await clear.focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("실험 ID 검색", { exact: true })).toBeFocused();
  await expect(page.getByTestId("experiment-row")).toHaveCount(5);
  const diagnostics = page.locator("summary").filter({ hasText: "조회 정보와 기록 상태" });
  await diagnostics.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("running · 실행 중", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("running · 실행 중", { exact: true })).toBeHidden();

  const link = page.getByRole("link", { name: "fixture_failed", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard\/lab\/runs\/fixture_failed$/);
  await expect(page.getByRole("heading", { name: "fixture_failed", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "실험", exact: true })).toBeVisible();
  await expect(page.getByTestId("experiment-row")).toHaveCount(5);
  await expectAccessible(page, testInfo, "keyboard-return");
});

test("responsive menus expose existing routes through pointer or touch and keyboard", async ({ page, isMobile }, testInfo) => {
  await page.goto("/dashboard");
  if (isMobile) {
    const menu = page.locator("summary").filter({ hasText: /^메뉴$/ });
    await menu.tap();
    const mobileNav = page.getByRole("navigation", { name: "모바일 주 메뉴", exact: true });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole("link", { name: "실험", exact: true }).tap();
    await expect(mobileNav).toBeHidden();
    await expect(page.getByRole("main")).toBeFocused();
    await menu.tap();
    await mobileNav.getByRole("link", { name: "전략·정책", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(mobileNav).toBeHidden();
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mobileNav).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: isMobile ? "모바일 주 메뉴" : "주 메뉴", exact: true });
  for (const [name, href] of [
    ["실험", "/dashboard"], ["전략·정책", "/dashboard/lab/policies"],
    ["비교", "/dashboard/validation#candidate-comparison"], ["데이터", "/dashboard/validation#data-universe-coverage"],
  ]) await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
  const operations = page.locator("summary:visible").filter({ hasText: "설정·운영" });
  await operations.focus();
  await page.keyboard.press("Enter");
  for (const [name, href] of [
    ["기존 운영 요약", "/dashboard/operations"], ["포트폴리오", "/dashboard/portfolio"],
    ["전략 테스트", "/dashboard/lab/strategy-tests"], ["Risk Gate", "/dashboard/risk-gate"],
    ["감사 기록", "/dashboard/audit"], ["Live Readiness", "/dashboard/live-readiness"],
    ["컴포넌트", "/dashboard/component-catalog"],
  ]) await expect(page.getByRole("link", { name, exact: true }).filter({ visible: true })).toHaveAttribute("href", href);
  await expectNoOverflow(page);
  await captureViewport(page, testInfo, "expanded-menu");
  await expectAccessible(page, testInfo, "expanded-menu");
  if (isMobile) {
    const menu = page.locator("summary").filter({ hasText: /^메뉴$/ });
    const mobileNav = page.getByRole("navigation", { name: "모바일 주 메뉴", exact: true });
    await mobileNav.getByRole("link", { name: "감사 기록", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(mobileNav).toBeHidden();
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole("link", { name: "기존 운영 요약", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/operations$/);
    await expect(page.getByRole("heading", { name: "Paper-only Dashboard", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "실험", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "모바일 주 메뉴", exact: true })).toBeHidden();
    const search = page.getByLabel("실험 ID 검색", { exact: true });
    await search.tap();
    await search.fill("fixture_completed");
    await page.getByRole("button", { name: "검색", exact: true }).tap();
    await expect(page.getByTestId("experiment-row")).toHaveCount(1);
    await page.getByRole("link", { name: "fixture_completed", exact: true }).tap();
    await expect(page).toHaveURL(/\/dashboard\/lab\/runs\/fixture_completed$/);
    await expect(page.getByRole("heading", { name: "fixture_completed", exact: true })).toBeVisible();
    await page.goBack();
    await expect(search).toHaveValue("fixture_completed");
  }
});

test("duplicate-terminal-detail keeps the last eligible terminal summary from list to detail and Back", async ({ page, request }, testInfo) => {
  await setScenario(request, "duplicate-terminal-detail");
  const id = "fixture_duplicate";
  const detailEndpoint = `/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=${id}`;
  const response = await request.get(`${FIXTURE_ORIGIN}${detailEndpoint}`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.runs).toHaveLength(2);
  expect(payload.selectedRun).toMatchObject({ runId: id, status: "failed", summary: { tradeCount: 1 } });

  await page.goto("/dashboard");
  await expectIdentity(page);
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await expect(row(page, id).getByRole("cell").nth(1)).toHaveText("완료");
  await expect(row(page, id)).toContainText("거래 2");
  await expect(page.getByLabel("실험 데이터 출처")).toContainText("전체 2개");
  await expect(page.getByLabel("실험 데이터 출처")).toContainText("terminal 1개");
  await expect(page.getByLabel("실험 데이터 출처")).toContainText("표시 제외 1행");
  await captureViewport(page, testInfo, "first-viewport");
  await row(page, id).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/lab/runs/${id}$`));
  await expect(page.getByRole("heading", { name: "Run Detail", exact: true })).toBeVisible();
  const summary = page.locator("section").filter({ has: page.getByRole("heading", { name: id, exact: true }) });
  await expect(summary.getByText("completed", { exact: true })).toBeVisible();
  await expect(summary.getByText("failed", { exact: true })).toHaveCount(0);
  await expect(summary.getByText("Trades", { exact: true }).locator("..").locator("p").nth(1)).toHaveText("2");
  await expectNoOverflow(page);
  await expectAccessible(page, testInfo, "duplicate-child-detail");
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await expect(row(page, id).getByRole("cell").nth(1)).toHaveText("완료");
  await expect(row(page, id)).toContainText("거래 2");
  await expectAccessible(page, testInfo, "duplicate-child-return");
});

test("fixture control is runner-only, whitelisted, no-store, and exposes no mutation route", async ({ request }) => {
  const control = `${FIXTURE_ORIGIN}${CONTROL_PATH}/scenario`;
  expect((await request.post(control, { data: { scenario: "empty" } })).status()).toBe(403);
  expect((await request.post(control, { headers: { ...CONTROL_HEADERS, origin: "http://127.0.0.1:3003" }, data: { scenario: "empty" } })).status()).toBe(403);
  expect((await request.post(control, { headers: CONTROL_HEADERS, data: { scenario: "../../real-data" } })).status()).toBe(400);
  expect((await request.post(`${FIXTURE_ORIGIN}/batch/replay/runs`)).status()).toBe(404);
  expect((await request.get(`${FIXTURE_ORIGIN}/provider`)).status()).toBe(404);
  const source = await request.get(`${FIXTURE_ORIGIN}${LIST_PATH}`);
  expect(source.headers()["cache-control"]).toBe("no-store");
  expect(source.headers()["access-control-allow-origin"]).toBeUndefined();
  expect((await source.json()).runs[0].runId).toBe("fixture_completed");
});

async function assertScenarioDetails(page: Page, scenario: string) {
  if (scenario === "all-statuses") {
    for (const [id, label] of [["fixture_completed", "완료"], ["fixture_completed_with_failures", "부분 실패"], ["fixture_failed", "실패"], ["fixture_skipped", "건너뜀"], ["fixture_running", "진행 중"]]) {
      await expect(row(page, id).getByRole("cell").nth(1)).toHaveText(label);
      await expect(row(page, id).getByRole("link")).toHaveAttribute("href", `/dashboard/lab/runs/${id}`);
    }
  }
  if (scenario === "active-only") {
    await expect(row(page, "fixture_running").getByRole("cell").nth(1)).toHaveText("진행 중");
    await expect(row(page, "fixture_running")).toContainText("거래 미확인 · 거절 미확인");
  }
  if (scenario === "active-terminal-dedup") await expect(row(page, "fixture_running").getByRole("cell").nth(1)).toHaveText("완료");
  if (scenario === "running-corrupt") {
    await expect(page.getByText("JSONL 2줄 손상", { exact: true })).toBeVisible();
    await expect(row(page, "fixture_running").getByRole("cell").nth(1)).toHaveText("진행 중");
    await expect(row(page, "fixture_completed").getByRole("cell").nth(1)).toHaveText("완료");
  }
  if (scenario === "no-manifest") {
    await expect(row(page, "fixture_unbound")).toContainText("저장 행 · batch 연결 미확인");
    await expect(row(page, "fixture_unbound").getByRole("link")).toHaveAttribute("href", "/dashboard/lab/runs/fixture_unbound");
    await expect(page.getByLabel("실험 데이터 출처")).toContainText("batch 미확인");
  }
  if (scenario.endsWith("stale-active")) {
    await expect(page.getByRole("link", { name: "fixture_running", exact: true })).toHaveCount(0);
    await expect(row(page, "fixture_completed").getByRole("cell").nth(1)).toHaveText("완료");
  }
  if (scenario === "mismatched-row" || scenario === "unknown-row") {
    await expect(page.getByLabel("실험 데이터 출처")).toContainText("표시 제외 1행");
    await expect(page.getByRole("link", { name: scenario === "mismatched-row" ? "fixture_other_batch" : "fixture_unknown", exact: true })).toHaveCount(0);
    await expect(row(page, "fixture_completed").getByRole("link")).toHaveAttribute("href", "/dashboard/lab/runs/fixture_completed");
  }
  if (scenario === "long-identifiers") {
    const id = `fixture_${"x".repeat(247)}`;
    expect(id).toHaveLength(255);
    await expect(row(page, id).getByRole("link")).toHaveAttribute("href", `/dashboard/lab/runs/${id}`);
  }
  if (scenario === "legacy-batch-id") {
    const id = "batch_smoke_2025_run_000000_2025-02";
    await expect(row(page, id).getByRole("link")).toHaveAttribute("href", `/dashboard/lab/runs/${id}`);
    await expect(row(page, id)).toContainText("저장 행 · batch 연결 미확인");
    await expect(page.getByLabel("실험 데이터 출처").getByText("선택 batch", { exact: true }).locator("..").locator("strong")).toHaveText("미확인");
    await expect(page.getByRole("main")).not.toContainText("batch smoke/2025");
    await expect(page.locator('a[href*="batch%20smoke"]')).toHaveCount(0);
  }
  if (scenario === "partial-manifest-metadata") {
    const source = page.getByLabel("실험 데이터 출처");
    await expect(row(page, "fixture_completed").getByRole("link")).toHaveAttribute("href", "/dashboard/lab/runs/fixture_completed");
    await expect(source.getByText("batch 요청 실행 수", { exact: true }).locator("..").locator("dd")).toHaveText("미확인");
    await expect(source.getByText("manifest 집계", { exact: true }).locator("..").locator("dd")).toHaveText("완료 미확인 · 실패 0 · 건너뜀 0");
  }
  if (scenario === "nullable-zero") {
    await expect(row(page, "fixture_null")).toContainText("거래 미확인 · 거절 미확인");
    await expect(row(page, "fixture_null")).toContainText("판단 실패 미확인");
    await expect(row(page, "fixture_zero")).toContainText("거래 0 · 거절 0");
    await expect(row(page, "fixture_zero")).toContainText("판단 실패 0");
  }
  if (scenario === "bounded-window") {
    await expect(page.getByLabel("실험 데이터 출처")).toContainText("전체 150개 · 이번 응답 100개 (요청 한도 100)");
    await expect(page.getByLabel("실험 데이터 출처")).toContainText("완료 150");
    await expect(page.getByRole("link", { name: "fixture_window_049", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "fixture_window_050", exact: true })).toHaveAttribute("href", "/dashboard/lab/runs/fixture_window_050");
    await expect(page.getByRole("link", { name: "fixture_window_149", exact: true })).toHaveAttribute("href", "/dashboard/lab/runs/fixture_window_149");
  }
}

function row(page: Page, runId: string) {
  return page.getByTestId("experiment-row").filter({ has: page.getByRole("link", { name: runId, exact: true }) });
}

async function setScenario(request: APIRequestContext, scenario: string) {
  const response = await request.post(`${FIXTURE_ORIGIN}${CONTROL_PATH}/scenario`, { headers: CONTROL_HEADERS, data: { scenario } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ fixture: MARKER, scenario });
}

async function fixtureRequests(request: APIRequestContext): Promise<string[]> {
  const response = await request.get(`${FIXTURE_ORIGIN}${CONTROL_PATH}/requests`, { headers: CONTROL_HEADERS });
  expect(response.ok()).toBe(true);
  return (await response.json()).requests;
}

async function expectIdentity(page: Page) {
  await expect(page).toHaveTitle("Toss Trading Dashboard");
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "실험", exact: true })).toBeInViewport();
  await expect(page.getByRole("link", { name: "기존 실행 설정", exact: true })).toBeInViewport();
  await expect(page.getByText("API가 선택한 batch / 최신 여부 미확인", { exact: true })).toBeInViewport();
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(/최신 batch|최신 실험|전체 실험 목록|모든 실험/);
}

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, "document must not scroll horizontally").toBeLessThanOrEqual(dimensions.width + 1);
}

async function captureViewport(page: Page, testInfo: TestInfo, label: string) {
  await expectNoOverflow(page);
  await testInfo.attach(label, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  const geometry = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, documentHeight: document.documentElement.scrollHeight, scrollX, scrollY }));
  expect(geometry.scrollX).toBe(0);
  if (label === "first-viewport") expect(geometry.scrollY).toBe(0);
  await testInfo.attach(`${label}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
}

async function expectAccessible(page: Page, testInfo: TestInfo, label: string) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: typeof axe.run } }).axe.run();
    return { violations: result.violations, incomplete: result.incomplete };
  });
  await testInfo.attach(`${label}-axe-incomplete`, { body: JSON.stringify(result.incomplete, null, 2), contentType: "application/json" });
  expect(result.violations, "axe incomplete checks are attached separately, not counted as passes").toEqual([]);
}
