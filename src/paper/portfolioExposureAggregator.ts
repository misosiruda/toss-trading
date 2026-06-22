import {
  assetClassSchema,
  assetTypeSchema,
  marketSchema,
  type AssetClass,
  type AssetType,
  type Market,
  type VirtualPortfolio,
  type VirtualPosition
} from "../domain/schemas.js";
import {
  STRATEGY_BUCKETS,
  UNKNOWN_STRATEGY_BUCKET,
  type StrategyBucketKey
} from "./strategyBucketPolicy.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export const UNKNOWN_EXPOSURE_KEY = "UNKNOWN";

export type AssetTypeExposureKey = AssetType | typeof UNKNOWN_EXPOSURE_KEY;
export type AssetClassExposureKey = AssetClass | typeof UNKNOWN_EXPOSURE_KEY;

export interface PortfolioSymbolExposure {
  key: string;
  market: Market;
  symbol: string;
  grossExposureKrw: number;
  netExposureKrw: number;
  exposureRatio: number;
  positionCount: number;
  strategyBuckets: StrategyBucketKey[];
  assetTypes: AssetTypeExposureKey[];
  assetClasses: AssetClassExposureKey[];
}

export interface PortfolioExposureAggregate {
  mode: "paper_only";
  virtualNetWorthKrw: number;
  positionMarketValueKrw: number;
  totalGrossExposureKrw: number;
  totalNetExposureKrw: number;
  totalGrossExposureRatio: number;
  totalNetExposureRatio: number;
  positionCount: number;
  exposureByMarketKrw: Record<Market, number>;
  exposureByMarketRatio: Record<Market, number>;
  exposureByAssetTypeKrw: Record<AssetTypeExposureKey, number>;
  exposureByAssetTypeRatio: Record<AssetTypeExposureKey, number>;
  exposureByAssetClassKrw: Record<AssetClassExposureKey, number>;
  exposureByAssetClassRatio: Record<AssetClassExposureKey, number>;
  exposureByStrategyBucketKrw: Record<StrategyBucketKey, number>;
  exposureByStrategyBucketRatio: Record<StrategyBucketKey, number>;
  symbolExposures: PortfolioSymbolExposure[];
  unknownMetadataExposureKrw: number;
  unknownMetadataExposureRatio: number;
}

interface MutableSymbolExposure {
  key: string;
  market: Market;
  symbol: string;
  grossExposureKrw: number;
  netExposureKrw: number;
  positionCount: number;
  strategyBuckets: Set<StrategyBucketKey>;
  assetTypes: Set<AssetTypeExposureKey>;
  assetClasses: Set<AssetClassExposureKey>;
}

export function buildPortfolioExposureAggregate(
  portfolio: VirtualPortfolio
): PortfolioExposureAggregate {
  const virtualNetWorth = virtualNetWorthKrw(portfolio);
  const exposureByMarketKrw = zeroRecord(marketSchema.options);
  const exposureByAssetTypeKrw = zeroRecord([
    ...assetTypeSchema.options,
    UNKNOWN_EXPOSURE_KEY
  ]);
  const exposureByAssetClassKrw = zeroRecord([
    ...assetClassSchema.options,
    UNKNOWN_EXPOSURE_KEY
  ]);
  const exposureByStrategyBucketKrw = zeroRecord([
    ...STRATEGY_BUCKETS,
    UNKNOWN_STRATEGY_BUCKET
  ]);
  const symbolExposures = new Map<string, MutableSymbolExposure>();

  let totalGrossExposureKrw = 0;
  let totalNetExposureKrw = 0;
  let unknownMetadataExposureKrw = 0;

  for (const position of portfolio.positions) {
    const exposureKrw = positionExposureValueKrw(position);
    const grossExposureKrw = Math.abs(exposureKrw);
    const assetType = position.assetType ?? UNKNOWN_EXPOSURE_KEY;
    const assetClass = position.assetClass ?? UNKNOWN_EXPOSURE_KEY;
    const strategyBucket =
      position.strategyBucket ?? UNKNOWN_STRATEGY_BUCKET;

    totalGrossExposureKrw += grossExposureKrw;
    totalNetExposureKrw += exposureKrw;
    exposureByMarketKrw[position.market] += grossExposureKrw;
    exposureByAssetTypeKrw[assetType] += grossExposureKrw;
    exposureByAssetClassKrw[assetClass] += grossExposureKrw;
    exposureByStrategyBucketKrw[strategyBucket] += grossExposureKrw;

    if (
      position.assetType === undefined ||
      position.assetClass === undefined ||
      position.strategyBucket === undefined
    ) {
      unknownMetadataExposureKrw += grossExposureKrw;
    }

    const symbolKey = `${position.market}:${position.symbol}`;
    const symbolExposure =
      symbolExposures.get(symbolKey) ??
      createMutableSymbolExposure(position, symbolKey);
    symbolExposure.grossExposureKrw += grossExposureKrw;
    symbolExposure.netExposureKrw += exposureKrw;
    symbolExposure.positionCount += 1;
    symbolExposure.strategyBuckets.add(strategyBucket);
    symbolExposure.assetTypes.add(assetType);
    symbolExposure.assetClasses.add(assetClass);
    symbolExposures.set(symbolKey, symbolExposure);
  }

  return {
    mode: "paper_only",
    virtualNetWorthKrw: virtualNetWorth,
    positionMarketValueKrw: totalNetExposureKrw,
    totalGrossExposureKrw,
    totalNetExposureKrw,
    totalGrossExposureRatio: exposureRatio(
      totalGrossExposureKrw,
      virtualNetWorth
    ),
    totalNetExposureRatio: exposureRatio(totalNetExposureKrw, virtualNetWorth),
    positionCount: portfolio.positions.length,
    exposureByMarketKrw,
    exposureByMarketRatio: ratioRecord(exposureByMarketKrw, virtualNetWorth),
    exposureByAssetTypeKrw,
    exposureByAssetTypeRatio: ratioRecord(
      exposureByAssetTypeKrw,
      virtualNetWorth
    ),
    exposureByAssetClassKrw,
    exposureByAssetClassRatio: ratioRecord(
      exposureByAssetClassKrw,
      virtualNetWorth
    ),
    exposureByStrategyBucketKrw,
    exposureByStrategyBucketRatio: ratioRecord(
      exposureByStrategyBucketKrw,
      virtualNetWorth
    ),
    symbolExposures: Array.from(symbolExposures.values())
      .map((item) => finalizeSymbolExposure(item, virtualNetWorth))
      .sort(compareSymbolExposure),
    unknownMetadataExposureKrw,
    unknownMetadataExposureRatio: exposureRatio(
      unknownMetadataExposureKrw,
      virtualNetWorth
    )
  };
}

export function positionExposureValueKrw(
  position: Pick<
    VirtualPosition,
    "marketValueKrw" | "quantity" | "averagePriceKrw"
  >
): number {
  const value =
    position.marketValueKrw ??
    Math.round(position.quantity * position.averagePriceKrw);
  return Number.isFinite(value) ? value : 0;
}

function createMutableSymbolExposure(
  position: Pick<VirtualPosition, "market" | "symbol">,
  key: string
): MutableSymbolExposure {
  return {
    key,
    market: position.market,
    symbol: position.symbol,
    grossExposureKrw: 0,
    netExposureKrw: 0,
    positionCount: 0,
    strategyBuckets: new Set<StrategyBucketKey>(),
    assetTypes: new Set<AssetTypeExposureKey>(),
    assetClasses: new Set<AssetClassExposureKey>()
  };
}

function finalizeSymbolExposure(
  exposure: MutableSymbolExposure,
  virtualNetWorthKrw: number
): PortfolioSymbolExposure {
  return {
    key: exposure.key,
    market: exposure.market,
    symbol: exposure.symbol,
    grossExposureKrw: exposure.grossExposureKrw,
    netExposureKrw: exposure.netExposureKrw,
    exposureRatio: exposureRatio(
      exposure.grossExposureKrw,
      virtualNetWorthKrw
    ),
    positionCount: exposure.positionCount,
    strategyBuckets: Array.from(exposure.strategyBuckets).sort(),
    assetTypes: Array.from(exposure.assetTypes).sort(),
    assetClasses: Array.from(exposure.assetClasses).sort()
  };
}

function zeroRecord<Key extends string>(
  keys: readonly Key[]
): Record<Key, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>;
}

function ratioRecord<Key extends string>(
  values: Record<Key, number>,
  denominator: number
): Record<Key, number> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      exposureRatio(value as number, denominator)
    ])
  ) as Record<Key, number>;
}

function exposureRatio(value: number, denominator: number): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return 0;
  }
  return roundRatio(value / denominator);
}

function compareSymbolExposure(
  left: PortfolioSymbolExposure,
  right: PortfolioSymbolExposure
): number {
  if (right.grossExposureKrw !== left.grossExposureKrw) {
    return right.grossExposureKrw - left.grossExposureKrw;
  }
  return left.key.localeCompare(right.key);
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}
