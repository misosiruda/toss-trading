import type {
  AuditEvent,
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";
import { virtualPortfolioSchema } from "../domain/schemas.js";
import { isDeepStrictEqual } from "node:util";
import { VirtualPortfolioStateChangedError } from "../storage/virtualPortfolioFileStore.js";
import { withPaperExecutionLogBatch } from "../storage/paperExecutionLogLocks.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import { preparePaperApplication, type PreparedPaperApplication } from "../paper/preparedApplication.js";
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
  | { kind: "portfolio"; failureReason: "portfolio_state_changed"; summary: string }
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
  const portfolio = virtualPortfolioSchema.parse(options.portfolio);
  const expectedSnapshot = await options.repositories.portfolioStore.readSnapshot();
  const expectedStoredPortfolio = expectedSnapshot.portfolio;
  const stateChanged = async (): Promise<PaperDecisionPipelineResult> => {
    const summary = "Paper portfolio changed; build a new market packet before retrying.";
    auditEventIds.push(await appendPaperAudit(options.repositories.auditLog, "PAPER_PORTFOLIO_STATE_CHANGED", summary, options.now));
    return failedPipelineResult({ auditEventIds, portfolio,
      failure: { kind: "portfolio", failureReason: "portfolio_state_changed", summary } });
  };
  if ((expectedStoredPortfolio !== null && !isDeepStrictEqual(expectedStoredPortfolio, portfolio)) ||
    !isDeepStrictEqual(portfolio, options.packet.virtualPortfolio)) return stateChanged();
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

  const providerDecision = decisionResult.decision;

  try {
    const repositories = options.repositories;
    return await withPaperExecutionLogBatch([repositories.auditLog.filePath, repositories.decisionStore.filePath, repositories.tradeStore.filePath],
      () => repositories.portfolioStore.withPreparedApplication(expectedSnapshot,
      () => preparePaperApplication({ expectedSnapshot, packet: options.packet, providerDecision,
        evaluatedAt: options.now.toISOString(), decisionSummary: options.recordedDecisionSummary?.(providerDecision.decisions.length) ??
          `Recorded ${providerDecision.decisions.length} paper-only decision(s)` }),
      (application) => applyPreparedApplication(repositories, application, auditEventIds)));
  } catch (error) {
    if (error instanceof VirtualPortfolioStateChangedError) return stateChanged();
    throw error;
  }
}

async function applyPreparedApplication(repositories: PaperDecisionPipelineRepositories,
  application: PreparedPaperApplication, auditEventIds: string[]): Promise<PaperDecisionPipelineResult> {
  await repositories.decisionStore.append(application.decision);
  let auditIndex = 0;
  const appendNextAudit = async () => {
    const event = application.auditEvents[auditIndex++]!;
    await repositories.auditLog.append(event); auditEventIds.push(event.eventId);
  };
  await appendNextAudit();
  let tradeCount = 0;
  let rejectedCount = 0;
  for (const step of application.steps) {
    if (!step.riskDecision.approved) rejectedCount += 1;
    await appendNextAudit();
    if (step.trade) {
      await repositories.tradeStore.append(step.trade); tradeCount += 1;
      await appendNextAudit();
    }
  }

  return {
    status: "completed",
    tradeCount,
    rejectedCount,
    auditEventIds,
    portfolio: application.portfolio,
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
