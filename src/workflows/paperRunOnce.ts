import type {
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  createMockMarketPacket,
  type MarketPacketBuildResult
} from "../market/packetBuilder.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  bindDecisionIdentityMetadata,
  createStaticDecisionIdentityMetadata
} from "../paper/decisionIdentity.js";
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
import {
  appendPaperAudit,
  runPaperDecisionPipeline,
  type DecisionProvider
} from "./paperDecisionPipeline.js";

export type { DecisionProvider } from "./paperDecisionPipeline.js";

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

  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    return {
      attempted: false,
      decision: bindStaticDecisionDefaults(this.decision, packet),
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

function bindStaticDecisionDefaults(
  decision: VirtualDecision,
  packet: MarketPacket
): VirtualDecision {
  const decisionWithHash = decision.packetHash
    ? decision
    : {
        ...decision,
        packetHash: createMarketPacketHash(packet)
      };
  return bindDecisionIdentityMetadata(
    decisionWithHash,
    createStaticDecisionIdentityMetadata()
  );
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
    await appendPaperAudit(
      repositories.auditLog,
      "MARKET_PACKET_CREATED",
      `Created paper-only market packet ${packetResult.packet.packetId}`,
      now
    )
  );

  for (const warning of packetResult.warnings) {
    auditEventIds.push(
      await appendPaperAudit(
        repositories.auditLog,
        "MARKET_PACKET_WARNING",
        warning,
        now
      )
    );
  }

  const pipelineResult = await runPaperDecisionPipeline({
    packet: packetResult.packet,
    portfolio,
    provider: options.provider,
    repositories,
    now
  });
  auditEventIds.push(...pipelineResult.auditEventIds);

  if (pipelineResult.status === "failed") {
    return {
      status: "failed",
      report: buildReport(
        packetResult,
        0,
        pipelineResult.failure?.kind === "validation"
          ? "AI decision rejected by semantic validation; no paper order was created."
          : "AI decision failed; no paper order was created."
      ),
      packetId: packetResult.packet.packetId,
      tradeCount: 0,
      auditEventIds
    };
  }

  return {
    status: "completed",
    report: buildReport(
      packetResult,
      pipelineResult.tradeCount,
      "Paper trading run completed."
    ),
    packetId: packetResult.packet.packetId,
    tradeCount: pipelineResult.tradeCount,
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
