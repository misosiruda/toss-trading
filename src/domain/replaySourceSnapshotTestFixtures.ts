import assert from "node:assert/strict";
import type { HistoricalMarketSnapshot } from "./schemas.js";
import { prepareReplaySourceSnapshot, type ReplaySourceSnapshotObservation } from "./replaySourceSnapshot.js";

export function sourceSnapshot(): HistoricalMarketSnapshot {
  return { snapshotId: "synthetic-snapshot", market: "KR", symbol: "SYNTH", name: "Synthetic stock",
    assetType: "STOCK", assetClass: "equity", region: "KR", riskTags: ["currency_exposed", "sector_concentrated"],
    strategyBucket: "swing", sector: "synthetic", observedAt: "2025-01-02T00:00:00.000Z", interval: "1m",
    openPriceKrw: 100, highPriceKrw: 110, lowPriceKrw: 90, closePriceKrw: 101, lastPriceKrw: 102, volume: 12.5,
    sourceRefs: ["synthetic:alpha", "synthetic:beta"], createdAt: "2025-01-02T00:00:01.000Z" };
}

export function minimalSourceSnapshot(): HistoricalMarketSnapshot {
  return { snapshotId: "s", market: "KR", symbol: "S", observedAt: "2025-01-02T00:00:00Z",
    interval: "1m", lastPriceKrw: 0, sourceRefs: ["x"], createdAt: "2025-01-02T00:00:01Z" };
}

export function recordedSource(value: unknown): Extract<ReplaySourceSnapshotObservation, { status: "recorded" }> {
  const result = prepareReplaySourceSnapshot(value);
  assert.equal(result.status, "recorded");
  if (result.status !== "recorded") throw new Error("Expected recorded synthetic source");
  return result;
}

// Escape-heavy strings cover the exact byte budget with 44 small records, not huge nested inputs.
export function sourceAtJsonBytes(bytes: number): HistoricalMarketSnapshot[] {
  const records = Array.from({ length: 44 }, minimalSourceSnapshot);
  let remaining = bytes - Buffer.byteLength(JSON.stringify(records));
  assert.ok(remaining >= 0);
  for (const record of records) {
    const first = Math.min(remaining, 2999);
    record.sourceRefs[0] = textWithJsonBytes(first + 1);
    remaining -= first;
    while (record.sourceRefs.length < 128 && remaining >= 4) {
      const interior = Math.min(remaining - 3, 3000);
      record.sourceRefs.push(textWithJsonBytes(interior));
      remaining -= interior + 3;
    }
    if (remaining > 0 && remaining < 4) {
      record.sourceRefs[record.sourceRefs.length - 1] += "x".repeat(remaining);
      remaining = 0;
    }
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(records)), bytes);
  return records;
}

function textWithJsonBytes(bytes: number): string {
  return "\u0001".repeat(Math.floor(bytes / 6)) + "x".repeat(bytes % 6);
}
