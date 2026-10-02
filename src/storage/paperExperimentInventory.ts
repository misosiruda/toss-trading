import { join } from "node:path";

import { z } from "zod";

import {
  historicalMarketSnapshotSchema, marketPacketSchema, replayResearchManifestSchema,
  virtualDecisionSchema, virtualRiskDecisionSchema, virtualTradeSchema
} from "../domain/schemas.js";
import {
  historicalReplayPortfolioTimelineRecordSchema, historicalReplayRunMetadataSchema
} from "../replay/historicalReplayAuditLog.js";
import { historicalReplayProgressSnapshotSchema } from "../replay/historicalReplayProgress.js";
import { PAPER_EXPERIMENT_LIMITS, parsePaperExperimentInput } from "../replay/paperExperimentInput.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { createPaperExperimentArtifactPaths } from "./artifactPaths.js";
import {
  PAPER_EXPERIMENT_ARTIFACTS, type PaperExperimentInventoryEntry, type PaperExperimentState
} from "./paperExperimentContract.js";
import { readExperimentFile, requireExperimentStorage } from "./paperExperimentFilesystem.js";

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const count = z.number().int().nonnegative().max(10_000);
const object = z.record(z.string(), z.json());
const reportReference = replayResearchManifestSchema.omit({
  mode: true, runId: true, batchId: true, createdAt: true, universeSnapshotDate: true
}).extend({ status: z.literal("available"), manifestPath: z.string().min(1) }).strict();

// The legacy report has no Zod schema. Validate its storage envelope/count/reference sections;
// retain and digest every raw nested field, without recalculating report analytics here.
const reportSchema = z.object({
  title: z.string().min(1), mode: z.literal("paper_only"), generatedAt: z.iso.datetime(),
  simulatedRange: z.object({ startAt: z.iso.datetime().nullable(), endAt: z.iso.datetime().nullable(), tickCount: count }).strict(),
  replaySummary: z.object({ packetCount: count, decisionProviderCallCount: count, decisionSkippedCount: count,
    decisionRecordCount: count, decisionItemCount: count, tradeCount: count, rejectedCount: count }).strict(),
  allocationPolicy: object.nullable(), paperExitPolicy: object.nullable(),
  portfolio: object, portfolioConstruction: object, analytics: object, decisionOutcome: object,
  tradeSummary: object.and(z.object({ tradeCount: count })), costSummary: object,
  advancedPerformance: object, sharpeValidation: object,
  riskSummary: object.and(z.object({ approvedCount: count, rejectedCount: count })),
  samplingSummary: object, reproducibility: reportReference, benchmarks: object,
  sourceWarningSummary: object, portfolioTimeline: z.array(object), disclaimer: z.string().min(1)
}).strict();

export type ExperimentPaths = ReturnType<typeof createPaperExperimentArtifactPaths>;

export function parseExperimentJsonl(text: string, schema: z.ZodType): unknown[] {
  if (text === "") return [];
  requireExperimentStorage(text.endsWith("\n"), "ARTIFACT_INTEGRITY");
  const lines = text.slice(0, -1).split("\n");
  requireExperimentStorage(lines.length <= 10_000, "ARTIFACT_INTEGRITY");
  return lines.map((line) => {
    requireExperimentStorage(line.trim().length > 0, "ARTIFACT_INTEGRITY");
    const value: unknown = JSON.parse(line);
    schema.parse(value);
    return value;
  });
}

export async function verifyExperimentInput(paths: ExperimentPaths, state: PaperExperimentState) {
  const inputText = await readExperimentFile(paths.inputPath, PAPER_EXPERIMENT_LIMITS.inputBytes);
  const input = parsePaperExperimentInput(inputText, {
    implementationRevision: state.runtimeIdentity.implementationRevision
  });
  requireExperimentStorage(input.inputHash === state.inputHash
    && createReplayResearchHash(JSON.parse(inputText)) === input.inputHash, "INPUT_INTEGRITY");
  const source = parseExperimentJsonl(
    await readExperimentFile(paths.sourcePath, PAPER_EXPERIMENT_LIMITS.inputBytes), historicalMarketSnapshotSchema
  );
  requireExperimentStorage(createReplayResearchHash(source)
    === createReplayResearchHash(input.normalizedInput.source.snapshots), "INPUT_INTEGRITY");
  return input;
}

export async function captureExperimentInventory(paths: ExperimentPaths, state: PaperExperimentState) {
  const input = await verifyExperimentInput(paths, state);
  const inventory: PaperExperimentInventoryEntry[] = [];
  function add(key: keyof typeof PAPER_EXPERIMENT_ARTIFACTS, contract: string, format: "json" | "jsonl", value: unknown) {
    inventory.push({ relativePath: PAPER_EXPERIMENT_ARTIFACTS[key], contract, format,
      recordCount: format === "jsonl" ? (value as unknown[]).length : 1,
      digest: createReplayResearchHash(value) });
  }
  async function json<T>(key: keyof typeof PAPER_EXPERIMENT_ARTIFACTS, contract: string, schema: z.ZodType<T>): Promise<T> {
    const raw: unknown = JSON.parse(await readExperimentFile(join(paths.attemptDir, PAPER_EXPERIMENT_ARTIFACTS[key]), MAX_ARTIFACT_BYTES));
    const value = schema.parse(raw);
    add(key, contract, "json", raw);
    return value;
  }
  async function jsonl<T>(key: keyof typeof PAPER_EXPERIMENT_ARTIFACTS, contract: string, schema: z.ZodType<T>): Promise<T[]> {
    const values = parseExperimentJsonl(await readExperimentFile(join(paths.attemptDir, PAPER_EXPERIMENT_ARTIFACTS[key]), MAX_ARTIFACT_BYTES), schema);
    add(key, contract, "jsonl", values);
    return values.map((value) => schema.parse(value));
  }
  add("input", "paper_experiment_input.v1", "json", input.normalizedInput);
  add("source", "HistoricalMarketSnapshot", "jsonl", input.normalizedInput.source.snapshots);
  const manifest = await json("manifest", "replay_research_manifest.v1", replayResearchManifestSchema);
  const metadata = await json("metadata", "historical_replay_run_metadata.v1", historicalReplayRunMetadataSchema);
  const progress = await json("progress", "HistoricalReplayProgressSnapshot", historicalReplayProgressSnapshotSchema);
  const report = await json("report", "HistoricalReplayReport.storage.v1", reportSchema);
  const packets = await jsonl("packets", "MarketPacket", marketPacketSchema);
  const decisions = await jsonl("decisions", "VirtualDecision", virtualDecisionSchema);
  const risks = await jsonl("riskDecisions", "VirtualRiskDecision", virtualRiskDecisionSchema);
  const trades = await jsonl("trades", "VirtualTrade", virtualTradeSchema);
  const timeline = await jsonl("timeline", "HistoricalReplayPortfolioTimelineRecord", historicalReplayPortfolioTimelineRecordSchema);

  function equal(left: unknown, right: unknown) {
    requireExperimentStorage(createReplayResearchHash(left) === createReplayResearchHash(right), "ARTIFACT_INTEGRITY");
  }
  equal(metadata.identity, { runId: state.runId, batchId: null, runIndex: null });
  requireExperimentStorage(manifest.runId === state.runId && manifest.batchId === null
    && metadata.status === "completed" && metadata.completedAt !== null && metadata.failedAt === null && metadata.error === null
    && progress.status === "completed" && progress.completedAt !== null && progress.failedAt === null && progress.error === null,
  "ARTIFACT_INTEGRITY");
  equal(metadata.configuration, input.normalizedInput.configuration);
  equal(metadata.researchManifest, manifest);
  const { manifestPath, status, ...reportManifest } = report.reproducibility;
  const { mode, runId, batchId, createdAt, universeSnapshotDate, ...expectedReportManifest } = manifest;
  void status; void mode; void runId; void batchId; void createdAt; void universeSnapshotDate;
  equal(reportManifest, expectedReportManifest);
  equal(manifest.costModelHash, createReplayResearchHash(input.normalizedInput.costModel));
  const expectedPath = (key: keyof typeof PAPER_EXPERIMENT_ARTIFACTS) => join(paths.attemptDir, PAPER_EXPERIMENT_ARTIFACTS[key]);
  equal(metadata.logPaths, {
    runMetadataPath: expectedPath("metadata"), packetLogPath: expectedPath("packets"),
    decisionLogPath: expectedPath("decisions"), riskDecisionLogPath: expectedPath("riskDecisions"),
    tradeLogPath: expectedPath("trades"), portfolioTimelinePath: expectedPath("timeline"), researchManifestPath: expectedPath("manifest")
  });
  equal(manifestPath, expectedPath("manifest"));
  equal(progress.finalReportPath, expectedPath("report"));
  for (const [records, key] of [[packets, "packetId"], [decisions, "decisionHash"], [risks, "riskDecisionId"],
    [trades, "tradeId"], [timeline, "recordId"]] as const) {
    const ids = records.map((row) => (row as Record<string, unknown>)[key]);
    requireExperimentStorage(ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length, "ARTIFACT_INTEGRITY");
  }
  const ticks = input.preflight.tickCount;
  equal(metadata.tickCount, ticks);
  equal(progress.tickCount, ticks);
  equal(progress.completedTickCount, ticks);
  equal(report.simulatedRange.tickCount, ticks);
  equal(report.simulatedRange.startAt, input.normalizedInput.configuration.clock.startAt);
  // The final emitted tick can precede clock.endAt for non-divisible windows.
  equal(report.simulatedRange.endAt, input.preflight.ticks.at(-1)?.simulatedAt);
  requireExperimentStorage(packets.length <= ticks && decisions.length <= input.preflight.decisionCallUpperBound, "ARTIFACT_INTEGRITY");
  const rejectedCount = risks.filter((risk) => !risk.approved).length;
  for (const [key, expected] of [["packetCount", packets.length], ["decisionRecordCount", decisions.length],
    ["tradeCount", trades.length], ["rejectedCount", rejectedCount]] as const) {
    equal(report.replaySummary[key], expected);
    equal(progress[key], expected);
  }
  equal(progress.riskDecisionCount, risks.length);
  equal(progress.riskApprovedCount, risks.length - rejectedCount);
  equal(report.riskSummary.approvedCount, risks.length - rejectedCount);
  equal(report.riskSummary.rejectedCount, rejectedCount);
  equal(report.tradeSummary.tradeCount, trades.length);
  equal(report.replaySummary.decisionItemCount, decisions.reduce((sum, row) => sum + row.decisions.length, 0));
  equal(report.replaySummary.decisionProviderCallCount, progress.decisionProviderCallCount);
  equal(report.replaySummary.decisionSkippedCount, progress.decisionSkippedCount);
  requireExperimentStorage(timeline.length >= ticks && timeline.every((row) => row.tickIndex < ticks), "ARTIFACT_INTEGRITY");
  return inventory;
}
