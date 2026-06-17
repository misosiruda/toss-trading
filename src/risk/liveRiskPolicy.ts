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
  const policy = isRecord(input.policy) ? input.policy : undefined;
  return {
    killSwitch: normalizeBooleanPolicyValue(policy?.killSwitch, true),
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
    allowedSymbols: normalizeAllowedSymbols(policy?.allowedSymbols),
    allowedMarkets: normalizeAllowedMarkets(policy?.allowedMarkets),
    requireMarketOpen: normalizeBooleanPolicyValue(
      policy?.requireMarketOpen,
      true
    ),
    maxOpenOrders: normalizeNonNegativeIntegerPolicyNumber(
      policy?.maxOpenOrders,
      0
    ),
    marketOrderPolicy: normalizeMarketOrderPolicy(policy?.marketOrderPolicy),
    requirePreview: normalizeBooleanPolicyValue(policy?.requirePreview, true),
    cooldownEntries: normalizeCooldownEntries(policy?.cooldownEntries),
    now: normalizePolicyNow(policy?.now)
  };
}

type LiveRiskPolicyFiniteNumberKey =
  | "maxOrderAmountKrw"
  | "maxDailyLossKrw"
  | "maxSymbolExposureKrw"
  | "maxMarketExposureKrw"
  | "maxTotalExposureKrw";

type LiveRiskPolicyBooleanKey =
  | "killSwitch"
  | "requireMarketOpen"
  | "requirePreview";

export function hasInvalidLiveRiskPolicyInput(
  policy: Partial<LiveRiskPolicy> | undefined
): boolean {
  if (policy === undefined) {
    return false;
  }
  if (!isRecord(policy)) {
    return true;
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
  const hasInvalidBoolean = (
    ["killSwitch", "requireMarketOpen", "requirePreview"] as const
  ).some((key: LiveRiskPolicyBooleanKey) =>
    hasInvalidBooleanPolicyValue(policy, key)
  );

  return (
    hasInvalidFiniteNumber ||
    hasInvalidBoolean ||
    hasInvalidIntegerPolicyValue(policy, "maxOpenOrders") ||
    hasInvalidAllowedSymbolsPolicyValue(policy) ||
    hasInvalidAllowedMarketsPolicyValue(policy) ||
    hasInvalidCooldownEntriesPolicyValue(policy) ||
    hasInvalidMarketOrderPolicyValue(policy) ||
    hasInvalidPolicyNowValue(policy)
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

function normalizeAllowedSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter(isNonEmptyString)
        .map(normalizeLiveRiskSymbol)
    )
  ];
}

function normalizeAllowedMarkets(value: unknown): Market[] {
  return Array.isArray(value) ? [...new Set(value.filter(isLiveMarket))] : [];
}

function normalizeCooldownEntries(value: unknown): LiveRiskCooldownEntry[] {
  return Array.isArray(value) ? value.filter(isLiveRiskCooldownEntry) : [];
}

function hasInvalidFiniteNumberPolicyValue(
  policy: Record<string, unknown>,
  key: LiveRiskPolicyFiniteNumberKey
): boolean {
  const value = policy[key];
  return value !== undefined && !isNonNegativeFiniteNumber(value);
}

function hasInvalidIntegerPolicyValue(
  policy: Record<string, unknown>,
  key: "maxOpenOrders"
): boolean {
  const value = policy[key];
  return value !== undefined && !isNonNegativeInteger(value);
}

function hasInvalidBooleanPolicyValue(
  policy: Record<string, unknown>,
  key: LiveRiskPolicyBooleanKey
): boolean {
  const value = policy[key];
  return value !== undefined && typeof value !== "boolean";
}

function hasInvalidAllowedSymbolsPolicyValue(
  policy: Record<string, unknown>
): boolean {
  const value = policy.allowedSymbols;
  return (
    value !== undefined &&
    (!Array.isArray(value) || value.some((symbol) => !isNonEmptyString(symbol)))
  );
}

function hasInvalidAllowedMarketsPolicyValue(
  policy: Record<string, unknown>
): boolean {
  const value = policy.allowedMarkets;
  return (
    value !== undefined &&
    (!Array.isArray(value) || value.some((market) => !isLiveMarket(market)))
  );
}

function hasInvalidCooldownEntriesPolicyValue(
  policy: Record<string, unknown>
): boolean {
  const value = policy.cooldownEntries;
  return (
    value !== undefined &&
    (!Array.isArray(value) ||
      value.some((entry) => !isLiveRiskCooldownEntry(entry)))
  );
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

function normalizeBooleanPolicyValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMarketOrderPolicy(value: unknown): LiveMarketOrderPolicy {
  return isLiveMarketOrderPolicy(value) ? value : "disabled";
}

function hasInvalidMarketOrderPolicyValue(
  policy: Record<string, unknown>
): boolean {
  const value = policy.marketOrderPolicy;
  return value !== undefined && !isLiveMarketOrderPolicy(value);
}

function normalizePolicyNow(value: unknown): Date {
  return isValidDate(value) ? value : new Date();
}

function hasInvalidPolicyNowValue(policy: Record<string, unknown>): boolean {
  const value = policy.now;
  return value !== undefined && !isValidDate(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isNonNegativeFiniteNumber(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLiveMarket(value: unknown): value is Market {
  return value === "KR" || value === "US";
}

function isLiveOrderSide(value: unknown): value is LiveOrderSide {
  return value === "BUY" || value === "SELL";
}

function isLiveMarketOrderPolicy(
  value: unknown
): value is LiveMarketOrderPolicy {
  return (
    value === "disabled" ||
    value === "requires_approval" ||
    value === "allowed"
  );
}

function isLiveRiskCooldownEntry(
  value: unknown
): value is LiveRiskCooldownEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.symbol) &&
    (value.market === undefined || isLiveMarket(value.market)) &&
    (value.side === undefined || isLiveOrderSide(value.side)) &&
    isNonEmptyString(value.activeUntil) &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
