import { PAPER_DECISION_PROMPT_VERSION } from "../ai/decisionPrompt.js";
import {
  isFresh,
  type MarketPacket,
  type VirtualDecision,
  type VirtualPortfolio,
  type VirtualRiskDecision,
  type VirtualTrade
} from "../domain/schemas.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
import {
  createStoragePaths,
  FileMarketPacketStore,
  FileVirtualDecisionStore
} from "../storage/repositories.js";

export interface PaperReplayInput {
  packet: MarketPacket;
  decision: VirtualDecision;
  initialPortfolio?: VirtualPortfolio;
  now?: Date;
  promptVersion?: string;
}

export interface StoredPaperReplayOptions {
  storageBaseDir: string;
  now?: Date;
  promptVersion?: string;
}

export interface PaperReplayResult {
  status: "completed" | "failed";
  mode: "paper_only";
  packetId: string | null;
  promptVersion: string;
  replayedAt: string;
  failureReason: string | null;
  decisionItemCount: number;
  tradeCount: number;
  rejectedCount: number;
  riskDecisions: VirtualRiskDecision[];
  trades: VirtualTrade[];
  initialPortfolio: VirtualPortfolio | null;
  finalPortfolio: VirtualPortfolio | null;
}

export interface StoredPaperReplayResult extends PaperReplayResult {
  packetRecordCount: number;
  decisionRecordCount: number;
  packetCorruptLineCount: number;
  decisionCorruptLineCount: number;
}

export function replayPaperDecisions(
  input: PaperReplayInput
): PaperReplayResult {
  const now = input.now ?? new Date();
  const promptVersion = input.promptVersion ?? PAPER_DECISION_PROMPT_VERSION;
  const replayedAt = now.toISOString();

  if (input.decision.packetId !== input.packet.packetId) {
    return failedReplay({
      packetId: input.packet.packetId,
      promptVersion,
      replayedAt,
      failureReason: "packet_mismatch"
    });
  }

  if (!isFresh(input.packet.expiresAt, now)) {
    return failedReplay({
      packetId: input.packet.packetId,
      promptVersion,
      replayedAt,
      failureReason: "stale_packet"
    });
  }

  let currentPortfolio = clonePortfolio(
    input.initialPortfolio ?? input.packet.virtualPortfolio
  );
  const initialPortfolio = clonePortfolio(currentPortfolio);
  const riskDecisions: VirtualRiskDecision[] = [];
  const trades: VirtualTrade[] = [];
  const engine = new PaperOrderEngine();

  for (const decision of input.decision.decisions) {
    const result = engine.execute({
      packet: input.packet,
      portfolio: currentPortfolio,
      decision,
      riskPolicy: { now }
    });

    currentPortfolio = result.portfolio;
    riskDecisions.push(result.riskDecision);
    if (result.trade) {
      trades.push(result.trade);
    }
  }

  return {
    status: "completed",
    mode: "paper_only",
    packetId: input.packet.packetId,
    promptVersion,
    replayedAt,
    failureReason: null,
    decisionItemCount: input.decision.decisions.length,
    tradeCount: trades.length,
    rejectedCount: riskDecisions.filter((decision) => !decision.approved).length,
    riskDecisions,
    trades,
    initialPortfolio,
    finalPortfolio: currentPortfolio
  };
}

export async function runStoredPaperReplay(
  options: StoredPaperReplayOptions
): Promise<StoredPaperReplayResult> {
  const paths = createStoragePaths(options.storageBaseDir);
  const [packets, decisions] = await Promise.all([
    new FileMarketPacketStore(paths.marketPacketsPath).readAll(),
    new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll()
  ]);
  const promptVersion = options.promptVersion ?? PAPER_DECISION_PROMPT_VERSION;
  const replayedAt = (options.now ?? new Date()).toISOString();
  const appendStoreMetadata = (
    result: PaperReplayResult
  ): StoredPaperReplayResult => ({
    ...result,
    packetRecordCount: packets.records.length,
    decisionRecordCount: decisions.records.length,
    packetCorruptLineCount: packets.corruptLineCount,
    decisionCorruptLineCount: decisions.corruptLineCount
  });

  const packet = packets.records.at(-1);
  if (!packet) {
    return appendStoreMetadata(
      failedReplay({
        packetId: null,
        promptVersion,
        replayedAt,
        failureReason: "missing_market_packet"
      })
    );
  }

  const decision = decisions.records
    .filter((record) => record.packetId === packet.packetId)
    .at(-1);
  if (!decision) {
    return appendStoreMetadata(
      failedReplay({
        packetId: packet.packetId,
        promptVersion,
        replayedAt,
        failureReason: "missing_matching_decision"
      })
    );
  }

  const replayInput: PaperReplayInput = {
    packet,
    decision,
    promptVersion
  };
  if (options.now) {
    replayInput.now = options.now;
  }

  return appendStoreMetadata(replayPaperDecisions(replayInput));
}

function failedReplay(input: {
  packetId: string | null;
  promptVersion: string;
  replayedAt: string;
  failureReason: string;
}): PaperReplayResult {
  return {
    status: "failed",
    mode: "paper_only",
    packetId: input.packetId,
    promptVersion: input.promptVersion,
    replayedAt: input.replayedAt,
    failureReason: input.failureReason,
    decisionItemCount: 0,
    tradeCount: 0,
    rejectedCount: 0,
    riskDecisions: [],
    trades: [],
    initialPortfolio: null,
    finalPortfolio: null
  };
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}
