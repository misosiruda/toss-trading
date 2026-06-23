import type {
  Market,
  VirtualAction,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import type { MarketRegimeClassification } from "../analytics/marketRegimeClassifier.js";
import type { DynamicCashReservePolicy } from "./dynamicCashReservePolicy.js";
import type { HedgePolicy } from "./hedgePolicy.js";

export const VIRTUAL_RISK_REJECT_CODES = [
  "VIRTUAL_PACKET_STALE",
  "VIRTUAL_DECISION_STALE",
  "VIRTUAL_CANDIDATE_NOT_FOUND",
  "VIRTUAL_PRICE_MISSING",
  "VIRTUAL_CASH_EXCEEDED",
  "VIRTUAL_CASH_RESERVE_BREACHED",
  "VIRTUAL_REGIME_CASH_RESERVE_BREACHED",
  "VIRTUAL_BUDGET_EXCEEDED",
  "VIRTUAL_TARGET_EXPOSURE_EXCEEDED",
  "VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED",
  "VIRTUAL_POSITION_WEIGHT_EXCEEDED",
  "VIRTUAL_BUCKET_BUDGET_EXCEEDED",
  "VIRTUAL_BUCKET_TURNOVER_EXCEEDED",
  "VIRTUAL_SECTOR_EXPOSURE_EXCEEDED",
  "VIRTUAL_COUNTRY_EXPOSURE_EXCEEDED",
  "VIRTUAL_CURRENCY_EXPOSURE_EXCEEDED",
  "VIRTUAL_EXPOSURE_METADATA_MISSING",
  "VIRTUAL_HEDGE_NOT_REDUCE_RISK",
  "VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED",
  "VIRTUAL_HEDGE_METADATA_MISSING",
  "VIRTUAL_POSITION_NOT_FOUND",
  "VIRTUAL_SELL_AMOUNT_REQUIRED",
  "VIRTUAL_SELL_AMOUNT_EXCEEDED",
  "VIRTUAL_LIQUIDITY_STALE",
  "VIRTUAL_LIQUIDITY_INSUFFICIENT",
  "VIRTUAL_COOLDOWN_ACTIVE"
] as const;

export type VirtualRiskRejectCode = (typeof VIRTUAL_RISK_REJECT_CODES)[number];

export const VIRTUAL_RISK_RULE_IDS = [
  "packet_freshness",
  "decision_freshness",
  "candidate_presence",
  "candidate_price",
  "cash_limit",
  "cash_reserve",
  "regime_cash_reserve",
  "budget_limit",
  "target_exposure",
  "symbol_exposure",
  "position_weight",
  "bucket_budget",
  "bucket_turnover",
  "sector_exposure",
  "country_exposure",
  "currency_exposure",
  "exposure_metadata",
  "hedge_policy",
  "sell_position",
  "cooldown"
] as const;

export type VirtualRiskRuleId = (typeof VIRTUAL_RISK_RULE_IDS)[number];

export interface VirtualRiskCooldownEntry {
  market?: Market | undefined;
  symbol: string;
  action?: VirtualAction | undefined;
  activeUntil: string;
  reason?: string | undefined;
}

export interface VirtualRiskPolicy {
  maxBudgetPerDecisionKrw: number;
  maxSymbolExposureKrw: number;
  targetExposureRatio?: number | undefined;
  maxPositionWeightRatio: number;
  maxStrategyBucketExposureKrw?: Record<string, number> | undefined;
  maxStrategyBucketExposureRatio?: Record<string, number> | undefined;
  maxBucketTurnoverKrw?: Record<string, number> | undefined;
  maxBucketTurnoverRatio?: Record<string, number> | undefined;
  maxSectorExposureKrw?: number | undefined;
  maxSectorExposureRatio?: number | undefined;
  maxCountryExposureKrw?: number | undefined;
  maxCountryExposureRatio?: number | undefined;
  maxCurrencyExposureKrw?: number | undefined;
  maxCurrencyExposureRatio?: number | undefined;
  maxUnknownMetadataExposureKrw?: number | undefined;
  maxUnknownMetadataExposureRatio?: number | undefined;
  minCashReserveRatio: number;
  minCashReserveKrw: number;
  dynamicCashReservePolicy?: DynamicCashReservePolicy | undefined;
  dynamicCashReserveMarketRegime?: MarketRegimeClassification | undefined;
  hedgePolicy?: HedgePolicy | undefined;
  cooldownEntries: VirtualRiskCooldownEntry[];
  now: Date;
}

export interface CreateVirtualRiskPolicyInput {
  maxBudgetPerSymbolKrw: number;
  policy?: Partial<VirtualRiskPolicy> | undefined;
}

export function createVirtualRiskPolicy(
  input: CreateVirtualRiskPolicyInput
): VirtualRiskPolicy {
  return {
    maxBudgetPerDecisionKrw:
      input.policy?.maxBudgetPerDecisionKrw ?? input.maxBudgetPerSymbolKrw,
    maxSymbolExposureKrw:
      input.policy?.maxSymbolExposureKrw ?? input.maxBudgetPerSymbolKrw,
    ...(input.policy?.targetExposureRatio === undefined
      ? {}
      : { targetExposureRatio: input.policy.targetExposureRatio }),
    maxPositionWeightRatio: input.policy?.maxPositionWeightRatio ?? 0.35,
    ...(input.policy?.maxStrategyBucketExposureKrw === undefined
      ? {}
      : {
          maxStrategyBucketExposureKrw:
            input.policy.maxStrategyBucketExposureKrw
        }),
    ...(input.policy?.maxStrategyBucketExposureRatio === undefined
      ? {}
      : {
          maxStrategyBucketExposureRatio:
            input.policy.maxStrategyBucketExposureRatio
        }),
    ...(input.policy?.maxBucketTurnoverKrw === undefined
      ? {}
      : { maxBucketTurnoverKrw: input.policy.maxBucketTurnoverKrw }),
    ...(input.policy?.maxBucketTurnoverRatio === undefined
      ? {}
      : { maxBucketTurnoverRatio: input.policy.maxBucketTurnoverRatio }),
    ...(input.policy?.maxSectorExposureKrw === undefined
      ? {}
      : { maxSectorExposureKrw: input.policy.maxSectorExposureKrw }),
    ...(input.policy?.maxSectorExposureRatio === undefined
      ? {}
      : { maxSectorExposureRatio: input.policy.maxSectorExposureRatio }),
    ...(input.policy?.maxCountryExposureKrw === undefined
      ? {}
      : { maxCountryExposureKrw: input.policy.maxCountryExposureKrw }),
    ...(input.policy?.maxCountryExposureRatio === undefined
      ? {}
      : { maxCountryExposureRatio: input.policy.maxCountryExposureRatio }),
    ...(input.policy?.maxCurrencyExposureKrw === undefined
      ? {}
      : { maxCurrencyExposureKrw: input.policy.maxCurrencyExposureKrw }),
    ...(input.policy?.maxCurrencyExposureRatio === undefined
      ? {}
      : { maxCurrencyExposureRatio: input.policy.maxCurrencyExposureRatio }),
    ...(input.policy?.maxUnknownMetadataExposureKrw === undefined
      ? {}
      : {
          maxUnknownMetadataExposureKrw:
            input.policy.maxUnknownMetadataExposureKrw
        }),
    ...(input.policy?.maxUnknownMetadataExposureRatio === undefined
      ? {}
      : {
          maxUnknownMetadataExposureRatio:
            input.policy.maxUnknownMetadataExposureRatio
        }),
    minCashReserveRatio: input.policy?.minCashReserveRatio ?? 0.1,
    minCashReserveKrw: input.policy?.minCashReserveKrw ?? 0,
    ...(input.policy?.dynamicCashReservePolicy === undefined
      ? {}
      : { dynamicCashReservePolicy: input.policy.dynamicCashReservePolicy }),
    ...(input.policy?.dynamicCashReserveMarketRegime === undefined
      ? {}
      : {
          dynamicCashReserveMarketRegime:
            input.policy.dynamicCashReserveMarketRegime
        }),
    ...(input.policy?.hedgePolicy === undefined
      ? {}
      : { hedgePolicy: input.policy.hedgePolicy }),
    cooldownEntries: input.policy?.cooldownEntries ?? [],
    now: input.policy?.now ?? new Date()
  };
}

export function appendVirtualRiskRejectCode(
  target: VirtualRiskRejectCode[],
  code: VirtualRiskRejectCode
): void {
  if (!target.includes(code)) {
    target.push(code);
  }
}

export function normalizeVirtualRiskRejectCodes(
  codes: VirtualRiskRejectCode[]
): VirtualRiskRejectCode[] {
  return [...new Set(codes)];
}

export function minimumCashReserveKrw(
  portfolio: VirtualPortfolio,
  policy: VirtualRiskPolicy
): number {
  return Math.max(
    policy.minCashReserveKrw,
    Math.round(virtualNetWorthKrw(portfolio) * policy.minCashReserveRatio)
  );
}

export function virtualNetWorthKrw(portfolio: VirtualPortfolio): number {
  return (
    portfolio.cashKrw +
    portfolio.positions.reduce(
      (sum, position) =>
        sum +
        (position.marketValueKrw ??
          Math.round(position.quantity * position.averagePriceKrw)),
      0
    )
  );
}

export function isVirtualRiskCooldownActive(
  decision: VirtualDecisionItem,
  policy: VirtualRiskPolicy
): boolean {
  if (decision.action === "VIRTUAL_SELL" && decision.reduceOnly === true) {
    return false;
  }

  return policy.cooldownEntries.some((entry) => {
    if (!isActiveCooldown(entry, policy.now)) {
      return false;
    }

    if (entry.market !== undefined && entry.market !== decision.market) {
      return false;
    }

    if (entry.symbol !== decision.symbol) {
      return false;
    }

    return entry.action === undefined || entry.action === decision.action;
  });
}

function isActiveCooldown(entry: VirtualRiskCooldownEntry, now: Date): boolean {
  const activeUntilMs = Date.parse(entry.activeUntil);
  return Number.isFinite(activeUntilMs) && activeUntilMs > now.getTime();
}
