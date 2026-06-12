import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  isoDateTimeSchema,
  marketPacketSchema,
  marketSchema,
  parseWithSchema,
  virtualActionSchema,
  virtualDecisionSchema,
  virtualPositionSchema,
  virtualRiskDecisionSchema,
  virtualTradeSchema,
  type Market,
  type MarketPacket,
  type VirtualAction,
  type VirtualDecision,
  type VirtualPortfolio,
  type VirtualRiskDecision,
  type VirtualTrade
} from "../domain/schemas.js";
import type { SimulatedTick } from "./simulatedClock.js";
import {
  markPortfolioToMarket,
  pricePointsFromMarketPacket
} from "../portfolio/markToMarket.js";

export const HISTORICAL_REPLAY_PROGRESS_DISCLAIMER =
  "Paper-only historical replay progress. This is not financial advice, not a performance guarantee, and cannot place live orders.";

export const historicalReplayProgressStatusSchema = z.enum([
  "idle",
  "running",
  "completed",
  "failed"
]);

export const historicalReplayProgressEventTypeSchema = z.enum([
  "VIRTUAL_BUY",
  "VIRTUAL_SELL",
  "RISK_REJECTED"
]);

export const historicalReplayPortfolioProgressSchema = z
  .object({
    simulatedAt: isoDateTimeSchema,
    cashKrw: z.number().int().nonnegative(),
    positionCount: z.number().int().nonnegative(),
    positionMarketValueKrw: z.number().int().nonnegative(),
    virtualNetWorthKrw: z.number().int().nonnegative(),
    positions: z.array(virtualPositionSchema)
  })
  .strict();

export const historicalReplayProgressEventSchema = z
  .object({
    eventId: z.string().trim().min(1),
    eventType: historicalReplayProgressEventTypeSchema,
    simulatedAt: isoDateTimeSchema,
    tickIndex: z.number().int().nonnegative(),
    packetId: z.string().trim().min(1),
    market: marketSchema,
    symbol: z.string().trim().min(1),
    action: virtualActionSchema,
    approved: z.boolean(),
    rejectCodes: z.array(z.string().trim().min(1)),
    amountKrw: z.number().int().nonnegative().optional(),
    summary: z.string().trim().min(1)
  })
  .strict();

export const historicalReplayPerformanceSchema = z
  .object({
    lastTickElapsedMs: z.number().nonnegative(),
    lastPacketBuildMs: z.number().nonnegative(),
    lastSamplingMs: z.number().nonnegative(),
    lastDecisionProviderMs: z.number().nonnegative(),
    lastOrderExecutionMs: z.number().nonnegative(),
    averageTickElapsedMs: z.number().nonnegative(),
    maxTickElapsedMs: z.number().nonnegative(),
    estimatedRemainingMs: z.number().nonnegative().nullable(),
    bottleneck: z.enum([
      "packet_build",
      "sampling",
      "decision_provider",
      "order_execution",
      "none"
    ])
  })
  .strict();

export const historicalReplayProgressSnapshotSchema = z
  .object({
    mode: z.literal("paper_only"),
    status: historicalReplayProgressStatusSchema,
    startedAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    failedAt: isoDateTimeSchema.nullable(),
    simulatedAt: isoDateTimeSchema.nullable(),
    tickIndex: z.number().int().nonnegative(),
    completedTickCount: z.number().int().nonnegative(),
    tickCount: z.number().int().nonnegative(),
    packetCount: z.number().int().nonnegative(),
    decisionProviderCallCount: z.number().int().nonnegative(),
    decisionSkippedCount: z.number().int().nonnegative(),
    decisionRecordCount: z.number().int().nonnegative(),
    tradeCount: z.number().int().nonnegative(),
    riskDecisionCount: z.number().int().nonnegative(),
    riskApprovedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    currentPortfolio: historicalReplayPortfolioProgressSchema,
    portfolioTimeline: z.array(historicalReplayPortfolioProgressSchema),
    recentEvents: z.array(historicalReplayProgressEventSchema),
    recentPackets: z.array(marketPacketSchema),
    recentDecisions: z.array(virtualDecisionSchema),
    recentRiskDecisions: z.array(virtualRiskDecisionSchema),
    recentTrades: z.array(virtualTradeSchema),
    performance: historicalReplayPerformanceSchema.nullable().default(null),
    finalReportPath: z.string().trim().min(1).nullable(),
    error: z.string().trim().min(1).nullable(),
    disclaimer: z.string().trim().min(1)
  })
  .strict();

export type HistoricalReplayProgressStatus = z.infer<
  typeof historicalReplayProgressStatusSchema
>;
export type HistoricalReplayProgressEventType = z.infer<
  typeof historicalReplayProgressEventTypeSchema
>;
export type HistoricalReplayPortfolioProgress = z.infer<
  typeof historicalReplayPortfolioProgressSchema
>;
export type HistoricalReplayProgressEvent = z.infer<
  typeof historicalReplayProgressEventSchema
>;
export type HistoricalReplayPerformance = z.infer<
  typeof historicalReplayPerformanceSchema
>;
export type HistoricalReplayProgressSnapshot = z.infer<
  typeof historicalReplayProgressSnapshotSchema
>;

export interface HistoricalReplayTickPerformance {
  tickElapsedMs: number;
  packetBuildMs: number;
  samplingMs: number;
  decisionProviderMs: number;
  orderExecutionMs: number;
}

export interface HistoricalReplayProgressUpdate {
  simulatedAt: Date;
  tick: SimulatedTick;
  tickCount: number;
  packetCount: number;
  decisionProviderCallCount: number;
  decisionSkippedCount: number;
  decisionRecordCount: number;
  tradeCount: number;
  riskDecisionCount: number;
  riskApprovedCount: number;
  rejectedCount: number;
  currentPortfolio: VirtualPortfolio;
  packets: MarketPacket[];
  decisions: VirtualDecision[];
  riskDecisions: VirtualRiskDecision[];
  trades: VirtualTrade[];
  event?: HistoricalReplayProgressEvent;
  performance?: HistoricalReplayTickPerformance;
}

export interface HistoricalReplayProgressRecorderOptions {
  filePath: string;
  startedAt: Date;
  tickCount: number;
  initialPortfolio: VirtualPortfolio;
  maxRecentEvents?: number;
  maxRecentRecords?: number;
  maxRecentPackets?: number;
  maxPortfolioTimelineRecords?: number;
}

export class HistoricalReplayProgressRecorder {
  private snapshot: HistoricalReplayProgressSnapshot;
  private readonly maxRecentEvents: number;
  private readonly maxRecentRecords: number;
  private readonly maxRecentPackets: number;
  private readonly maxPortfolioTimelineRecords: number;
  private performanceSampleCount = 0;
  private totalTickElapsedMs = 0;
  private maxTickElapsedMs = 0;

  constructor(private readonly options: HistoricalReplayProgressRecorderOptions) {
    this.maxRecentEvents = options.maxRecentEvents ?? 50;
    this.maxRecentRecords = options.maxRecentRecords ?? 50;
    this.maxRecentPackets = options.maxRecentPackets ?? 10;
    this.maxPortfolioTimelineRecords = options.maxPortfolioTimelineRecords ?? 1_500;
    this.snapshot = {
      mode: "paper_only",
      status: "running",
      startedAt: options.startedAt.toISOString(),
      updatedAt: options.startedAt.toISOString(),
      completedAt: null,
      failedAt: null,
      simulatedAt: null,
      tickIndex: 0,
      completedTickCount: 0,
      tickCount: options.tickCount,
      packetCount: 0,
      decisionProviderCallCount: 0,
      decisionSkippedCount: 0,
      decisionRecordCount: 0,
      tradeCount: 0,
      riskDecisionCount: 0,
      riskApprovedCount: 0,
      rejectedCount: 0,
      currentPortfolio: toHistoricalReplayPortfolioProgress(
        options.startedAt,
        options.initialPortfolio
      ),
      portfolioTimeline: [],
      recentEvents: [],
      recentPackets: [],
      recentDecisions: [],
      recentRiskDecisions: [],
      recentTrades: [],
      performance: null,
      finalReportPath: null,
      error: null,
      disclaimer: HISTORICAL_REPLAY_PROGRESS_DISCLAIMER
    };
  }

  async start(): Promise<void> {
    await this.write();
  }

  async record(update: HistoricalReplayProgressUpdate): Promise<void> {
    const currentPortfolio = toHistoricalReplayPortfolioProgress(
      update.simulatedAt,
      update.currentPortfolio,
      update.packets.at(-1)
    );
    const performance = this.nextPerformance(update);
    this.snapshot = {
      ...this.snapshot,
      status: "running",
      updatedAt: new Date().toISOString(),
      simulatedAt: update.simulatedAt.toISOString(),
      tickIndex: update.tick.stepIndex,
      completedTickCount: Math.min(update.tick.stepIndex + 1, update.tickCount),
      tickCount: update.tickCount,
      packetCount: update.packetCount,
      decisionProviderCallCount: update.decisionProviderCallCount,
      decisionSkippedCount: update.decisionSkippedCount,
      decisionRecordCount: update.decisionRecordCount,
      tradeCount: update.tradeCount,
      riskDecisionCount: update.riskDecisionCount,
      riskApprovedCount: update.riskApprovedCount,
      rejectedCount: update.rejectedCount,
      currentPortfolio,
      portfolioTimeline: appendPortfolioProgress(
        this.snapshot.portfolioTimeline,
        currentPortfolio,
        this.maxPortfolioTimelineRecords
      ),
      recentEvents:
        update.event === undefined
          ? this.snapshot.recentEvents
          : [update.event, ...this.snapshot.recentEvents].slice(
              0,
              this.maxRecentEvents
            ),
      recentPackets: takeRecent(update.packets, this.maxRecentPackets),
      recentDecisions: takeRecent(update.decisions, this.maxRecentRecords),
      recentRiskDecisions: takeRecent(update.riskDecisions, this.maxRecentRecords),
      recentTrades: takeRecent(update.trades, this.maxRecentRecords),
      performance,
      error: null
    };

    await this.write();
  }

  private nextPerformance(
    update: HistoricalReplayProgressUpdate
  ): HistoricalReplayPerformance | null {
    if (update.performance === undefined) {
      return this.snapshot.performance;
    }

    this.performanceSampleCount += 1;
    this.totalTickElapsedMs += update.performance.tickElapsedMs;
    this.maxTickElapsedMs = Math.max(
      this.maxTickElapsedMs,
      update.performance.tickElapsedMs
    );

    const completedTickCount = Math.min(
      update.tick.stepIndex + 1,
      update.tickCount
    );
    const averageTickElapsedMs =
      this.totalTickElapsedMs / this.performanceSampleCount;
    const remainingTicks = Math.max(0, update.tickCount - completedTickCount);
    const estimatedRemainingMs =
      remainingTicks > 0 ? Math.round(remainingTicks * averageTickElapsedMs) : null;

    return {
      lastTickElapsedMs: Math.round(update.performance.tickElapsedMs),
      lastPacketBuildMs: Math.round(update.performance.packetBuildMs),
      lastSamplingMs: Math.round(update.performance.samplingMs),
      lastDecisionProviderMs: Math.round(update.performance.decisionProviderMs),
      lastOrderExecutionMs: Math.round(update.performance.orderExecutionMs),
      averageTickElapsedMs: Math.round(averageTickElapsedMs),
      maxTickElapsedMs: Math.round(this.maxTickElapsedMs),
      estimatedRemainingMs,
      bottleneck: bottleneck(update.performance)
    };
  }

  async complete(input: {
    completedAt: Date;
    finalReportPath: string;
  }): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      status: "completed",
      updatedAt: input.completedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      finalReportPath: input.finalReportPath,
      error: null
    };
    await this.write();
  }

  async fail(error: unknown, failedAt = new Date()): Promise<void> {
    this.snapshot = {
      ...this.snapshot,
      status: "failed",
      updatedAt: failedAt.toISOString(),
      failedAt: failedAt.toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    await this.write();
  }

  current(): HistoricalReplayProgressSnapshot {
    return this.snapshot;
  }

  private async write(): Promise<void> {
    const parsed = parseWithSchema(
      historicalReplayProgressSnapshotSchema,
      this.snapshot,
      "historicalReplayProgress"
    );
    await mkdir(dirname(this.options.filePath), { recursive: true });
    const tempPath = `${this.options.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await replaceFile(tempPath, this.options.filePath);
  }
}

export function createHistoricalReplayProgressEvent(input: {
  eventType: HistoricalReplayProgressEventType;
  sequence: number;
  simulatedAt: Date;
  tick: SimulatedTick;
  packetId: string;
  market: Market;
  symbol: string;
  action: VirtualAction;
  approved: boolean;
  rejectCodes: string[];
  amountKrw?: number;
  summary: string;
}): HistoricalReplayProgressEvent {
  const base = {
    eventId: `replay_event_${input.tick.stepIndex}_${input.sequence}_${input.packetId}_${input.symbol}_${input.eventType.toLowerCase()}`,
    eventType: input.eventType,
    simulatedAt: input.simulatedAt.toISOString(),
    tickIndex: input.tick.stepIndex,
    packetId: input.packetId,
    market: input.market,
    symbol: input.symbol,
    action: input.action,
    approved: input.approved,
    rejectCodes: input.rejectCodes,
    summary: input.summary
  };

  if (input.amountKrw === undefined) {
    return base;
  }

  return {
    ...base,
    amountKrw: input.amountKrw
  };
}

export function toHistoricalReplayPortfolioProgress(
  simulatedAt: Date,
  portfolio: VirtualPortfolio,
  latestPacket?: MarketPacket
): HistoricalReplayPortfolioProgress {
  const canUseLatestPacket =
    latestPacket !== undefined &&
    Date.parse(latestPacket.generatedAt) === simulatedAt.getTime();
  const markedPortfolio =
    !canUseLatestPacket || latestPacket === undefined
      ? portfolio
      : markPortfolioToMarket({
          portfolio,
          prices: pricePointsFromMarketPacket(latestPacket),
          asOf: simulatedAt
        });
  const positions = markedPortfolio.positions;
  const positionMarketValueKrw = positions.reduce(
    (sum, position) => sum + (position.marketValueKrw ?? 0),
    0
  );

  return {
    simulatedAt: simulatedAt.toISOString(),
    cashKrw: markedPortfolio.cashKrw,
    positionCount: positions.length,
    positionMarketValueKrw,
    virtualNetWorthKrw: markedPortfolio.cashKrw + positionMarketValueKrw,
    positions
  };
}

function takeRecent<T>(records: T[], limit: number): T[] {
  return records.slice(-limit).reverse();
}

function appendPortfolioProgress(
  records: HistoricalReplayPortfolioProgress[],
  next: HistoricalReplayPortfolioProgress,
  limit: number
): HistoricalReplayPortfolioProgress[] {
  const copied = [...records];
  if (copied.at(-1)?.simulatedAt === next.simulatedAt) {
    copied[copied.length - 1] = next;
  } else {
    copied.push(next);
  }
  return copied.slice(-limit);
}

function bottleneck(
  performance: HistoricalReplayTickPerformance
): HistoricalReplayPerformance["bottleneck"] {
  const candidates: Array<{
    key: HistoricalReplayPerformance["bottleneck"];
    value: number;
  }> = [
    { key: "packet_build", value: performance.packetBuildMs },
    { key: "sampling", value: performance.samplingMs },
    { key: "decision_provider", value: performance.decisionProviderMs },
    { key: "order_execution", value: performance.orderExecutionMs }
  ];
  const top = candidates.sort((left, right) => right.value - left.value)[0];
  if (top === undefined || top.value <= 0) {
    return "none";
  }
  return top.key;
}

async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  const retryDelaysMs = [20, 50, 100];
  for (const delayMs of retryDelaysMs) {
    try {
      await rename(tempPath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableReplaceError(error)) {
        throw error;
      }
      await sleep(delayMs);
    }
  }

  await rm(targetPath, { force: true });
  await rename(tempPath, targetPath);
}

function isRetryableReplaceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
