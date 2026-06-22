import type { MarketRegimeClassification } from "../analytics/marketRegimeClassifier.js";
import type { Sha256Hash } from "../domain/schemas.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import type { MarketRegimeAllocationPolicy } from "../paper/marketRegimeAllocationPolicy.js";
import type { NormalizedPaperExitPolicy } from "../paper/exitPolicy.js";
import type { PaperRiskProfileName } from "../paper/riskProfile.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import type { ReplayWindowSelection } from "./replayWindowSampler.js";
import {
  createReplayResearchHash,
  type ReplayResearchManifestReference
} from "./replayRunManifest.js";

export const SELECTION_TRIAL_SCHEMA_VERSION = "selection_trial.v1";

export type SelectionTrialRunStatus =
  | "completed"
  | "completed_with_failures"
  | "skipped"
  | "failed";

export interface SelectionTrialRecord {
  mode: "paper_only";
  trialSchemaVersion: typeof SELECTION_TRIAL_SCHEMA_VERSION;
  trialId: string;
  batchId: string;
  runId: string;
  runIndex: number;
  runSeed: string;
  status: SelectionTrialRunStatus;
  startedAt: string;
  completedAt: string | null;
  skippedAt: string | null;
  failedAt: string | null;
  window: ReplayWindowSelection;
  marketRegime: MarketRegimeClassification;
  decisionProvider: SelectionTrialDecisionProvider;
  config: SelectionTrialConfig;
  outcome: SelectionTrialOutcome;
  selection: SelectionTrialSelection;
  researchManifest: ReplayResearchManifestReference;
}

export interface SelectionTrialDecisionProvider {
  mode: string;
  promptPolicy: string | null;
  promptVersion: string | null;
  promptHash: Sha256Hash | null;
  metadataHash: Sha256Hash;
}

export interface SelectionTrialConfig {
  configHash: Sha256Hash | null;
  riskPolicyHash: Sha256Hash;
  allocationPolicyHash: Sha256Hash;
  marketRegimeAllocationPolicyHash: Sha256Hash;
  exitPolicyHash: Sha256Hash;
  riskProfile: PaperRiskProfileName | null;
  selectionMetric: "total_return_ratio";
}

export interface SelectionTrialOutcome {
  totalReturnRatio: number | null;
  finalVirtualNetWorthKrw: number | null;
  tradeCount: number;
  aiDecisionFailureCount: number;
  rejectedCount: number;
  skipReason: string | null;
  error: string | null;
  reportPath: string | null;
}

export interface SelectionTrialSelection {
  selected: false;
  selectedBy: null;
  selectedAt: null;
  selectionReason: null;
}

export interface CreateSelectionTrialRecordInput {
  batchId: string;
  runId: string;
  runIndex: number;
  runSeed: string;
  status: SelectionTrialRunStatus;
  startedAt: string;
  completedAt: string | null;
  skippedAt: string | null;
  failedAt: string | null;
  window: ReplayWindowSelection;
  marketRegime: MarketRegimeClassification;
  decisionProviderMetadata: unknown;
  riskProfile: PaperRiskProfileName | null;
  riskPolicy: Partial<VirtualRiskPolicy> | undefined;
  allocationPolicy: PaperAllocationPolicy | null;
  marketRegimeAllocationPolicy: MarketRegimeAllocationPolicy | null;
  paperExitPolicy: NormalizedPaperExitPolicy | null;
  researchManifest: ReplayResearchManifestReference;
  totalReturnRatio: number | null;
  finalVirtualNetWorthKrw: number | null;
  tradeCount: number;
  aiDecisionFailureCount: number;
  rejectedCount: number;
  skipReason: string | null;
  error: string | null;
  reportPath: string | null;
}

export function createSelectionTrialRecord(
  input: CreateSelectionTrialRecordInput
): SelectionTrialRecord {
  return {
    mode: "paper_only",
    trialSchemaVersion: SELECTION_TRIAL_SCHEMA_VERSION,
    trialId: selectionTrialId(input.batchId, input.runIndex, input.runId),
    batchId: input.batchId,
    runId: input.runId,
    runIndex: input.runIndex,
    runSeed: input.runSeed,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    skippedAt: input.skippedAt,
    failedAt: input.failedAt,
    window: input.window,
    marketRegime: input.marketRegime,
    decisionProvider: {
      mode: decisionProviderMode(input.decisionProviderMetadata),
      promptPolicy: nullableStringField(
        input.decisionProviderMetadata,
        "promptPolicy"
      ),
      promptVersion: nullableStringField(
        input.decisionProviderMetadata,
        "promptVersion"
      ),
      promptHash:
        input.researchManifest.promptHash ??
        hashTrialValue(input.decisionProviderMetadata),
      metadataHash: hashTrialValue(input.decisionProviderMetadata)
    },
    config: {
      configHash: input.researchManifest.configHash,
      riskPolicyHash: hashTrialValue(input.riskPolicy ?? null),
      allocationPolicyHash: hashTrialValue(input.allocationPolicy),
      marketRegimeAllocationPolicyHash: hashTrialValue(
        input.marketRegimeAllocationPolicy
      ),
      exitPolicyHash: hashTrialValue(input.paperExitPolicy),
      riskProfile: input.riskProfile,
      selectionMetric: "total_return_ratio"
    },
    outcome: {
      totalReturnRatio: input.totalReturnRatio,
      finalVirtualNetWorthKrw: input.finalVirtualNetWorthKrw,
      tradeCount: input.tradeCount,
      aiDecisionFailureCount: input.aiDecisionFailureCount,
      rejectedCount: input.rejectedCount,
      skipReason: input.skipReason,
      error: input.error,
      reportPath: input.reportPath
    },
    selection: {
      selected: false,
      selectedBy: null,
      selectedAt: null,
      selectionReason: null
    },
    researchManifest: input.researchManifest
  };
}

function selectionTrialId(
  batchId: string,
  runIndex: number,
  runId: string
): string {
  return `${batchId}:trial:${String(runIndex).padStart(6, "0")}:${runId}`;
}

function hashTrialValue(value: unknown): Sha256Hash {
  return createReplayResearchHash(value);
}

function decisionProviderMode(value: unknown): string {
  const mode = nullableStringField(value, "mode");
  return mode ?? "unknown_provider";
}

function nullableStringField(value: unknown, field: string): string | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const entry = (value as Record<string, unknown>)[field];
  return typeof entry === "string" ? entry : null;
}
