import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:3002",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command:
        "node tests/e2e/prepare-e2e-data.mjs && npm --prefix ../.. run dashboard -- --data-dir apps/dashboard/.e2e-data/paper --host 127.0.0.1 --port 8789",
      url: "http://127.0.0.1:8789/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 3002",
      env: {
        DASHBOARD_OPS_API_BASE_URL: "",
        DASHBOARD_MUTATION_TOKEN: "playwright-dashboard-mutation-token",
        OPS_API_BASE_URL: "http://127.0.0.1:8789",
      },
      url: "http://127.0.0.1:3002/dashboard",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
