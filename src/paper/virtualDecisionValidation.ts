import type {
  MarketCandidate,
  MarketPacket,
  VirtualAction,
  VirtualDecision,
  VirtualDecisionItem
} from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { missingDecisionIdentityFields } from "./decisionIdentity.js";

export const VIRTUAL_DECISION_VALIDATION_REJECT_CODES = [
  "VIRTUAL_DECISION_PACKET_MISMATCH",
  "VIRTUAL_DECISION_PACKET_HASH_REQUIRED",
  "VIRTUAL_DECISION_PACKET_HASH_MISMATCH",
  "VIRTUAL_DECISION_HASH_NOT_ALLOWED",
  "VIRTUAL_DECISION_IDENTITY_METADATA_REQUIRED",
  "VIRTUAL_DECISION_SYMBOL_NOT_IN_PACKET",
  "VIRTUAL_DECISION_ACTION_NOT_ALLOWED",
  "VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE",
  "VIRTUAL_DECISION_DUPLICATE_SYMBOL",
  "VIRTUAL_DECISION_DATA_REF_NOT_IN_CANDIDATE",
  "VIRTUAL_DECISION_FEATURE_REF_NOT_IN_CANDIDATE",
  "VIRTUAL_DECISION_CLAIM_SUPPORT_REQUIRED",
  "VIRTUAL_DECISION_CLAIM_SUPPORT_DATA_REF_NOT_IN_CANDIDATE",
  "VIRTUAL_DECISION_CLAIM_SUPPORT_FEATURE_REF_NOT_IN_CANDIDATE",
  "VIRTUAL_DECISION_CONFIDENCE_BREAKDOWN_NOT_ALLOWED",
  "VIRTUAL_DECISION_HOLD_REASON_REQUIRED",
  "VIRTUAL_DECISION_HOLD_REASON_NOT_ALLOWED"
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
  featureRef?: string;
  claim?: string;
  metadataField?: string;
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

  const expectedPacketHash = createMarketPacketHash(input.packet);
  if (!input.decision.packetHash) {
    issues.push({
      code: "VIRTUAL_DECISION_PACKET_HASH_REQUIRED",
      message: "decision must include packetHash"
    });
  } else if (input.decision.packetHash !== expectedPacketHash) {
    issues.push({
      code: "VIRTUAL_DECISION_PACKET_HASH_MISMATCH",
      message: `decision packetHash ${input.decision.packetHash} does not match ${expectedPacketHash}`
    });
  }

  if (input.decision.decisionHash) {
    issues.push({
      code: "VIRTUAL_DECISION_HASH_NOT_ALLOWED",
      message: "decisionHash is backend-generated and must not be supplied"
    });
  }

  for (const field of missingDecisionIdentityFields(input.decision)) {
    issues.push({
      code: "VIRTUAL_DECISION_IDENTITY_METADATA_REQUIRED",
      message: `decision must include ${field}`,
      metadataField: field
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

    if (item.confidenceBreakdown) {
      issues.push({
        code: "VIRTUAL_DECISION_CONFIDENCE_BREAKDOWN_NOT_ALLOWED",
        message:
          "confidenceBreakdown is backend-generated and must not be supplied",
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }

    if (!input.packet.constraints.allowedActions.includes(item.action)) {
      issues.push({
        code: "VIRTUAL_DECISION_ACTION_NOT_ALLOWED",
        message: `${item.action} is not allowed by packet constraints`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }

    if (item.action === "VIRTUAL_HOLD" && !item.holdReasonCode) {
      issues.push({
        code: "VIRTUAL_DECISION_HOLD_REASON_REQUIRED",
        message: "VIRTUAL_HOLD decisions must include holdReasonCode",
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }

    if (item.action !== "VIRTUAL_HOLD" && item.holdReasonCode) {
      issues.push({
        code: "VIRTUAL_DECISION_HOLD_REASON_NOT_ALLOWED",
        message: `${item.action} decisions must not include holdReasonCode`,
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

    if (item.action === "VIRTUAL_BUY" && candidate.buyEligible === false) {
      issues.push({
        code: "VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE",
        message: `${item.market}:${item.symbol} is not buyEligible in packet`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }

    if (item.action === "VIRTUAL_SELL" && candidate.sellEligible === false) {
      issues.push({
        code: "VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE",
        message: `${item.market}:${item.symbol} is not sellEligible in packet`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
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

    for (const featureRef of item.featureRefs ?? []) {
      if (!(candidate.featureRefs ?? []).includes(featureRef)) {
        issues.push({
          code: "VIRTUAL_DECISION_FEATURE_REF_NOT_IN_CANDIDATE",
          message: `${featureRef} is not a featureRef for ${item.market}:${item.symbol}`,
          market: item.market,
          symbol: item.symbol,
          action: item.action,
          featureRef
        });
      }
    }

    if (!item.claimSupport || item.claimSupport.length === 0) {
      issues.push({
        code: "VIRTUAL_DECISION_CLAIM_SUPPORT_REQUIRED",
        message: `${item.market}:${item.symbol} must include claimSupport`,
        market: item.market,
        symbol: item.symbol,
        action: item.action
      });
    }

    for (const claimSupport of item.claimSupport ?? []) {
      for (const dataRef of claimSupport.dataRefs ?? []) {
        if (!candidate.sourceRefs.includes(dataRef)) {
          issues.push({
            code: "VIRTUAL_DECISION_CLAIM_SUPPORT_DATA_REF_NOT_IN_CANDIDATE",
            message: `${dataRef} is not a claim support sourceRef for ${item.market}:${item.symbol}`,
            market: item.market,
            symbol: item.symbol,
            action: item.action,
            dataRef,
            claim: claimSupport.claim
          });
        }
      }

      for (const featureRef of claimSupport.featureRefs ?? []) {
        if (!(candidate.featureRefs ?? []).includes(featureRef)) {
          issues.push({
            code: "VIRTUAL_DECISION_CLAIM_SUPPORT_FEATURE_REF_NOT_IN_CANDIDATE",
            message: `${featureRef} is not a claim support featureRef for ${item.market}:${item.symbol}`,
            market: item.market,
            symbol: item.symbol,
            action: item.action,
            featureRef,
            claim: claimSupport.claim
          });
        }
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
      const featureRef = issue.featureRef
        ? ` featureRef=${issue.featureRef}`
        : "";
      const claim = issue.claim ? ` claim=${issue.claim}` : "";
      const metadataField = issue.metadataField
        ? ` metadataField=${issue.metadataField}`
        : "";
      return `${issue.code}${target}${dataRef}${featureRef}${claim}${metadataField}`;
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
