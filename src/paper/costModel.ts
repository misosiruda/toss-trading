import {
  createPaperExecutionPolicy,
  type PaperExecutionPolicy
} from "./executionModel.js";

export const PAPER_COST_MODEL_VERSION = "paper_cost_model.v3";
export const PAPER_EXECUTION_MODEL_VERSION = "execution_simulator.v3";

export interface PaperCostModel {
  modelVersion: typeof PAPER_COST_MODEL_VERSION;
  executionModelVersion: typeof PAPER_EXECUTION_MODEL_VERSION;
  fillModel: "simple_fill_ratio_with_participation_cap";
  feeModel: "fixed_bps";
  taxModel: "sell_tax_bps";
  slippageModel: "linear_bps";
  spreadModel: "not_modeled";
  marketImpactModel: "not_modeled" | "linear_participation_bps";
  liquidityModel: "conservative_when_available";
  executionPolicy: PaperExecutionPolicy;
  costComponents: {
    fee: "fee_bps";
    tax: "sell_tax_bps";
    slippage: "slippage_bps";
    spread: "not_modeled";
    marketImpact: "not_modeled" | "participation_rate_bps";
  };
  assumptions: string[];
}

export function createPaperCostModel(
  policy?: Partial<PaperExecutionPolicy> | undefined
): PaperCostModel {
  const executionPolicy = createPaperExecutionPolicy(policy);
  const marketImpactModeled =
    executionPolicy.marketImpactBpsPerParticipationRate > 0;

  return {
    modelVersion: PAPER_COST_MODEL_VERSION,
    executionModelVersion: PAPER_EXECUTION_MODEL_VERSION,
    fillModel: "simple_fill_ratio_with_participation_cap",
    feeModel: "fixed_bps",
    taxModel: "sell_tax_bps",
    slippageModel: "linear_bps",
    spreadModel: "not_modeled",
    marketImpactModel: marketImpactModeled
      ? "linear_participation_bps"
      : "not_modeled",
    liquidityModel: "conservative_when_available",
    executionPolicy,
    costComponents: {
      fee: "fee_bps",
      tax: "sell_tax_bps",
      slippage: "slippage_bps",
      spread: "not_modeled",
      marketImpact: marketImpactModeled
        ? "participation_rate_bps"
        : "not_modeled"
    },
    assumptions: [
      "paper-only execution simulator",
      "no live broker order",
      "spread is an explicit zero placeholder",
      marketImpactModeled
        ? "market impact cost uses filled notional and filled volume participation rate"
        : "market impact is an explicit zero placeholder",
      "volume participation cap applies only when candidate volume is available",
      "missing volume preserves legacy fill behavior and is reported as not_modeled"
    ]
  };
}
