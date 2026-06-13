import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecision,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualPosition
} from "../domain/schemas.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export interface PaperExitPolicy {
  takeProfitRatio?: number;
  stopLossRatio?: number;
  rebalanceMaxPositionWeightRatio?: number;
}

export type NormalizedPaperExitPolicy = PaperExitPolicy;

type ExitReason = "take_profit" | "stop_loss" | "rebalance";

const ratioEpsilon = 1e-9;

export function normalizePaperExitPolicy(
  policy: PaperExitPolicy | undefined
): NormalizedPaperExitPolicy | null {
  if (policy === undefined) {
    return null;
  }

  const normalized: NormalizedPaperExitPolicy = {};

  if (policy.takeProfitRatio !== undefined) {
    normalized.takeProfitRatio = validateRatio({
      name: "takeProfitRatio",
      value: policy.takeProfitRatio,
      max: 10
    });
  }
  if (policy.stopLossRatio !== undefined) {
    normalized.stopLossRatio = validateRatio({
      name: "stopLossRatio",
      value: policy.stopLossRatio,
      max: 1
    });
  }
  if (policy.rebalanceMaxPositionWeightRatio !== undefined) {
    normalized.rebalanceMaxPositionWeightRatio = validateRatio({
      name: "rebalanceMaxPositionWeightRatio",
      value: policy.rebalanceMaxPositionWeightRatio,
      max: 1
    });
  }

  return Object.keys(normalized).length === 0 ? null : normalized;
}

export function buildPaperExitPolicyDecision(input: {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  policy?: PaperExitPolicy | undefined;
}): VirtualDecision | null {
  const policy = normalizePaperExitPolicy(input.policy);
  if (policy === null) {
    return null;
  }
  if (!input.packet.constraints.allowedActions.includes("VIRTUAL_SELL")) {
    return null;
  }

  const candidatesBySymbol = new Map(
    input.packet.candidates.map((candidate) => [
      `${candidate.market}:${candidate.symbol}`,
      candidate
    ])
  );
  const decisions = input.portfolio.positions.flatMap((position) => {
    const candidate = candidatesBySymbol.get(
      `${position.market}:${position.symbol}`
    );
    if (candidate === undefined) {
      return [];
    }

    const decision = buildPositionExitDecision({
      packet: input.packet,
      portfolio: input.portfolio,
      position,
      candidate,
      policy
    });

    return decision === null ? [] : [decision];
  });

  if (decisions.length === 0) {
    return null;
  }

  return {
    packetId: input.packet.packetId,
    summary: "Paper-only deterministic exit policy decision.",
    policyVersion: "paper_exit_policy_v1",
    decisions
  };
}

function buildPositionExitDecision(input: {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  position: VirtualPosition;
  candidate: MarketCandidate;
  policy: NormalizedPaperExitPolicy;
}): VirtualDecisionItem | null {
  if (
    input.position.quantity <= 0 ||
    input.position.averagePriceKrw <= 0 ||
    input.candidate.lastPriceKrw === undefined ||
    input.candidate.lastPriceKrw <= 0 ||
    input.candidate.sellEligible === false
  ) {
    return null;
  }

  const currentPriceKrw = input.candidate.lastPriceKrw;
  const unrealizedReturnRatio =
    (currentPriceKrw - input.position.averagePriceKrw) /
    input.position.averagePriceKrw;

  if (
    input.policy.stopLossRatio !== undefined &&
    unrealizedReturnRatio <= -input.policy.stopLossRatio
  ) {
    return exitDecision({
      packet: input.packet,
      candidate: input.candidate,
      reason: "stop_loss",
      sizing: { sellAll: true },
      thesis: `Paper-only stop-loss exit triggered at ${formatRatio(
        unrealizedReturnRatio
      )} unrealized return.`
    });
  }

  if (
    input.policy.takeProfitRatio !== undefined &&
    unrealizedReturnRatio >= input.policy.takeProfitRatio
  ) {
    return exitDecision({
      packet: input.packet,
      candidate: input.candidate,
      reason: "take_profit",
      sizing: { sellAll: true },
      thesis: `Paper-only take-profit exit triggered at ${formatRatio(
        unrealizedReturnRatio
      )} unrealized return.`
    });
  }

  if (input.policy.rebalanceMaxPositionWeightRatio !== undefined) {
    const netWorthKrw = virtualNetWorthKrw(input.portfolio);
    const positionValueKrw = Math.round(
      input.position.quantity * currentPriceKrw
    );
    const positionWeightRatio =
      netWorthKrw > 0 ? positionValueKrw / netWorthKrw : 0;
    if (
      positionWeightRatio >
      input.policy.rebalanceMaxPositionWeightRatio + ratioEpsilon
    ) {
      return exitDecision({
        packet: input.packet,
        candidate: input.candidate,
        reason: "rebalance",
        sizing: {
          targetWeightPct: input.policy.rebalanceMaxPositionWeightRatio
        },
        thesis: `Paper-only rebalance exit trims ${formatRatio(
          positionWeightRatio
        )} position weight to ${formatRatio(
          input.policy.rebalanceMaxPositionWeightRatio
        )}.`
      });
    }
  }

  return null;
}

function exitDecision(input: {
  packet: MarketPacket;
  candidate: MarketCandidate;
  reason: ExitReason;
  sizing: Pick<
    VirtualDecisionItem,
    "sellAll" | "targetWeightPct"
  >;
  thesis: string;
}): VirtualDecisionItem {
  const dataRefs = input.candidate.sourceRefs.slice(0, 5);
  const featureRefs = input.candidate.featureRefs?.slice(0, 8);
  const item: VirtualDecisionItem = {
    market: input.candidate.market,
    symbol: input.candidate.symbol,
    action: "VIRTUAL_SELL",
    confidence: 0.68,
    budgetKrw: 0,
    reduceOnly: true,
    ...input.sizing,
    thesis: input.thesis,
    riskFactors: [
      "Paper-only deterministic exit policy.",
      "Historical replay fill assumptions may differ from live liquidity."
    ],
    dataRefs,
    claimSupport: [
      {
        claim: input.thesis,
        dataRefs
      }
    ],
    expiresAt: input.packet.expiresAt
  };

  if (featureRefs !== undefined && featureRefs.length > 0) {
    item.featureRefs = featureRefs;
    item.claimSupport = [
      {
        claim: input.thesis,
        dataRefs,
        featureRefs
      }
    ];
  }

  item.riskFactors.push(`paper_exit_reason:${input.reason}`);
  return item;
}

function validateRatio(input: {
  name: string;
  value: number;
  max: number;
}): number {
  if (!Number.isFinite(input.value) || input.value <= 0 || input.value > input.max) {
    throw new Error(`${input.name} must be > 0 and <= ${input.max}`);
  }
  return input.value;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
