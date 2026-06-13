import {
  assertFresh,
  type MarketCandidate,
  type MarketPacket,
  type VirtualDecisionItem,
  type VirtualPortfolio,
  type VirtualRiskDecision
} from "../domain/schemas.js";
import { normalizeVirtualDecision } from "./decisionNormalizer.js";
import { isSellAllDustClose } from "./dustPosition.js";
import {
  appendVirtualRiskRejectCode,
  createVirtualRiskPolicy,
  isVirtualRiskCooldownActive,
  minimumCashReserveKrw,
  normalizeVirtualRiskRejectCodes,
  virtualNetWorthKrw,
  VIRTUAL_RISK_RULE_IDS,
  type VirtualRiskPolicy,
  type VirtualRiskRejectCode
} from "./riskPolicy.js";

export type { VirtualRiskPolicy } from "./riskPolicy.js";

export interface VirtualRiskInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
  policy?: Partial<VirtualRiskPolicy>;
}

export class VirtualRiskEngine {
  evaluate(input: VirtualRiskInput): VirtualRiskDecision {
    const policy = createVirtualRiskPolicy({
      maxBudgetPerSymbolKrw: input.packet.constraints.maxBudgetPerSymbolKrw,
      policy: input.policy
    });
    const rejectCodes: VirtualRiskRejectCode[] = [];
    const checkedRules = [...VIRTUAL_RISK_RULE_IDS];

    if (!isFresh(input.packet.expiresAt, policy.now)) {
      appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_PACKET_STALE");
    }

    if (!isFresh(input.decision.expiresAt, policy.now)) {
      appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_DECISION_STALE");
    }

    const candidate = findCandidate(input.packet, input.decision);
    if (!candidate) {
      appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_CANDIDATE_NOT_FOUND");
    }

    if (input.decision.action !== "VIRTUAL_HOLD" && !candidate?.lastPriceKrw) {
      appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_PRICE_MISSING");
    }

    if (isVirtualRiskCooldownActive(input.decision, policy)) {
      appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_COOLDOWN_ACTIVE");
    }

    if (input.decision.action === "VIRTUAL_BUY") {
      const notionalKrw = normalizeVirtualDecision(input).targetNotionalKrw;
      if (notionalKrw > input.portfolio.cashKrw) {
        appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_CASH_EXCEEDED");
      }

      if (
        input.portfolio.cashKrw - notionalKrw <
        minimumCashReserveKrw(input.portfolio, policy)
      ) {
        appendVirtualRiskRejectCode(
          rejectCodes,
          "VIRTUAL_CASH_RESERVE_BREACHED"
        );
      }

      if (notionalKrw > policy.maxBudgetPerDecisionKrw) {
        appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_BUDGET_EXCEEDED");
      }

      const currentExposure = currentSymbolExposureKrw(
        input.portfolio,
        input.decision
      );
      if (currentExposure + notionalKrw > policy.maxSymbolExposureKrw) {
        appendVirtualRiskRejectCode(
          rejectCodes,
          "VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED"
        );
      }

      const netWorthKrw = virtualNetWorthKrw(input.portfolio);
      if (
        netWorthKrw > 0 &&
        (currentExposure + notionalKrw) / netWorthKrw >
          policy.maxPositionWeightRatio
      ) {
        appendVirtualRiskRejectCode(
          rejectCodes,
          "VIRTUAL_POSITION_WEIGHT_EXCEEDED"
        );
      }
    }

    if (input.decision.action === "VIRTUAL_SELL") {
      const position = input.portfolio.positions.find(
        (item) =>
          item.market === input.decision.market &&
          item.symbol === input.decision.symbol
      );
      const notionalKrw = normalizeVirtualDecision(input).targetNotionalKrw;
      if (!position) {
        appendVirtualRiskRejectCode(rejectCodes, "VIRTUAL_POSITION_NOT_FOUND");
      } else if (
        notionalKrw <= 0 &&
        !isSellAllDustClose({
          decision: input.decision,
          position,
          priceKrw: candidate?.lastPriceKrw
        })
      ) {
        appendVirtualRiskRejectCode(
          rejectCodes,
          "VIRTUAL_SELL_AMOUNT_REQUIRED"
        );
      } else if (candidate?.lastPriceKrw) {
        const positionValue = Math.round(position.quantity * candidate.lastPriceKrw);
        if (notionalKrw > positionValue) {
          appendVirtualRiskRejectCode(
            rejectCodes,
            "VIRTUAL_SELL_AMOUNT_EXCEEDED"
          );
        }
      }
    }

    return {
      riskDecisionId: `vrisk_${input.packet.packetId}_${input.decision.symbol}`,
      packetId: input.packet.packetId,
      symbol: input.decision.symbol,
      approved: rejectCodes.length === 0,
      rejectCodes: normalizeVirtualRiskRejectCodes(rejectCodes),
      checkedRules,
      createdAt: policy.now.toISOString()
    };
  }
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
