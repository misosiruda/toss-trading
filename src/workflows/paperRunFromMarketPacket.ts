import type {
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import { isFresh } from "../domain/schemas.js";
import { firstCandidateDecisionDataRef } from "../market/candidateDataRefs.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  bindDecisionIdentityMetadata,
  createStaticDecisionIdentityMetadata
} from "../paper/decisionIdentity.js";
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
  appendPaperAudit,
  runPaperDecisionPipeline,
  type DecisionProvider
} from "./paperDecisionPipeline.js";

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
          packetHash: createMarketPacketHash(packet),
          ...createStaticDecisionIdentityMetadata(),
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
    const dataRef = firstCandidateDecisionDataRef(
      candidate,
      `packet:${packet.packetId}`
    );

    return {
      attempted: false,
      decision: {
        packetId: packet.packetId,
        packetHash: createMarketPacketHash(packet),
        ...createStaticDecisionIdentityMetadata(),
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
            dataRefs: [dataRef],
            claimSupport: [
              {
                claim: "Dry-run uses the first priced stored market candidate.",
                dataRefs: [dataRef]
              }
            ],
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

  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    const decisionWithHash = this.decision.packetHash
      ? this.decision
      : {
          ...this.decision,
          packetHash: createMarketPacketHash(packet)
        };

    return {
      attempted: false,
      decision: bindDecisionIdentityMetadata(
        decisionWithHash,
        createStaticDecisionIdentityMetadata()
      ),
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
    const auditEventId = await appendPaperAudit(
      repositories.auditLog,
      "PAPER_MARKET_PACKET_RUN_FAILED",
      "No stored market packet is available",
      now
    );
    return failedResult(null, "missing_market_packet", [auditEventId], now);
  }

  if (!isFresh(packet.expiresAt, now)) {
    const auditEventId = await appendPaperAudit(
      repositories.auditLog,
      "PAPER_MARKET_PACKET_RUN_FAILED",
      `Stored market packet is stale: ${packet.packetId}`,
      now
    );
    return failedResult(packet.packetId, "stale_market_packet", [auditEventId], now);
  }

  auditEventIds.push(
    await appendPaperAudit(
      repositories.auditLog,
      "MARKET_PACKET_SELECTED",
      `Selected stored paper-only market packet ${packet.packetId}`,
      now
    )
  );

  const pipelineResult = await runPaperDecisionPipeline({
    packet,
    portfolio: clonePortfolio(packet.virtualPortfolio),
    provider: options.provider,
    repositories,
    now,
    recordedDecisionSummary: (decisionCount) =>
      `Recorded ${decisionCount} paper-only decision(s) from stored market packet`
  });
  auditEventIds.push(...pipelineResult.auditEventIds);

  if (pipelineResult.status === "failed") {
    return failedResult(
      packet.packetId,
      pipelineResult.failure?.failureReason ?? "paper_decision_pipeline_failed",
      auditEventIds,
      now
    );
  }

  return {
    status: "completed",
    report: buildReport({
      packet,
      tradeCount: pipelineResult.tradeCount,
      rejectedCount: pipelineResult.rejectedCount,
      statusLine: "Stored market packet paper trading run completed."
    }),
    packetId: packet.packetId,
    tradeCount: pipelineResult.tradeCount,
    rejectedCount: pipelineResult.rejectedCount,
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
