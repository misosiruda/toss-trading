import {
  createPaperExecutionPolicy,
  type PaperExecutionPolicy
} from "./executionModel.js";

export const PAPER_COST_MODEL_VERSION = "paper_cost_model.v1";
export const PAPER_EXECUTION_MODEL_VERSION = "execution_simulator.v1";

export interface PaperCostModel {
  modelVersion: typeof PAPER_COST_MODEL_VERSION;
  executionModelVersion: typeof PAPER_EXECUTION_MODEL_VERSION;
  fillModel: "simple_fill_ratio";
  feeModel: "fixed_bps";
  taxModel: "sell_tax_bps";
  slippageModel: "linear_bps";
  spreadModel: "not_modeled";
  marketImpactModel: "not_modeled";
  liquidityModel: "not_modeled";
  executionPolicy: PaperExecutionPolicy;
  costComponents: {
    fee: "fee_bps";
    tax: "sell_tax_bps";
    slippage: "slippage_bps";
    spread: "not_modeled";
    marketImpact: "not_modeled";
  };
  assumptions: string[];
}

export function createPaperCostModel(
  policy?: Partial<PaperExecutionPolicy> | undefined
): PaperCostModel {
  return {
    modelVersion: PAPER_COST_MODEL_VERSION,
    executionModelVersion: PAPER_EXECUTION_MODEL_VERSION,
    fillModel: "simple_fill_ratio",
    feeModel: "fixed_bps",
    taxModel: "sell_tax_bps",
    slippageModel: "linear_bps",
    spreadModel: "not_modeled",
    marketImpactModel: "not_modeled",
    liquidityModel: "not_modeled",
    executionPolicy: createPaperExecutionPolicy(policy),
    costComponents: {
      fee: "fee_bps",
      tax: "sell_tax_bps",
      slippage: "slippage_bps",
      spread: "not_modeled",
      marketImpact: "not_modeled"
    },
    assumptions: [
      "paper-only execution simulator",
      "no live broker order",
      "spread and market impact are explicit zero placeholders",
      "liquidity and partial-fill behavior are not modeled in Q3-1"
    ]
  };
}
