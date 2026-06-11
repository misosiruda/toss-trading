import {
  assertFresh,
  type MarketCandidate,
  type MarketPacket,
  type VirtualDecisionItem,
  type VirtualPortfolio,
  type VirtualRiskDecision
} from "../domain/schemas.js";

export interface VirtualRiskPolicy {
  maxBudgetPerDecisionKrw: number;
  maxSymbolExposureKrw: number;
  now: Date;
}

export interface VirtualRiskInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
  policy?: Partial<VirtualRiskPolicy>;
}

export class VirtualRiskEngine {
  evaluate(input: VirtualRiskInput): VirtualRiskDecision {
    const policy = createVirtualRiskPolicy(input);
    const rejectCodes: string[] = [];
    const checkedRules = [
      "packet_freshness",
      "decision_freshness",
      "candidate_presence",
      "candidate_price",
      "cash_limit",
      "budget_limit",
      "symbol_exposure",
      "sell_position"
    ];

    if (!isFresh(input.packet.expiresAt, policy.now)) {
      rejectCodes.push("VIRTUAL_PACKET_STALE");
    }

    if (!isFresh(input.decision.expiresAt, policy.now)) {
      rejectCodes.push("VIRTUAL_DECISION_STALE");
    }

    const candidate = findCandidate(input.packet, input.decision);
    if (!candidate) {
      rejectCodes.push("VIRTUAL_CANDIDATE_NOT_FOUND");
    }

    if (input.decision.action !== "VIRTUAL_HOLD" && !candidate?.lastPriceKrw) {
      rejectCodes.push("VIRTUAL_PRICE_MISSING");
    }

    if (input.decision.action === "VIRTUAL_BUY") {
      if (input.decision.budgetKrw > input.portfolio.cashKrw) {
        rejectCodes.push("VIRTUAL_CASH_EXCEEDED");
      }

      if (input.decision.budgetKrw > policy.maxBudgetPerDecisionKrw) {
        rejectCodes.push("VIRTUAL_BUDGET_EXCEEDED");
      }

      const currentExposure = currentSymbolExposureKrw(
        input.portfolio,
        input.decision
      );
      if (
        currentExposure + input.decision.budgetKrw >
        policy.maxSymbolExposureKrw
      ) {
        rejectCodes.push("VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED");
      }
    }

    if (input.decision.action === "VIRTUAL_SELL") {
      const position = input.portfolio.positions.find(
        (item) =>
          item.market === input.decision.market &&
          item.symbol === input.decision.symbol
      );
      if (!position) {
        rejectCodes.push("VIRTUAL_POSITION_NOT_FOUND");
      } else if (input.decision.budgetKrw <= 0) {
        rejectCodes.push("VIRTUAL_SELL_AMOUNT_REQUIRED");
      } else if (candidate?.lastPriceKrw) {
        const positionValue = Math.round(position.quantity * candidate.lastPriceKrw);
        if (input.decision.budgetKrw > positionValue) {
          rejectCodes.push("VIRTUAL_SELL_AMOUNT_EXCEEDED");
        }
      }
    }

    return {
      riskDecisionId: `vrisk_${input.packet.packetId}_${input.decision.symbol}`,
      packetId: input.packet.packetId,
      symbol: input.decision.symbol,
      approved: rejectCodes.length === 0,
      rejectCodes,
      checkedRules,
      createdAt: policy.now.toISOString()
    };
  }
}

function createVirtualRiskPolicy(input: VirtualRiskInput): VirtualRiskPolicy {
  return {
    maxBudgetPerDecisionKrw:
      input.policy?.maxBudgetPerDecisionKrw ??
      input.packet.constraints.maxBudgetPerSymbolKrw,
    maxSymbolExposureKrw:
      input.policy?.maxSymbolExposureKrw ??
      input.packet.constraints.maxBudgetPerSymbolKrw,
    now: input.policy?.now ?? new Date()
  };
}

function isFresh(expiresAt: string, now: Date): boolean {
  try {
    assertFresh(expiresAt, now);
    return true;
  } catch {
    return false;
  }
}

export function findCandidate(
  packet: MarketPacket,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): MarketCandidate | undefined {
  return packet.candidates.find(
    (candidate) =>
      candidate.market === decision.market && candidate.symbol === decision.symbol
  );
}

function currentSymbolExposureKrw(
  portfolio: VirtualPortfolio,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): number {
  const position = portfolio.positions.find(
    (item) => item.market === decision.market && item.symbol === decision.symbol
  );
  if (!position) {
    return 0;
  }

  return position.marketValueKrw ?? Math.round(position.quantity * position.averagePriceKrw);
}
