import {
  assertFresh,
  type MarketCandidate,
  type MarketPacket,
  type VirtualDecisionItem,
  type VirtualPortfolio,
  type VirtualRiskDecision
} from "../domain/schemas.js";
import {
  evaluateVirtualBuyRiskBranch,
  evaluateVirtualSellRiskBranch
} from "./riskBranches.js";
import {
  appendVirtualRiskRejectCode,
  createVirtualRiskPolicy,
  isVirtualRiskCooldownActive,
  normalizeVirtualRiskRejectCodes,
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
      appendBranchRejectCodes(
        rejectCodes,
        evaluateVirtualBuyRiskBranch({
          packet: input.packet,
          portfolio: input.portfolio,
          decision: input.decision,
          policy,
          candidate
        })
      );
    }

    if (input.decision.action === "VIRTUAL_SELL") {
      appendBranchRejectCodes(
        rejectCodes,
        evaluateVirtualSellRiskBranch({
          packet: input.packet,
          portfolio: input.portfolio,
          decision: input.decision,
          policy,
          candidate
        })
      );
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

function appendBranchRejectCodes(
  target: VirtualRiskRejectCode[],
  codes: VirtualRiskRejectCode[]
): void {
  for (const code of codes) {
    appendVirtualRiskRejectCode(target, code);
  }
}
