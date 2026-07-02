import type { VirtualTrade } from "../domain/schemas.js";
import {
  buildPaperLiquidityDecision,
  type PaperFillStatus,
  type PaperLiquidityRejectReason,
  type PaperLiquidityStatus
} from "./liquidityModel.js";

export interface PaperExecutionPolicy {
  fillPriceRule: "current_candidate_last_price";
  slippageBps: number;
  feeBps: number;
  taxBps: number;
  fillRatio: number;
  allowFractionalShares: boolean;
  maxVolumeParticipationRate: number;
  minLiquidityFillRatio: number;
  rejectStaleLiquidity: boolean;
  marketImpactBpsPerParticipationRate: number;
}

export interface PaperFillInput {
  action: VirtualTrade["action"];
  targetNotionalKrw: number;
  sourcePriceKrw: number;
  averagePriceKrw?: number | undefined;
  quantityOverride?: number | undefined;
  volume?: number | undefined;
  averageVolume?: number | undefined;
  liquidityStale?: boolean | undefined;
  policy?: Partial<PaperExecutionPolicy> | undefined;
}

export interface PaperFill {
  quantity: number;
  sourcePriceKrw: number;
  fillPriceKrw: number;
  fillPriceRule: PaperExecutionPolicy["fillPriceRule"];
  grossAmountKrw: number;
  netAmountKrw: number;
  feeKrw: number;
  taxKrw: number;
  slippageKrw: number;
  spreadCostKrw: number;
  impactCostKrw: number;
  totalCostKrw: number;
  realizedPnlKrw?: number | undefined;
  fillRatio: number;
  fractionalShares: boolean;
  requestedNotionalKrw: number;
  filledNotionalKrw: number;
  fillStatus: PaperFillStatus;
  liquidityStatus: PaperLiquidityStatus;
  participationRate?: number | undefined;
  maxParticipationRate: number;
  volume?: number | undefined;
  averageVolume?: number | undefined;
  liquidityRejectReason?: PaperLiquidityRejectReason | undefined;
}

export function createPaperExecutionPolicy(
  policy: Partial<PaperExecutionPolicy> | undefined
): PaperExecutionPolicy {
  return {
    fillPriceRule: policy?.fillPriceRule ?? "current_candidate_last_price",
    slippageBps: policy?.slippageBps ?? 0,
    feeBps: policy?.feeBps ?? 0,
    taxBps: policy?.taxBps ?? 0,
    fillRatio: policy?.fillRatio ?? 1,
    allowFractionalShares: policy?.allowFractionalShares ?? true,
    maxVolumeParticipationRate: policy?.maxVolumeParticipationRate ?? 0.1,
    minLiquidityFillRatio: policy?.minLiquidityFillRatio ?? 0.1,
    rejectStaleLiquidity: policy?.rejectStaleLiquidity ?? true,
    marketImpactBpsPerParticipationRate: normalizeNonnegativeNumber(
      policy?.marketImpactBpsPerParticipationRate,
      0
    )
  };
}

export function buildPaperFill(input: PaperFillInput): PaperFill {
  const policy = createPaperExecutionPolicy(input.policy);
  const sourcePriceKrw = input.sourcePriceKrw;
  const fillPriceKrw = applySlippage(input.action, sourcePriceKrw, policy);
  const quantityPrice =
    input.action === "VIRTUAL_BUY" ? fillPriceKrw : sourcePriceKrw;
  const targetNotionalKrw = Math.round(
    input.targetNotionalKrw * policy.fillRatio
  );
  const requestedNotionalKrw =
    input.quantityOverride === undefined
      ? targetNotionalKrw
      : Math.round(input.quantityOverride * sourcePriceKrw);
  const liquidityDecision = buildPaperLiquidityDecision({
    requestedNotionalKrw,
    sourcePriceKrw,
    volume: input.volume,
    averageVolume: input.averageVolume,
    liquidityStale: input.liquidityStale,
    policy
  });

  if (liquidityDecision.fillStatus === "rejected") {
    return rejectedPaperFill({
      sourcePriceKrw,
      fillPriceKrw,
      policy,
      liquidityDecision
    });
  }

  let quantity =
    input.quantityOverride === undefined
      ? liquidityDecision.fillableNotionalKrw / quantityPrice
      : liquidityDecision.fillStatus === "filled"
        ? input.quantityOverride
        : Math.min(
            input.quantityOverride,
            liquidityDecision.fillableNotionalKrw / sourcePriceKrw
          );

  if (input.quantityOverride === undefined && !policy.allowFractionalShares) {
    quantity = Math.floor(quantity);
  }

  if (quantity <= 0) {
    return rejectedPaperFill({
      sourcePriceKrw,
      fillPriceKrw,
      policy,
      liquidityDecision: {
        ...liquidityDecision,
        fillStatus: "rejected",
        liquidityStatus:
          liquidityDecision.liquidityStatus === "not_modeled"
            ? "rejected"
            : liquidityDecision.liquidityStatus,
        fillableNotionalKrw: 0,
        rejectReason: "insufficient_liquidity"
      }
    });
  }

  const grossAmountKrw = Math.round(quantity * fillPriceKrw);
  const feeKrw = Math.round((grossAmountKrw * policy.feeBps) / 10_000);
  const taxKrw =
    input.action === "VIRTUAL_SELL"
      ? Math.round((grossAmountKrw * policy.taxBps) / 10_000)
      : 0;
  const slippageKrw = Math.round(
    Math.abs(fillPriceKrw - sourcePriceKrw) * quantity
  );
  const spreadCostKrw = 0;
  const impactCostKrw = calculateMarketImpactCost({
    grossAmountKrw,
    participationRate: liquidityDecision.participationRate,
    policy
  });
  const explicitExecutionCostKrw =
    feeKrw + taxKrw + spreadCostKrw + impactCostKrw;
  const netAmountKrw =
    input.action === "VIRTUAL_BUY"
      ? grossAmountKrw + explicitExecutionCostKrw
      : Math.max(0, grossAmountKrw - explicitExecutionCostKrw);
  const totalCostKrw =
    feeKrw + taxKrw + slippageKrw + spreadCostKrw + impactCostKrw;
  const realizedPnlKrw =
    input.action === "VIRTUAL_SELL" && input.averagePriceKrw !== undefined
      ? netAmountKrw - Math.round(quantity * input.averagePriceKrw)
      : undefined;

  return {
    quantity,
    sourcePriceKrw,
    fillPriceKrw,
    fillPriceRule: policy.fillPriceRule,
    grossAmountKrw,
    netAmountKrw,
    feeKrw,
    taxKrw,
    slippageKrw,
    spreadCostKrw,
    impactCostKrw,
    totalCostKrw,
    realizedPnlKrw,
    fillRatio: policy.fillRatio,
    fractionalShares: policy.allowFractionalShares,
    requestedNotionalKrw,
    filledNotionalKrw: grossAmountKrw,
    fillStatus: liquidityDecision.fillStatus,
    liquidityStatus: liquidityDecision.liquidityStatus,
    ...(liquidityDecision.participationRate === undefined
      ? {}
      : { participationRate: liquidityDecision.participationRate }),
    maxParticipationRate: liquidityDecision.maxParticipationRate,
    ...(liquidityDecision.volume === undefined
      ? {}
      : { volume: liquidityDecision.volume }),
    ...(liquidityDecision.averageVolume === undefined
      ? {}
      : { averageVolume: liquidityDecision.averageVolume })
  };
}

function rejectedPaperFill(input: {
  sourcePriceKrw: number;
  fillPriceKrw: number;
  policy: PaperExecutionPolicy;
  liquidityDecision: ReturnType<typeof buildPaperLiquidityDecision>;
}): PaperFill {
  return {
    quantity: 0,
    sourcePriceKrw: input.sourcePriceKrw,
    fillPriceKrw: input.fillPriceKrw,
    fillPriceRule: input.policy.fillPriceRule,
    grossAmountKrw: 0,
    netAmountKrw: 0,
    feeKrw: 0,
    taxKrw: 0,
    slippageKrw: 0,
    spreadCostKrw: 0,
    impactCostKrw: 0,
    totalCostKrw: 0,
    fillRatio: input.policy.fillRatio,
    fractionalShares: input.policy.allowFractionalShares,
    requestedNotionalKrw: input.liquidityDecision.requestedNotionalKrw,
    filledNotionalKrw: 0,
    fillStatus: "rejected",
    liquidityStatus: input.liquidityDecision.liquidityStatus,
    ...(input.liquidityDecision.participationRate === undefined
      ? {}
      : { participationRate: input.liquidityDecision.participationRate }),
    maxParticipationRate: input.liquidityDecision.maxParticipationRate,
    ...(input.liquidityDecision.volume === undefined
      ? {}
      : { volume: input.liquidityDecision.volume }),
    ...(input.liquidityDecision.averageVolume === undefined
      ? {}
      : { averageVolume: input.liquidityDecision.averageVolume }),
    ...(input.liquidityDecision.rejectReason === undefined
      ? {}
      : { liquidityRejectReason: input.liquidityDecision.rejectReason })
  };
}

function applySlippage(
  action: VirtualTrade["action"],
  priceKrw: number,
  policy: PaperExecutionPolicy
): number {
  const direction = action === "VIRTUAL_BUY" ? 1 : -1;
  return Math.max(
    0,
    Math.round(priceKrw * (1 + (direction * policy.slippageBps) / 10_000))
  );
}

function calculateMarketImpactCost(input: {
  grossAmountKrw: number;
  participationRate: number | undefined;
  policy: PaperExecutionPolicy;
}): number {
  if (
    input.participationRate === undefined ||
    input.participationRate <= 0 ||
    input.policy.marketImpactBpsPerParticipationRate <= 0
  ) {
    return 0;
  }

  const impactBps =
    input.participationRate * input.policy.marketImpactBpsPerParticipationRate;
  return Math.round((input.grossAmountKrw * impactBps) / 10_000);
}

function normalizeNonnegativeNumber(
  value: number | undefined,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}
