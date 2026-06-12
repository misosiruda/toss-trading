import type {
  Market,
  VirtualAction,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";

export const VIRTUAL_RISK_REJECT_CODES = [
  "VIRTUAL_PACKET_STALE",
  "VIRTUAL_DECISION_STALE",
  "VIRTUAL_CANDIDATE_NOT_FOUND",
  "VIRTUAL_PRICE_MISSING",
  "VIRTUAL_CASH_EXCEEDED",
  "VIRTUAL_CASH_RESERVE_BREACHED",
  "VIRTUAL_BUDGET_EXCEEDED",
  "VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED",
  "VIRTUAL_POSITION_WEIGHT_EXCEEDED",
  "VIRTUAL_POSITION_NOT_FOUND",
  "VIRTUAL_SELL_AMOUNT_REQUIRED",
  "VIRTUAL_SELL_AMOUNT_EXCEEDED",
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
  "budget_limit",
  "symbol_exposure",
  "position_weight",
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
  maxPositionWeightRatio: number;
  minCashReserveRatio: number;
  minCashReserveKrw: number;
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
    maxPositionWeightRatio: input.policy?.maxPositionWeightRatio ?? 0.35,
    minCashReserveRatio: input.policy?.minCashReserveRatio ?? 0.1,
    minCashReserveKrw: input.policy?.minCashReserveKrw ?? 0,
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
