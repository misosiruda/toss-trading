import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecision,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualPosition
} from "../domain/schemas.js";
import { candidateDecisionDataRefs } from "../market/candidateDataRefs.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export interface PaperExitPolicy {
  takeProfitRatio?: number;
  stopLossRatio?: number;
  rebalanceMaxPositionWeightRatio?: number;
  takeProfitMode?: TakeProfitMode;
  takeProfitSellRatio?: number;
  trailingStopFromPeakRatio?: number;
}

export type TakeProfitMode = "full_exit" | "partial_then_trail";

export interface NormalizedPaperExitPolicy extends PaperExitPolicy {
  takeProfitMode: TakeProfitMode;
}

export interface PaperExitPolicyPositionState {
  partialTakeProfitExecuted: boolean;
  peakPriceKrw: number;
}

export type PaperExitPolicyState = Map<string, PaperExitPolicyPositionState>;

type ExitReason = "take_profit" | "stop_loss" | "rebalance";

const ratioEpsilon = 1e-9;
const DEFAULT_TAKE_PROFIT_MODE: TakeProfitMode = "full_exit";
const DEFAULT_TAKE_PROFIT_SELL_RATIO = 0.5;
const DEFAULT_TRAILING_STOP_FROM_PEAK_RATIO = 0.08;

export function normalizePaperExitPolicy(
  policy: PaperExitPolicy | undefined
): NormalizedPaperExitPolicy | null {
  if (policy === undefined) {
    return null;
  }

  const normalized: NormalizedPaperExitPolicy = {
    takeProfitMode: normalizeTakeProfitMode(policy.takeProfitMode)
  };

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
  if (policy.takeProfitSellRatio !== undefined) {
    normalized.takeProfitSellRatio = validateRatio({
      name: "takeProfitSellRatio",
      value: policy.takeProfitSellRatio,
      max: 1
    });
  }
  if (policy.trailingStopFromPeakRatio !== undefined) {
    normalized.trailingStopFromPeakRatio = validateRatio({
      name: "trailingStopFromPeakRatio",
      value: policy.trailingStopFromPeakRatio,
      max: 1
    });
  }

  const hasRule =
    normalized.takeProfitRatio !== undefined ||
    normalized.stopLossRatio !== undefined ||
    normalized.rebalanceMaxPositionWeightRatio !== undefined;

  return hasRule ? normalized : null;
}

export function createPaperExitPolicyState(): PaperExitPolicyState {
  return new Map();
}

export function prunePaperExitPolicyState(
  state: PaperExitPolicyState,
  portfolio: VirtualPortfolio
): void {
  const activePositionKeys = new Set(
    portfolio.positions
      .filter((position) => position.quantity > 0)
      .map((position) => positionKey(position))
  );

  for (const key of state.keys()) {
    if (!activePositionKeys.has(key)) {
      state.delete(key);
    }
  }
}

export function buildPaperExitPolicyDecision(input: {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  policy?: PaperExitPolicy | undefined;
  state?: PaperExitPolicyState | undefined;
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
      policy,
      state: input.state
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
  state?: PaperExitPolicyState | undefined;
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
  const stateKey = positionKey(input.position);
  const positionState = updateExitPositionState({
    state: input.state,
    key: stateKey,
    currentPriceKrw
  });
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
    input.policy.takeProfitMode === "partial_then_trail" &&
    positionState.partialTakeProfitExecuted
  ) {
    const peakDrawdownRatio =
      positionState.peakPriceKrw > 0
        ? (positionState.peakPriceKrw - currentPriceKrw) /
          positionState.peakPriceKrw
        : 0;
    const trailingStopRatio =
      input.policy.trailingStopFromPeakRatio ??
      DEFAULT_TRAILING_STOP_FROM_PEAK_RATIO;
    if (peakDrawdownRatio >= trailingStopRatio) {
      return exitDecision({
        packet: input.packet,
        candidate: input.candidate,
        reason: "take_profit",
        sizing: { sellAll: true },
        thesis: `Paper-only trailing stop exit triggered after ${formatRatio(
          peakDrawdownRatio
        )} drawdown from peak.`
      });
    }
  }

  if (
    input.policy.takeProfitRatio !== undefined &&
    unrealizedReturnRatio >= input.policy.takeProfitRatio
  ) {
    if (input.policy.takeProfitMode === "partial_then_trail") {
      if (positionState.partialTakeProfitExecuted) {
        return null;
      }
      positionState.partialTakeProfitExecuted = true;
      return exitDecision({
        packet: input.packet,
        candidate: input.candidate,
        reason: "take_profit",
        sizing: {
          sellRatio:
            input.policy.takeProfitSellRatio ?? DEFAULT_TAKE_PROFIT_SELL_RATIO
        },
        thesis: `Paper-only partial take-profit exit triggered at ${formatRatio(
          unrealizedReturnRatio
        )} unrealized return.`
      });
    }

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
    "sellAll" | "sellRatio" | "targetWeightPct"
  >;
  thesis: string;
}): VirtualDecisionItem {
  const dataRefs = candidateDecisionDataRefs(input.candidate).slice(0, 5);
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

function normalizeTakeProfitMode(value: TakeProfitMode | undefined): TakeProfitMode {
  if (value === undefined) {
    return DEFAULT_TAKE_PROFIT_MODE;
  }
  if (value === "full_exit" || value === "partial_then_trail") {
    return value;
  }
  throw new Error("takeProfitMode must be full_exit or partial_then_trail");
}

function updateExitPositionState(input: {
  state?: PaperExitPolicyState | undefined;
  key: string;
  currentPriceKrw: number;
}): PaperExitPolicyPositionState {
  if (input.state === undefined) {
    return {
      partialTakeProfitExecuted: false,
      peakPriceKrw: input.currentPriceKrw
    };
  }

  const existing = input.state.get(input.key);
  if (existing === undefined) {
    const created = {
      partialTakeProfitExecuted: false,
      peakPriceKrw: input.currentPriceKrw
    };
    input.state.set(input.key, created);
    return created;
  }

  existing.peakPriceKrw = Math.max(existing.peakPriceKrw, input.currentPriceKrw);
  return existing;
}

function positionKey(position: Pick<VirtualPosition, "market" | "symbol">): string {
  return `${position.market}:${position.symbol}`;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
