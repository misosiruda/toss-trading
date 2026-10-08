import assert from "node:assert/strict";
import test from "node:test";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { initialPortfolio } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { observeReplayInitialPortfolio, replayInitialPortfolioObservationSchema, replayInitialPortfolioSnapshotSchema } from "./replayInitialPortfolioObservation.js";

test("initial snapshot preserves every consumed field and each field affects the fingerprint", () => {
  const value = initialPortfolio(), reference = observeReplayInitialPortfolio(value, "stored_portfolio");
  assert.equal(reference.status, "recorded");
  if (reference.status !== "recorded") return;
  assert.deepEqual(reference.snapshot, value);
  assert.equal(reference.contentHash, createReplayResearchHash({ schemaVersion: reference.snapshotVersion, snapshot: value }));
  const variations: Record<string, unknown> = { market: "US", symbol: "AAPL", assetType: "ETF", assetClass: "bond", region: "US",
    riskTags: [], strategyBucket: "hedge", sector: "utilities", quantity: 3, averagePriceKrw: 101,
    marketPriceKrw: 91, marketValueKrw: 226, unrealizedPnlKrw: 0, priceUpdatedAt: "2025-01-02T00:00:01.000Z",
    priceStaleAfter: "2025-01-02T00:06:00.000Z", priceSourceRefs: [], isPriceStale: true, updatedAt: "2025-01-02T00:00:01.000Z" };
  for (const [key, next] of Object.entries(variations)) {
    const changed = structuredClone(value); Object.assign(changed.positions[0]!, { [key]: next });
    const observation = observeReplayInitialPortfolio(changed, "stored_portfolio");
    assert.equal(observation.status, "recorded", key);
    assert.notEqual(observation.status === "recorded" && observation.contentHash, reference.contentHash, key);
  }
  for (const key of ["cashKrw", "portfolioId", "updatedAt"] as const) {
    const changed = structuredClone(value); Object.assign(changed, { [key]: key === "cashKrw" ? 1 : key === "portfolioId" ? "other" : "2025-01-02T00:01:00Z" });
    const observation = observeReplayInitialPortfolio(changed, "stored_portfolio");
    assert.notEqual(observation.status === "recorded" && observation.contentHash, reference.contentHash);
  }
});
test("presence is preserved without defaults; cash zero empty holdings and false are recorded", () => {
  const value = initialPortfolio();
  const absent = structuredClone(value); delete absent.positions[0]!.isPriceStale;
  assert.equal(Object.hasOwn(replayInitialPortfolioSnapshotSchema.parse(absent).positions[0]!, "isPriceStale"), false);
  assert.notDeepEqual(observeReplayInitialPortfolio(value, "generated"), observeReplayInitialPortfolio(absent, "generated"));
  value.positions = [];
  const record = observeReplayInitialPortfolio(value, "generated");
  assert.equal(record.status, "recorded"); assert.equal(record.status === "recorded" && record.snapshot.cashKrw, 0);
});
test("unsupported shape and sensitive input have no snapshot or guessing hash", () => {
  for (const value of [null, { ...initialPortfolio(), extra: true }, { ...initialPortfolio(), cashKrw: undefined },
    { ...initialPortfolio(), positions: [{ ...initialPortfolio().positions[0], invented: 0 }] }]) {
    assert.deepEqual(observeReplayInitialPortfolio(value, "generated"), { status: "unavailable", origin: "generated", reason: "unsupported_shape" });
  }
  const value = initialPortfolio(); value.positions[0]!.priceSourceRefs = ["account:123456-123-123456"];
  const masked = observeReplayInitialPortfolio(value, "stored_portfolio");
  assert.deepEqual(masked, { status: "unavailable", origin: "stored_portfolio", reason: "redacted" });
  assert.equal(JSON.stringify(masked).includes("123456"), false);
});
test("snapshot byte budget emits typed unavailable and frozen record rejects unknown versions and flags", () => {
  const value = initialPortfolio(); value.positions = Array.from({ length: 512 }, () => ({ ...value.positions[0]!, priceSourceRefs: ["x".repeat(512)] }));
  assert.deepEqual(observeReplayInitialPortfolio(value, "generated"), { status: "unavailable", origin: "generated", reason: "limit" });
  assert.equal(replayInitialPortfolioObservationSchema.safeParse({ schemaVersion: "replay_initial_portfolio_observation.v2" }).success, false);
});
