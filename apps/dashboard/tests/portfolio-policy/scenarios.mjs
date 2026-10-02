export const portfolioScenarios = ["missing", "enabled", "disabled"];
export const missingPolicyWarning =
  "active portfolio policy is unavailable; policy targets are reported as missing";

export function readPortfolioScenario(value) {
  if (!portfolioScenarios.includes(value)) {
    throw new Error("Portfolio scenario must be missing, enabled, or disabled");
  }
  return value;
}

// This is the original default smoke snapshot, including its June as-of.
export function portfolioSnapshot() {
  return {
    portfolioId: "virtual_e2e",
    cashKrw: 850_000,
    positions: [{
      market: "KR", symbol: "005930", assetType: "STOCK", assetClass: "equity",
      strategyBucket: "long_term", quantity: 2, averagePriceKrw: 70_000,
      marketValueKrw: 150_000, updatedAt: "2026-06-27T00:00:00.000Z"
    }],
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
}
