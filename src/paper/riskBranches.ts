import type {
  AssetRegion,
  MarketCandidate,
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import { normalizeVirtualDecision } from "./decisionNormalizer.js";
import { assessDynamicCashReserve } from "./dynamicCashReservePolicy.js";
import { isSellAllDustClose } from "./dustPosition.js";
import {
  UNKNOWN_EXPOSURE_KEY,
  positionExposureValueKrw
} from "./portfolioExposureAggregator.js";
import {
  minimumCashReserveKrw,
  virtualNetWorthKrw,
  type VirtualRiskPolicy,
  type VirtualRiskRejectCode
} from "./riskPolicy.js";
import {
  UNKNOWN_STRATEGY_BUCKET,
  type StrategyBucketKey
} from "./strategyBucketPolicy.js";

export interface VirtualRiskBranchInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
  policy: VirtualRiskPolicy;
  candidate: MarketCandidate | undefined;
}

export function evaluateVirtualBuyRiskBranch(
  input: VirtualRiskBranchInput
): VirtualRiskRejectCode[] {
  const rejectCodes: VirtualRiskRejectCode[] = [];
  const notionalKrw = normalizeVirtualDecision(input).targetNotionalKrw;
  const remainingCashKrw = input.portfolio.cashKrw - notionalKrw;
  const staticCashReserveKrw = minimumCashReserveKrw(
    input.portfolio,
    input.policy
  );

  if (notionalKrw > input.portfolio.cashKrw) {
    rejectCodes.push("VIRTUAL_CASH_EXCEEDED");
  }

  if (remainingCashKrw < staticCashReserveKrw) {
    rejectCodes.push("VIRTUAL_CASH_RESERVE_BREACHED");
  }

  const dynamicCashReserve = assessDynamicCashReserve({
    portfolio: input.portfolio,
    baseMinimumCashReserveRatio: input.policy.minCashReserveRatio,
    baseMinimumCashReserveKrw: input.policy.minCashReserveKrw,
    policy: input.policy.dynamicCashReservePolicy,
    marketRegime: input.policy.dynamicCashReserveMarketRegime
  });
  if (
    dynamicCashReserve !== null &&
    dynamicCashReserve.minimumCashReserveKrw > staticCashReserveKrw &&
    remainingCashKrw < dynamicCashReserve.minimumCashReserveKrw
  ) {
    rejectCodes.push("VIRTUAL_REGIME_CASH_RESERVE_BREACHED");
  }

  if (notionalKrw > input.policy.maxBudgetPerDecisionKrw) {
    rejectCodes.push("VIRTUAL_BUDGET_EXCEEDED");
  }

  const netWorthKrw = virtualNetWorthKrw(input.portfolio);
  if (
    input.policy.targetExposureRatio !== undefined &&
    netWorthKrw > 0 &&
    (portfolioExposureKrw(input.portfolio) + notionalKrw) / netWorthKrw >
      input.policy.targetExposureRatio
  ) {
    rejectCodes.push("VIRTUAL_TARGET_EXPOSURE_EXCEEDED");
  }

  const currentExposure = currentSymbolExposureKrw(
    input.portfolio,
    input.decision
  );
  if (currentExposure + notionalKrw > input.policy.maxSymbolExposureKrw) {
    rejectCodes.push("VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED");
  }

  if (
    netWorthKrw > 0 &&
    (currentExposure + notionalKrw) / netWorthKrw >
      input.policy.maxPositionWeightRatio
  ) {
    rejectCodes.push("VIRTUAL_POSITION_WEIGHT_EXCEEDED");
  }

  rejectCodes.push(
    ...evaluatePortfolioExposureRisk({ ...input, notionalKrw, netWorthKrw })
  );

  return rejectCodes;
}

export function evaluateVirtualSellRiskBranch(
  input: VirtualRiskBranchInput
): VirtualRiskRejectCode[] {
  const rejectCodes: VirtualRiskRejectCode[] = [];
  const position = input.portfolio.positions.find(
    (item) =>
      item.market === input.decision.market &&
      item.symbol === input.decision.symbol
  );
  const notionalKrw = normalizeVirtualDecision(input).targetNotionalKrw;

  if (position === undefined) {
    rejectCodes.push("VIRTUAL_POSITION_NOT_FOUND");
    return rejectCodes;
  }

  if (
    notionalKrw <= 0 &&
    !isSellAllDustClose({
      decision: input.decision,
      position,
      priceKrw: input.candidate?.lastPriceKrw
    })
  ) {
    rejectCodes.push("VIRTUAL_SELL_AMOUNT_REQUIRED");
    return rejectCodes;
  }

  if (input.candidate?.lastPriceKrw) {
    const positionValue = Math.round(
      position.quantity * input.candidate.lastPriceKrw
    );
    if (notionalKrw > positionValue) {
      rejectCodes.push("VIRTUAL_SELL_AMOUNT_EXCEEDED");
    }
  }

  return rejectCodes;
}

function currentSymbolExposureKrw(
  portfolio: VirtualPortfolio,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): number {
  const position = portfolio.positions.find(
    (item) => item.market === decision.market && item.symbol === decision.symbol
  );
  if (position === undefined) {
    return 0;
  }

  return (
    position.marketValueKrw ??
    Math.round(position.quantity * position.averagePriceKrw)
  );
}

function portfolioExposureKrw(portfolio: VirtualPortfolio): number {
  return portfolio.positions.reduce(
    (sum, position) =>
      sum +
      (position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)),
    0
  );
}

interface PortfolioExposureRiskInput extends VirtualRiskBranchInput {
  notionalKrw: number;
  netWorthKrw: number;
}

interface ExposureMetadata {
  sector: string;
  country: AssetRegion | typeof UNKNOWN_EXPOSURE_KEY;
  strategyBucket: StrategyBucketKey;
  currencyExposed: boolean;
  currencyMetadataMissing: boolean;
  metadataMissing: boolean;
}

interface ExposureProfile {
  bySector: Map<string, number>;
  byCountry: Map<AssetRegion | typeof UNKNOWN_EXPOSURE_KEY, number>;
  byStrategyBucket: Map<StrategyBucketKey, number>;
  currencyExposureKrw: number;
  unknownCurrencyExposureKrw: number;
  unknownMetadataExposureKrw: number;
}

function evaluatePortfolioExposureRisk(
  input: PortfolioExposureRiskInput
): VirtualRiskRejectCode[] {
  if (input.notionalKrw <= 0) {
    return [];
  }

  const rejectCodes: VirtualRiskRejectCode[] = [];
  const profile = buildExposureProfile(input);
  const decisionMetadata = resolveDecisionExposureMetadata(input);

  incrementMap(profile.bySector, decisionMetadata.sector, input.notionalKrw);
  incrementMap(profile.byCountry, decisionMetadata.country, input.notionalKrw);
  incrementMap(
    profile.byStrategyBucket,
    decisionMetadata.strategyBucket,
    input.notionalKrw
  );

  if (decisionMetadata.currencyExposed) {
    profile.currencyExposureKrw += input.notionalKrw;
  }
  if (decisionMetadata.currencyMetadataMissing) {
    profile.unknownCurrencyExposureKrw += input.notionalKrw;
  }
  if (decisionMetadata.metadataMissing) {
    profile.unknownMetadataExposureKrw += input.notionalKrw;
  }

  if (
    hasSectorExposureLimit(input.policy) &&
    (profile.bySector.get(UNKNOWN_EXPOSURE_KEY) ?? 0) > 0
  ) {
    appendPortfolioRejectCode(
      rejectCodes,
      "VIRTUAL_EXPOSURE_METADATA_MISSING"
    );
  }

  if (
    hasCountryExposureLimit(input.policy) &&
    (profile.byCountry.get(UNKNOWN_EXPOSURE_KEY) ?? 0) > 0
  ) {
    appendPortfolioRejectCode(
      rejectCodes,
      "VIRTUAL_EXPOSURE_METADATA_MISSING"
    );
  }

  if (
    hasStrategyBucketLimit(input.policy) &&
    (profile.byStrategyBucket.get(UNKNOWN_STRATEGY_BUCKET) ?? 0) > 0
  ) {
    appendPortfolioRejectCode(
      rejectCodes,
      "VIRTUAL_EXPOSURE_METADATA_MISSING"
    );
  }

  if (
    hasCurrencyExposureLimit(input.policy) &&
    profile.unknownCurrencyExposureKrw > 0
  ) {
    appendPortfolioRejectCode(
      rejectCodes,
      "VIRTUAL_EXPOSURE_METADATA_MISSING"
    );
  }

  const strategyBucketExposure = profile.byStrategyBucket.get(
    decisionMetadata.strategyBucket
  ) ?? 0;
  if (
    exceedsMappedLimit({
      value: strategyBucketExposure,
      key: decisionMetadata.strategyBucket,
      krwLimits: input.policy.maxStrategyBucketExposureKrw,
      ratioLimits: input.policy.maxStrategyBucketExposureRatio,
      netWorthKrw: input.netWorthKrw
    })
  ) {
    appendPortfolioRejectCode(rejectCodes, "VIRTUAL_BUCKET_BUDGET_EXCEEDED");
  }

  if (
    exceedsMappedLimit({
      value: input.notionalKrw,
      key: decisionMetadata.strategyBucket,
      krwLimits: input.policy.maxBucketTurnoverKrw,
      ratioLimits: input.policy.maxBucketTurnoverRatio,
      netWorthKrw: input.netWorthKrw
    })
  ) {
    appendPortfolioRejectCode(rejectCodes, "VIRTUAL_BUCKET_TURNOVER_EXCEEDED");
  }

  if (
    exceedsLimit({
      value: profile.bySector.get(decisionMetadata.sector) ?? 0,
      krwLimit: input.policy.maxSectorExposureKrw,
      ratioLimit: input.policy.maxSectorExposureRatio,
      netWorthKrw: input.netWorthKrw
    })
  ) {
    appendPortfolioRejectCode(rejectCodes, "VIRTUAL_SECTOR_EXPOSURE_EXCEEDED");
  }

  if (
    exceedsLimit({
      value: profile.byCountry.get(decisionMetadata.country) ?? 0,
      krwLimit: input.policy.maxCountryExposureKrw,
      ratioLimit: input.policy.maxCountryExposureRatio,
      netWorthKrw: input.netWorthKrw
    })
  ) {
    appendPortfolioRejectCode(rejectCodes, "VIRTUAL_COUNTRY_EXPOSURE_EXCEEDED");
  }

  if (
    exceedsLimit({
      value: profile.currencyExposureKrw,
      krwLimit: input.policy.maxCurrencyExposureKrw,
      ratioLimit: input.policy.maxCurrencyExposureRatio,
      netWorthKrw: input.netWorthKrw
    })
  ) {
    appendPortfolioRejectCode(rejectCodes, "VIRTUAL_CURRENCY_EXPOSURE_EXCEEDED");
  }

  if (
    exceedsLimit({
      value: profile.unknownMetadataExposureKrw,
      krwLimit: input.policy.maxUnknownMetadataExposureKrw,
      ratioLimit: input.policy.maxUnknownMetadataExposureRatio,
      netWorthKrw: input.netWorthKrw
    })
  ) {
    appendPortfolioRejectCode(
      rejectCodes,
      "VIRTUAL_EXPOSURE_METADATA_MISSING"
    );
  }

  return rejectCodes;
}

function buildExposureProfile(input: VirtualRiskBranchInput): ExposureProfile {
  const profile: ExposureProfile = {
    bySector: new Map<string, number>(),
    byCountry: new Map<AssetRegion | typeof UNKNOWN_EXPOSURE_KEY, number>(),
    byStrategyBucket: new Map<StrategyBucketKey, number>(),
    currencyExposureKrw: 0,
    unknownCurrencyExposureKrw: 0,
    unknownMetadataExposureKrw: 0
  };

  for (const position of input.portfolio.positions) {
    const exposureKrw = Math.abs(positionExposureValueKrw(position));
    const metadata = resolvePositionExposureMetadata(input.packet, position);

    incrementMap(profile.bySector, metadata.sector, exposureKrw);
    incrementMap(profile.byCountry, metadata.country, exposureKrw);
    incrementMap(profile.byStrategyBucket, metadata.strategyBucket, exposureKrw);
    if (metadata.currencyExposed) {
      profile.currencyExposureKrw += exposureKrw;
    }
    if (metadata.currencyMetadataMissing) {
      profile.unknownCurrencyExposureKrw += exposureKrw;
    }
    if (metadata.metadataMissing) {
      profile.unknownMetadataExposureKrw += exposureKrw;
    }
  }

  return profile;
}

function resolveDecisionExposureMetadata(
  input: VirtualRiskBranchInput
): ExposureMetadata {
  const existingPosition = input.portfolio.positions.find(
    (position) =>
      position.market === input.decision.market &&
      position.symbol === input.decision.symbol
  );

  return resolveExposureMetadata({
    candidate: input.candidate,
    position: existingPosition
  });
}

function resolvePositionExposureMetadata(
  packet: MarketPacket,
  position: VirtualPortfolio["positions"][number]
): ExposureMetadata {
  return resolveExposureMetadata({
    position,
    candidate: packet.candidates.find(
      (candidate) =>
        candidate.market === position.market && candidate.symbol === position.symbol
    )
  });
}

function resolveExposureMetadata(input: {
  candidate: MarketCandidate | undefined;
  position?: VirtualPortfolio["positions"][number] | undefined;
}): ExposureMetadata {
  const sector = normalizeExposureKey(
    input.position?.sector ?? input.candidate?.sector
  );
  const country =
    input.position?.region ?? input.candidate?.region ?? UNKNOWN_EXPOSURE_KEY;
  const strategyBucket =
    input.position?.strategyBucket ??
    input.candidate?.strategyBucket ??
    UNKNOWN_STRATEGY_BUCKET;
  const assetType = input.position?.assetType ?? input.candidate?.assetType;
  const assetClass = input.position?.assetClass ?? input.candidate?.assetClass;
  const riskTags = input.position?.riskTags ?? input.candidate?.riskTags;
  const currencyMetadataKnown =
    country !== UNKNOWN_EXPOSURE_KEY ||
    assetClass === "currency" ||
    riskTags?.includes("currency_exposed") === true;
  const currencyExposed =
    assetClass === "currency" ||
    riskTags?.includes("currency_exposed") === true ||
    country === "US" ||
    country === "GLOBAL";

  return {
    sector,
    country,
    strategyBucket,
    currencyExposed,
    currencyMetadataMissing: !currencyMetadataKnown,
    metadataMissing:
      assetType === undefined ||
      assetClass === undefined ||
      (input.position?.strategyBucket === undefined &&
        input.candidate?.strategyBucket === undefined) ||
      sector === UNKNOWN_EXPOSURE_KEY ||
      country === UNKNOWN_EXPOSURE_KEY ||
      !currencyMetadataKnown
  };
}

function normalizeExposureKey(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : UNKNOWN_EXPOSURE_KEY;
}

function incrementMap<Key>(map: Map<Key, number>, key: Key, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function exceedsMappedLimit(input: {
  value: number;
  key: string;
  krwLimits?: Record<string, number> | undefined;
  ratioLimits?: Record<string, number> | undefined;
  netWorthKrw: number;
}): boolean {
  return exceedsLimit({
    value: input.value,
    krwLimit: input.krwLimits?.[input.key],
    ratioLimit: input.ratioLimits?.[input.key],
    netWorthKrw: input.netWorthKrw
  });
}

function exceedsLimit(input: {
  value: number;
  krwLimit?: number | undefined;
  ratioLimit?: number | undefined;
  netWorthKrw: number;
}): boolean {
  if (
    input.krwLimit !== undefined &&
    Number.isFinite(input.krwLimit) &&
    input.value > input.krwLimit
  ) {
    return true;
  }

  return (
    input.ratioLimit !== undefined &&
    Number.isFinite(input.ratioLimit) &&
    input.netWorthKrw > 0 &&
    input.value / input.netWorthKrw > input.ratioLimit
  );
}

function hasSectorExposureLimit(policy: VirtualRiskPolicy): boolean {
  return (
    policy.maxSectorExposureKrw !== undefined ||
    policy.maxSectorExposureRatio !== undefined
  );
}

function hasCountryExposureLimit(policy: VirtualRiskPolicy): boolean {
  return (
    policy.maxCountryExposureKrw !== undefined ||
    policy.maxCountryExposureRatio !== undefined
  );
}

function hasCurrencyExposureLimit(policy: VirtualRiskPolicy): boolean {
  return (
    policy.maxCurrencyExposureKrw !== undefined ||
    policy.maxCurrencyExposureRatio !== undefined
  );
}

function hasStrategyBucketLimit(policy: VirtualRiskPolicy): boolean {
  return (
    policy.maxStrategyBucketExposureKrw !== undefined ||
    policy.maxStrategyBucketExposureRatio !== undefined ||
    policy.maxBucketTurnoverKrw !== undefined ||
    policy.maxBucketTurnoverRatio !== undefined
  );
}

function appendPortfolioRejectCode(
  target: VirtualRiskRejectCode[],
  code: VirtualRiskRejectCode
): void {
  if (!target.includes(code)) {
    target.push(code);
  }
}
