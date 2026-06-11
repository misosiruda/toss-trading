import type {
  AuditEvent,
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  createMockMarketPacket,
  type MarketPacketBuildResult
} from "../market/packetBuilder.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore,
  type StoragePaths
} from "../storage/repositories.js";
import type {
  CodexCliDecisionFailure,
  CodexCliDecisionResult
} from "../ai/codexCliDecisionProvider.js";

export interface DecisionProvider {
  decide(packet: MarketPacket): Promise<CodexCliDecisionResult>;
}

export interface PaperRunOnceOptions {
  storageBaseDir: string;
  provider: DecisionProvider;
  now?: Date;
  initialCashKrw?: number;
}

export interface PaperRunOnceResult {
  status: "completed" | "failed";
  report: string;
  packetId: string;
  tradeCount: number;
  auditEventIds: string[];
}

export class StaticDecisionProvider implements DecisionProvider {
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

export class FailingDecisionProvider implements DecisionProvider {
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

export async function runPaperDecisionOnce(
  options: PaperRunOnceOptions
): Promise<PaperRunOnceResult> {
  const now = options.now ?? new Date();
  const paths = createStoragePaths(options.storageBaseDir);
  const repositories = createRepositories(paths);
  const portfolio =
    (await repositories.portfolioStore.read()) ??
    createInitialPortfolio(options.initialCashKrw ?? 1_000_000, now);
  const packetResult = createMockMarketPacket({ portfolio, now });
  const auditEventIds: string[] = [];

  auditEventIds.push(
    await appendAudit(
      repositories.auditLog,
      "MARKET_PACKET_CREATED",
      `Created paper-only market packet ${packetResult.packet.packetId}`,
      now
    )
  );

  for (const warning of packetResult.warnings) {
    auditEventIds.push(
      await appendAudit(repositories.auditLog, "MARKET_PACKET_WARNING", warning, now)
    );
  }

  const decisionResult = await options.provider.decide(packetResult.packet);
  if (decisionResult.failure || !decisionResult.decision) {
    auditEventIds.push(
      await appendAudit(
        repositories.auditLog,
        "AI_DECISION_FAILED",
        decisionResult.failure?.reason ?? "provider returned no decision",
        now
      )
    );
    return {
      status: "failed",
      report: buildReport(packetResult, 0, "AI decision failed; no paper order was created."),
      packetId: packetResult.packet.packetId,
      tradeCount: 0,
      auditEventIds
    };
  }

  await repositories.decisionStore.append(decisionResult.decision);
  auditEventIds.push(
    await appendAudit(
      repositories.auditLog,
      "VIRTUAL_DECISION_RECORDED",
      `Recorded ${decisionResult.decision.decisions.length} paper-only decision(s)`,
      now
    )
  );

  let currentPortfolio = portfolio;
  let tradeCount = 0;
  const engine = new PaperOrderEngine();

  for (const decision of decisionResult.decision.decisions) {
    const result = engine.execute({
      packet: packetResult.packet,
      portfolio: currentPortfolio,
      decision,
      riskPolicy: { now }
    });
    currentPortfolio = result.portfolio;

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
    report: buildReport(packetResult, tradeCount, "Paper trading run completed."),
    packetId: packetResult.packet.packetId,
    tradeCount,
    auditEventIds
  };
}

function createRepositories(paths: StoragePaths) {
  return {
    auditLog: new FileAuditLog(paths.auditLogPath),
    portfolioStore: new FileVirtualPortfolioStore(paths.virtualPortfolioPath),
    decisionStore: new FileVirtualDecisionStore(paths.virtualDecisionsPath),
    tradeStore: new FileVirtualTradeStore(paths.virtualTradesPath)
  };
}

function createInitialPortfolio(
  cashKrw: number,
  now: Date
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw,
    positions: [],
    updatedAt: now.toISOString()
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

function buildReport(
  packetResult: MarketPacketBuildResult,
  tradeCount: number,
  statusLine: string
): string {
  return [
    "Paper trading report",
    statusLine,
    `packet_id=${packetResult.packet.packetId}`,
    `candidate_count=${packetResult.packet.candidates.length}`,
    `paper_trade_count=${tradeCount}`,
    "This report is for virtual portfolio simulation only and is not financial advice."
  ].join("\n");
}
