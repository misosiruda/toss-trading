import { join } from "node:path";

import { replayResearchManifestSchema, virtualDecisionSchema, type MarketPacket } from "../domain/schemas.js";
import { bindVirtualDecisionHash } from "../paper/decisionHash.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { bindDecisionIdentityMetadata, createStaticDecisionIdentityMetadata } from "../paper/decisionIdentity.js";
import { validateVirtualDecisionAgainstPacket } from "../paper/virtualDecisionValidation.js";
import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";
import { parseHistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";
import { parsePaperExperimentInput } from "../replay/paperExperimentInput.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { buildHistoricalReplayReport } from "../reports/historicalReplayReport.js";
import { PAPER_EXPERIMENT_ARTIFACTS } from "../storage/paperExperimentContract.js";
import { createPaperExperimentExecutionReceipt, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH } from "../storage/paperExperimentExecutionReceipt.js";
import { readExperimentFile, writeExclusiveExperimentFile, PaperExperimentStorageError } from "../storage/paperExperimentFilesystem.js";
import {
  createPaperExperimentAttempt, retryPaperExperimentAttempt,
  type CreatePaperExperimentAttemptOptions
} from "../storage/paperExperimentStore.js";
import {
  createWorkflowResearchManifest, runHistoricalReplayWorkflow,
  type HistoricalReplayWorkflowOptions, type HistoricalReplayWorkflowResult
} from "./historicalReplayWorkflow.js";
import { createHistoricalReplayWorkflowPlan } from "./historicalReplayWorkflowPlan.js";

type Owner = Awaited<ReturnType<typeof createPaperExperimentAttempt>>;
export type PaperExperimentWorkflowOptions = CreatePaperExperimentAttemptOptions
  | (Omit<CreatePaperExperimentAttemptOptions, "inputJson"> & { parentAttemptId: string });

/** Trusted backend seam for integration faults only. No CLI/input/env provider selection. */
export interface PaperExperimentWorkflowDependencies {
  workflow?: typeof runHistoricalReplayWorkflow;
  now?: () => Date;
  onPrepared?: (attempt: { attemptId: string; artifactRoot: string }) => void | Promise<void>;
}

export class PaperExperimentExecutionError extends Error {
  constructor(readonly code: "EXECUTION_FAILED" | "ARTIFACT_INTEGRITY", readonly attemptId: string,
    readonly artifactRoot: string, readonly failureRecorded: boolean) {
    super(`Paper experiment execution failed: ${code}`);
    this.name = "PaperExperimentExecutionError";
  }
}

/** A new clock, sampling policy and fixture provider are constructed for every attempt. */
export function paperExperimentWorkflowOptions(owner: Owner): HistoricalReplayWorkflowOptions {
  // Mutable legacy interfaces get their own plain JSON copy; the retained source never changes.
  const input = JSON.parse(JSON.stringify(owner.input.normalizedInput)) as ReturnType<typeof parsePaperExperimentInput>["normalizedInput"];
  const config = input.configuration;
  const sampling = config.samplingPolicy!;
  return {
    storageBaseDir: owner.paths.replayDir, historicalMarketSnapshotsPath: owner.paths.sourcePath,
    runId: owner.runId, generatedAt: new Date(input.evaluation.generatedAt),
    clock: new SimulatedClock({ startAt: new Date(config.clock.startAt), endAt: new Date(config.clock.endAt),
      stepSeconds: config.clock.stepSeconds, speedMultiplier: config.clock.speedMultiplier }),
    samplingPolicy: new ReplaySamplingPolicy({ ...(sampling.everyNSteps === null ? {} : { everyNSteps: sampling.everyNSteps }),
      candidateChangedOnly: sampling.candidateChangedOnly, decisionFrequency: sampling.decisionFrequency,
      maxDecisionCalls: sampling.maxDecisionCalls!, timezoneOffsetMinutes: sampling.timezoneOffsetMinutes }),
    decisionProvider: createPaperExperimentFixtureProvider(),
    decisionProviderMetadata: input.provider,
    universeManifest: parseHistoricalUniverseManifest(input.universe),
    initialCashKrw: config.initialCashKrw, packetIdPrefix: config.packetIdPrefix,
    packetExpiresInSeconds: config.packetExpiresInSeconds, maxCandidates: config.maxCandidates,
    maxSnapshotAgeSeconds: config.maxSnapshotAgeSeconds,
    constraints: JSON.parse(JSON.stringify(config.constraints)),
    executionPolicy: JSON.parse(JSON.stringify(config.executionPolicy)),
    riskProfile: config.riskProfile!, riskPolicy: JSON.parse(JSON.stringify(config.riskPolicy)),
    allocationPolicy: JSON.parse(JSON.stringify(config.allocationPolicy))
    // v1 rejects exit/regime/preset extensions. Cash and the auxiliary benchmarks are the existing report's fixed formulas.
  };
}

export async function runPaperExperimentWorkflow(options: PaperExperimentWorkflowOptions,
  dependencies: PaperExperimentWorkflowDependencies = {}) {
  // Preserve precise admission codes and perform bounded admission before any storage creation.
  if ("inputJson" in options) parsePaperExperimentInput(options.inputJson, { implementationRevision: options.runtimeIdentity.implementationRevision });
  const owner = "parentAttemptId" in options
    ? await retryPaperExperimentAttempt({ ...options, executionReceiptRequired: true })
    : await createPaperExperimentAttempt({ ...options, executionReceiptRequired: true });
  const now = dependencies.now ?? (() => new Date());
  let verifying = false;
  try {
    const workflowOptions = paperExperimentWorkflowOptions(owner);
    const expectedManifest = expectedExperimentManifest(owner, workflowOptions);
    await dependencies.onPrepared?.({ attemptId: owner.attemptId, artifactRoot: owner.paths.attemptDir });
    await owner.start(now());
    const result = await (dependencies.workflow ?? runHistoricalReplayWorkflow)(workflowOptions);
    verifying = true;
    await verifyExecutedExperiment(owner, result, expectedManifest);
    const receipt = createPaperExperimentExecutionReceipt({ runId: owner.runId, inputHash: owner.input.inputHash,
      expectedManifest, report: result.report, result: result.replayResult });
    await writeExclusiveExperimentFile(join(owner.paths.attemptDir, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH), `${JSON.stringify(receipt)}\n`);
    await owner.complete(now());
    return { status: "completed" as const, attemptId: owner.attemptId, artifactRoot: owner.paths.attemptDir,
      inputHash: owner.input.inputHash, result };
  } catch (error) {
    const integrity = verifying || (error instanceof PaperExperimentStorageError && error.code === "INPUT_INTEGRITY");
    let failureRecorded = false;
    try { await owner.fail(integrity ? "artifact_integrity_failed" : "execution_failed", now()); failureRecorded = true; }
    catch { /* No repair: a fresh reader reports incomplete if the failure marker could not be written. */ }
    throw new PaperExperimentExecutionError(integrity ? "ARTIFACT_INTEGRITY" : "EXECUTION_FAILED",
      owner.attemptId, owner.paths.attemptDir, failureRecorded);
  }
}

function expectedExperimentManifest(owner: Owner, options: HistoricalReplayWorkflowOptions) {
  const snapshots = JSON.parse(JSON.stringify(owner.input.normalizedInput.source.snapshots));
  const createdAt = options.generatedAt!;
  const plan = createHistoricalReplayWorkflowPlan({ options, storedPortfolio: null, snapshots,
    replayStartedAt: createdAt, decisionProvider: options.decisionProvider! });
  return createWorkflowResearchManifest({ plan, snapshots, corruptLineCount: 0, hasExplicitDecisionProvider: true,
    decisionProviderMetadata: options.decisionProviderMetadata, universeManifest: options.universeManifest, createdAt });
}

async function verifyExecutedExperiment(owner: Owner, result: HistoricalReplayWorkflowResult,
  expectedManifest: ReturnType<typeof expectedExperimentManifest>) {
  function equal(a: unknown, b: unknown) {
    if (createReplayResearchHash(a) !== createReplayResearchHash(b)) throw new PaperExperimentStorageError("ARTIFACT_INTEGRITY");
  }
  const artifact = (key: keyof typeof PAPER_EXPERIMENT_ARTIFACTS) => join(owner.paths.attemptDir, PAPER_EXPERIMENT_ARTIFACTS[key]);
  equal(result.status, "completed"); equal(result.mode, "paper_only");
  equal(result.reportPath, artifact("report")); equal(result.researchManifestPath, artifact("manifest"));
  const manifest = replayResearchManifestSchema.parse(JSON.parse(await readExperimentFile(artifact("manifest"), 1024 * 1024)));
  equal(manifest, expectedManifest);
  equal(JSON.parse(await readExperimentFile(artifact("report"), 16 * 1024 * 1024)), result.report);
  equal(result.report, buildHistoricalReplayReport({ result: result.replayResult,
    generatedAt: new Date(owner.input.normalizedInput.evaluation.generatedAt), researchManifest: expectedManifest,
    researchManifestPath: artifact("manifest") }));
  for (const [key, records] of [["packets", result.replayResult.packets], ["decisions", result.replayResult.decisions.map(bindVirtualDecisionHash)],
    ["riskDecisions", result.replayResult.riskDecisions], ["trades", result.replayResult.trades]] as const) {
    const text = await readExperimentFile(artifact(key), 16 * 1024 * 1024);
    equal(text === "" ? [] : text.trimEnd().split("\n").map((line) => JSON.parse(line)), records);
  }
}

/** Static test decisions traverse the same schema and semantic gate; never an executable input option. */
export function createPaperExperimentFixtureProvider(decide: (packet: MarketPacket) => unknown
  = (packet) => new FirstPricedHistoricalDecisionProvider().decide(packet)) {
  return { async decide(packet: MarketPacket) {
    const parsed = virtualDecisionSchema.safeParse(decide(packet));
    const decision = parsed.success ? bindDecisionIdentityMetadata({ ...parsed.data,
      packetHash: parsed.data.packetHash ?? createMarketPacketHash(packet) }, createStaticDecisionIdentityMetadata()) : null;
    if (decision === null || !validateVirtualDecisionAgainstPacket({ packet, decision }).approved) {
      return { attempted: true, decision: null, failure: { code: "AI_DECISION_FAILED" as const,
        reason: "Fixture decision schema or semantic validation failed" }, command: null };
    }
    return { attempted: true, decision, failure: null, command: null };
  } };
}
