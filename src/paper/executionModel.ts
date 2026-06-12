import type { VirtualTrade } from "../domain/schemas.js";

export interface PaperExecutionPolicy {
  fillPriceRule: "current_candidate_last_price";
  slippageBps: number;
  feeBps: number;
  taxBps: number;
  fillRatio: number;
  allowFractionalShares: boolean;
}

export interface PaperFillInput {
  action: VirtualTrade["action"];
  targetNotionalKrw: number;
  sourcePriceKrw: number;
  averagePriceKrw?: number | undefined;
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
  realizedPnlKrw?: number | undefined;
  fillRatio: number;
  fractionalShares: boolean;
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
    allowFractionalShares: policy?.allowFractionalShares ?? true
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
  let quantity = targetNotionalKrw / quantityPrice;

  if (!policy.allowFractionalShares) {
    quantity = Math.floor(quantity);
  }

  const grossAmountKrw = Math.round(quantity * fillPriceKrw);
  const feeKrw = Math.round((grossAmountKrw * policy.feeBps) / 10_000);
  const taxKrw =
    input.action === "VIRTUAL_SELL"
      ? Math.round((grossAmountKrw * policy.taxBps) / 10_000)
      : 0;
  const netAmountKrw =
    input.action === "VIRTUAL_BUY"
      ? grossAmountKrw + feeKrw + taxKrw
      : Math.max(0, grossAmountKrw - feeKrw - taxKrw);
  const slippageKrw = Math.round(
    Math.abs(fillPriceKrw - sourcePriceKrw) * quantity
  );
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
    realizedPnlKrw,
    fillRatio: policy.fillRatio,
    fractionalShares: policy.allowFractionalShares
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
