import type { Market } from "../domain/schemas.js";

export const LIVE_RISK_REJECT_CODES = [
  "KILL_SWITCH_ACTIVE",
  "MAX_ORDER_AMOUNT_EXCEEDED",
  "MAX_DAILY_LOSS_EXCEEDED",
  "MAX_SYMBOL_EXPOSURE_EXCEEDED",
  "MAX_MARKET_EXPOSURE_EXCEEDED",
  "MAX_TOTAL_EXPOSURE_EXCEEDED",
  "SYMBOL_NOT_ALLOWED",
  "MARKET_NOT_ALLOWED",
  "MARKET_CLOSED",
  "MARKET_HOURS_UNKNOWN",
  "DUPLICATE_ORDER_INTENT",
  "IDEMPOTENCY_KEY_REUSED",
  "COOLDOWN_ACTIVE",
  "OPEN_ORDER_LIMIT_EXCEEDED",
  "MARKET_ORDER_DISABLED",
  "MARKET_ORDER_REQUIRES_APPROVAL",
  "SIGNAL_STALE",
  "POSITION_NOT_FOUND",
  "SELL_QUANTITY_EXCEEDED",
  "PREVIEW_REQUIRED",
  "PREVIEW_EXPIRED",
  "PREVIEW_MISMATCH",
  "INVALID_ORDER_INTENT",
  "INVALID_RISK_SNAPSHOT",
  "INVALID_RISK_POLICY"
] as const;

export type LiveRiskRejectCode = (typeof LIVE_RISK_REJECT_CODES)[number];

export const LIVE_RISK_RULE_IDS = [
  "kill_switch",
  "max_order_amount",
  "max_daily_loss",
  "max_position_exposure",
  "symbol_allowlist",
  "market_allowlist",
  "market_hours",
  "duplicate_order_prevention",
  "cooldown",
  "open_order_count",
  "market_order_policy",
  "stale_signal",
  "sell_position",
  "preview_requirement",
  "order_intent_validation",
  "risk_snapshot_validation",
  "risk_policy_validation"
] as const;

export type LiveRiskRuleId = (typeof LIVE_RISK_RULE_IDS)[number];

export type LiveOrderSide = "BUY" | "SELL";
export type LiveOrderType = "LIMIT" | "MARKET";
export type LiveMarketSessionStatus = "open" | "closed";
export type LiveMarketOrderPolicy = "disabled" | "requires_approval" | "allowed";

export interface LiveRiskCooldownEntry {
  market?: Market | undefined;
  symbol: string;
  side?: LiveOrderSide | undefined;
  activeUntil: string;
  reason?: string | undefined;
}

export interface LiveRiskPolicy {
  killSwitch: boolean;
  maxOrderAmountKrw: number;
  maxDailyLossKrw: number;
  maxSymbolExposureKrw: number;
  maxMarketExposureKrw: number;
  maxTotalExposureKrw: number;
  allowedSymbols: readonly string[];
  allowedMarkets: readonly Market[];
  requireMarketOpen: boolean;
  maxOpenOrders: number;
  marketOrderPolicy: LiveMarketOrderPolicy;
  requirePreview: boolean;
  cooldownEntries: readonly LiveRiskCooldownEntry[];
  now: Date;
}

export interface CreateLiveRiskPolicyInput {
  policy?: Partial<LiveRiskPolicy> | undefined;
}

export function createLiveRiskPolicy(
  input: CreateLiveRiskPolicyInput = {}
): LiveRiskPolicy {
  const policy = input.policy;
  return {
    killSwitch: policy?.killSwitch ?? true,
    maxOrderAmountKrw: normalizeNonNegativeFinitePolicyNumber(
      policy?.maxOrderAmountKrw,
      0
    ),
    maxDailyLossKrw: normalizeNonNegativeFinitePolicyNumber(
      policy?.maxDailyLossKrw,
      0
    ),
    maxSymbolExposureKrw: normalizeNonNegativeFinitePolicyNumber(
      policy?.maxSymbolExposureKrw,
      0
    ),
    maxMarketExposureKrw: normalizeNonNegativeFinitePolicyNumber(
      policy?.maxMarketExposureKrw,
      0
    ),
    maxTotalExposureKrw: normalizeNonNegativeFinitePolicyNumber(
      policy?.maxTotalExposureKrw,
      0
    ),
    allowedSymbols: normalizeAllowedSymbols(policy?.allowedSymbols ?? []),
    allowedMarkets: [...new Set(policy?.allowedMarkets ?? [])],
    requireMarketOpen: policy?.requireMarketOpen ?? true,
    maxOpenOrders: normalizeNonNegativeIntegerPolicyNumber(
      policy?.maxOpenOrders,
      0
    ),
    marketOrderPolicy: policy?.marketOrderPolicy ?? "disabled",
    requirePreview: policy?.requirePreview ?? true,
    cooldownEntries: policy?.cooldownEntries ?? [],
    now: policy?.now ?? new Date()
  };
}

type LiveRiskPolicyFiniteNumberKey =
  | "maxOrderAmountKrw"
  | "maxDailyLossKrw"
  | "maxSymbolExposureKrw"
  | "maxMarketExposureKrw"
  | "maxTotalExposureKrw";

export function hasInvalidLiveRiskPolicyInput(
  policy: Partial<LiveRiskPolicy> | undefined
): boolean {
  if (policy === undefined) {
    return false;
  }

  const hasInvalidFiniteNumber = (
    [
      "maxOrderAmountKrw",
      "maxDailyLossKrw",
      "maxSymbolExposureKrw",
      "maxMarketExposureKrw",
      "maxTotalExposureKrw"
    ] as const
  ).some((key: LiveRiskPolicyFiniteNumberKey) =>
    hasInvalidFiniteNumberPolicyValue(policy, key)
  );

  return (
    hasInvalidFiniteNumber ||
    hasInvalidIntegerPolicyValue(policy, "maxOpenOrders")
  );
}

export function appendLiveRiskRejectCode(
  target: LiveRiskRejectCode[],
  code: LiveRiskRejectCode
): void {
  if (!target.includes(code)) {
    target.push(code);
  }
}

export function normalizeLiveRiskRejectCodes(
  codes: LiveRiskRejectCode[]
): LiveRiskRejectCode[] {
  return [...new Set(codes)];
}

export function normalizeLiveRiskSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeAllowedSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map(normalizeLiveRiskSymbol))];
}

function hasInvalidFiniteNumberPolicyValue(
  policy: Partial<LiveRiskPolicy>,
  key: LiveRiskPolicyFiniteNumberKey
): boolean {
  const value = policy[key];
  return value !== undefined && !isNonNegativeFiniteNumber(value);
}

function hasInvalidIntegerPolicyValue(
  policy: Partial<LiveRiskPolicy>,
  key: "maxOpenOrders"
): boolean {
  const value = policy[key];
  return value !== undefined && !isNonNegativeInteger(value);
}

function normalizeNonNegativeFinitePolicyNumber(
  value: unknown,
  fallback: number
): number {
  return isNonNegativeFiniteNumber(value) ? value : fallback;
}

function normalizeNonNegativeIntegerPolicyNumber(
  value: unknown,
  fallback: number
): number {
  return isNonNegativeInteger(value) ? value : fallback;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isNonNegativeFiniteNumber(value);
}
