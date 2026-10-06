import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { portfolioScenarios } from "./scenarios.mjs";

const dashboardRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function run(args, cwd, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) process.exit(result.status || 1);
}

// Compile factory imports once before seeding or testing. Scenario servers use
// the compiled Operations API directly and do not rebuild between scenarios.
// Run the default E2E suite, this runner, then any later list/SSR matrix strictly
// sequentially: Next.js development servers share this worktree's .next lock.
run(["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], repoRoot);
run(["--test", "tests/portfolio-policy/portfolio-fixture.test.mjs"], dashboardRoot);
for (const scenario of portfolioScenarios) {
  run(["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.portfolio.config.ts"], dashboardRoot, {
    ...process.env, PORTFOLIO_E2E_SCENARIO: scenario
  });
}
