import type { MarketPacket } from "../domain/schemas.js";
import type { HistoricalReplayDecisionContext } from "./historicalReplayRunner.js";

export type ReplayDecisionFrequency =
  | "every_tick"
  | "once_per_day"
  | "once_per_week";

export type ReplaySamplingDecisionReason =
  | "POLICY_ALLOWED"
  | "STEP_INTERVAL_SKIPPED"
  | "CANDIDATES_UNCHANGED"
  | "FREQUENCY_WINDOW_ALREADY_EVALUATED"
  | "DECISION_CALL_BUDGET_EXHAUSTED";

export interface ReplaySamplingPolicyConfig {
  everyNSteps?: number;
  candidateChangedOnly?: boolean;
  decisionFrequency?: ReplayDecisionFrequency;
  maxDecisionCalls?: number;
  timezoneOffsetMinutes?: number;
}

export interface ReplaySamplingPolicyMetadata {
  everyNSteps: number | null;
  candidateChangedOnly: boolean;
  decisionFrequency: ReplayDecisionFrequency;
  maxDecisionCalls: number | null;
  timezoneOffsetMinutes: number;
}

export interface ReplaySamplingDecision {
  shouldEvaluate: boolean;
  reason: ReplaySamplingDecisionReason;
  decisionCallsUsed: number;
  candidateFingerprint: string;
}

export class ReplaySamplingPolicy {
  private readonly everyNSteps: number | undefined;
  private readonly candidateChangedOnly: boolean;
  private readonly decisionFrequency: ReplayDecisionFrequency;
  private readonly maxDecisionCalls: number | undefined;
  private readonly timezoneOffsetMinutes: number;
  private readonly evaluatedPeriodKeys = new Set<string>();
  private lastCandidateFingerprint: string | null = null;
  private decisionCallsUsed = 0;

  constructor(config: ReplaySamplingPolicyConfig = {}) {
    validateConfig(config);
    this.everyNSteps = config.everyNSteps;
    this.candidateChangedOnly = config.candidateChangedOnly ?? false;
    this.decisionFrequency = config.decisionFrequency ?? "every_tick";
    this.maxDecisionCalls = config.maxDecisionCalls;
    this.timezoneOffsetMinutes = config.timezoneOffsetMinutes ?? 0;
  }

  evaluate(
    packet: MarketPacket,
    context: HistoricalReplayDecisionContext
  ): ReplaySamplingDecision {
    const candidateFingerprint = fingerprintMarketPacketCandidates(packet);

    if (
      this.maxDecisionCalls !== undefined &&
      this.decisionCallsUsed >= this.maxDecisionCalls
    ) {
      return this.skipped(
        "DECISION_CALL_BUDGET_EXHAUSTED",
        candidateFingerprint
      );
    }

    if (
      this.everyNSteps !== undefined &&
      context.tick.stepIndex % this.everyNSteps !== 0
    ) {
      return this.skipped("STEP_INTERVAL_SKIPPED", candidateFingerprint);
    }

    const periodKey = periodKeyForFrequency(
      context.simulatedAt,
      this.decisionFrequency,
      this.timezoneOffsetMinutes
    );
    if (periodKey !== null && this.evaluatedPeriodKeys.has(periodKey)) {
      return this.skipped(
        "FREQUENCY_WINDOW_ALREADY_EVALUATED",
        candidateFingerprint
      );
    }

    if (
      this.candidateChangedOnly &&
      this.lastCandidateFingerprint === candidateFingerprint
    ) {
      return this.skipped("CANDIDATES_UNCHANGED", candidateFingerprint);
    }

    this.decisionCallsUsed += 1;
    this.lastCandidateFingerprint = candidateFingerprint;
    if (periodKey !== null) {
      this.evaluatedPeriodKeys.add(periodKey);
    }

    return {
      shouldEvaluate: true,
      reason: "POLICY_ALLOWED",
      decisionCallsUsed: this.decisionCallsUsed,
      candidateFingerprint
    };
  }

  metadata(): ReplaySamplingPolicyMetadata {
    return {
      everyNSteps: this.everyNSteps ?? null,
      candidateChangedOnly: this.candidateChangedOnly,
      decisionFrequency: this.decisionFrequency,
      maxDecisionCalls: this.maxDecisionCalls ?? null,
      timezoneOffsetMinutes: this.timezoneOffsetMinutes
    };
  }

  private skipped(
    reason: ReplaySamplingDecisionReason,
    candidateFingerprint: string
  ): ReplaySamplingDecision {
    return {
      shouldEvaluate: false,
      reason,
      decisionCallsUsed: this.decisionCallsUsed,
      candidateFingerprint
    };
  }
}

export function fingerprintMarketPacketCandidates(packet: MarketPacket): string {
  return packet.candidates
    .map((candidate) =>
      [
        candidate.market,
        candidate.symbol,
        candidate.ranking,
        candidate.lastPriceKrw ?? "no_price",
        candidate.collectedAt,
        candidate.staleAfter,
        candidate.reasonCodes.join(","),
        candidate.sourceRefs.join(",")
      ].join(":")
    )
    .join("|");
}

function validateConfig(config: ReplaySamplingPolicyConfig): void {
  if (
    config.everyNSteps !== undefined &&
    (!Number.isInteger(config.everyNSteps) || config.everyNSteps <= 0)
  ) {
    throw new Error("everyNSteps must be a positive integer");
  }
  if (
    config.maxDecisionCalls !== undefined &&
    (!Number.isInteger(config.maxDecisionCalls) || config.maxDecisionCalls <= 0)
  ) {
    throw new Error("maxDecisionCalls must be a positive integer");
  }
  if (
    config.timezoneOffsetMinutes !== undefined &&
    !Number.isInteger(config.timezoneOffsetMinutes)
  ) {
    throw new Error("timezoneOffsetMinutes must be an integer");
  }
}

function periodKeyForFrequency(
  simulatedAt: Date,
  frequency: ReplayDecisionFrequency,
  timezoneOffsetMinutes: number
): string | null {
  if (frequency === "every_tick") {
    return null;
  }

  const localDate = new Date(
    simulatedAt.getTime() + timezoneOffsetMinutes * 60_000
  );
  const dayKey = localDate.toISOString().slice(0, 10);
  if (frequency === "once_per_day") {
    return dayKey;
  }

  return isoWeekKey(localDate);
}

function isoWeekKey(localDate: Date): string {
  const date = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate()
    )
  );
  const dayNumber = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );

  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}
