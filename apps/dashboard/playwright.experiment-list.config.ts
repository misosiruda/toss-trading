import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated SSR contract-state tests, not proof of the real Operations API.
 * Run after (never concurrently with) playwright.config.ts: Next shares .next.
 * The default suite and its real backend fixture are deliberately unchanged.
 */
export default defineConfig({
  testDir: "./tests/experiment-list-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: "test-results/experiment-list",
  use: {
    baseURL: "http://127.0.0.1:3003",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node tests/experiment-list-e2e/fixture-api.mjs",
      url: "http://127.0.0.1:8791/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3003",
      env: {
        DASHBOARD_OPS_API_BASE_URL: "",
        OPS_API_BASE_URL: "http://127.0.0.1:8791",
      },
      url: "http://127.0.0.1:3003/dashboard",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "experiment-desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "experiment-tablet-1024",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 900 } },
    },
    {
      name: "experiment-mobile-390",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
