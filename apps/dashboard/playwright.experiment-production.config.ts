import { defineConfig, devices } from "@playwright/test";
import baseline from "./playwright.config";

// This is an additional production regression gate, not a replacement for the
// original default suite. Run after building and after all other servers exit.
export default defineConfig({
  ...baseline,
  testMatch: "experiment-list.spec.ts",
  use: { ...baseline.use, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    {
      command: "node tests/e2e/prepare-e2e-data.mjs && npm --prefix ../.. run dashboard -- --data-dir apps/dashboard/.e2e-data/paper --host 127.0.0.1 --port 8789",
      url: "http://127.0.0.1:8789/health",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3002",
      env: {
        DASHBOARD_OPS_API_BASE_URL: "",
        DASHBOARD_MUTATION_TOKEN: "playwright-dashboard-mutation-token",
        OPS_API_BASE_URL: "http://127.0.0.1:8789"
      },
      url: "http://127.0.0.1:3002/dashboard",
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    { name: "production-desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "production-tablet-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 900 } } },
    { name: "production-mobile-390", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }
  ]
});
