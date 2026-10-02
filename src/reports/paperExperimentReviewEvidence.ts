import { lstat } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { z } from "zod";

import { marketPacketSchema, replayResearchManifestSchema, virtualDecisionSchema, virtualRiskDecisionSchema, virtualTradeSchema } from "../domain/schemas.js";
import { historicalReplayPortfolioTimelineRecordSchema, historicalReplayRunMetadataSchema } from "../replay/historicalReplayAuditLog.js";
import { historicalReplayProgressSnapshotSchema } from "../replay/historicalReplayProgress.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { PAPER_EXPERIMENT_ARTIFACTS } from "../storage/paperExperimentContract.js";
import { PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH, paperExperimentExecutionReceiptSchema } from "../storage/paperExperimentExecutionReceipt.js";
import { assertExperimentPath, assertExperimentPathSyntax, readExperimentFile, requireExperimentStorage, storageError } from "../storage/paperExperimentFilesystem.js";
import { parseExperimentJsonl } from "../storage/paperExperimentInventory.js";
import { paperExperimentReportSchema } from "../storage/paperExperimentReportContract.js";
import { inspectPaperExperimentAttempt, type PaperExperimentStoreLocation } from "../storage/paperExperimentStore.js";

export const REVIEW_ARTIFACT_PATHS = Object.freeze({ ...PAPER_EXPERIMENT_ARTIFACTS, execution: PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH });
export type ReviewArtifactKey = keyof typeof REVIEW_ARTIFACT_PATHS;
export interface ReviewArtifactStatus {
  artifact: string;
  status: "verified" | "partial" | "unavailable";
  recordCount: number | null;
  errorCode: string | null;
}

/** Read only fixed paths. Persisted path strings are never followed. No engine/provider imports. */
export async function readPaperExperimentReviewEvidence(location: PaperExperimentStoreLocation, attemptId: string) {
  let admitted = { ...location, protectedPaths: Array.isArray(location.protectedPaths) ? [...location.protectedPaths] : location.protectedPaths };
  try {
    assertExperimentPathSyntax(admitted.rootDir);
    requireExperimentStorage(Array.isArray(admitted.protectedPaths), "INVALID_REQUEST");
    for (const path of admitted.protectedPaths) assertExperimentPathSyntax(path);
    admitted = { rootDir: resolve(admitted.rootDir), protectedPaths: admitted.protectedPaths.map((path) => resolve(path)) };
  } catch { /* Preserve invalid spelling for the existing inspector's fail-closed error projection. */ }
  const inspection = await inspectPaperExperimentAttempt(admitted, attemptId);
  const artifacts: ReviewArtifactStatus[] = (["input", "source"] as const).map((key) => ({
    artifact: REVIEW_ARTIFACT_PATHS[key], status: inspection.input ? "verified" : "unavailable",
    recordCount: inspection.input ? key === "input" ? 1 : inspection.input.preflight.snapshotCount : null,
    errorCode: inspection.input ? null : inspection.errorCode ?? "INPUT_UNAVAILABLE"
  }));
  let verified = inspection.status === "completed" && inspection.state?.executionReceiptRequired === true;
  const canRead = inspection.state !== null && inspection.input !== null
    && !["PATH_UNSAFE", "PATH_OVERLAP", "INVALID_REQUEST", "INPUT_INTEGRITY", "STATE_INVALID"].includes(inspection.errorCode ?? "");
  const root = canRead ? admitted.rootDir : null;
  async function storageOrigin(): Promise<string | null> {
    if (root === null) return null;
    try {
      await assertExperimentPath(root);
      const directory = await lstat(root, { bigint: true });
      requireExperimentStorage(directory.isDirectory() && !directory.isSymbolicLink() && directory.ino > 0n, "PATH_UNSAFE");
      return createReplayResearchHash({ device: String(directory.dev), inode: String(directory.ino),
        volume: process.platform === "win32" ? parse(root).root.toLowerCase() : null });
    } catch { return null; }
  }
  const originBefore = await storageOrigin();
  async function read<T>(key: Exclude<ReviewArtifactKey, "input" | "source">, schema: z.ZodType<T>, jsonl = false): Promise<T | null> {
    const artifact = REVIEW_ARTIFACT_PATHS[key];
    if (!canRead) {
      artifacts.push({ artifact, status: "unavailable", recordCount: null, errorCode: inspection.errorCode ?? "INPUT_UNAVAILABLE" });
      return null;
    }
    try {
      const text = await readExperimentFile(join(root!, attemptId, artifact), 16 * 1024 * 1024);
      let raw: unknown;
      let value: T;
      try {
        raw = jsonl ? parseExperimentJsonl(text, schema) : JSON.parse(text);
        value = jsonl ? raw as T : schema.parse(raw);
      } catch { throw Object.assign(new Error(), { reviewCode: "ARTIFACT_INTEGRITY" }); }
      const inventory = inspection.state?.artifactInventory?.find((entry) => entry.relativePath === artifact);
      if (verified && (!inventory || inventory.digest !== createReplayResearchHash(raw))) {
        throw Object.assign(new Error(), { reviewCode: "ARTIFACT_INTEGRITY" });
      }
      artifacts.push({ artifact, status: verified ? "verified" : "partial",
        recordCount: jsonl ? (raw as unknown[]).length : 1, errorCode: null });
      return value;
    } catch (error) {
      verified = false;
      artifacts.push({ artifact, status: "unavailable", recordCount: null,
        errorCode: error instanceof Error && "reviewCode" in error ? String(error.reviewCode) : storageError(error).code });
      return null;
    }
  }
  const manifest = await read("manifest", replayResearchManifestSchema);
  const metadata = await read("metadata", historicalReplayRunMetadataSchema);
  const progress = await read("progress", historicalReplayProgressSnapshotSchema);
  const report = await read("report", paperExperimentReportSchema);
  // Each row is parsed by the existing strict JSONL reader; array schema is a type adapter only.
  const rows = async <T>(key: "packets" | "decisions" | "riskDecisions" | "trades" | "timeline", schema: z.ZodType<T>) =>
    await read(key, schema, true) as T[] | null;
  const packets = await rows("packets", marketPacketSchema);
  const decisions = await rows("decisions", virtualDecisionSchema);
  const risks = await rows("riskDecisions", virtualRiskDecisionSchema);
  const trades = await rows("trades", virtualTradeSchema);
  const timeline = await rows("timeline", historicalReplayPortfolioTimelineRecordSchema);
  const execution = await read("execution", paperExperimentExecutionReceiptSchema);
  // A reader can race an active writer. It never promotes a mixed or changed snapshot to completed.
  const after = await inspectPaperExperimentAttempt(admitted, attemptId);
  const originAfter = await storageOrigin();
  const originStable = originBefore !== null && originBefore === originAfter;
  const stable = createReplayResearchHash(after) === createReplayResearchHash(inspection) && (!canRead || originStable);
  if (!stable) verified = false;
  if (!verified) for (const artifact of artifacts) {
    const isInput = artifact.artifact === REVIEW_ARTIFACT_PATHS.input || artifact.artifact === REVIEW_ARTIFACT_PATHS.source;
    if (artifact.status === "verified" && (!isInput || !stable)) artifact.status = "partial";
  }
  return { storageOrigin: originStable ? originBefore : null, inspection: stable ? inspection : { ...inspection, status: "incomplete" as const,
    input: null, errorCode: "ARTIFACT_INTEGRITY" as const }, verified, artifacts, manifest, metadata, progress, report, packets, decisions, risks, trades, timeline, execution };
}
export type PaperExperimentReviewEvidence = Awaited<ReturnType<typeof readPaperExperimentReviewEvidence>>;

/** Field-level whitelist. All simulated/source/evaluation times, record identities, dataRefs and array order survive. */
export function paperExperimentSemanticProjection(evidence: PaperExperimentReviewEvidence) {
  function omit<T extends object>(value: T | null, keys: readonly string[]) {
    return value === null ? null : Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  }
  const manifest = (value: PaperExperimentReviewEvidence["manifest"]) => omit(value, ["runId", "batchId"]);
  const metadata = omit(evidence.metadata, ["identity", "logPaths", "startedAt", "updatedAt", "completedAt", "failedAt", "researchManifest"]);
  const report = evidence.report === null ? null : { ...evidence.report,
    reproducibility: omit(evidence.report.reproducibility, ["manifestPath"]) };
  const execution = evidence.execution === null ? null : {
    ...omit(evidence.execution, ["runId", "expectedManifest", "artifactDigests"]),
    expectedManifest: manifest(evidence.execution.expectedManifest),
    // These two digests incorporate the run ID / absolute manifest path removed above.
    artifactDigests: omit(evidence.execution.artifactDigests, ["manifest", "report"])
  };
  return { input: evidence.inspection.input?.normalizedInput ?? null, coverage: evidence.inspection.input?.preflight ?? null,
    manifest: manifest(evidence.manifest), metadata: metadata === null ? null : { ...metadata, researchManifest: manifest(evidence.metadata!.researchManifest) },
    progress: omit(evidence.progress, ["startedAt", "updatedAt", "completedAt", "failedAt", "performance", "finalReportPath"]),
    report, packets: evidence.packets, decisions: evidence.decisions, risks: evidence.risks,
    trades: evidence.trades, timeline: evidence.timeline, execution };
}

export function comparePaperExperimentEvidence(left: PaperExperimentReviewEvidence, right: PaperExperimentReviewEvidence) {
  const reasons: string[] = [];
  const originsKnown = [left, right].every((evidence) => typeof evidence.storageOrigin === "string"
    && /^sha256:[a-f0-9]{64}$/.test(evidence.storageOrigin));
  if (!originsKnown) reasons.push("VERIFIED_STORAGE_ORIGIN_REQUIRED");
  if (originsKnown && left.storageOrigin === right.storageOrigin
    && left.inspection.state?.attemptId === right.inspection.state?.attemptId) reasons.push("DISTINCT_ATTEMPTS_REQUIRED");
  if (!left.verified || !right.verified) reasons.push("VERIFIED_EXECUTION_REQUIRED");
  if (left.inspection.state?.inputHash !== right.inspection.state?.inputHash) reasons.push("INPUT_MISMATCH");
  if (createReplayResearchHash(left.inspection.state?.runtimeIdentity ?? null)
    !== createReplayResearchHash(right.inspection.state?.runtimeIdentity ?? null)) reasons.push("RUNTIME_MISMATCH");
  if (reasons.length) return { status: "incomparable" as const, reasons, differences: [] as string[], leftHash: null, rightHash: null };
  const a = paperExperimentSemanticProjection(left), b = paperExperimentSemanticProjection(right);
  const differences = (Object.keys(a) as (keyof typeof a)[]).filter((key) => createReplayResearchHash(a[key]) !== createReplayResearchHash(b[key]));
  return { status: differences.length ? "mismatch" as const : "identical" as const, reasons, differences,
    leftHash: createReplayResearchHash(a), rightHash: createReplayResearchHash(b) };
}
