import {
  marketPacketSchema,
  parseWithSchema,
  type Market,
  type MarketCandidate,
  type MarketPacket,
  type VirtualBudgetTier,
  type VirtualAction,
  type VirtualPortfolio
} from "../domain/schemas.js";

export interface MarketCandidateDraft {
  market: Market;
  symbol: string;
  name?: string;
  sector?: string;
  industry?: string;
  lastPriceKrw?: number;
  ranking?: number;
  score?: number;
  reasonCodes?: string[];
  eventTags?: string[];
  newsRefs?: string[];
  dividendYieldPct?: number;
  exDividendDate?: string;
  cooldownActive?: boolean;
  sourceRefs?: string[];
  collectedAt?: string;
  staleAfter?: string;
}

export interface MarketPacketConstraints {
  maxNewPositions: number;
  maxBudgetPerSymbolKrw: number;
  allowedActions: VirtualAction[];
}

export interface MarketPacketBuilderOptions {
  packetId: string;
  generatedAt: Date;
  expiresInSeconds: number;
  maxCandidates: number;
  constraints: MarketPacketConstraints;
}

export interface MarketPacketBuildInput {
  portfolio: VirtualPortfolio;
  candidates: MarketCandidateDraft[];
}

export interface MarketPacketBuildResult {
  packet: MarketPacket;
  warnings: string[];
}

type CandidateEligibility = Pick<
  MarketCandidate,
  | "buyEligible"
  | "sellEligible"
  | "blockedReasonCodes"
  | "budgetTierAllowed"
  | "positionExists"
  | "cooldownActive"
>;

export class MarketPacketBuilder {
  constructor(private readonly options: MarketPacketBuilderOptions) {}

  build(input: MarketPacketBuildInput): MarketPacketBuildResult {
    const warnings: string[] = [];
    const generatedAt = this.options.generatedAt.toISOString();
    const expiresAt = new Date(
      this.options.generatedAt.getTime() + this.options.expiresInSeconds * 1000
    ).toISOString();

    const candidates = input.candidates
      .flatMap((candidate): MarketCandidate[] => {
        if (!candidate.sourceRefs || candidate.sourceRefs.length === 0) {
          warnings.push(
            `candidate ${candidate.market}:${candidate.symbol} excluded: missing sourceRefs`
          );
          return [];
        }

        return [
          normalizeCandidate(
            candidate,
            {
              collectedAt: candidate.collectedAt ?? generatedAt,
              staleAfter: candidate.staleAfter ?? expiresAt
            },
            deriveCandidateEligibility({
              portfolio: input.portfolio,
              candidate,
              constraints: this.options.constraints
            })
          )
        ];
      })
      .sort(compareCandidates)
      .slice(0, this.options.maxCandidates);

    const packet = parseWithSchema(
      marketPacketSchema,
      {
        packetId: this.options.packetId,
        mode: "paper_only",
        generatedAt,
        expiresAt,
        virtualPortfolio: input.portfolio,
        candidates,
        constraints: this.options.constraints
      },
      "marketPacket"
    );

    return { packet, warnings };
  }
}

export function createMockMarketPacket(input: {
  portfolio: VirtualPortfolio;
  now?: Date;
}): MarketPacketBuildResult {
  const now = input.now ?? new Date();
  return new MarketPacketBuilder({
    packetId: "packet_mock_001",
    generatedAt: now,
    expiresInSeconds: 300,
    maxCandidates: 10,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  }).build({
    portfolio: input.portfolio,
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Sample Corp",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["MOCK_RANKING"],
        sourceRefs: ["mock_source_001"]
      }
    ]
  });
}

function normalizeCandidate(
  candidate: MarketCandidateDraft,
  defaults: Pick<MarketCandidate, "collectedAt" | "staleAfter">,
  eligibility: CandidateEligibility
): MarketCandidate {
  const normalized: MarketCandidate = {
    market: candidate.market,
    symbol: candidate.symbol,
    reasonCodes: candidate.reasonCodes ?? [],
    eventTags: candidate.eventTags ?? [],
    newsRefs: candidate.newsRefs ?? [],
    buyEligible: eligibility.buyEligible,
    sellEligible: eligibility.sellEligible,
    blockedReasonCodes: eligibility.blockedReasonCodes,
    budgetTierAllowed: eligibility.budgetTierAllowed,
    positionExists: eligibility.positionExists,
    cooldownActive: eligibility.cooldownActive,
    sourceRefs: candidate.sourceRefs ?? [],
    collectedAt: defaults.collectedAt,
    staleAfter: defaults.staleAfter
  };

  if (candidate.name !== undefined) {
    normalized.name = candidate.name;
  }
  if (candidate.sector !== undefined) {
    normalized.sector = candidate.sector;
  }
  if (candidate.industry !== undefined) {
    normalized.industry = candidate.industry;
  }
  if (candidate.lastPriceKrw !== undefined) {
    normalized.lastPriceKrw = candidate.lastPriceKrw;
  }
  if (candidate.ranking !== undefined) {
    normalized.ranking = candidate.ranking;
  }
  if (candidate.score !== undefined) {
    normalized.score = candidate.score;
  }
  if (candidate.dividendYieldPct !== undefined) {
    normalized.dividendYieldPct = candidate.dividendYieldPct;
  }
  if (candidate.exDividendDate !== undefined) {
    normalized.exDividendDate = candidate.exDividendDate;
  }

  return normalized;
}

function deriveCandidateEligibility(input: {
  portfolio: VirtualPortfolio;
  candidate: MarketCandidateDraft;
  constraints: MarketPacketConstraints;
}): CandidateEligibility {
  const positionExists = input.portfolio.positions.some(
    (position) =>
      position.market === input.candidate.market &&
      position.symbol === input.candidate.symbol &&
      position.quantity > 0
  );
  const priceAvailable =
    input.candidate.lastPriceKrw !== undefined &&
    input.candidate.lastPriceKrw > 0;
  const cooldownActive = input.candidate.cooldownActive === true;
  const buyBlockedReasonCodes: string[] = [];
  const sellBlockedReasonCodes: string[] = [];

  if (!input.constraints.allowedActions.includes("VIRTUAL_BUY")) {
    buyBlockedReasonCodes.push("BUY_ACTION_NOT_ALLOWED");
  }
  if (!priceAvailable) {
    buyBlockedReasonCodes.push("PRICE_MISSING");
  }
  if (
    !positionExists &&
    input.portfolio.positions.length >= input.constraints.maxNewPositions
  ) {
    buyBlockedReasonCodes.push("MAX_NEW_POSITIONS_REACHED");
  }
  if (
    input.portfolio.cashKrw <= 0 ||
    input.constraints.maxBudgetPerSymbolKrw <= 0
  ) {
    buyBlockedReasonCodes.push("BUY_BUDGET_UNAVAILABLE");
  }
  if (cooldownActive) {
    buyBlockedReasonCodes.push("COOLDOWN_ACTIVE");
  }

  if (!input.constraints.allowedActions.includes("VIRTUAL_SELL")) {
    sellBlockedReasonCodes.push("SELL_ACTION_NOT_ALLOWED");
  }
  if (!positionExists) {
    sellBlockedReasonCodes.push("POSITION_NOT_FOUND");
  }
  if (!priceAvailable) {
    sellBlockedReasonCodes.push("PRICE_MISSING");
  }

  const buyEligible = buyBlockedReasonCodes.length === 0;
  const sellEligible = sellBlockedReasonCodes.length === 0;

  return {
    buyEligible,
    sellEligible,
    blockedReasonCodes: Array.from(
      new Set([...buyBlockedReasonCodes, ...sellBlockedReasonCodes])
    ).sort(),
    budgetTierAllowed: deriveBudgetTier({
      buyEligible,
      cashKrw: input.portfolio.cashKrw,
      maxBudgetPerSymbolKrw: input.constraints.maxBudgetPerSymbolKrw
    }),
    positionExists,
    cooldownActive
  };
}

function deriveBudgetTier(input: {
  buyEligible: boolean;
  cashKrw: number;
  maxBudgetPerSymbolKrw: number;
}): VirtualBudgetTier {
  if (
    !input.buyEligible ||
    input.cashKrw <= 0 ||
    input.maxBudgetPerSymbolKrw <= 0
  ) {
    return "NONE";
  }

  const allowedBudgetKrw = Math.min(
    input.cashKrw,
    input.maxBudgetPerSymbolKrw
  );
  const ratio = allowedBudgetKrw / input.maxBudgetPerSymbolKrw;

  if (ratio < 1 / 3) {
    return "SMALL";
  }

  if (ratio < 2 / 3) {
    return "MEDIUM";
  }

  return "LARGE";
}

function compareCandidates(left: MarketCandidate, right: MarketCandidate): number {
  const leftRanking = left.ranking ?? Number.MAX_SAFE_INTEGER;
  const rightRanking = right.ranking ?? Number.MAX_SAFE_INTEGER;
  if (leftRanking !== rightRanking) {
    return leftRanking - rightRanking;
  }

  return (right.score ?? 0) - (left.score ?? 0);
}
