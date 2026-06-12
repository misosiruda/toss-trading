import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  isoDateTimeSchema,
  marketPacketSchema,
  parseWithSchema,
  virtualDecisionSchema,
  virtualRiskDecisionSchema,
  virtualTradeSchema
} from "../domain/schemas.js";
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

export const historicalReplayRunMetadataSchema = z
  .object({
    mode: z.literal("paper_only"),
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
  private readonly seenDecisionPacketIds = new Set<string>();
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
      if (this.seenDecisionPacketIds.has(decision.packetId)) {
        continue;
      }
      this.seenDecisionPacketIds.add(decision.packetId);
      await this.decisionStore.append(decision);
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
