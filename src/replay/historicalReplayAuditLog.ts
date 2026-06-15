import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  isoDateTimeSchema,
  marketSchema,
  marketPacketSchema,
  parseWithSchema,
  virtualActionSchema,
  virtualDecisionSchema,
  virtualRiskDecisionSchema,
  virtualTradeSchema
} from "../domain/schemas.js";
import { bindVirtualDecisionHash } from "../paper/decisionHash.js";
import { PAPER_RISK_PROFILE_NAMES } from "../paper/riskProfile.js";
import { JsonlStore } from "../storage/jsonlStore.js";
import {
  HISTORICAL_REPLAY_PROGRESS_DISCLAIMER,
  historicalReplayPortfolioProgressSchema,
  toHistoricalReplayPortfolioProgress,
  type HistoricalReplayProgressUpdate
} from "./historicalReplayProgress.js";

export const historicalReplayAuditStatusSchema = z.enum([
  "running",
  "completed",
  "failed"
]);

export const historicalReplayAuditLogPathsSchema = z
  .object({
    runMetadataPath: z.string().trim().min(1),
    packetLogPath: z.string().trim().min(1),
    decisionLogPath: z.string().trim().min(1),
    riskDecisionLogPath: z.string().trim().min(1),
    tradeLogPath: z.string().trim().min(1),
    portfolioTimelinePath: z.string().trim().min(1)
  })
  .strict();

export const historicalReplayRunIdentitySchema = z
  .object({
    runId: z.string().trim().min(1),
    batchId: z.string().trim().min(1).nullable(),
    runIndex: z.number().int().nonnegative().nullable()
  })
  .strict();

export const historicalReplayRunWindowSchema = z
  .object({
    source: z.enum(["explicit", "random_window"]),
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    rangeStart: isoDateTimeSchema.nullable(),
    rangeEnd: isoDateTimeSchema.nullable(),
    seed: z.string().trim().min(1).nullable(),
    selectedMonth: z.string().trim().min(1).nullable(),
    localStartDate: z.string().trim().min(1).nullable(),
    localEndDate: z.string().trim().min(1).nullable(),
    windowMonths: z.number().int().positive().nullable(),
    timezoneOffsetMinutes: z.number().int()
  })
  .strict();

export const historicalReplayRunConfigurationSchema = z
  .object({
    clock: z
      .object({
        startAt: isoDateTimeSchema,
        endAt: isoDateTimeSchema,
        stepSeconds: z.number().int().positive(),
        speedMultiplier: z.number().positive()
      })
      .strict(),
    samplingPolicy: z
      .object({
        everyNSteps: z.number().int().positive().nullable(),
        candidateChangedOnly: z.boolean(),
        decisionFrequency: z.enum([
          "every_tick",
          "once_per_day",
          "once_per_week"
        ]),
        maxDecisionCalls: z.number().int().positive().nullable(),
        timezoneOffsetMinutes: z.number().int()
      })
      .strict()
      .nullable(),
    initialCashKrw: z.number().int().nonnegative(),
    packetIdPrefix: z.string().trim().min(1),
    packetExpiresInSeconds: z.number().int().positive(),
    maxCandidates: z.number().int().positive(),
    maxSnapshotAgeSeconds: z.number().int().nonnegative(),
    constraints: z
      .object({
        maxNewPositions: z.number().int().nonnegative(),
        maxBudgetPerSymbolKrw: z.number().int().nonnegative(),
        allowedActions: z.array(virtualActionSchema).min(1)
      })
      .strict(),
    riskProfile: z.enum(PAPER_RISK_PROFILE_NAMES).nullable(),
    riskPolicy: z
      .object({
        maxBudgetPerDecisionKrw: z.number().int().nonnegative().optional(),
        maxSymbolExposureKrw: z.number().int().nonnegative().optional(),
        targetExposureRatio: z.number().min(0).max(1).optional(),
        maxPositionWeightRatio: z.number().min(0).max(1).optional(),
        minCashReserveRatio: z.number().min(0).max(1).optional(),
        minCashReserveKrw: z.number().int().nonnegative().optional()
      })
      .strict()
      .nullable(),
    allocationPolicy: z
      .object({
        policyName: z.string().trim().min(1),
        targetExposureRatio: z.number().min(0).max(1),
        minCashReserveRatio: z.number().min(0).max(1),
        maxBudgetPerDecisionRatio: z.number().min(0).max(1),
        maxSymbolExposureRatio: z.number().min(0).max(1),
        marketTargetExposureRatios: z
          .partialRecord(marketSchema, z.number().min(0).max(1))
          .optional()
      })
      .strict()
      .nullable(),
    marketRegimeAllocationPolicy: z
      .object({
        lookbackDays: z.number().int().positive(),
        policyNameSuffix: z.string().trim().min(1).optional(),
        minSymbols: z.number().int().positive().optional(),
        minSnapshotsPerSymbol: z.number().int().positive().optional(),
        bullReturnThreshold: z.number().optional(),
        bearReturnThreshold: z.number().optional(),
        sidewaysAbsReturnThreshold: z.number().optional(),
        breadthThreshold: z.number().optional(),
        regimeWeights: z
          .partialRecord(
            z.enum([
              "bull",
              "bear",
              "sideways",
              "mixed",
              "insufficient_data"
            ]),
            z.number().nonnegative()
          )
          .optional()
      })
      .strict()
      .nullable(),
    paperExitPolicy: z
      .object({
        takeProfitRatio: z.number().gt(0).max(10).optional(),
        stopLossRatio: z.number().gt(0).max(1).optional(),
        rebalanceMaxPositionWeightRatio: z.number().gt(0).max(1).optional(),
        takeProfitMode: z
          .enum(["full_exit", "partial_then_trail"])
          .optional(),
        takeProfitSellRatio: z.number().gt(0).max(1).optional(),
        trailingStopFromPeakRatio: z.number().gt(0).max(1).optional()
      })
      .strict()
      .nullable()
  })
  .strict();

export const historicalReplayRunMetadataContextSchema = z
  .object({
    identity: historicalReplayRunIdentitySchema,
    window: historicalReplayRunWindowSchema,
    configuration: historicalReplayRunConfigurationSchema
  })
  .strict();

export const historicalReplayRunMetadataSchema = z
  .object({
    mode: z.literal("paper_only"),
    identity: historicalReplayRunIdentitySchema,
    window: historicalReplayRunWindowSchema,
    configuration: historicalReplayRunConfigurationSchema,
    status: historicalReplayAuditStatusSchema,
    startedAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    failedAt: isoDateTimeSchema.nullable(),
    tickCount: z.number().int().nonnegative(),
    logPaths: historicalReplayAuditLogPathsSchema,
    error: z.string().trim().min(1).nullable(),
    disclaimer: z.string().trim().min(1)
  })
  .strict();

export const historicalReplayPortfolioTimelineRecordSchema = z
  .object({
    recordId: z.string().trim().min(1),
    tickIndex: z.number().int().nonnegative(),
    simulatedAt: isoDateTimeSchema,
    portfolio: historicalReplayPortfolioProgressSchema
  })
  .strict();

export type HistoricalReplayAuditLogPaths = z.infer<
  typeof historicalReplayAuditLogPathsSchema
>;
export type HistoricalReplayRunIdentity = z.infer<
  typeof historicalReplayRunIdentitySchema
>;
export type HistoricalReplayRunWindow = z.infer<
  typeof historicalReplayRunWindowSchema
>;
export type HistoricalReplayRunConfiguration = z.infer<
  typeof historicalReplayRunConfigurationSchema
>;
export type HistoricalReplayRunMetadataContext = z.infer<
  typeof historicalReplayRunMetadataContextSchema
>;
export type HistoricalReplayRunMetadata = z.infer<
  typeof historicalReplayRunMetadataSchema
>;
export type HistoricalReplayPortfolioTimelineRecord = z.infer<
  typeof historicalReplayPortfolioTimelineRecordSchema
>;

export interface HistoricalReplayAuditLogRecorderOptions {
  paths: HistoricalReplayAuditLogPaths;
  startedAt: Date;
  tickCount: number;
  metadataContext: HistoricalReplayRunMetadataContext;
}

export class HistoricalReplayAuditLogRecorder {
  private readonly packetStore: JsonlStore<
    z.infer<typeof marketPacketSchema>
  >;
  private readonly decisionStore: JsonlStore<
    z.infer<typeof virtualDecisionSchema>
  >;
  private readonly riskDecisionStore: JsonlStore<
    z.infer<typeof virtualRiskDecisionSchema>
  >;
  private readonly tradeStore: JsonlStore<z.infer<typeof virtualTradeSchema>>;
  private readonly portfolioTimelineStore: JsonlStore<
    HistoricalReplayPortfolioTimelineRecord
  >;
  private readonly seenPacketIds = new Set<string>();
  private readonly seenDecisionHashes = new Set<string>();
  private readonly seenRiskDecisionIds = new Set<string>();
  private readonly seenTradeIds = new Set<string>();
  private portfolioTimelineSequence = 0;
  private metadata: HistoricalReplayRunMetadata;

  constructor(private readonly options: HistoricalReplayAuditLogRecorderOptions) {
    this.packetStore = new JsonlStore(
      this.options.paths.packetLogPath,
      marketPacketSchema,
      "historicalReplayPacketLog"
    );
    this.decisionStore = new JsonlStore(
      this.options.paths.decisionLogPath,
      virtualDecisionSchema,
      "historicalReplayDecisionLog"
    );
    this.riskDecisionStore = new JsonlStore(
      this.options.paths.riskDecisionLogPath,
      virtualRiskDecisionSchema,
      "historicalReplayRiskDecisionLog"
    );
    this.tradeStore = new JsonlStore(
      this.options.paths.tradeLogPath,
      virtualTradeSchema,
      "historicalReplayTradeLog"
    );
    this.portfolioTimelineStore = new JsonlStore(
      this.options.paths.portfolioTimelinePath,
      historicalReplayPortfolioTimelineRecordSchema,
      "historicalReplayPortfolioTimelineLog"
    );
    this.metadata = {
      mode: "paper_only",
      identity: options.metadataContext.identity,
      window: options.metadataContext.window,
      configuration: options.metadataContext.configuration,
      status: "running",
      startedAt: options.startedAt.toISOString(),
      updatedAt: options.startedAt.toISOString(),
      completedAt: null,
      failedAt: null,
      tickCount: options.tickCount,
      logPaths: options.paths,
      error: null,
      disclaimer: HISTORICAL_REPLAY_PROGRESS_DISCLAIMER
    };
  }

  async start(): Promise<void> {
    await Promise.all([
      resetFile(this.options.paths.packetLogPath),
      resetFile(this.options.paths.decisionLogPath),
      resetFile(this.options.paths.riskDecisionLogPath),
      resetFile(this.options.paths.tradeLogPath),
      resetFile(this.options.paths.portfolioTimelinePath)
    ]);
    await this.writeMetadata();
  }

  async record(update: HistoricalReplayProgressUpdate): Promise<void> {
    for (const packet of update.packets) {
      if (this.seenPacketIds.has(packet.packetId)) {
        continue;
      }
      this.seenPacketIds.add(packet.packetId);
      await this.packetStore.append(packet);
    }

    for (const decision of update.decisions) {
      const boundDecision = bindVirtualDecisionHash(decision);
      const decisionHash = boundDecision.decisionHash ?? decision.packetId;
      if (this.seenDecisionHashes.has(decisionHash)) {
        continue;
      }
      this.seenDecisionHashes.add(decisionHash);
      await this.decisionStore.append(boundDecision);
    }

    for (const riskDecision of update.riskDecisions) {
      if (this.seenRiskDecisionIds.has(riskDecision.riskDecisionId)) {
        continue;
      }
      this.seenRiskDecisionIds.add(riskDecision.riskDecisionId);
      await this.riskDecisionStore.append(riskDecision);
    }

    for (const trade of update.trades) {
      if (this.seenTradeIds.has(trade.tradeId)) {
        continue;
      }
      this.seenTradeIds.add(trade.tradeId);
      await this.tradeStore.append(trade);
    }

    await this.appendPortfolioTimeline(update);
  }

  async complete(completedAt: Date): Promise<void> {
    this.metadata = {
      ...this.metadata,
      status: "completed",
      updatedAt: completedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      error: null
    };
    await this.writeMetadata();
  }

  async fail(error: unknown, failedAt = new Date()): Promise<void> {
    this.metadata = {
      ...this.metadata,
      status: "failed",
      updatedAt: failedAt.toISOString(),
      failedAt: failedAt.toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };
    await this.writeMetadata();
  }

  private async appendPortfolioTimeline(
    update: HistoricalReplayProgressUpdate
  ): Promise<void> {
    this.portfolioTimelineSequence += 1;
    const portfolio = toHistoricalReplayPortfolioProgress(
      update.simulatedAt,
      update.currentPortfolio,
      update.packets.at(-1)
    );
    const record: HistoricalReplayPortfolioTimelineRecord = {
      recordId: `portfolio_timeline_${update.tick.stepIndex}_${this.portfolioTimelineSequence}`,
      tickIndex: update.tick.stepIndex,
      simulatedAt: update.simulatedAt.toISOString(),
      portfolio
    };

    await this.portfolioTimelineStore.append(record);
  }

  private async writeMetadata(): Promise<void> {
    const parsed = parseWithSchema(
      historicalReplayRunMetadataSchema,
      this.metadata,
      "historicalReplayRunMetadata"
    );
    await mkdir(dirname(this.options.paths.runMetadataPath), { recursive: true });
    await writeFile(
      this.options.paths.runMetadataPath,
      `${JSON.stringify(parsed, null, 2)}\n`,
      "utf8"
    );
  }
}

async function resetFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "", "utf8");
}
