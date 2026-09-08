import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBucketTurnoverSnapshotOrigin, resolveBucketTurnoverSnapshotOrigin } from "./bucketTurnoverSnapshotOrigin.js";
import { createInitialBucketTurnoverState } from "./bucketTurnover.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";

const POLICY = `sha256:${"a".repeat(64)}`;
const NEXT_POLICY = `sha256:${"b".repeat(64)}`;
const START = "2026-09-02T00:00:00.000Z";
const request = { portfolioId: "synthetic-portfolio", bucket: "swing" as const, policyHash: NEXT_POLICY,
  durationSeconds: 86_400, asOf: "2026-09-02T01:00:00.000Z" };

test("turnover denominator selects the exact latest pre-window stored snapshot across policies and append order", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const latest = snapshot("latest", "2026-09-01T23:59:59.999Z", 300);
    const older = snapshot("older", "2026-09-01T12:00:00.000Z", 100);
    const boundary = snapshot("boundary", START, 500);
    const after = snapshot("after", "2026-09-02T00:00:00.001Z", 1_000);
    for (const item of [latest, boundary, older, after, snapshot("foreign", "2026-09-01T23:59:59.999Z", 900, "other")]) await repository.append(item);
    const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const origin = await repository.withDurableVerifiedHistory(async (history) => createBucketTurnoverSnapshotOrigin(history, request));
    assert.equal(origin.portfolioSnapshotId, latest.portfolioSnapshotId);
    assert.equal(origin.initialState.windowOpenPortfolioNetWorthKrw, 300);
    assert.equal(origin.initialState.lastAppliedPolicyHash, NEXT_POLICY);
    assert.equal(origin.initialState.windowStartedAt, START);
    assert.ok(Object.isFrozen(origin) && Object.isFrozen(origin.initialState) && Object.isFrozen(origin.observation));
    await new PortfolioSizingSnapshotFileRepository(baseDir).withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(resolveBucketTurnoverSnapshotOrigin(history, JSON.parse(JSON.stringify(origin))), origin);
    });
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});

test("turnover denominator fails closed for missing, ambiguous and zero latest snapshot without falling back", async () => {
  for (const records of [[], [snapshot("at-boundary", START, 300)],
    [snapshot("a", "2026-09-01T23:00:00Z", 100), snapshot("b", "2026-09-02T08:00:00+09:00", 200)],
    [snapshot("older", "2026-09-01T22:00:00Z", 100), snapshot("zero", "2026-09-01T23:00:00Z", 0)]]) {
    await withDirectory(async (baseDir) => {
      const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
      for (const record of records) await repository.append(record);
      await assert.rejects(repository.withDurableVerifiedHistory(async (history) => createBucketTurnoverSnapshotOrigin(history, request)), /missing or ambiguous|must be positive/);
    });
  }
});

test("turnover source binding requires a live repository lease, strict input and nonfuture observation", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const stored = snapshot("v1", "2026-09-01T23:00:00Z", 300);
    await repository.append(stored);
    let captured: VerifiedPortfolioSizingSnapshotHistory | undefined;
    const origin = await repository.withDurableVerifiedHistory(async (history) => {
      captured = history;
      for (const fake of [{ snapshots: [stored] }, { ...history }, JSON.parse(JSON.stringify(history))]) {
        assert.throws(() => createBucketTurnoverSnapshotOrigin(fake, request), /durable observation lease/);
      }
      assert.throws(() => createBucketTurnoverSnapshotOrigin(history, { ...request, asOf: "9999-01-01T00:00:00Z" }), /after source observation/);
      assert.throws(() => createBucketTurnoverSnapshotOrigin(history, { ...request, windowOpenPortfolioNetWorthKrw: 900 } as typeof request));
      return createBucketTurnoverSnapshotOrigin(history, request);
    });
    assert.ok(captured);
    const expired = captured;
    assert.throws(() => createBucketTurnoverSnapshotOrigin(expired, request), /durable observation lease/);
    assert.throws(() => resolveBucketTurnoverSnapshotOrigin(expired, origin), /durable observation lease/);
  });
});

test("turnover historical origin retains the observed prefix after later append and rejects snapshot or denominator substitution", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    const original = snapshot("v1", "2026-09-01T22:00:00Z", 300);
    await repository.append(original);
    const origin = await repository.withDurableVerifiedHistory(async (history) => createBucketTurnoverSnapshotOrigin(history, request));
    await repository.append(snapshot("late-arriving", "2026-09-01T23:00:00Z", 400));
    await repository.append(snapshot("in-window", "2026-09-02T00:30:00Z", 1_000));
    await new PortfolioSizingSnapshotFileRepository(baseDir).withDurableVerifiedHistory(async (history) => {
      assert.deepEqual(resolveBucketTurnoverSnapshotOrigin(history, origin), origin);
      const newlyObserved = createBucketTurnoverSnapshotOrigin(history, request);
      assert.equal(newlyObserved.initialState.windowOpenPortfolioNetWorthKrw, 400);
      assert.equal(newlyObserved.initialState.turnoverStateId, origin.initialState.turnoverStateId);
      // The future window repository must retain the first origin and reject root replacement.
      for (const change of [{ portfolioSnapshotId: "other" }, { portfolioSnapshotHash: NEXT_POLICY }, { exposureSnapshotHash: NEXT_POLICY },
        { initialState: createInitialBucketTurnoverState({ ...request, windowOpenPortfolioNetWorthKrw: 500 }) },
        { initialState: createInitialBucketTurnoverState({ ...request, portfolioId: "other", windowOpenPortfolioNetWorthKrw: 300 }) },
        { observation: { ...origin.observation, recordCount: 2 } }, { unexpected: true }]) {
        assert.throws(() => resolveBucketTurnoverSnapshotOrigin(history, { ...origin, ...change }));
      }
    });
  });
});

test("turnover origin rejects rewritten, truncated and corrupt snapshot history", async () => {
  await withDirectory(async (baseDir) => {
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    await repository.append(snapshot("v1", "2026-09-01T23:00:00Z", 300));
    const origin = await repository.withDurableVerifiedHistory(async (history) => createBucketTurnoverSnapshotOrigin(history, request));
    const path = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    for (const raw of ["", `${JSON.stringify(snapshot("v1", "2026-09-01T23:00:00Z", 400))}\n`, original + "{", original + "{}\n"]) {
      await writeFile(path, raw, "utf8");
      await assert.rejects(repository.withDurableVerifiedHistory(async (history) => resolveBucketTurnoverSnapshotOrigin(history, origin)), /source prefix|torn|corrupt/);
    }
  });
});

test("turnover denominator uses independently valued portfolio NAV including held positions", async () => {
  await withDirectory(async (baseDir) => {
    const asOf = "2026-09-01T23:00:00Z";
    const cash = snapshot("valued", asOf, 100);
    const exposure = createPortfolioExposureSnapshot({ ...cash.exposureSnapshot, virtualNetWorthKrw: 500,
      bucketExposureKrw: { ...cash.exposureSnapshot.bucketExposureKrw, long_term: 400 },
      symbolExposureKrw: [{ market: "KR", symbol: "005930", exposureKrw: 400 }], marketExposureKrw: { KR: 400, US: 0 },
      sectorExposureKrw: { Electronics: 400 }, countryExposureKrw: { KR: 400 }, currencyExposureKrw: { KRW: 400 } });
    const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = cash;
    const valued = createPortfolioSizingSnapshot({ ...payload, ...exposure,
      virtualPortfolio: { ...cash.virtualPortfolio, positions: [{ market: "KR", symbol: "005930", assetType: "STOCK",
        assetClass: "equity", region: "KR", riskTags: [], strategyBucket: "long_term", sector: "Electronics",
        quantity: 2, averagePriceKrw: 100, marketPriceKrw: 200, marketValueKrw: 400, unrealizedPnlKrw: 200, updatedAt: asOf }] },
      valuationInputs: [{ kind: "mark_price", market: "KR", symbol: "005930", priceKrw: 200, evidenceRef: "synthetic-price", evidenceAsOf: asOf }] });
    const repository = new PortfolioSizingSnapshotFileRepository(baseDir);
    await repository.append(valued);
    await repository.withDurableVerifiedHistory(async (history) => {
      const origin = createBucketTurnoverSnapshotOrigin(history, request);
      assert.equal(origin.initialState.windowOpenPortfolioNetWorthKrw, 500);
      assert.equal(origin.exposureSnapshotHash, valued.exposureSnapshotHash);
      assert.deepEqual(resolveBucketTurnoverSnapshotOrigin(history, origin), origin);
    });
  });
});

function snapshot(version: string, asOf: string, cashKrw: number, portfolioId = request.portfolioId) {
  const exposure = createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw, cashKrw,
    bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
    marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
    pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 });
  return createPortfolioSizingSnapshot({ portfolioId, portfolioVersion: version, policyHash: POLICY, asOf,
    virtualPortfolio: { portfolioId, cashKrw, positions: [], updatedAt: asOf }, valuationInputs: [], pendingActionInputs: [], ...exposure });
}

async function withDirectory(operation: (baseDir: string) => Promise<void>): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-turnover-snapshot-"));
  try { await operation(baseDir); } finally { await rm(baseDir, { recursive: true, force: true }); }
}
