import { rm } from "node:fs/promises";
import { startLocalOperationsServer } from "../../../../dist/api/localOperationsServer.js";
import { portfolioScenarioDirectory, writePortfolioFixture } from "./fixture.mjs";
import { readPortfolioScenario } from "./scenarios.mjs";

const scenario = readPortfolioScenario(process.argv[2]);
const storageBaseDir = portfolioScenarioDirectory(scenario);
// Only the fixed, allowlisted E2E directory is reset, before any reader starts.
await rm(storageBaseDir, { recursive: true, force: true });
await writePortfolioFixture(storageBaseDir, scenario);
await startLocalOperationsServer({ storageBaseDir, host: "127.0.0.1", port: 8790, env: {} });
