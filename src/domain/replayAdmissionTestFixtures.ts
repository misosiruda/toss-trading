import { resolvePaperSimulationConfig, type PaperSimulationRunConfig } from "../api/paperSimulationConfig.js";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import type { PaperSimulationAdmissionEvidence } from "../storage/paperSimulationObservationStore.js";
import { safeArtifactPathPart } from "../storage/artifactPaths.js";
import { createHistoricalReplayWorkflowPlan, type HistoricalReplayWorkflowOptions } from "../workflows/historicalReplayWorkflowPlan.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { sourceDecision } from "../replay/codexReplaySourceTestFixtures.js";
import { selectReplayWindow } from "../replay/replayWindowSampler.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { paperSimulationInputSnapshotSchema } from "./paperSimulationInputSnapshot.js";
import { observeReplayInitialPortfolio, replayInitialPortfolioObservationSchema } from "./replayInitialPortfolioObservation.js";
import { initialPortfolioObservationReference, replaySourceObservationSchema } from "./replaySourceObservation.js";
import { durableSourceObservationReference, durableSettingsObservationReference, replaySettingsObservationSchema } from "./replaySettingsObservation.js";
import { prepareReplaySettingsSnapshot } from "./replaySettingsSnapshot.js";
import { prepareReplaySourceSnapshot } from "./replaySourceSnapshot.js";
import type { ReplayAdmissionActualChild } from "./replayAdmissionMapping.js";
import type { VirtualPortfolio } from "./schemas.js";

/** Synthetic data for the pure mapping function; it is deliberately not an issued context. */
export function admissionMappingFixture(input: {
  config?: PaperSimulationRunConfig; index?: number; storedPortfolio?: VirtualPortfolio; tickDelayMs?: number;
} = {}) {
  const snapshot = paperSimulationInputSnapshotSchema.parse(resolvePaperSimulationConfig(input.config ?? simulationConfig(),
    { PAPER_SIMULATION_TICK_DELAY_MS: String(input.tickDelayMs ?? 17) }));
  const id = "paper_sim_20261008090000000_mapping";
  const acceptedAt = "2026-10-08T09:00:00.000Z";
  const evidence: Extract<PaperSimulationAdmissionEvidence, { status: "available" }> = {
    status: "available", simulationRunId: id, batchId: id, acceptedAt, snapshot,
    receipt: { receiptVersion: "paper_simulation_admission_receipt.v1", simulationRunId: id, batchId: id, acceptedAt,
      canonicalVersion: "paper_simulation_canonical_request.v1", canonicalRequestHash: createReplayResearchHash({ fixture: "canonical" }),
      inputVersion: "paper_simulation_input_provenance.v1", inputProvenanceHash: createReplayResearchHash({ fixture: "input" }) }
  };
  const config = snapshot.effectiveConfig, index = input.index ?? 0;
  const seed = `${config.window.seed.trim()}:${index}`;
  const window = config.window.fixedWindow === null
    ? selectReplayWindow({ rangeStart: new Date(config.window.rangeStartAt), rangeEnd: new Date(config.window.rangeEndAt),
      seed, windowMonths: config.window.windowMonths!, timezoneOffsetMinutes: 540 })
    : { ...config.window.fixedWindow, seed };
  const actual: ReplayAdmissionActualChild = { identity: { batchId: id, runIndex: index,
    runId: `${id}_run_${String(index).padStart(6, "0")}_${safeArtifactPathPart(window.selectedMonth, "window")}` },
    startedAt: new Date(Date.parse(acceptedAt) + index).toISOString(),
    windowSamplingMode: config.window.mode === "fixed_range" ? "fixed_range" : "random", windowSelection: window };
  const options = {
    storageBaseDir: "fixture", clock: new SimulatedClock({ startAt: new Date(window.startAt), endAt: new Date(window.endAt), stepSeconds: 2_592_000 }),
    packetIdPrefix: `packet_${id}_${index}`, packetExpiresInSeconds: 60, maxCandidates: 10, maxSnapshotAgeSeconds: 86_400,
    constraints: config.constraints, executionPolicy: config.costModel.executionPolicy, riskPolicy: config.riskPolicy,
    allocationPolicy: config.allocationPolicy, tickDelayMs: config.tickDelayMs,
    ...(config.paperExitPolicy === null ? {} : { paperExitPolicy: config.paperExitPolicy }),
    initialCashKrw: config.capital.initialCashKrw, runId: actual.identity.runId, batchId: id, batchRunIndex: index, windowSelection: window
  };
  const plan = createHistoricalReplayWorkflowPlan({ options: options as HistoricalReplayWorkflowOptions, storedPortfolio: input.storedPortfolio ?? null,
    snapshots: [], replayStartedAt: new Date(actual.startedAt), decisionProvider: { decide: async packet => sourceDecision(packet) } });
  const origin = input.storedPortfolio === undefined ? "generated" : "stored_portfolio";
  const reservationHash = createReplayResearchHash({ schemaVersion: "replay_initial_portfolio_reservation.v1",
    identity: actual.identity, startedAt: actual.startedAt, origin });
  const initial = replayInitialPortfolioObservationSchema.parse({
    schemaVersion: "replay_initial_portfolio_observation.v1", mode: "paper_only", phase: "runner_initial_state",
    identity: actual.identity, startedAt: actual.startedAt, reservationHash,
    initialPortfolio: observeReplayInitialPortfolio(plan.initialPortfolio, origin), admission: "unavailable", source: "unavailable",
    configuration: "unavailable", runtime: "unavailable", dependencies: "unavailable", result: "unavailable", completeInput: false, comparability: "unavailable"
  });
  const source = replaySourceObservationSchema.parse({
    schemaVersion: "replay_source_observation.v1", mode: "paper_only", phase: "runner_consumed_source",
    identity: actual.identity, startedAt: actual.startedAt, reservationHash, initialObservation: initialPortfolioObservationReference(initial),
    source: prepareReplaySourceSnapshot([]), admission: "unavailable", configuration: "unavailable", acquisition: "unavailable",
    sourceTrust: "unavailable", sourceFileIdentity: "unavailable", sourceReadCompleteness: "unavailable", runtime: "unavailable",
    dependencies: "unavailable", result: "unavailable", completeInput: false, comparability: "unavailable"
  });
  const a = replaySettingsObservationSchema.parse({
    schemaVersion: "replay_settings_observation.v1", mode: "paper_only", phase: "runner_supplied_settings",
    ...durableSourceObservationReference(source), settings: prepareReplaySettingsSnapshot(plan.runnerOptions),
    admission: "unavailable", clock: "unavailable", sampler: "unavailable", provider: "unavailable", acquisition: "unavailable",
    sourceTrust: "unavailable", sourceFileIdentity: "unavailable", sourceReadCompleteness: "unavailable", runtime: "unavailable",
    dependencies: "unavailable", result: "unavailable", completeConfiguration: false, completeInput: false, comparability: "unavailable"
  });
  return { evidence, actual, initial, a, settings: durableSettingsObservationReference(a), plan };
}
