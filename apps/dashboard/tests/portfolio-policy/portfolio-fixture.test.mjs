import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startLocalOperationsServer } from "../../../../dist/api/localOperationsServer.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot } from "../../../../dist/portfolio/runtimePortfolioPolicyActivationFiles.js";
import { findActiveRuntimePortfolioPolicyAsOf } from "../../../../dist/portfolio/runtimePortfolioPolicyActivation.js";
import { portfolioScenarioDirectory, writePortfolioFixture } from "./fixture.mjs";
import {
  missingPolicyWarning, portfolioScenarios, portfolioSnapshot
} from "./scenarios.mjs";

for (const scenario of portfolioScenarios) {
  test(`real Operations API: ${scenario} policy preserves ineffective analytics and exact policy state`, async (t) => {
    const { dataDir, fixture, baseUrl } = await startFixture(t, scenario);
    const before = await artifactBytes(dataDir);
    const response = await fetch(`${baseUrl}/dashboard/view-model/portfolio-compliance`);
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.mode, "paper_only");
    assert.equal(view.readOnly, true);
    assert.equal(view.policyStatus, scenario === "missing" ? "missing" : "active");
    assert.equal(view.hedgeCompliance.policyEnabled, scenario === "missing" ? null : scenario === "enabled");
    assert.equal(view.hedgeCompliance.status, "ineffective");
    assert.equal(view.complianceAnalytics.hedgeEffectiveness.status, "ineffective");
    if (scenario === "missing") {
      assert.equal(view.activePolicy, null);
      assert.equal(view.sourceStatus.policyArtifacts, "missing");
      assert.ok(view.warnings.includes(missingPolicyWarning));
      assert.ok(view.bucketCompliance.every((row) => row.status === "missing_policy" && row.targetWeightRatio === null));
      assert.deepEqual(Object.keys(before), ["virtual-portfolio.json"]);
    } else {
      assert.equal(view.sourceStatus.policyArtifacts, "ok");
      assert.equal(view.activePolicy.policyHash, fixture.policy.policyHash);
      assert.equal(view.activePolicy.runtimePolicyRecordId, fixture.policy.runtimePolicyRecordId);
      assert.equal(view.activePolicy.activationId, fixture.activation.activationId);
      assert.equal(view.activePolicy.effectiveFrom, fixture.portfolio.updatedAt);
      assert.ok(!view.warnings.includes(missingPolicyWarning));
      assert.ok(view.bucketCompliance.every((row) => row.status === "ok"));
      // The fixture has no other breach: disabled must genuinely suppress only
      // hedge compliance, rather than accidentally losing its active policy.
      assert.equal(view.status, scenario === "enabled" ? "breach" : "ok");
      await assertStoredPolicy(dataDir, fixture, fixture.portfolio.updatedAt);
    }
    assert.deepEqual(await artifactBytes(dataDir), before, "read-only API must preserve fixture bytes");
  });
}

test("future-effective activation stays unavailable at the June snapshot despite valid policy/dependencies", async (t) => {
  const activationAt = "2026-06-27T00:00:00.001Z";
  const { dataDir, fixture, baseUrl } = await startFixture(t, "enabled", { activationAt });
  assert.ok(Date.parse(activationAt) > Date.parse(fixture.portfolio.updatedAt));
  await assertStoredPolicy(dataDir, fixture, activationAt);
  const response = await fetch(`${baseUrl}/dashboard/view-model/portfolio-compliance`);
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.equal(view.policyStatus, "missing");
  assert.equal(view.activePolicy, null);
  assert.equal(view.hedgeCompliance.policyEnabled, null);
  assert.equal(view.hedgeCompliance.status, "ineffective");
  assert.ok(view.warnings.includes(missingPolicyWarning));
});

test("scenario paths are allowlisted, distinct and cannot target the original smoke data", () => {
  const paths = portfolioScenarios.map(portfolioScenarioDirectory);
  assert.equal(new Set(paths).size, 3);
  const defaultDir = fileURLToPath(new URL("../../.e2e-data/paper/", import.meta.url));
  assert.ok(paths.every((path) => path !== defaultDir && !path.startsWith(defaultDir)));
  for (const input of [undefined, "", "../paper", "/tmp", "future", "enabled/../../paper"]) {
    assert.throws(() => portfolioScenarioDirectory(input), /Portfolio scenario must be/);
  }
});

async function assertStoredPolicy(dataDir, fixture, asOf) {
  const stored = await readStoredRuntimePortfolioPolicyActivationSnapshot(dataDir);
  assert.equal(stored.policies.length, 1);
  assert.equal(stored.events.length, 1);
  assert.equal(stored.policies[0].portfolioId, portfolioSnapshot().portfolioId);
  assert.equal(stored.events[0].portfolioId, portfolioSnapshot().portfolioId);
  const active = findActiveRuntimePortfolioPolicyAsOf({
    portfolioId: fixture.portfolio.portfolioId, asOf,
    policies: stored.policies, events: stored.events, dependencies: stored.dependencies.repository
  });
  assert.equal(active.policy.policyHash, fixture.policy.policyHash);
  assert.equal(active.activation.activationId, fixture.activation.activationId);
}

async function startFixture(t, scenario, options) {
  const root = fileURLToPath(new URL("../../.e2e-data/", import.meta.url));
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(join(root, "portfolio-contract-"));
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });
  const fixture = await writePortfolioFixture(dataDir, scenario, options);
  server = await startLocalOperationsServer({ storageBaseDir: dataDir, host: "127.0.0.1", port: 0, env: {} });
  return { dataDir, fixture, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function artifactBytes(dataDir) {
  return Object.fromEntries(await Promise.all((await readdir(dataDir)).sort().map(async (name) => [
    name, await readFile(join(dataDir, name), "utf8")
  ])));
}
