import type {
  AuditEvent,
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import { bindVirtualDecisionConfidenceBreakdown } from "../paper/decisionConfidence.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
import {
  summarizeVirtualDecisionValidation,
  validateVirtualDecisionAgainstPacket,
  type VirtualDecisionValidationResult
} from "../paper/virtualDecisionValidation.js";
import type {
  FileAuditLog,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";

export interface DecisionProvider {
  decide(packet: MarketPacket): Promise<CodexCliDecisionResult>;
}

export interface PaperDecisionPipelineRepositories {
  auditLog: FileAuditLog;
  portfolioStore: FileVirtualPortfolioStore;
  decisionStore: FileVirtualDecisionStore;
  tradeStore: FileVirtualTradeStore;
}

export interface PaperDecisionPipelineOptions {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  provider: DecisionProvider;
  repositories: PaperDecisionPipelineRepositories;
  now: Date;
  recordedDecisionSummary?: (decisionCount: number) => string;
}

export type PaperDecisionPipelineFailure =
  | {
      kind: "provider";
      failureReason: string;
      summary: string;
    }
  | {
      kind: "validation";
      failureReason: string;
      summary: string;
      validation: VirtualDecisionValidationResult;
    };

export interface PaperDecisionPipelineResult {
  status: "completed" | "failed";
  tradeCount: number;
  rejectedCount: number;
  auditEventIds: string[];
  portfolio: VirtualPortfolio;
  failure: PaperDecisionPipelineFailure | null;
}

export async function runPaperDecisionPipeline(
  options: PaperDecisionPipelineOptions
): Promise<PaperDecisionPipelineResult> {
  const auditEventIds: string[] = [];
  const decisionResult = await options.provider.decide(options.packet);

  if (decisionResult.failure || !decisionResult.decision) {
    const summary =
      decisionResult.failure?.reason ?? "provider returned no decision";
    const failureReason =
      decisionResult.failure?.code ?? "ai_decision_missing";
    auditEventIds.push(
      await appendPaperAudit(
        options.repositories.auditLog,
        "AI_DECISION_FAILED",
        summary,
        options.now
      )
    );
    return failedPipelineResult({
      auditEventIds,
      portfolio: options.portfolio,
      failure: {
        kind: "provider",
        failureReason,
        summary
      }
    });
  }

  const validation = validateVirtualDecisionAgainstPacket({
    packet: options.packet,
    decision: decisionResult.decision
  });

  if (!validation.approved) {
    const summary = summarizeVirtualDecisionValidation(validation);
    auditEventIds.push(
      await appendPaperAudit(
        options.repositories.auditLog,
        "VIRTUAL_DECISION_REJECTED",
        summary,
        options.now
      )
    );
    return failedPipelineResult({
      auditEventIds,
      portfolio: options.portfolio,
      failure: {
        kind: "validation",
        failureReason: validationFailureReason(validation),
        summary,
        validation
      }
    });
  }

  const recordedDecision = bindVirtualDecisionConfidenceBreakdown({
    decision: decisionResult.decision,
    packet: options.packet
  });

  await options.repositories.decisionStore.append(recordedDecision);
  auditEventIds.push(
    await appendPaperAudit(
      options.repositories.auditLog,
      "VIRTUAL_DECISION_RECORDED",
      options.recordedDecisionSummary?.(recordedDecision.decisions.length) ??
        `Recorded ${recordedDecision.decisions.length} paper-only decision(s)`,
      options.now
    )
  );

  let currentPortfolio = options.portfolio;
  let tradeCount = 0;
  let rejectedCount = 0;
  const engine = new PaperOrderEngine();

  for (const decision of recordedDecision.decisions) {
    const result = engine.execute({
      packet: options.packet,
      portfolio: currentPortfolio,
      decision,
      riskPolicy: { now: options.now }
    });
    currentPortfolio = result.portfolio;

    if (!result.riskDecision.approved) {
      rejectedCount += 1;
    }

    auditEventIds.push(
      await appendPaperAudit(
        options.repositories.auditLog,
        result.riskDecision.approved
          ? "VIRTUAL_RISK_APPROVED"
          : "VIRTUAL_RISK_REJECTED",
        `${decision.market}:${decision.symbol} ${decision.action}`,
        options.now
      )
    );

    if (result.trade) {
      await options.repositories.tradeStore.append(result.trade);
      tradeCount += 1;
      auditEventIds.push(
        await appendPaperAudit(
          options.repositories.auditLog,
          "PAPER_ORDER_FILLED",
          `${result.trade.market}:${result.trade.symbol} ${result.trade.action}`,
          options.now
        )
      );
    }
  }

  await options.repositories.portfolioStore.write(currentPortfolio);

  return {
    status: "completed",
    tradeCount,
    rejectedCount,
    auditEventIds,
    portfolio: currentPortfolio,
    failure: null
  };
}

export async function appendPaperAudit(
  auditLog: FileAuditLog,
  eventType: string,
  summary: string,
  now: Date
): Promise<string> {
  const eventId = `audit_${eventType.toLowerCase()}_${now.getTime()}`;
  const event: AuditEvent = {
    eventId,
    eventType,
    actor: "system",
    summary,
    maskedRefs: [],
    createdAt: now.toISOString()
  };
  await auditLog.append(event);
  return eventId;
}

export function validationFailureReason(
  validation: VirtualDecisionValidationResult
): string {
  return validation.rejectCodes.includes("VIRTUAL_DECISION_PACKET_MISMATCH")
    ? "decision_packet_mismatch"
    : "virtual_decision_semantic_invalid";
}

function failedPipelineResult(input: {
  auditEventIds: string[];
  portfolio: VirtualPortfolio;
  failure: PaperDecisionPipelineFailure;
}): PaperDecisionPipelineResult {
  return {
    status: "failed",
    tradeCount: 0,
    rejectedCount: 0,
    auditEventIds: input.auditEventIds,
    portfolio: input.portfolio,
    failure: input.failure
  };
}
