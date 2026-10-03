import { expect, test, type Page, type TestInfo } from "@playwright/test";
import axe from "axe-core";

// These tests use playwright.config.ts and its existing isolated REAL Operations
// API fixture. Do not populate the list by changing prepare-e2e-data.mjs: detail
// tests depend on that fixture's original single completed child.
const CHILD = "paper_sim_single_run_000000";
const CHILD_HREF = `/dashboard/lab/runs/${CHILD}`;

test("real API child list supports filters, direct reload, and exact detail Back", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const response = await request.get("http://127.0.0.1:8789/batch/replay/runs?limit=100");
  expect(response.ok()).toBe(true);
  const source = await response.json();
  expect(source).toMatchObject({ mode: "paper_only", readOnly: true, batchId: "paper_sim_single", count: 1, totalCount: 1 });
  expect(source.runs).toHaveLength(1);
  expect(source.runs[0]).toMatchObject({ runId: CHILD, status: "completed" });

  await page.goto("/dashboard");
  await expect(page).toHaveTitle("Toss Trading Dashboard");
  await expect(page.getByRole("heading", { name: "실험", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await expect(page.getByText("API가 선택한 batch / 최신 여부 미확인", { exact: true })).toBeVisible();
  const row = page.getByTestId("experiment-row").filter({ has: page.getByRole("link", { name: CHILD, exact: true }) });
  await expect(row).toContainText("완료");
  await expect(row).toContainText("2024-01-01");
  await expect(row).toContainText("2024-02-01");
  await expect(row.getByRole("link", { name: CHILD, exact: true })).toHaveAttribute("href", CHILD_HREF);
  await expect(page.locator('a[href="/dashboard/lab/runs/paper_sim_single"]')).toHaveCount(0);
  await expect(page.getByLabel("실험 데이터 출처")).toContainText("전체 1개");
  await expect(page.getByTestId("source-projected-counts")).toHaveText("저장 결과 1개 · 진행 중 0개");
  await expectNoOverflow(page);
  await testInfo.attach("real-api-first-viewport", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });

  await page.getByLabel("실험 ID 검색", { exact: true }).fill(CHILD);
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await page.getByLabel("실험 상태", { exact: true }).selectOption("completed");
  await expect(page).toHaveURL(new RegExp(`q=${CHILD}&status=completed$`));
  await page.reload();
  await expect(page.getByLabel("실험 ID 검색", { exact: true })).toHaveValue(CHILD);
  await expect(page.getByLabel("실험 상태", { exact: true })).toHaveValue("completed");
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);

  await page.getByRole("link", { name: CHILD, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${CHILD_HREF}$`));
  await expect(page.getByRole("heading", { name: "Run Detail", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: CHILD, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`q=${CHILD}&status=completed$`));
  await expect(page.getByLabel("실험 ID 검색", { exact: true })).toHaveValue(CHILD);
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);

  await page.getByLabel("실험 ID 검색", { exact: true }).fill("no_matching_fixture_child");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("heading", { name: "조건에 맞는 실험이 없어요" })).toBeVisible();
  await expect(page.getByTestId("experiment-row")).toHaveCount(0);
  await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("experiment-row")).toHaveCount(1);
  await expect(page.getByLabel("실험 ID 검색", { exact: true })).toBeFocused();

  const search = page.getByLabel("실험 ID 검색", { exact: true });
  const status = page.getByLabel("실험 상태", { exact: true });
  await search.fill(CHILD);
  await search.press("Enter");
  await status.selectOption("completed");
  await page.getByRole("link", { name: "조회 정보", exact: true }).click();
  const details = page.getByTestId("experiment-source-details");
  await details.locator("summary").click();
  await details.getByRole("link", { name: "목록 필터로 돌아가기", exact: true }).click();
  await expect(page).toHaveURL((url) => url.hash === "#experiment-query");
  await status.selectOption("failed");
  await expect(page.getByTestId("experiment-row")).toHaveCount(0);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.goBack();
    await expect(page).toHaveURL((url) => url.hash === "#experiment-query" && url.searchParams.get("status") === "completed");
    await expect(search).toHaveValue(CHILD);
    await expect(status).toHaveValue("completed");
    await expect(page.getByTestId("experiment-row")).toHaveCount(1);
    await page.goForward();
    await expect(page).toHaveURL((url) => url.hash === "#experiment-query" && url.searchParams.get("status") === "failed");
    await expect(search).toHaveValue(CHILD);
    await expect(status).toHaveValue("failed");
    await expect(page.getByTestId("experiment-row")).toHaveCount(0);
  }

  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: typeof axe.run } }).axe.run();
    return { violations: result.violations, incomplete: result.incomplete };
  });
  await testInfo.attach("real-api-axe-incomplete", { body: JSON.stringify(accessibility.incomplete, null, 2), contentType: "application/json" });
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("experiment navigation retains live existing destinations and anchored reports", async ({ page, isMobile }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const navigationEvents: Array<{ event: string; url: string; href?: string | null }> = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigationEvents.push({ event: "main-frame navigation", url: frame.url() });
  });
  try {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "기존 실행 설정", exact: true })).toHaveAttribute("href", "/dashboard/lab/policies");
    await expect(page.getByText(/PortfolioPolicy 실행은 지원하지 않음/)).toBeVisible();

    for (let cycle = 0; cycle < 3; cycle++) {
      for (const [label, anchor] of [["비교", "candidate-comparison"], ["데이터", "data-universe-coverage"]] as const) {
        if (isMobile) await openMobileMenu(page);
        const navigation = page.getByRole("navigation", { name: isMobile ? "모바일 주 메뉴" : "주 메뉴", exact: true });
        const link = navigation.getByRole("link", { name: new RegExp(`^${label}`) });
        await expect(link).toHaveAttribute("href", `/dashboard/validation#${anchor}`);
        navigationEvents.push({ event: `cycle ${cycle + 1}: ${label} click`, url: page.url(), href: await link.getAttribute("href") });
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/dashboard/validation#${anchor}$`));
        await expectReportDestination(page, anchor, testInfo);
        navigationEvents.push({ event: `cycle ${cycle + 1}: Back from ${label}`, url: page.url() });
        await page.goBack();
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.getByRole("heading", { name: "실험", exact: true })).toBeVisible();
      }
    }

    if (isMobile) await openMobileMenu(page);
    await page.locator("summary:visible").filter({ hasText: "설정·운영" }).click();
    await page.getByRole("link", { name: "기존 운영 요약", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/operations$/);
    await expect(page.getByRole("heading", { name: "Paper-only Dashboard", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "실험", exact: true })).toBeVisible();
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
  } finally {
    navigationEvents.push({ event: "final observed URL", url: page.url() });
    await testInfo.attach("real-navigation-url-sequence", { body: JSON.stringify(navigationEvents, null, 2), contentType: "application/json" });
    await testInfo.attach("real-navigation-browser-errors", { body: JSON.stringify(errors), contentType: "application/json" });
  }
});

test("direct validation report fragments and reload reach the visible focused destination", async ({ page }, testInfo) => {
  const geometry = [];
  for (const anchor of ["candidate-comparison", "data-universe-coverage"]) {
    await page.goto(`/dashboard/validation#${anchor}`);
    await expectReportDestination(page, anchor, testInfo);
    await page.reload();
    await expectReportDestination(page, anchor, testInfo);
    geometry.push(await page.locator(`#${anchor}`).evaluate((element) => ({
      id: element.id, top: element.getBoundingClientRect().top, scrollY: window.scrollY,
      focusedId: document.activeElement?.id, viewportHeight: window.innerHeight
    })));
  }
  await testInfo.attach("direct-reload-fragment-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
});

async function expectReportDestination(page: Page, anchor: string, testInfo: TestInfo) {
  const target = page.locator(`#${anchor}`);
  try {
    await expect(target).toBeVisible();
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
    // Scroll is clamped when the remaining document is shorter than a viewport.
    // Measuring the destination catches the previous URL-only success at Y=0.
    await expect.poll(async () => target.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
      const scroller = document.scrollingElement;
      const remaining = scroller ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : Infinity;
      return top >= margin - 3 && remaining <= 3 ? 0 : Math.abs(top - margin);
    })).toBeLessThanOrEqual(3);
  } finally {
    const geometry = await page.evaluate((id) => {
      const element = document.getElementById(id);
      const rect = element?.getBoundingClientRect();
      return { href: location.href, readyState: document.readyState, scrollY,
        viewport: { width: innerWidth, height: innerHeight,
          visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, visualScale: visualViewport?.scale },
        scroller: document.scrollingElement ? { height: document.scrollingElement.scrollHeight,
          clientHeight: document.scrollingElement.clientHeight, scrollTop: document.scrollingElement.scrollTop } : null,
        activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
        target: rect ? { id, top: rect.top, bottom: rect.bottom, height: rect.height,
          scrollMarginTop: getComputedStyle(element!).scrollMarginTop } : null };
    }, anchor);
    await testInfo.attach(`${anchor}-navigation-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  }
}

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
}

async function openMobileMenu(page: Page) {
  const summary = page.locator("summary").filter({ hasText: /^메뉴$/ });
  if (!(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open))) await summary.click();
}
