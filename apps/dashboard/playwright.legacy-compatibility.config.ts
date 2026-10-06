import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Run after the default suite: production and dev share .next.
// A configured legacy origin belongs only to this dedicated synthetic suite.
export default defineConfig({
  ...base,
  testDir: "./tests/legacy-compatibility",
  workers: 1,
  retries: 0,
  outputDir: "test-results/legacy-compatibility",
  use: { ...base.use, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: (base.webServer as { command: string; env?: Record<string, string> }[]).map((server, index) => ({
    ...server,
    reuseExistingServer: false,
    ...(index === 1 ? {
      command: "npm run start -- --hostname 127.0.0.1 --port 3002",
      env: { ...server.env, DASHBOARD_LEGACY_ORIGIN: "http://127.0.0.1:8789", NEXT_TELEMETRY_DISABLED: "1" },
    } : {}),
  })),
  projects: [
    { name: "legacy-desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "legacy-tablet-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 900 } } },
    { name: "legacy-mobile-390", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } },
  ],
});
