import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import { seedManual, START, PORTFOLIO, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { seedSelectorReservation } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { capacityPolicy } from "./storedSnapshotOpeningCapacityTestFixtures.js";

export const options = { lockTimeoutMs: 90, lockRetryDelayMs: 3 };
export async function withCurrentCapacityFixture(context: TestContext,
  operation: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>, kind: "manual" | "selector" = "manual", openingLimits = false) {
  const dir = await fs.mkdtemp(join(tmpdir(), "current-sizing-capacity-"));
  context.mock.timers.enable({ apis: ["Date"], now: START });
  try { await operation(await setup(dir, context, kind, openingLimits)); }
  finally { context.mock.timers.reset(); await fs.rm(dir, { recursive: true, force: true }); }
}
async function setup(dir: string, context: TestContext, kind: "manual" | "selector", openingLimits: boolean) {
  const root = kind === "manual" ? await seedManual(dir, (ms) => context.mock.timers.setTime(START + ms)) :
    await seedSelectorReservation(dir, context, {});
  context.mock.timers.setTime(START + 100);
  const fixture = openingLimits ? capacityPolicy() : policyFixture();
  const { runtimePolicyRecordId: _id, policyHash: _hash, lineageHash: _lineage, createdAt, ...old } = fixture.policy;
  const payload = { ...old, portfolioId: PORTFOLIO }, policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId,
      semanticHash: policyHash, createdAt }) });
  await storePolicyFixture(dir, { ...fixture, policy });
  const portfolioPath = join(dir, "current-portfolio.json"), store = new FileVirtualPortfolioStore(portfolioPath, options);
  await store.write({ portfolioId: PORTFOLIO, cashKrw: 1000, positions: [], updatedAt: at(100) });
  const request = { baseDir: dir, portfolioPath, policyHash, asOf: at(100), valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) };
  return { dir, root, store, request, records: createPortfolioSizingSnapshotPaths(dir).recordsPath };
}
