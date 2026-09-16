import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish,
  appendCurrentPortfolioSizingSnapshot as publishUnbound } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { createSourceFxEvidenceRecord } from "./sourceFxEvidence.js";
import { createSourceFxEvidencePaths, SourceFxEvidenceFileRepository } from "./sourceFxEvidenceFiles.js";

const TIME = Date.parse("2026-09-02T00:00:00.000Z"), OBSERVED = "2026-09-01T23:59:00.000Z";
const options = { lockTimeoutMs: 60, lockRetryDelayMs: 5 };
const fxRecord = (overrides = {}) => createSourceFxEvidenceRecord({ schemaVersion: "source_fx_evidence.v1", sourceContractId: "synthetic-fx.v1",
  baseCurrency: "USD", quoteCurrency: "KRW", rate: 1400, observedAt: OBSERVED, createdAt: OBSERVED, sourceRefs: ["synthetic-fx"], ...overrides });
async function fixture(context: TestContext, operation: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "current-sizing-fx-"));
  context.mock.timers.enable({ apis: ["Date"], now: TIME });
  try { const state = await setup(baseDir); context.mock.timers.setTime(TIME + 100); await operation(state); }
  finally { context.mock.timers.reset(); await fs.rm(baseDir, { recursive: true, force: true }); }
}
async function setup(baseDir: string) {
  const policy = policyFixture(), portfolioPath = join(baseDir, "portfolio.json"), store = new FileVirtualPortfolioStore(portfolioPath, options);
  await store.write({ portfolioId: policy.policy.portfolioId, cashKrw: 100, updatedAt: OBSERVED,
    positions: [{ market: "US", symbol: "AAPL", quantity: 2, averagePriceKrw: 10, region: "US", sector: "Technology", strategyBucket: "intraday", updatedAt: OBSERVED }] });
  await storePolicyFixture(baseDir, policy);
  const price = createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-price.v1", market: "US", symbol: "AAPL", priceField: "last_price",
    priceKrw: 10, observedAt: OBSERVED, createdAt: OBSERVED, sourceRefs: ["synthetic-price"] });
  const prices = new SourcePriceEvidenceFileRepository(baseDir, options); await prices.append(price);
  const fx = fxRecord(), rates = new SourceFxEvidenceFileRepository(baseDir, options); await rates.append(fx);
  const rate = { kind: "fx_rate" as const, baseCurrency: "USD", quoteCurrency: "KRW" as const, rate: fx.rate, evidenceRef: fx.evidenceRef, evidenceAsOf: OBSERVED };
  const request = { baseDir, portfolioPath, policyHash: policy.policy.policyHash, asOf: new Date(TIME + 50).toISOString(),
    valuationInputs: [{ kind: "mark_price" as const, market: "US" as const, symbol: "AAPL", priceKrw: 10, evidenceRef: price.evidenceRef, evidenceAsOf: OBSERVED }, rate],
    pendingActionInputs: [], ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 120, cashKrw: 100,
      bucketExposureKrw: { intraday: 20, swing: 0, short_term: 0, long_term: 0, hedge: 0 }, symbolExposureKrw: [{ market: "US", symbol: "AAPL", exposureKrw: 20 }],
      marketExposureKrw: { KR: 0, US: 20 }, sectorExposureKrw: { Technology: 20 }, countryExposureKrw: { US: 20 }, currencyExposureKrw: { USD: 20 },
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) };
  return { baseDir, store, request, rate, rates, fx, price, prices, paths: createSourceFxEvidencePaths(baseDir),
    snapshots: new PortfolioSizingSnapshotFileRepository(baseDir, options), destination: createPortfolioSizingSnapshotPaths(baseDir) };
}

test("policy-bound current sizing authenticates stored FX and preserves KRW mark valuation on retry", async (context) => {
  await fixture(context, async ({ request, rates, fx, paths, snapshots }) => {
    const before = await fs.readFile(paths.recordsPath), result = await publish(request, options);
    assert.equal(result.exposureSnapshot.virtualNetWorthKrw, 120);
    assert.deepEqual(await publish(request, options), result); assert.equal((await snapshots.readAll()).length, 1);
    assert.deepEqual(await fs.readFile(paths.recordsPath), before); assert.deepEqual(await rates.append(fx), fx);
  });
});

test("policy-bound current sizing rejects missing forged mismatched and late FX sources before persistence", async (context) => {
  for (const failure of ["ref", "rate", "time", "late", "missing", "torn"] as const) await fixture(context, async ({ request, rate, rates, paths, destination, store }) => {
    if (failure === "ref") rate.evidenceRef = "caller-fx-ref";
    else if (failure === "rate") rate.rate++;
    else if (failure === "time") rate.evidenceAsOf = "2026-09-01T23:58:00Z";
    else if (failure === "late") {
      const late = fxRecord({ sourceContractId: "synthetic-late" }); await rates.append(late); rate.evidenceRef = late.evidenceRef;
    } else if (failure === "missing") await fs.unlink(paths.recordsPath);
    else await fs.appendFile(paths.recordsPath, "{");
    await assert.rejects(publish(request, options));
    await assert.rejects(fs.readFile(destination.recordsPath), { code: "ENOENT" }); assert.ok(await store.read());
    if (failure === "late") {
      request.asOf = new Date(TIME + 100).toISOString(); assert.ok(await publish(request, options));
    }
  });
});

test("policy-bound exact retry revalidates FX while the general publisher keeps its existing contract", async (context) => {
  for (const failure of ["missing", "torn"] as const) await fixture(context, async ({ request, paths, destination }) => {
    const result = await publish(request, options), before = await fs.readFile(destination.recordsPath);
    if (failure === "missing") await fs.unlink(paths.recordsPath); else await fs.appendFile(paths.recordsPath, "{");
    await assert.rejects(publish(request, options)); assert.deepEqual(await fs.readFile(destination.recordsPath), before);
    assert.deepEqual(await publishUnbound(request, options), result);
  });
});

test("policy-bound current sizing holds price then FX before sizing and through new and retry fsync", async (context) => {
  await fixture(context, async ({ request, paths, destination, rates, fx, prices, price }) => {
    const original = fs.open; let orderChecks = 0, lockChecks = 0, syncChecks = 0, observePublisherFxLock = true;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === paths.lockPath && args[1] === "wx" && observePublisherFxLock) {
        observePublisherFxLock = false;
        await assert.rejects(prices.append(price), /lock/); orderChecks++;
      }
      if (args[0] === destination.lockPath && args[1] === "wx") { await assert.rejects(rates.append(fx), /lock/); lockChecks++; }
      const handle = await original(...args);
      if (args[0] === destination.recordsPath && (args[1] === "a" || args[1] === "r+")) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await assert.rejects(rates.append(fx), /lock/); syncChecks++; await sync(); });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { await publish(request, options); observePublisherFxLock = true; await publish(request, options); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(orderChecks, 2); assert.equal(lockChecks, 2); assert.equal(syncChecks, 2);
    assert.deepEqual(await rates.append(fx), fx); assert.deepEqual(await prices.append(price), price);
  });
});

test("policy-bound current sizing propagates FX source fsync failure without writing a destination", async (context) => {
  await fixture(context, async ({ request, paths, destination, rates, fx }) => {
    const original = fs.open, failure = new Error("synthetic FX source sync failure");
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === paths.recordsPath && args[1] === "r+") context.mock.method(handle, "sync", async () => { throw failure; });
      return handle;
    }); syncBuiltinESMExports();
    try { await assert.rejects(publish(request, options), (error: unknown) => error === failure); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await assert.rejects(fs.readFile(destination.recordsPath), { code: "ENOENT" }); assert.deepEqual(await rates.append(fx), fx);
  });
});
