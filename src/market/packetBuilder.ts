import {
  marketPacketSchema,
  parseWithSchema,
  type Market,
  type MarketCandidate,
  type MarketPacket,
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
          normalizeCandidate(candidate, {
            collectedAt: candidate.collectedAt ?? generatedAt,
            staleAfter: candidate.staleAfter ?? expiresAt
          })
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
  defaults: Pick<MarketCandidate, "collectedAt" | "staleAfter">
): MarketCandidate {
  const normalized: MarketCandidate = {
    market: candidate.market,
    symbol: candidate.symbol,
    reasonCodes: candidate.reasonCodes ?? [],
    eventTags: candidate.eventTags ?? [],
    newsRefs: candidate.newsRefs ?? [],
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

function compareCandidates(left: MarketCandidate, right: MarketCandidate): number {
  const leftRanking = left.ranking ?? Number.MAX_SAFE_INTEGER;
  const rightRanking = right.ranking ?? Number.MAX_SAFE_INTEGER;
  if (leftRanking !== rightRanking) {
    return leftRanking - rightRanking;
  }

  return (right.score ?? 0) - (left.score ?? 0);
}
