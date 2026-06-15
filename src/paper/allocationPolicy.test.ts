import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualPortfolio } from "../domain/schemas.js";
import { buildPaperAllocationSnapshot } from "./allocationPolicy.js";

test("paper allocation snapshot calculates target exposure budget from net worth", () => {
  const snapshot = buildPaperAllocationSnapshot({
    portfolio: portfolio({ cashKrw: 10_000_000 }),
    policy: {
      policyName: "aggressive_paper_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3
    }
  });

  assert.equal(snapshot.currentExposureRatio, 0);
  assert.equal(snapshot.currentCashRatio, 1);
  assert.equal(snapshot.targetCashRatio, 0.15);
  assert.equal(snapshot.targetExposureGapKrw, 8_500_000);
  assert.equal(snapshot.maxAdditionalBuyBudgetKrw, 8_500_000);
  assert.equal(snapshot.maxBudgetPerDecisionKrw, 2_000_000);
  assert.equal(snapshot.maxSymbolExposureKrw, 3_000_000);
  assert.equal(snapshot.minCashReserveKrw, 500_000);
});

test("paper allocation snapshot caps additional buys at target exposure gap", () => {
  const snapshot = buildPaperAllocationSnapshot({
    portfolio: portfolio({
      cashKrw: 7_000_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 30,
          averagePriceKrw: 100_000,
          marketValueKrw: 3_000_000,
          updatedAt: "2026-06-14T09:00:00+09:00"
        }
      ]
    }),
    policy: {
      policyName: "aggressive_paper_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3
    }
  });

  assert.equal(snapshot.currentExposureRatio, 0.3);
  assert.equal(snapshot.targetExposureGapRatio, 0.55);
  assert.equal(snapshot.targetExposureGapKrw, 5_500_000);
  assert.equal(snapshot.maxAdditionalBuyBudgetKrw, 5_500_000);
});

test("paper allocation snapshot calculates market target exposure budgets", () => {
  const snapshot = buildPaperAllocationSnapshot({
    portfolio: portfolio({
      cashKrw: 7_000_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 30,
          averagePriceKrw: 100_000,
          marketValueKrw: 3_000_000,
          updatedAt: "2026-06-14T09:00:00+09:00"
        }
      ]
    }),
    policy: {
      policyName: "market_aware_paper_allocation",
      targetExposureRatio: 0.85,
      minCashReserveRatio: 0.05,
      maxBudgetPerDecisionRatio: 0.2,
      maxSymbolExposureRatio: 0.3,
      marketTargetExposureRatios: {
        KR: 0.2,
        US: 0.6
      }
    }
  });

  assert.deepEqual(snapshot.marketTargetExposureRatios, {
    KR: 0.2,
    US: 0.6
  });
  assert.equal(snapshot.marketAllocations?.KR?.currentExposureRatio, 0.3);
  assert.equal(snapshot.marketAllocations?.KR?.targetExposureGapKrw, 0);
  assert.equal(snapshot.marketAllocations?.KR?.maxAdditionalBuyBudgetKrw, 0);
  assert.equal(snapshot.marketAllocations?.US?.currentExposureRatio, 0);
  assert.equal(snapshot.marketAllocations?.US?.targetExposureGapKrw, 6_000_000);
  assert.equal(
    snapshot.marketAllocations?.US?.maxAdditionalBuyBudgetKrw,
    6_000_000
  );
});

function portfolio(overrides: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-14T09:00:00+09:00",
    ...overrides
  };
}
