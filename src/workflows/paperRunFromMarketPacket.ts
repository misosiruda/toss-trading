import type {
  AuditEvent,
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import { isFresh } from "../domain/schemas.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore,
  type StoragePaths
} from "../storage/repositories.js";
import type {
  CodexCliDecisionFailure,
  CodexCliDecisionResult
} from "../ai/codexCliDecisionProvider.js";
import {
  summarizeVirtualDecisionValidation,
  validateVirtualDecisionAgainstPacket,
  type VirtualDecisionValidationResult
} from "../paper/virtualDecisionValidation.js";
import type { DecisionProvider } from "./paperRunOnce.js";

export interface PaperRunFromMarketPacketOptions {
  storageBaseDir: string;
  provider: DecisionProvider;
  now?: Date;
}

export interface PaperRunFromMarketPacketResult {
  status: "completed" | "failed";
  report: string;
  packetId: string | null;
  tradeCount: number;
  rejectedCount: number;
  auditEventIds: string[];
  failureReason: string | null;
}

export class MarketPacketDryRunDecisionProvider implements DecisionProvider {
  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    const candidate = packet.candidates.find(
      (item) => item.lastPriceKrw !== undefined
    );

    if (!candidate) {
      return {
        attempted: false,
        decision: {
          packetId: packet.packetId,
          summary: "Dry-run paper-only hold because no priced candidate exists.",
          decisions: []
        },
        failure: null,
        command: null
      };
    }

    const budgetKrw = Math.min(
      packet.constraints.maxBudgetPerSymbolKrw,
      Math.max(candidate.lastPriceKrw ?? 0, 1)
    );

    return {
      attempted: false,
      decision: {
        packetId: packet.packetId,
        summary: "Dry-run paper-only decision from stored market packet.",
        decisions: [
          {
            market: candidate.market,
            symbol: candidate.symbol,
            action: "VIRTUAL_BUY",
            confidence: 0.6,
            budgetKrw,
            thesis: "Dry-run uses the first priced stored market candidate.",
            riskFactors: ["Dry-run paper simulation can diverge from live markets."],
            dataRefs: [candidate.sourceRefs[0] ?? `packet:${packet.packetId}`],
            expiresAt: packet.expiresAt
          }
        ]
      },
      failure: null,
      command: null
    };
  }
}

export class StaticMarketPacketDecisionProvider implements DecisionProvider {
  constructor(private readonly decision: VirtualDecision) {}

  async decide(): Promise<CodexCliDecisionResult> {
    return {
      attempted: false,
      decision: this.decision,
      failure: null,
      command: null
    };
  }
}

export class FailingMarketPacketDecisionProvider implements DecisionProvider {
  constructor(private readonly failure: CodexCliDecisionFailure) {}

  async decide(): Promise<CodexCliDecisionResult> {
    return {
      attempted: false,
      decision: null,
      failure: this.failure,
      command: null
    };
  }
}

export async function runPaperDecisionFromLatestMarketPacket(
  options: PaperRunFromMarketPacketOptions
): Promise<PaperRunFromMarketPacketResult> {
  const now = options.now ?? new Date();
  const paths = createStoragePaths(options.storageBaseDir);
  const repositories = createRepositories(paths);
  const auditEventIds: string[] = [];
  const packets = await repositories.packetStore.readAll();
  const packet = packets.records.at(-1) ?? null;

  if (!packet) {
    const auditEventId = await appendAudit(
      repositories.auditLog,
      "PAPER_MARKET_PACKET_RUN_FAILED",
      "No stored market packet is available",
      now
    );
    return failedResult(null, "missing_market_packet", [auditEventId], now);
  }

  if (!isFresh(packet.expiresAt, now)) {
    const auditEventId = await appendAudit(
      repositories.auditLog,
      "PAPER_MARKET_PACKET_RUN_FAILED",
      `Stored market packet is stale: ${packet.packetId}`,
      now
    );
    return failedResult(packet.packetId, "stale_market_packet", [auditEventId], now);
  }

  auditEventIds.push(
    await appendAudit(
      repositories.auditLog,
      "MARKET_PACKET_SELECTED",
      `Selected stored paper-only market packet ${packet.packetId}`,
      now
    )
  );

  const decisionResult = await options.provider.decide(packet);
  if (decisionResult.failure || !decisionResult.decision) {
    auditEventIds.push(
      await appendAudit(
        repositories.auditLog,
        "AI_DECISION_FAILED",
        decisionResult.failure?.reason ?? "provider returned no decision",
        now
      )
    );
    return failedResult(
      packet.packetId,
      decisionResult.failure?.code ?? "ai_decision_missing",
      auditEventIds,
      now
    );
  }

  const validation = validateVirtualDecisionAgainstPacket({
    packet,
    decision: decisionResult.decision
  });
  if (!validation.approved) {
    auditEventIds.push(
      await appendAudit(
        repositories.auditLog,
        "VIRTUAL_DECISION_REJECTED",
        summarizeVirtualDecisionValidation(validation),
        now
      )
    );
    return failedResult(
      packet.packetId,
      validationFailureReason(validation),
      auditEventIds,
      now
    );
  }

  await repositories.decisionStore.append(decisionResult.decision);
  auditEventIds.push(
    await appendAudit(
      repositories.auditLog,
      "VIRTUAL_DECISION_RECORDED",
      `Recorded ${decisionResult.decision.decisions.length} paper-only decision(s) from stored market packet`,
      now
    )
  );

  let currentPortfolio = clonePortfolio(packet.virtualPortfolio);
  let tradeCount = 0;
  let rejectedCount = 0;
  const engine = new PaperOrderEngine();

  for (const decision of decisionResult.decision.decisions) {
    const result = engine.execute({
      packet,
      portfolio: currentPortfolio,
      decision,
      riskPolicy: { now }
    });
    currentPortfolio = result.portfolio;

    if (!result.riskDecision.approved) {
      rejectedCount += 1;
    }

    auditEventIds.push(
      await appendAudit(
        repositories.auditLog,
        result.riskDecision.approved
          ? "VIRTUAL_RISK_APPROVED"
          : "VIRTUAL_RISK_REJECTED",
        `${decision.market}:${decision.symbol} ${decision.action}`,
        now
      )
    );

    if (result.trade) {
      await repositories.tradeStore.append(result.trade);
      tradeCount += 1;
      auditEventIds.push(
        await appendAudit(
          repositories.auditLog,
          "PAPER_ORDER_FILLED",
          `${result.trade.market}:${result.trade.symbol} ${result.trade.action}`,
          now
        )
      );
    }
  }

  await repositories.portfolioStore.write(currentPortfolio);

  return {
    status: "completed",
    report: buildReport({
      packet,
      tradeCount,
      rejectedCount,
      statusLine: "Stored market packet paper trading run completed."
    }),
    packetId: packet.packetId,
    tradeCount,
    rejectedCount,
    auditEventIds,
    failureReason: null
  };
}

function createRepositories(paths: StoragePaths) {
  return {
    auditLog: new FileAuditLog(paths.auditLogPath),
    packetStore: new FileMarketPacketStore(paths.marketPacketsPath),
    portfolioStore: new FileVirtualPortfolioStore(paths.virtualPortfolioPath),
    decisionStore: new FileVirtualDecisionStore(paths.virtualDecisionsPath),
    tradeStore: new FileVirtualTradeStore(paths.virtualTradesPath)
  };
}

async function appendAudit(
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

function failedResult(
  packetId: string | null,
  failureReason: string,
  auditEventIds: string[],
  now: Date
): PaperRunFromMarketPacketResult {
  return {
    status: "failed",
    report: [
      "Paper trading report",
      "Stored market packet paper trading run failed; no paper order was created.",
      `packet_id=${packetId ?? "none"}`,
      "candidate_count=0",
      "paper_trade_count=0",
      "rejected_count=0",
      `failure_reason=${failureReason}`,
      `generated_at=${now.toISOString()}`,
      "This report is for virtual portfolio simulation only and is not financial advice."
    ].join("\n"),
    packetId,
    tradeCount: 0,
    rejectedCount: 0,
    auditEventIds,
    failureReason
  };
}

function buildReport(input: {
  packet: MarketPacket;
  tradeCount: number;
  rejectedCount: number;
  statusLine: string;
}): string {
  return [
    "Paper trading report",
    input.statusLine,
    "source=stored_market_packet",
    `packet_id=${input.packet.packetId}`,
    `candidate_count=${input.packet.candidates.length}`,
    `paper_trade_count=${input.tradeCount}`,
    `rejected_count=${input.rejectedCount}`,
    "This report is for virtual portfolio simulation only and is not financial advice."
  ].join("\n");
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}

function validationFailureReason(
  validation: VirtualDecisionValidationResult
): string {
  return validation.rejectCodes.includes("VIRTUAL_DECISION_PACKET_MISMATCH")
    ? "decision_packet_mismatch"
    : "virtual_decision_semantic_invalid";
}
