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
import type { PaperRiskProfileName } from "../paper/riskProfile.js";
import {
  summarizeVirtualDecisionValidation,
  validateVirtualDecisionAgainstPacket
} from "../paper/virtualDecisionValidation.js";
import type { HistoricalReplayDecisionContext } from "./historicalReplayRunner.js";

export const HISTORICAL_REPLAY_DECISION_PROMPT_VERSION =
  `${PAPER_DECISION_PROMPT_VERSION}-historical-replay-v1`;
export const HISTORICAL_REPLAY_AGGRESSIVE_PAPER_PROMPT_VERSION =
  `${PAPER_DECISION_PROMPT_VERSION}-historical-replay-aggressive-paper-v1`;

export type HistoricalReplayPromptPolicyName = "default" | "aggressive_paper";

export interface HistoricalReplayPromptPolicy {
  name: HistoricalReplayPromptPolicyName;
  prompt: string;
  promptVersion: string;
}

export interface HistoricalReplayPromptPolicyOptions {
  riskProfile?: PaperRiskProfileName;
}

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
  config: CodexCliDecisionProviderConfig,
  options: HistoricalReplayPromptPolicyOptions = {}
): CodexCliDecisionProviderConfig {
  const policy = resolveHistoricalReplayPromptPolicy(options);
  return {
    ...config,
    prompt: config.prompt ?? policy.prompt,
    promptVersion: config.promptVersion ?? policy.promptVersion
  };
}

export function resolveHistoricalReplayPromptPolicy(
  options: HistoricalReplayPromptPolicyOptions = {}
): HistoricalReplayPromptPolicy {
  if (options.riskProfile === "aggressive_paper") {
    return {
      name: "aggressive_paper",
      prompt: buildHistoricalReplayDecisionPrompt(options),
      promptVersion: HISTORICAL_REPLAY_AGGRESSIVE_PAPER_PROMPT_VERSION
    };
  }

  return {
    name: "default",
    prompt: buildHistoricalReplayDecisionPrompt(),
    promptVersion: HISTORICAL_REPLAY_DECISION_PROMPT_VERSION
  };
}

export function buildHistoricalReplayDecisionPrompt(
  options: HistoricalReplayPromptPolicyOptions = {}
): string {
  const prompt = [
    buildPaperDecisionPrompt(),
    "Historical replay mode: packet.generatedAt is the simulated current time.",
    "Do not infer, request, or use market data after packet.generatedAt.",
    "Do not use future prices, future news, future fills, or future portfolio states.",
    "Treat packet sourceRefs as the complete evidence set for that simulated time.",
    "If the packet evidence is insufficient, stale, or ambiguous, prefer VIRTUAL_HOLD."
  ];

  if (options.riskProfile === "aggressive_paper") {
    prompt.push(
      "Aggressive paper profile policy: this applies only to paper-only historical replay and never to live trading.",
      "Use the wider aggressive_paper risk envelope only when packet evidence is strong, fresh, internally consistent, and action eligibility is true.",
      "Do not chase a monthly return target, do not force trades to reach 15-30% returns, and do not guarantee performance.",
      "Prefer VIRTUAL_BUY over VIRTUAL_HOLD only for top-ranked candidates with strong featureScores or reasonCodes, fresh dataRefs, buyEligible=true, and enough cash under packet constraints.",
      "When proposing VIRTUAL_BUY, size budgetKrw close to but never above marketPacket.constraints.maxBudgetPerSymbolKrw only when riskFactors explicitly cover concentration, drawdown, stale-data, and cash-reserve risk.",
      "Use reduce-only VIRTUAL_SELL for existing positions when packet evidence weakens or portfolio state shows concentration, cash, or policy conflict supported by packet data.",
      "VIRTUAL_HOLD remains required when eligibility, evidence, or constraints do not support a non-hold action."
    );
  }

  return prompt.join("\n");
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
