import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import axe from "axe-core";
const validatePath = "/dashboard/experiments/validate";
const createPath = "/dashboard/lab/policies/simulations/create";
const token = "playwright-dashboard-mutation-token";
const admissionKey = "paper-experiment-admission-v1";
async function fixture() { return JSON.parse(await readFile(process.env.EXPERIMENT_WIZARD_FIXTURE_FILE ?? ".e2e-data/experiment-wizard/fixture.json", "utf8")); }
async function snapshot(path: string): Promise<Record<string, unknown>> {
  const files: Record<string, unknown> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(file));
    else { const info = await stat(file); files[file] = { bytes: (await readFile(file)).toString("base64"), size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }; }
  } return files;
}
async function open(page: Page, id: string, step = 1) {
  await page.goto("/dashboard/experiments/new?cloneFrom=" + encodeURIComponent(id) + "&step=" + step);
  await expect(page.getByRole("button", { name: step === 3 ? "현재 입력 검증" : "다음", exact: true })).toBeEnabled();
}
async function validate(page: Page, expected: unknown) {
  const pending = page.waitForResponse(r => r.url().endsWith(validatePath));
  await page.getByRole("button", { name: "현재 입력 검증", exact: true }).click();
  const response = await pending; expect(response.status()).toBe(200);
  expect((await response.json()).requestedConfig).toEqual(expected);
  await expect(page.getByRole("status")).toContainText("입력 검증 완료");
}
for (const kind of ["whole", "omitted"] as const) test("whole original " + kind + " validates fresh, creates once and preserves source through Back/reload", async ({ page }) => {
  const source = (await fixture()).clones[kind]; const before = await snapshot(dirname(source.path));
  let posts = 0; const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  let acceptedReady!: (id: string) => void; const accepted = new Promise<string>(resolve => { acceptedReady = resolve; });
  await page.route("**" + createPath, async route => { posts++; expect(route.request().postDataJSON()).toEqual(source.requestedConfig); const response = await route.fetch(); expect(response.status()).toBe(202); acceptedReady((await response.json()).simulationRunId); await route.fulfill({ response }); });
  await page.goto("/dashboard/lab/runs/" + source.id + "?selectedRunId=child-not-the-source");
  const link = page.getByRole("link", { name: "원래 실험 전체 조건 복제", exact: true });
  await expect(link).toHaveAttribute("href", "/dashboard/experiments/new?cloneFrom=" + source.id);
  await link.focus(); await link.press("Enter");
  await expect(page.getByLabel("요청 실행 횟수")).toHaveValue(kind === "omitted" ? "" : "3");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByLabel("추출 seed")).toHaveValue(source.requestedConfig.window.seed);
  await expect(page.getByLabel("시작 날짜")).toHaveValue("2026-01-01"); await expect(page.getByLabel("종료 날짜")).toHaveValue("2026-01-31");
  await expect(page.getByLabel("수수료 (bps)")).toHaveValue(kind === "omitted" ? "" : "12.5");
  await page.addScriptTag({ content: axe.source }); const accessibility = await page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run()); expect(accessibility.violations).toEqual([]);
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })); expect(width.client).toBe(page.viewportSize()!.width); expect(width.scroll).toBeLessThanOrEqual(width.client);
  await page.getByRole("button", { name: "다음", exact: true }).click(); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await validate(page, source.requestedConfig); await page.getByLabel("실행 승인 토큰").fill(token); await page.getByRole("button", { name: "paper 실행 시작" }).click();
  const id = await accepted; expect(id).not.toBe(source.id); await expect(page).toHaveURL(new RegExp("/dashboard/lab/runs/" + id + "$")); expect(posts).toBe(1);
  await page.goBack();
  for (const reload of [false, true]) { if (reload) await page.reload(); await expect(page.getByRole("link", { name: "같은 ID 상태 조회" })).toHaveAttribute("href", "/dashboard/lab/runs/" + id); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); await expect(page.getByLabel("실행 승인 토큰")).toHaveValue(""); expect(posts).toBe(1); }
  await page.getByRole("button", { name: "원래 조건으로 별도의 새 실험 준비", exact: true }).click();
  await expect(page.getByLabel("요청 실행 횟수")).toHaveValue(kind === "omitted" ? "" : "3");
  expect(await page.evaluate(key => sessionStorage.getItem(key), admissionKey)).toBeNull();
  await page.getByRole("button", { name: "다음", exact: true }).click(); await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); await expect(page.getByLabel("실행 승인 토큰")).toHaveValue(""); expect(posts).toBe(1);
  expect(await snapshot(dirname(source.path))).toEqual(before); expect(errors).toEqual([]);
});
test("legacy, redacted, corrupt, missing and invalid exact IDs fail closed without create or defaults", async ({ page }) => {
  const clones = (await fixture()).clones; let posts = 0; page.on("request", r => { if (r.method() === "POST") posts++; });
  for (const id of [clones.legacy.id, clones.redacted.id, clones.corrupt.id, "paper_sim_20261001000000000_clone-missing", "latest", clones.whole.id + "/child"]) {
    await page.goto("/dashboard/experiments/new?cloneFrom=" + encodeURIComponent(id) + "&step=3");
    await expect(page.getByText("원래 요청을 완전히 확인할 수 없어 복제할 수 없습니다.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "현재 입력 검증", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  } expect(posts).toBe(0);
});
test("inherited disabled provider stays inherited and cannot create", async ({ page }) => {
  const source = (await fixture()).clones.codex; let posts = 0; page.on("request", r => { if (r.method() === "POST" && r.url().endsWith(createPath)) posts++; });
  await open(page, source.id, 3); const pending = page.waitForResponse(r => r.url().endsWith(validatePath)); await page.getByRole("button", { name: "현재 입력 검증", exact: true }).click();
  const response = await pending; expect(response.status()).toBe(400); expect(response.request().postDataJSON()).toEqual(source.requestedConfig);
  await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); expect(posts).toBe(0);
});
test("edited raw draft reload binds fresh hash and never restores receipt or token; unknown barrier survives source changes", async ({ page }) => {
  const clones = (await fixture()).clones; await open(page, clones.whole.id); await page.getByLabel("초기 모의 자본 (KRW)").fill("800000");
  await page.getByRole("button", { name: "다음", exact: true }).click(); await page.getByLabel("추출 seed").fill("synthetic-edited-seed"); await page.getByRole("button", { name: "다음", exact: true }).click();
  const expected = structuredClone(clones.whole.requestedConfig); expected.capital.initialCashKrw = 800000; expected.window.seed = "synthetic-edited-seed";
  await validate(page, expected); await page.getByLabel("실행 승인 토큰").fill(token); await page.reload();
  await expect(page.getByLabel("실행 승인 토큰")).toHaveValue(""); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); await validate(page, expected);
  const saved = await page.evaluate(() => sessionStorage.getItem("paper-experiment-clone-draft-v1")); expect(saved).not.toContain(token); expect(saved).not.toContain("receipt");
  await page.evaluate(key => sessionStorage.setItem(key, "response_unknown"), admissionKey); await page.reload(); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled();
  await page.goto("/dashboard/experiments/new?cloneFrom=" + clones.omitted.id + "&step=3"); await expect(page.getByRole("button", { name: "현재 입력 검증", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); expect(await page.evaluate(key => sessionStorage.getItem(key), admissionKey)).toBe("response_unknown");
});
test("a late source read cannot overwrite a newer exact source or trigger validation/create", async ({ page }) => {
  const clones = (await fixture()).clones; let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; }); let posts = 0;
  page.on("request", r => { if (r.method() === "POST") posts++; });
  await page.route("**/dashboard/experiments/clone?**", async route => { if (new URL(route.request().url()).searchParams.get("simulationRunId") !== clones.whole.id) return route.continue(); const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); });
  try { await page.goto("/dashboard/experiments/new?cloneFrom=" + clones.whole.id); await started; await page.evaluate(id => window.history.pushState(null, "", "/dashboard/experiments/new?cloneFrom=" + id), clones.omitted.id); await expect(page.getByRole("button", { name: "다음", exact: true })).toBeEnabled(); release(); await expect(page.getByLabel("요청 실행 횟수")).toHaveValue(""); expect(posts).toBe(0); }
  finally { release(); }
});

test("a stale validation cannot validate a newer clone source", async ({ page }) => {
  const clones = (await fixture()).clones; let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route("**" + validatePath, async route => { const response = await route.fetch(); expect(response.status()).toBe(200); entered(); await gate; await route.fulfill({ response }); });
  try { await open(page, clones.whole.id, 3); await page.getByRole("button", { name: "현재 입력 검증", exact: true }).click(); await started;
    await page.evaluate(id => window.history.pushState(null, "", "/dashboard/experiments/new?cloneFrom=" + id + "&step=3"), clones.omitted.id);
    await expect(page.getByRole("button", { name: "현재 입력 검증", exact: true })).toBeEnabled(); release(); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); await expect(page.getByText("현재 입력의 서버 검증이 필요합니다.", { exact: false })).toBeVisible();
  } finally { release(); }
});
test("late accepted clone preserves the latest source navigation and exact accepted barrier", async ({ page }) => {
  const clones = (await fixture()).clones; let release!: () => void; let acceptedReady!: (id: string) => void; const gate = new Promise<void>(resolve => { release = resolve; }); const accepted = new Promise<string>(resolve => { acceptedReady = resolve; }); let posts = 0;
  await page.route("**" + createPath, async route => { posts++; const response = await route.fetch(); expect(response.status()).toBe(202); acceptedReady((await response.json()).simulationRunId); await gate; await route.fulfill({ response }); });
  try { await open(page, clones.whole.id, 3); await validate(page, clones.whole.requestedConfig); await page.getByLabel("실행 승인 토큰").fill(token); await page.getByRole("button", { name: "paper 실행 시작" }).click(); const id = await accepted;
    await page.evaluate(source => window.history.pushState(null, "", "/dashboard/experiments/new?cloneFrom=" + source + "&step=3"), clones.omitted.id);
    await expect(page.getByText("원래 요청 ID: " + clones.omitted.id, { exact: true })).toBeVisible(); release();
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), admissionKey)).toBe(id); await expect(page).toHaveURL(new RegExp("cloneFrom=" + clones.omitted.id + "&step=3$"));
    await expect(page.getByRole("link", { name: "같은 ID 상태 조회" })).toHaveAttribute("href", "/dashboard/lab/runs/" + id); await expect(page.getByRole("button", { name: "paper 실행 시작" })).toBeDisabled(); expect(posts).toBe(1);
  } finally { release(); }
});
