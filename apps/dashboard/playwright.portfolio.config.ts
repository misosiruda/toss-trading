import { defineConfig } from "@playwright/test";
import baseline from "./playwright.config";
import { readPortfolioScenario } from "./tests/portfolio-policy/scenarios.mjs";

const scenario = readPortfolioScenario(process.env.PORTFOLIO_E2E_SCENARIO);

// The runner completes one scenario (both browser projects) and shuts down its
// servers before starting the next. Fixtures are never rewritten under readers.
export default defineConfig({
  ...baseline,
  testDir: "./tests/portfolio-policy",
  testMatch: "portfolio-policy.spec.ts",
  use: { ...baseline.use, baseURL: "http://127.0.0.1:3003" },
  webServer: [
    {
      command: `node tests/portfolio-policy/start-server.mjs ${scenario}`,
      url: "http://127.0.0.1:8790/health",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3003",
      env: {
        DASHBOARD_OPS_API_BASE_URL: "",
        DASHBOARD_MUTATION_TOKEN: "",
        OPS_API_BASE_URL: "http://127.0.0.1:8790"
      },
      url: "http://127.0.0.1:3003/dashboard/portfolio",
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
