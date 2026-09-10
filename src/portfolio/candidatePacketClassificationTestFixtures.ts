import type { Market, MarketCandidate, MarketPacket } from "../domain/schemas.js";

/** Synthetic packet only; importing this fixture does not register tests. */
export function classificationPacket(market: Market = "KR", patch: Partial<MarketCandidate> = {}): MarketPacket {
  return { packetId: "synthetic-classification-packet", mode: "paper_only", generatedAt: "2026-09-03T12:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    virtualPortfolio: { portfolioId: "synthetic-portfolio", cashKrw: 1000, positions: [], updatedAt: "2026-09-03T12:00:00.000Z" },
    candidates: [{ market, symbol: "SYNTH", sector: "Synthetic", region: market, strategyBucket: "long_term",
      reasonCodes: [], sourceRefs: ["synthetic-metadata"], collectedAt: "2026-09-03T11:00:00.000Z",
      staleAfter: "2026-09-05T00:00:00.000Z", ...patch }],
    constraints: { maxNewPositions: 1, maxBudgetPerSymbolKrw: 1000, allowedActions: ["VIRTUAL_HOLD"] } };
}
