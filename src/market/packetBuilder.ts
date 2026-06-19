import {
  marketPacketSchema,
  parseWithSchema,
  type Market,
  type MarketCandidate,
  type MarketCandidateFeatureScore,
  type MarketPacket,
  type VirtualBudgetTier,
  type VirtualAction,
  type AssetClass,
  type AssetRegion,
  type AssetRiskTag,
  type AssetType,
  type PortfolioAllocation,
  type VirtualPortfolio
} from "../domain/schemas.js";
import { buildCandidateDataRefs } from "./candidateDataRefs.js";
import {
  buildPaperAllocationSnapshot,
  type PaperAllocationPolicy
} from "../paper/allocationPolicy.js";

export interface MarketCandidateDraft {
  market: Market;
  symbol: string;
  name?: string;
  assetType?: AssetType;
  assetClass?: AssetClass;
  region?: AssetRegion;
  riskTags?: AssetRiskTag[];
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
  allocationPolicy?: PaperAllocationPolicy;
}

export interface MarketPacketBuildInput {
  portfolio: VirtualPortfolio;
  candidates: MarketCandidateDraft[];
}

export interface MarketPacketBuildResult {
  packet: MarketPacket;
  warnings: string[];
}

interface CandidateEligibility {
  buyEligible: boolean;
  sellEligible: boolean;
  blockedReasonCodes: string[];
  budgetTierAllowed: VirtualBudgetTier;
  positionExists: boolean;
  cooldownActive: boolean;
}

const maxPacketCandidateCount = 20;

export class MarketPacketBuilder {
  constructor(private readonly options: MarketPacketBuilderOptions) {}

  build(input: MarketPacketBuildInput): MarketPacketBuildResult {
    const warnings: string[] = [];
    const generatedAt = this.options.generatedAt.toISOString();
    const expiresAt = new Date(
      this.options.generatedAt.getTime() + this.options.expiresInSeconds * 1000
    ).toISOString();
    const portfolioAllocation =
      this.options.allocationPolicy === undefined
        ? undefined
        : buildPaperAllocationSnapshot({
            portfolio: input.portfolio,
            policy: this.options.allocationPolicy
          });

    const normalizedCandidates = input.candidates
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
              constraints: this.options.constraints,
              portfolioAllocation
            }),
            {
              maxCandidates: this.options.maxCandidates
            }
          )
        ];
      })
      .sort(compareCandidates);
    const candidates = selectPacketCandidates({
      candidates: normalizedCandidates,
      portfolio: input.portfolio,
      maxCandidates: this.options.maxCandidates
    });

    const packet = parseWithSchema(
      marketPacketSchema,
      {
        packetId: this.options.packetId,
        mode: "paper_only",
        generatedAt,
        expiresAt,
        virtualPortfolio: input.portfolio,
        candidates,
        constraints: this.options.constraints,
        ...(portfolioAllocation === undefined ? {} : { portfolioAllocation })
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
  eligibility: CandidateEligibility,
  scoring: Pick<MarketPacketBuilderOptions, "maxCandidates">
): MarketCandidate {
  const featureRefs = buildCandidateFeatureRefs(candidate);
  const dataRefs = buildCandidateDataRefs(candidate);
  const normalized: MarketCandidate = {
    market: candidate.market,
    symbol: candidate.symbol,
    reasonCodes: candidate.reasonCodes ?? [],
    eventTags: candidate.eventTags ?? [],
    newsRefs: candidate.newsRefs ?? [],
    featureRefs,
    featureScores: buildCandidateFeatureScores({
      candidate,
      eligibility,
      featureRefs,
      maxCandidates: scoring.maxCandidates
    }),
    buyEligible: eligibility.buyEligible,
    sellEligible: eligibility.sellEligible,
    blockedReasonCodes: eligibility.blockedReasonCodes,
    budgetTierAllowed: eligibility.budgetTierAllowed,
    positionExists: eligibility.positionExists,
    cooldownActive: eligibility.cooldownActive,
    dataRefs,
    sourceRefs: candidate.sourceRefs ?? [],
    collectedAt: defaults.collectedAt,
    staleAfter: defaults.staleAfter
  };

  if (candidate.name !== undefined) {
    normalized.name = candidate.name;
  }
  if (candidate.assetType !== undefined) {
    normalized.assetType = candidate.assetType;
  }
  if (candidate.assetClass !== undefined) {
    normalized.assetClass = candidate.assetClass;
  }
  if (candidate.region !== undefined) {
    normalized.region = candidate.region;
  }
  if (candidate.riskTags !== undefined) {
    normalized.riskTags = candidate.riskTags;
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

function buildCandidateFeatureRefs(candidate: MarketCandidateDraft): string[] {
  const prefix = `candidate.${candidate.market}.${candidate.symbol}`;
  const refs: string[] = [];

  if (candidate.lastPriceKrw !== undefined) {
    refs.push(`${prefix}.lastPriceKrw`);
  }
  if (candidate.assetType !== undefined) {
    refs.push(`${prefix}.assetType`);
  }
  if (candidate.assetClass !== undefined) {
    refs.push(`${prefix}.assetClass`);
  }
  if (candidate.region !== undefined) {
    refs.push(`${prefix}.region`);
  }
  if (candidate.riskTags && candidate.riskTags.length > 0) {
    refs.push(`${prefix}.riskTags`);
  }
  if (candidate.ranking !== undefined) {
    refs.push(`${prefix}.ranking`);
  }
  if (candidate.score !== undefined) {
    refs.push(`${prefix}.score`);
  }
  if (candidate.reasonCodes && candidate.reasonCodes.length > 0) {
    refs.push(`${prefix}.reasonCodes`);
  }
  if (candidate.eventTags && candidate.eventTags.length > 0) {
    refs.push(`${prefix}.eventTags`);
  }
  if (candidate.dividendYieldPct !== undefined) {
    refs.push(`${prefix}.dividendYieldPct`);
  }
  if (candidate.exDividendDate !== undefined) {
    refs.push(`${prefix}.exDividendDate`);
  }

  refs.push(`${prefix}.collectedAt`);
  refs.push(`${prefix}.staleAfter`);
  refs.push(`${prefix}.buyEligible`);
  refs.push(`${prefix}.sellEligible`);
  refs.push(`${prefix}.blockedReasonCodes`);
  refs.push(`${prefix}.budgetTierAllowed`);
  refs.push(`${prefix}.positionExists`);
  refs.push(`${prefix}.cooldownActive`);

  return Array.from(new Set(refs)).sort();
}

function buildCandidateFeatureScores(input: {
  candidate: MarketCandidateDraft;
  eligibility: CandidateEligibility;
  featureRefs: string[];
  maxCandidates: number;
}): MarketCandidateFeatureScore[] {
  const prefix = `candidate.${input.candidate.market}.${input.candidate.symbol}`;
  const scores: MarketCandidateFeatureScore[] = [];

  const addScore = (
    featureName: string,
    score: number,
    scoreType: MarketCandidateFeatureScore["scoreType"],
    reasonCode: string
  ) => {
    const featureRef = `${prefix}.${featureName}`;
    if (!input.featureRefs.includes(featureRef)) {
      return;
    }
    scores.push({
      featureRef,
      score: clampScore(score),
      scoreType,
      reasonCode
    });
  };

  if (input.candidate.lastPriceKrw !== undefined) {
    addScore("lastPriceKrw", 100, "AVAILABILITY", "PRICE_AVAILABLE");
  }
  if (input.candidate.ranking !== undefined) {
    addScore(
      "ranking",
      rankFeatureScore(input.candidate.ranking, input.maxCandidates),
      "RANKING",
      "RANKING_WITHIN_PACKET"
    );
  }
  if (input.candidate.score !== undefined) {
    addScore("score", input.candidate.score, "VALUE", "CANDIDATE_SCORE");
  }
  if (input.candidate.reasonCodes && input.candidate.reasonCodes.length > 0) {
    addScore(
      "reasonCodes",
      50 + Math.min(input.candidate.reasonCodes.length, 5) * 10,
      "VALUE",
      "REASON_CODE_COUNT"
    );
  }
  if (input.candidate.eventTags && input.candidate.eventTags.length > 0) {
    addScore(
      "eventTags",
      50 + Math.min(input.candidate.eventTags.length, 5) * 10,
      "VALUE",
      "EVENT_TAG_COUNT"
    );
  }
  if (input.candidate.dividendYieldPct !== undefined) {
    addScore(
      "dividendYieldPct",
      100,
      "AVAILABILITY",
      "DIVIDEND_FIELD_AVAILABLE"
    );
  }
  if (input.candidate.exDividendDate !== undefined) {
    addScore(
      "exDividendDate",
      100,
      "AVAILABILITY",
      "EX_DIVIDEND_DATE_AVAILABLE"
    );
  }

  addScore(
    "buyEligible",
    input.eligibility.buyEligible ? 100 : 0,
    "POLICY",
    input.eligibility.buyEligible ? "BUY_ELIGIBLE" : "BUY_BLOCKED"
  );
  addScore(
    "sellEligible",
    input.eligibility.sellEligible ? 100 : 0,
    "POLICY",
    input.eligibility.sellEligible ? "SELL_ELIGIBLE" : "SELL_BLOCKED"
  );
  addScore(
    "blockedReasonCodes",
    input.eligibility.blockedReasonCodes.length === 0 ? 100 : 0,
    "POLICY",
    input.eligibility.blockedReasonCodes.length === 0
      ? "NO_BLOCKED_REASONS"
      : "BLOCKED_REASONS_PRESENT"
  );
  addScore(
    "budgetTierAllowed",
    budgetTierFeatureScore(input.eligibility.budgetTierAllowed),
    "POLICY",
    `BUDGET_TIER_${input.eligibility.budgetTierAllowed}`
  );
  addScore(
    "positionExists",
    input.eligibility.positionExists ? 100 : 0,
    "STATE",
    input.eligibility.positionExists ? "POSITION_EXISTS" : "POSITION_ABSENT"
  );
  addScore(
    "cooldownActive",
    input.eligibility.cooldownActive ? 0 : 100,
    "POLICY",
    input.eligibility.cooldownActive ? "COOLDOWN_ACTIVE" : "COOLDOWN_CLEAR"
  );

  return scores.sort((left, right) =>
    left.featureRef.localeCompare(right.featureRef)
  );
}

function rankFeatureScore(ranking: number, maxCandidates: number): number {
  if (maxCandidates <= 1) {
    return 100;
  }

  const boundedRank = Math.max(1, Math.min(ranking, maxCandidates));
  return ((maxCandidates - boundedRank) / (maxCandidates - 1)) * 100;
}

function budgetTierFeatureScore(tier: VirtualBudgetTier): number {
  switch (tier) {
    case "LARGE":
      return 100;
    case "MEDIUM":
      return 66;
    case "SMALL":
      return 33;
    case "NONE":
      return 0;
  }
}

function deriveCandidateEligibility(input: {
  portfolio: VirtualPortfolio;
  candidate: MarketCandidateDraft;
  constraints: MarketPacketConstraints;
  portfolioAllocation?: PortfolioAllocation | undefined;
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
  const marketAllocation =
    input.portfolioAllocation?.marketAllocations?.[input.candidate.market];
  const maxOpenPositionCount =
    input.portfolioAllocation?.scheduledOpenPositionCeiling ??
    input.constraints.maxNewPositions;
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
    input.portfolio.positions.length >= maxOpenPositionCount
  ) {
    buyBlockedReasonCodes.push("MAX_NEW_POSITIONS_REACHED");
  }
  if (
    !positionExists &&
    input.portfolioAllocation?.remainingNewPositionSlots !== undefined &&
    input.portfolioAllocation.remainingNewPositionSlots <= 0
  ) {
    buyBlockedReasonCodes.push("MAX_NEW_POSITIONS_REACHED");
  }
  if (
    !positionExists &&
    marketAllocation?.remainingScheduledOpenPositionSlots !== undefined &&
    marketAllocation.remainingScheduledOpenPositionSlots <= 0
  ) {
    buyBlockedReasonCodes.push("MARKET_POSITION_SLOTS_REACHED");
  }
  if (
    input.portfolio.cashKrw <= 0 ||
    input.constraints.maxBudgetPerSymbolKrw <= 0
  ) {
    buyBlockedReasonCodes.push("BUY_BUDGET_UNAVAILABLE");
  }
  if (
    input.portfolioAllocation !== undefined &&
    input.portfolioAllocation.maxAdditionalBuyBudgetKrw <= 0
  ) {
    buyBlockedReasonCodes.push("TARGET_EXPOSURE_REACHED");
  }
  if (
    marketAllocation !== undefined &&
    marketAllocation.maxAdditionalBuyBudgetKrw <= 0
  ) {
    buyBlockedReasonCodes.push("MARKET_TARGET_EXPOSURE_REACHED");
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
      maxBudgetPerSymbolKrw: input.constraints.maxBudgetPerSymbolKrw,
      maxAdditionalBuyBudgetKrw:
        input.portfolioAllocation?.maxAdditionalBuyBudgetKrw,
      maxMarketAdditionalBuyBudgetKrw:
        marketAllocation?.maxAdditionalBuyBudgetKrw
    }),
    positionExists,
    cooldownActive
  };
}

function deriveBudgetTier(input: {
  buyEligible: boolean;
  cashKrw: number;
  maxBudgetPerSymbolKrw: number;
  maxAdditionalBuyBudgetKrw?: number | undefined;
  maxMarketAdditionalBuyBudgetKrw?: number | undefined;
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
    input.maxBudgetPerSymbolKrw,
    input.maxAdditionalBuyBudgetKrw ?? input.maxBudgetPerSymbolKrw,
    input.maxMarketAdditionalBuyBudgetKrw ?? input.maxBudgetPerSymbolKrw
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

function selectPacketCandidates(input: {
  candidates: MarketCandidate[];
  portfolio: VirtualPortfolio;
  maxCandidates: number;
}): MarketCandidate[] {
  const positionKeys = new Set(
    input.portfolio.positions
      .filter((position) => position.quantity > 0)
      .map((position) => `${position.market}:${position.symbol}`)
  );
  const selected = input.candidates.slice(0, input.maxCandidates);
  const selectedKeys = new Set(selected.map(candidateKey));

  for (const candidate of input.candidates) {
    const key = candidateKey(candidate);
    if (!positionKeys.has(key) || selectedKeys.has(key)) {
      continue;
    }
    selected.push(candidate);
    selectedKeys.add(key);
  }

  if (selected.length <= maxPacketCandidateCount) {
    return selected;
  }

  let overflow = selected.length - maxPacketCandidateCount;
  for (let index = selected.length - 1; index >= 0 && overflow > 0; index -= 1) {
    if (positionKeys.has(candidateKey(selected[index]!))) {
      continue;
    }
    selected.splice(index, 1);
    overflow -= 1;
  }

  return selected.slice(0, maxPacketCandidateCount);
}

function candidateKey(candidate: Pick<MarketCandidate, "market" | "symbol">): string {
  return `${candidate.market}:${candidate.symbol}`;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
