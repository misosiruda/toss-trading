import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { type Market } from "../domain/schemas.js";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish,
  appendCurrentPortfolioSizingSnapshot as publishUnbound } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { type PortfolioValuationInput } from "./portfolioSizingInputs.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { createSourcePriceEvidencePaths, SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { createSourceFxEvidenceRecord } from "./sourceFxEvidence.js";
import { SourceFxEvidenceFileRepository } from "./sourceFxEvidenceFiles.js";

const TIME = Date.parse("2026-09-02T00:00:00.000Z");
const OBSERVED = "2026-09-01T23:59:00.000Z";
const options = { lockTimeoutMs: 60, lockRetryDelayMs: 5 };

async function fixture(context: TestContext, market: Market, operation: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "current-sizing-marks-"));
  context.mock.timers.enable({ apis: ["Date"], now: TIME });
  try { const state = await setup(baseDir, market); context.mock.timers.setTime(TIME + 100); await operation(state); }
  finally { context.mock.timers.reset(); await fs.rm(baseDir, { recursive: true, force: true }); }
}

async function setup(baseDir: string, market: Market) {
  const policy = policyFixture(), symbol = market === "KR" ? "005930" : "AAPL";
  const record = createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-mark.v1", market, symbol,
    priceField: "last_price", priceKrw: 10, observedAt: OBSERVED, createdAt: OBSERVED, sourceRefs: ["synthetic-source"] });
  const prices = new SourcePriceEvidenceFileRepository(baseDir, options);
  await prices.append(record);
  const portfolioPath = join(baseDir, "portfolio.json"), store = new FileVirtualPortfolioStore(portfolioPath, options);
  await store.write({ portfolioId: policy.policy.portfolioId, cashKrw: 100, updatedAt: OBSERVED,
    positions: [{ market, symbol, quantity: 2, averagePriceKrw: 10, region: market, sector: "Technology", strategyBucket: "intraday", updatedAt: OBSERVED }] });
  await storePolicyFixture(baseDir, policy);
  const valuationInputs: PortfolioValuationInput[] = [{ kind: "mark_price", market, symbol, priceKrw: 10,
    evidenceRef: record.evidenceRef, evidenceAsOf: OBSERVED }];
  if (market === "US") {
    const fx = createSourceFxEvidenceRecord({ schemaVersion: "source_fx_evidence.v1", sourceContractId: "synthetic-fx.v1",
      baseCurrency: "USD", quoteCurrency: "KRW", rate: 1400, observedAt: OBSERVED, createdAt: OBSERVED, sourceRefs: ["synthetic-fx"] });
    await new SourceFxEvidenceFileRepository(baseDir, options).append(fx);
    valuationInputs.push({ kind: "fx_rate", baseCurrency: "USD", quoteCurrency: "KRW", rate: fx.rate,
      evidenceRef: fx.evidenceRef, evidenceAsOf: OBSERVED });
  }
  const request = { baseDir, portfolioPath, policyHash: policy.policy.policyHash, asOf: new Date(TIME + 50).toISOString(),
    valuationInputs, pendingActionInputs: [], ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 120, cashKrw: 100,
      bucketExposureKrw: { intraday: 20, swing: 0, short_term: 0, long_term: 0, hedge: 0 },
      symbolExposureKrw: [{ market, symbol, exposureKrw: 20 }], marketExposureKrw: { KR: market === "KR" ? 20 : 0, US: market === "US" ? 20 : 0 },
      sectorExposureKrw: { Technology: 20 }, countryExposureKrw: { [market]: 20 }, currencyExposureKrw: { [market === "KR" ? "KRW" : "USD"]: 20 },
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) };
  return { baseDir, request, record, prices, store, pricePaths: createSourcePriceEvidencePaths(baseDir),
    snapshots: new PortfolioSizingSnapshotFileRepository(baseDir, options), records: createPortfolioSizingSnapshotPaths(baseDir).recordsPath };
}

test("policy-bound current sizing resolves stored KR and US marks without applying FX twice", async (context) => {
  for (const market of ["KR", "US"] as const) await fixture(context, market, async ({ request, pricePaths, snapshots }) => {
    const before = await fs.readFile(pricePaths.recordsPath);
    const result = await publish(request, options);
    assert.equal(result.exposureSnapshot.virtualNetWorthKrw, 120);
    assert.deepEqual(result.valuationInputs, request.valuationInputs);
    assert.deepEqual(await publish(request, options), result);
    assert.equal((await snapshots.readAll()).length, 1);
    assert.deepEqual(await fs.readFile(pricePaths.recordsPath), before);
  });
});

test("policy-bound current sizing rejects fake and mismatched stored mark references before append", async (context) => {
  for (const mismatch of ["missing", "market", "symbol", "price", "time"] as const) await fixture(context, "KR", async ({ request, record, prices, records }) => {
    const mark = request.valuationInputs.find((item) => item.kind === "mark_price")!;
    if (mismatch === "missing") mark.evidenceRef = "caller-only-mark";
    else {
      const { evidenceRef: _ref, evidenceHash: _hash, ...payload } = record;
      const other = createSourcePriceEvidenceRecord({ ...payload, sourceContractId: `synthetic-${mismatch}`,
        ...(mismatch === "market" ? { market: "US" as const } : {}), ...(mismatch === "symbol" ? { symbol: "000660" } : {}),
        ...(mismatch === "price" ? { priceKrw: 11 } : {}), ...(mismatch === "time" ? { observedAt: "2026-09-01T23:58:00.000Z" } : {}) });
      await prices.append(other); mark.evidenceRef = other.evidenceRef;
    }
    await assert.rejects(publish(request, options), /does not resolve|differs from stored/);
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
  });
});

test("policy-bound current sizing requires committed price availability at snapshot cutoff", async (context) => {
  await fixture(context, "KR", async ({ request, record, prices, records }) => {
    const { evidenceRef: _ref, evidenceHash: _hash, ...payload } = record;
    const late = createSourcePriceEvidenceRecord({ ...payload, sourceContractId: "synthetic-late" });
    await prices.append(late);
    request.valuationInputs.find((item) => item.kind === "mark_price")!.evidenceRef = late.evidenceRef;
    await assert.rejects(publish(request, options), /unavailable at its cutoff/);
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
    request.asOf = new Date(TIME + 100).toISOString();
    assert.equal((await publish(request, options)).valuationInputs[0]!.evidenceRef, late.evidenceRef);
  });
});

test("policy-bound current sizing rejects missing torn and legacy price sources even on exact retry", async (context) => {
  for (const failure of ["missing", "torn", "legacy"] as const) await fixture(context, "KR", async ({ request, record, records, pricePaths, store }) => {
    await publish(request, options); const before = await fs.readFile(records);
    if (failure === "missing") await fs.unlink(pricePaths.recordsPath);
    else if (failure === "torn") await fs.appendFile(pricePaths.recordsPath, "{");
    else {
      const payload = { record, appendedAt: new Date(TIME).toISOString(), previousEntryHash: null };
      await fs.writeFile(pricePaths.recordsPath, `${JSON.stringify({ ...payload, entryHash: hashCanonicalPayload(payload) })}\n`);
    }
    await assert.rejects(publish(request, options));
    assert.deepEqual(await fs.readFile(records), before); assert.ok(await store.read());
    // The original general publisher deliberately keeps its valuation-only contract.
    assert.ok(await publishUnbound(request, options));
  });
});

test("policy-bound current sizing holds the price lock before sizing and through new and retry fsync", async (context) => {
  await fixture(context, "KR", async ({ baseDir, request, records, prices, record }) => {
    const original = fs.open, lock = createPortfolioSizingSnapshotPaths(baseDir).lockPath;
    let lockChecks = 0, syncChecks = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lock && args[1] === "wx") { await assert.rejects(prices.append(record), /lock/); lockChecks++; }
      const handle = await original(...args);
      if (args[0] === records && (args[1] === "a" || args[1] === "r+")) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await assert.rejects(prices.append(record), /lock/); syncChecks++; await sync(); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await publish(request, options); await publish(request, options); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    // The price lease also remains held during retry's pre-append snapshot observation.
    assert.equal(lockChecks, 2); assert.equal(syncChecks, 3);
    assert.deepEqual(await prices.append(record), record);
  });
});

test("policy-bound current sizing rejects price corruption during lock wait and propagates source sync failure", async (context) => {
  for (const failure of ["torn", "sync"] as const) await fixture(context, "KR", async ({ request, pricePaths, records, store }) => {
    const original = fs.open, syncFailure = new Error("synthetic mark source sync failure"); let injected = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (failure === "torn" && args[0] === pricePaths.lockPath && args[1] === "wx" && !injected) {
        injected = true; await fs.appendFile(pricePaths.recordsPath, "{");
      }
      const handle = await original(...args);
      if (failure === "sync" && args[0] === pricePaths.recordsPath && args[1] === "r+") {
        context.mock.method(handle, "sync", async () => { injected = true; throw syncFailure; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(publish(request, options), failure === "sync" ? (error: unknown) => error === syncFailure : /torn|JSON/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true); await assert.rejects(fs.readFile(records), { code: "ENOENT" }); assert.ok(await store.read());
  });
});
