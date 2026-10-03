import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/experiment-wizard", workers: 1, retries: 0,
  timeout: 30_000, expect: { timeout: 5_000 },
  use: { baseURL: "http://127.0.0.1:3003", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "node tests/experiment-wizard/fixture-server.mjs", url: "http://127.0.0.1:8791/health", reuseExistingServer: false, timeout: 15_000 },
    { command: "npm run dev -- --hostname 127.0.0.1 --port 3003", url: "http://127.0.0.1:3003/dashboard/experiments/new", reuseExistingServer: false, timeout: 120_000,
      env: { DASHBOARD_OPS_API_BASE_URL: "", OPS_API_BASE_URL: "http://127.0.0.1:8791", DASHBOARD_MUTATION_TOKEN: "playwright-dashboard-mutation-token" } }
  ],
  projects: [
    { name: "wizard-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "wizard-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 900 } } },
    { name: "wizard-390", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } }
  ]
});
