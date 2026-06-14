import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import type { PaperAllocationPolicy } from "./allocationPolicy.js";
import type { VirtualRiskPolicy } from "./riskEngine.js";

export const PAPER_RISK_PROFILE_NAMES = [
  "conservative",
  "balanced",
  "aggressive_paper"
] as const;

export type PaperRiskProfileName = (typeof PAPER_RISK_PROFILE_NAMES)[number];

export interface ResolvedPaperRiskProfile {
  name: PaperRiskProfileName;
  constraints: MarketPacketConstraints;
  riskPolicy: Partial<VirtualRiskPolicy>;
  allocationPolicy: PaperAllocationPolicy;
}

interface PaperRiskProfileTemplate {
  maxNewPositions: number;
  maxBudgetPerSymbolKrw: number;
  maxSymbolExposureMultiplier: number;
  targetExposureRatio: number;
  maxBudgetPerDecisionRatio: number;
  maxSymbolExposureRatio: number;
  maxPositionWeightRatio: number;
  minCashReserveRatio: number;
  minCashReserveKrw: number;
}

const PROFILE_TEMPLATES: Record<PaperRiskProfileName, PaperRiskProfileTemplate> = {
  conservative: {
    maxNewPositions: 3,
    maxBudgetPerSymbolKrw: 100_000,
    maxSymbolExposureMultiplier: 1,
    targetExposureRatio: 0.35,
    maxBudgetPerDecisionRatio: 0.1,
    maxSymbolExposureRatio: 0.2,
    maxPositionWeightRatio: 0.35,
    minCashReserveRatio: 0.1,
    minCashReserveKrw: 0
  },
  balanced: {
    maxNewPositions: 4,
    maxBudgetPerSymbolKrw: 200_000,
    maxSymbolExposureMultiplier: 1.25,
    targetExposureRatio: 0.55,
    maxBudgetPerDecisionRatio: 0.15,
    maxSymbolExposureRatio: 0.25,
    maxPositionWeightRatio: 0.45,
    minCashReserveRatio: 0.08,
    minCashReserveKrw: 0
  },
  aggressive_paper: {
    maxNewPositions: 5,
    maxBudgetPerSymbolKrw: 400_000,
    maxSymbolExposureMultiplier: 1.5,
    targetExposureRatio: 0.85,
    maxBudgetPerDecisionRatio: 0.2,
    maxSymbolExposureRatio: 0.3,
    maxPositionWeightRatio: 0.65,
    minCashReserveRatio: 0.05,
    minCashReserveKrw: 0
  }
};

export function parsePaperRiskProfileName(
  value: string | undefined
): PaperRiskProfileName {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return "conservative";
  }

  if (isPaperRiskProfileName(normalized)) {
    return normalized;
  }

  throw new Error(
    `--risk-profile must be one of ${PAPER_RISK_PROFILE_NAMES.join(", ")}`
  );
}

export function resolvePaperRiskProfile(input: {
  name?: PaperRiskProfileName;
  initialCashKrw?: number;
  maxNewPositions?: number;
  maxBudgetPerSymbolKrw?: number;
} = {}): ResolvedPaperRiskProfile {
  const name = input.name ?? "conservative";
  const template = PROFILE_TEMPLATES[name];
  const scaledBudgetKrw =
    input.initialCashKrw === undefined
      ? template.maxBudgetPerSymbolKrw
      : Math.round(input.initialCashKrw * template.maxBudgetPerDecisionRatio);
  const maxBudgetPerSymbolKrw =
    input.maxBudgetPerSymbolKrw ??
    Math.max(template.maxBudgetPerSymbolKrw, scaledBudgetKrw);
  const scaledSymbolExposureKrw =
    input.initialCashKrw === undefined
      ? Math.round(maxBudgetPerSymbolKrw * template.maxSymbolExposureMultiplier)
      : Math.round(input.initialCashKrw * template.maxSymbolExposureRatio);
  const maxSymbolExposureKrw = Math.max(
    Math.round(maxBudgetPerSymbolKrw * template.maxSymbolExposureMultiplier),
    scaledSymbolExposureKrw
  );

  return {
    name,
    constraints: {
      maxNewPositions: input.maxNewPositions ?? template.maxNewPositions,
      maxBudgetPerSymbolKrw,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    riskPolicy: {
      maxBudgetPerDecisionKrw: maxBudgetPerSymbolKrw,
      maxSymbolExposureKrw,
      targetExposureRatio: template.targetExposureRatio,
      maxPositionWeightRatio: template.maxPositionWeightRatio,
      minCashReserveRatio: template.minCashReserveRatio,
      minCashReserveKrw: template.minCashReserveKrw
    },
    allocationPolicy: {
      policyName: `${name}_allocation`,
      targetExposureRatio: template.targetExposureRatio,
      minCashReserveRatio: template.minCashReserveRatio,
      maxBudgetPerDecisionRatio: template.maxBudgetPerDecisionRatio,
      maxSymbolExposureRatio: template.maxSymbolExposureRatio
    }
  };
}

function isPaperRiskProfileName(value: string): value is PaperRiskProfileName {
  return PAPER_RISK_PROFILE_NAMES.some((name) => name === value);
}
