import { defineConfig } from "@playwright/test";
import base from "./playwright.experiment-wizard.config";

export default defineConfig({
  ...base, testIgnore: [], testMatch: "native-detail-navigation.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:3004", launchOptions: {
    chromiumSandbox: true, ignoreDefaultArgs: ["--disable-back-forward-cache"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  } },
  webServer: [
    { command: "node tests/experiment-wizard/fixture-server.mjs", url: "http://127.0.0.1:8791/health", reuseExistingServer: false, timeout: 15_000 },
    { command: "npm run start -- --hostname 127.0.0.1 --port 3003", url: "http://127.0.0.1:3003/dashboard/experiments/new", reuseExistingServer: false, timeout: 120_000,
      env: { DASHBOARD_OPS_API_BASE_URL: "", OPS_API_BASE_URL: "http://127.0.0.1:8791", DASHBOARD_MUTATION_TOKEN: "playwright-dashboard-mutation-token", NEXT_TELEMETRY_DISABLED: "1" } },
    { command: "node tests/experiment-wizard/native-navigation-proxy.mjs", url: "http://127.0.0.1:3004/dashboard/experiments/new", reuseExistingServer: false, timeout: 15_000 }
  ]
});
