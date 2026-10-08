import { types } from "node:util";
import type { PaperSimulationAdmissionEvidence } from "../storage/paperSimulationObservationStore.js";
import { safeArtifactPathPart } from "../storage/artifactPaths.js";
import { createPaperExecutionPolicy } from "../paper/executionModel.js";
import { normalizePaperExitPolicy, type PaperExitPolicy } from "../paper/exitPolicy.js";
import { selectReplayWindow, type ReplayWindowSelection } from "../replay/replayWindowSampler.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { replayInitialPortfolioIdentitySchema, type ReplayInitialPortfolioIdentity } from "./replayInitialPortfolioObservation.js";
import { initialPortfolioObservationReference, type ReplayInitialPortfolioObservation } from "./replaySourceObservation.js";
import { replayDurableSettingsReferenceSchema, type ReplayDurableSettingsReference } from "./replaySettingsObservation.js";
import { prepareReplaySettingsSnapshot } from "./replaySettingsSnapshot.js";
import { PAPER_SIMULATION_CHILD_MAPPING_VERSION, paperSimulationAdmissionReceiptSchema,
  replayAdmissionLineageSchema, replayAdmissionPlannedWindowSchema, type ReplayAdmissionLineage } from "./replayAdmissionLineage.js";

export interface ReplayAdmissionActualChild {
  identity: ReplayInitialPortfolioIdentity;
  startedAt: string;
  windowSamplingMode: string;
  windowSelection: ReplayWindowSelection;
}
const windowKeys = ["seed", "rangeStart", "rangeEnd", "windowMonths", "timezoneOffsetMinutes", "candidateCount",
  "selectedCandidateIndex", "selectedMonth", "localStartDate", "localEndDate", "startAt", "endAt"] as const;
const windowNumbers = new Set<string>(["windowMonths", "timezoneOffsetMinutes", "candidateCount", "selectedCandidateIndex"]);
const mismatch = () => Error("replay admission mapping mismatch");

/** Copy only fixed data descriptors, before serialization, parsing or any untrusted property reads. */
export function captureReplayAdmissionActualChild(value: unknown): Readonly<ReplayAdmissionActualChild> {
  try {
    const child = descriptors(value, ["identity", "startedAt", "windowSamplingMode", "windowSelection"]);
    const identity = descriptors(child.identity, ["runId", "batchId", "runIndex"]);
    boundedText(identity.runId, 256); boundedText(identity.batchId, 256);
    if (!Number.isSafeInteger(identity.runIndex) || (identity.runIndex as number) < 0) throw mismatch();
    const window = descriptors(child.windowSelection, windowKeys);
    for (const key of windowKeys) {
      if (windowNumbers.has(key)) {
        if (typeof window[key] !== "number" || !Number.isSafeInteger(window[key])) throw mismatch();
      } else boundedText(window[key], key === "seed" ? 140 : 80);
    }
    boundedText(child.startedAt, 80); boundedText(child.windowSamplingMode, 80);
    return Object.freeze({ identity: Object.freeze(replayInitialPortfolioIdentitySchema.parse(identity)),
      startedAt: child.startedAt as string, windowSamplingMode: child.windowSamplingMode as string,
      windowSelection: Object.freeze(window) as unknown as ReplayWindowSelection });
  } catch { throw mismatch(); }
}

/** The storage owner must resolve the issued context first and supply its own durable observations.
 * This pure factory cannot turn a receipt or arbitrary JSON into issuer authority. */
export function createReplayAdmissionLineage(
  evidence: Extract<PaperSimulationAdmissionEvidence, { status: "available" }>,
  actualValue: unknown, initial: ReplayInitialPortfolioObservation, settingsValue: ReplayDurableSettingsReference
): ReplayAdmissionLineage {
  try {
    const actual = captureReplayAdmissionActualChild(actualValue);
    const settings = replayDurableSettingsReferenceSchema.parse(settingsValue);
    const receipt = paperSimulationAdmissionReceiptSchema.parse(evidence.receipt);
    const config = evidence.snapshot.effectiveConfig;
    const index = actual.identity.runIndex;
    if (evidence.status !== "available" || receipt.simulationRunId !== evidence.simulationRunId ||
      receipt.batchId !== evidence.batchId || receipt.acceptedAt !== evidence.acceptedAt ||
      actual.identity.batchId !== evidence.batchId || index >= config.runCount ||
      actual.startedAt !== new Date(Date.parse(evidence.acceptedAt) + index).toISOString()) throw mismatch();
    assertObservationBinding(actual, initial, settings);
    const seed = config.window.seed.trim();
    if (seed.length === 0) throw mismatch();
    const childSeed = `${seed}:${index}`;
    let expectedWindow: ReplayWindowSelection;
    if (config.window.mode === "fixed_range") {
      if (config.window.fixedWindow === null || config.window.windowMonths !== null) throw mismatch();
      expectedWindow = { ...config.window.fixedWindow, seed: childSeed };
    } else {
      if (config.window.fixedWindow !== null || config.window.windowMonths === null) throw mismatch();
      expectedWindow = selectReplayWindow({ rangeStart: new Date(config.window.rangeStartAt),
        rangeEnd: new Date(config.window.rangeEndAt), seed: childSeed, windowMonths: config.window.windowMonths,
        timezoneOffsetMinutes: config.window.timezoneOffsetMinutes });
    }
    const expectedRunId = `${safeArtifactPathPart(evidence.batchId, "batch")}_run_${String(index).padStart(6, "0")}_${safeArtifactPathPart(expectedWindow.selectedMonth, "window")}`;
    if (actual.identity.runId !== expectedRunId || windowKeys.some(key => actual.windowSelection[key] !== expectedWindow[key])) throw mismatch();
    const expectedMode = config.window.mode === "fixed_range" ? "fixed_range" : "random";
    if (["fixed_range", "random"].includes(actual.windowSamplingMode) && actual.windowSamplingMode !== expectedMode) throw mismatch();
    // The writer's JSON-parsed snapshot has no own undefined values.
    const exit = normalizePaperExitPolicy((config.paperExitPolicy ?? undefined) as PaperExitPolicy | undefined);
    const expectedSettings = prepareReplaySettingsSnapshot({
      packetIdPrefix: `packet_${safeArtifactPathPart(evidence.batchId, "simulation")}_${index}`,
      packetExpiresInSeconds: 60, maxCandidates: 10, maxSnapshotAgeSeconds: 86_400,
      tickDelayMs: config.tickDelayMs, constraints: config.constraints,
      executionPolicy: createPaperExecutionPolicy(config.costModel.executionPolicy),
      riskPolicy: config.riskPolicy, allocationPolicy: config.allocationPolicy,
      ...(exit === null ? {} : { paperExitPolicy: exit })
    });
    const actualSettings = settings.settingsObservation.settings;
    if (actualSettings.status === "unavailable" && ["redacted", "inspection_unavailable"].includes(actualSettings.reason)) throw mismatch();
    if (expectedSettings.status === "recorded" && actualSettings.status === "recorded" &&
      expectedSettings.contentHash !== actualSettings.contentHash) throw mismatch();
    const portfolio = initial.initialPortfolio;
    if (portfolio.status === "recorded") {
      if (portfolio.contentHash !== createReplayResearchHash({ schemaVersion: portfolio.snapshotVersion, snapshot: portfolio.snapshot })) throw mismatch();
      if (portfolio.origin === "generated" && createReplayResearchHash(portfolio.snapshot) !== createReplayResearchHash({
        portfolioId: "virtual_default", cashKrw: config.capital.initialCashKrw, positions: [], updatedAt: expectedWindow.startAt
      })) throw mismatch();
    }
    let lineage: ReplayAdmissionLineage["lineage"];
    const plannedWindow = replayAdmissionPlannedWindowSchema.safeParse(expectedWindow);
    // Only the owner-derived expected plan can trigger a grammar fallback, after all supported comparisons.
    if (actual.windowSamplingMode !== expectedMode || !plannedWindow.success) {
      lineage = { status: "unavailable", reason: "unsupported_derivation" };
    } else if (expectedSettings.status !== "recorded" || actualSettings.status !== "recorded") {
      lineage = { status: "unavailable", reason: "settings_unavailable" };
    } else if (portfolio.status !== "recorded") {
      lineage = { status: "unavailable", reason: "initial_unavailable" };
    } else {
      lineage = { status: "recorded", receipt, mappingVersion: PAPER_SIMULATION_CHILD_MAPPING_VERSION,
        effectiveRunCount: config.runCount, windowMode: config.window.mode, normalizedBatchSeed: seed,
        plannedWindow: plannedWindow.data, expectedSettingsHash: expectedSettings.contentHash,
        initialCapitalRelation: portfolio.origin === "generated" ? "generated_matches_admission" : "stored_portfolio_precedence" };
    }
    return replayAdmissionLineageSchema.parse({
      schemaVersion: "replay_admission_lineage.v1", mode: "paper_only", phase: "child_admission_binding",
      identity: actual.identity, startedAt: actual.startedAt, reservationHash: settings.reservationHash,
      initialObservation: settings.initialObservation, sourceObservation: settings.sourceObservation,
      settingsObservation: settings.settingsObservation, lineage,
      clock: "unavailable", sampler: "unavailable", provider: "unavailable", acquisition: "unavailable", sourceTrust: "unavailable",
      sourceFileIdentity: "unavailable", sourceReadCompleteness: "unavailable", runtime: "unavailable", dependencies: "unavailable",
      result: "unavailable", completeConfiguration: false, completeInput: false, comparability: "unavailable"
    });
  } catch { throw mismatch(); }
}

function assertObservationBinding(actual: ReplayAdmissionActualChild, initial: ReplayInitialPortfolioObservation, settings: ReplayDurableSettingsReference): void {
  for (const record of [initial, settings]) {
    if (record.identity.runId !== actual.identity.runId || record.identity.batchId !== actual.identity.batchId ||
      record.identity.runIndex !== actual.identity.runIndex || record.startedAt !== actual.startedAt) throw mismatch();
  }
  if (initial.reservationHash !== settings.reservationHash ||
    initial.reservationHash !== createReplayResearchHash({ schemaVersion: "replay_initial_portfolio_reservation.v1",
      identity: initial.identity, startedAt: initial.startedAt, origin: initial.initialPortfolio.origin }) ||
    createReplayResearchHash(initialPortfolioObservationReference(initial)) !== createReplayResearchHash(settings.initialObservation) ||
    (settings.sourceObservation.source.status === "unavailable" && settings.sourceObservation.source.reason === "redacted")) throw mismatch();
}

function boundedText(value: unknown, max: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw mismatch();
}
function descriptors(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value)) throw mismatch();
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw mismatch();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) throw mismatch();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw mismatch();
    result[key] = descriptor.value;
  }
  return result;
}
