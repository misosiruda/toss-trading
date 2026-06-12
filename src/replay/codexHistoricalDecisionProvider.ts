import type {
  CodexCliDecisionProviderConfig,
  CodexCliDecisionResult,
  CodexCliCommandPreview
} from "../ai/codexCliDecisionProvider.js";
import {
  buildPaperDecisionPrompt,
  PAPER_DECISION_PROMPT_VERSION
} from "../ai/decisionPrompt.js";
import type { MarketPacket } from "../domain/schemas.js";
import {
  summarizeVirtualDecisionValidation,
  validateVirtualDecisionAgainstPacket
} from "../paper/virtualDecisionValidation.js";
import type { HistoricalReplayDecisionContext } from "./historicalReplayRunner.js";

export const HISTORICAL_REPLAY_DECISION_PROMPT_VERSION =
  `${PAPER_DECISION_PROMPT_VERSION}-historical-replay-v1`;

export interface CodexHistoricalDecisionDelegate {
  decide(packet: MarketPacket): Promise<CodexCliDecisionResult>;
}

export interface CodexHistoricalReplayDecisionProviderOptions {
  maxCallsPerReplay: number;
}

export class CodexHistoricalReplayDecisionProvider {
  private callCount = 0;

  constructor(
    private readonly delegate: CodexHistoricalDecisionDelegate,
    private readonly options: CodexHistoricalReplayDecisionProviderOptions
  ) {
    if (
      !Number.isInteger(options.maxCallsPerReplay) ||
      options.maxCallsPerReplay <= 0
    ) {
      throw new Error("maxCallsPerReplay must be a positive integer");
    }
  }

  async decide(
    packet: MarketPacket,
    _context: HistoricalReplayDecisionContext
  ): Promise<CodexCliDecisionResult> {
    if (this.callCount >= this.options.maxCallsPerReplay) {
      return {
        attempted: false,
        decision: null,
        failure: {
          code: "RUN_BUDGET_EXCEEDED",
          reason: "Historical replay Codex call budget is exhausted"
        },
        command: null
      };
    }

    this.callCount += 1;
    const result = await this.delegate.decide(packet);
    if (result.decision) {
      const validation = validateVirtualDecisionAgainstPacket({
        packet,
        decision: result.decision
      });
      if (!validation.approved) {
        return failedHistoricalDecision(
          result.command,
          validation.rejectCodes.includes("VIRTUAL_DECISION_PACKET_MISMATCH")
            ? `decision_packet_mismatch:${result.decision.packetId}:${packet.packetId}; ${summarizeVirtualDecisionValidation(validation)}`
            : summarizeVirtualDecisionValidation(validation)
        );
      }
    }

    return result;
  }
}

export function withHistoricalReplayPrompt(
  config: CodexCliDecisionProviderConfig
): CodexCliDecisionProviderConfig {
  return {
    ...config,
    prompt: config.prompt ?? buildHistoricalReplayDecisionPrompt(),
    promptVersion:
      config.promptVersion ?? HISTORICAL_REPLAY_DECISION_PROMPT_VERSION
  };
}

export function buildHistoricalReplayDecisionPrompt(): string {
  return [
    buildPaperDecisionPrompt(),
    "Historical replay mode: packet.generatedAt is the simulated current time.",
    "Do not infer, request, or use market data after packet.generatedAt.",
    "Do not use future prices, future news, future fills, or future portfolio states.",
    "Treat packet sourceRefs as the complete evidence set for that simulated time.",
    "If the packet evidence is insufficient, stale, or ambiguous, prefer VIRTUAL_HOLD."
  ].join("\n");
}

function failedHistoricalDecision(
  command: CodexCliCommandPreview | null,
  reason: string
): CodexCliDecisionResult {
  return {
    attempted: false,
    decision: null,
    failure: {
      code: "AI_DECISION_FAILED",
      reason
    },
    command
  };
}
