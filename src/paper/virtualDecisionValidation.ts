import type {
  MarketCandidate,
  MarketPacket,
  VirtualAction,
  VirtualDecision,
  VirtualDecisionItem
} from "../domain/schemas.js";

export const VIRTUAL_DECISION_VALIDATION_REJECT_CODES = [
  "VIRTUAL_DECISION_PACKET_MISMATCH",
  "VIRTUAL_DECISION_SYMBOL_NOT_IN_PACKET",
  "VIRTUAL_DECISION_ACTION_NOT_ALLOWED",
  "VIRTUAL_DECISION_DUPLICATE_SYMBOL",
  "VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE"
] as const;

export type VirtualDecisionValidationRejectCode =
  (typeof VIRTUAL_DECISION_VALIDATION_REJECT_CODES)[number];

export interface VirtualDecisionValidationIssue {
  code: VirtualDecisionValidationRejectCode;
  message: string;
  market?: string;
  symbol?: string;
  action?: VirtualAction;
  dataRef?: string;
}

export interface VirtualDecisionValidationResult {
  approved: boolean;
  rejectCodes: VirtualDecisionValidationRejectCode[];
  issues: VirtualDecisionValidationIssue[];
}

export function validateVirtualDecisionAgainstPacket(input: {
  packet: MarketPacket;
  decision: VirtualDecision;
}): VirtualDecisionValidationResult {
  const issues: VirtualDecisionValidationIssue[] = [];

  if (input.decision.packetId !== input.packet.packetId) {
    issues.push({
      code: "VIRTUAL_DECISION_PACKET_MISMATCH",
      message: `decision packetId ${input.decision.packetId} does not match packet ${input.packet.packetId}`
    });
  }

  const seenKeys = new Set<string>();

  for (const item of input.decision.decisions) {
    const key = decisionKey(item);
    if (seenKeys.has(key)) {
      issues.push({
        code: "VIRTUAL_DECISION_DUPLICATE_SYMBOL",
        message: `duplicate decision for ${key}`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }
    seenKeys.add(key);

    if (!input.packet.constraints.allowedActions.includes(item.action)) {
      issues.push({
        code: "VIRTUAL_DECISION_ACTION_NOT_ALLOWED",
        message: `${item.action} is not allowed by packet constraints`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }

    const candidate = findCandidate(input.packet, item);
    if (!candidate) {
      issues.push({
        code: "VIRTUAL_DECISION_SYMBOL_NOT_IN_PACKET",
        message: `${item.market}:${item.symbol} is not present in packet candidates`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
      continue;
    }

    for (const dataRef of item.dataRefs) {
      if (!candidate.sourceRefs.includes(dataRef)) {
        issues.push({
          code: "VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE",
          message: `${dataRef} is not a sourceRef for ${item.market}:${item.symbol}`,
          market: item.market,
          symbol: item.symbol,
          action: item.action,
          dataRef
        });
      }
    }
  }

  return {
    approved: issues.length === 0,
    rejectCodes: uniqueRejectCodes(issues),
    issues
  };
}

export function summarizeVirtualDecisionValidation(
  result: VirtualDecisionValidationResult
): string {
  return result.issues
    .map((issue) => {
      const target =
        issue.market && issue.symbol ? ` ${issue.market}:${issue.symbol}` : "";
      const dataRef = issue.dataRef ? ` dataRef=${issue.dataRef}` : "";
      return `${issue.code}${target}${dataRef}`;
    })
    .join("; ");
}

function findCandidate(
  packet: MarketPacket,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): MarketCandidate | undefined {
  return packet.candidates.find(
    (candidate) =>
      candidate.market === decision.market && candidate.symbol === decision.symbol
  );
}

function decisionKey(
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): string {
  return `${decision.market}:${decision.symbol}`;
}

function uniqueRejectCodes(
  issues: VirtualDecisionValidationIssue[]
): VirtualDecisionValidationRejectCode[] {
  return Array.from(new Set(issues.map((issue) => issue.code)));
}
