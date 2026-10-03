// Request serialization only. Effective values are exclusively supplied by the server.
export interface SimulationDraft {
  riskProfile: "conservative" | "balanced" | "aggressive_paper";
  market: "mixed_global" | "kr" | "us";
  runType: "single_replay" | "batch_replay";
  runCount: string;
  sourceDataDir: string;
  windowMode: "fixed_range" | "random_month";
  startAt: string;
  endAt: string;
  windowMonths: string;
  seed: string;
  initialCashKrw: string;
  decisionFrequency: "every_tick" | "once_per_day" | "once_per_week";
  stepSeconds: string;
  maxDecisionCalls: string;
  paperExitPolicy: "none" | "take_profit_stop_loss" | "rebalance_threshold";
}

export const emptySimulationDraft: SimulationDraft = {
  riskProfile: "conservative", market: "mixed_global", runType: "single_replay",
  runCount: "1", sourceDataDir: "", windowMode: "fixed_range", startAt: "", endAt: "",
  windowMonths: "1", seed: "", initialCashKrw: "", decisionFrequency: "once_per_day",
  stepSeconds: "86400", maxDecisionCalls: "30", paperExitPolicy: "none"
};

export function typedCandidate(draft: SimulationDraft) {
  if (!["conservative", "balanced", "aggressive_paper"].includes(draft.riskProfile) ||
      !["mixed_global", "kr", "us"].includes(draft.market) || !["single_replay", "batch_replay"].includes(draft.runType) ||
      !["fixed_range", "random_month"].includes(draft.windowMode) || !["every_tick", "once_per_day", "once_per_week"].includes(draft.decisionFrequency) ||
      !["none", "take_profit_stop_loss", "rebalance_threshold"].includes(draft.paperExitPolicy)) return null;
  const integers = [draft.runCount, draft.windowMonths, draft.initialCashKrw, draft.stepSeconds, draft.maxDecisionCalls];
  if (integers.some((value) => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) return null;
  if (!draft.sourceDataDir || !draft.startAt || !draft.endAt || !draft.seed) return null;
  return {
    mode: "paper_only" as const, runType: draft.runType, runCount: Number(draft.runCount),
    sourceDataDir: draft.sourceDataDir,
    universe: { preset: "source_snapshots", market: draft.market },
    window: { mode: draft.windowMode, seed: draft.seed, startAt: draft.startAt, endAt: draft.endAt, windowMonths: Number(draft.windowMonths) },
    samplingPolicy: { decisionFrequency: draft.decisionFrequency, stepSeconds: Number(draft.stepSeconds), maxDecisionCalls: Number(draft.maxDecisionCalls), maxCodexCallsPerRun: 0 },
    capital: { initialCashKrw: Number(draft.initialCashKrw) },
    decisionProvider: { mode: "dry_run_fixture" as const, modelId: "fixture", outputSchema: "schemas/virtual-decision.schema.json" as const },
    riskProfile: draft.riskProfile, paperExitPolicy: draft.paperExitPolicy,
    costModel: "standard" as const, benchmarkPolicy: "cash_equal_weight_initial_hold" as const
  };
}
export type SimulationCandidate = NonNullable<ReturnType<typeof typedCandidate>>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
export interface SimulationValidation {
  schemaVersion: "paper_simulation_validation.v1";
  status: "valid";
  requestedConfig: SimulationCandidate;
  effectiveConfig: {
    mode: "paper_only"; runType: SimulationCandidate["runType"]; runCount: number; sourceDataDir: string;
    universe: { selection: "source_snapshots"; presetApplied: false; marketFilterApplied: false; allocationMode: string };
    window: { mode: string; seed: string; rangeStartAt: string; rangeEndAt: string; windowMonths: number | null; fixedWindow: JsonObject | null; timezoneOffsetMinutes: number };
    samplingPolicy: SimulationCandidate["samplingPolicy"];
    capital: SimulationCandidate["capital"];
    decisionProvider: { mode: "dry_run_fixture"; modelId: null; outputSchema: null };
    riskProfile: string; constraints: JsonObject; riskPolicy: JsonObject; allocationPolicy: JsonObject;
    paperExitPolicy: JsonObject | null; costModel: JsonObject;
    benchmarkPolicy: { mode: "fixed_report_benchmarks"; names: string[]; equalWeightAvailability: string };
    portfolioPolicyApplied: false; tickDelayMs: number;
  };
  notices: Array<{ field: string; code: string; message: string }>;
  sourceDataKind: "unknown";
  dataAvailabilityChecked: false;
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => equalJson(v, right[i]));
  if (!isObject(left) || !isObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const numericFields = (value: unknown, keys: string[]) => isObject(value) && keys.every(key => finite(value[key]));

export function readValidation(value: unknown, candidate: SimulationCandidate): SimulationValidation | null {
  if (!isObject(value) || value.schemaVersion !== "paper_simulation_validation.v1" || value.status !== "valid" ||
      value.mode !== "paper_only" || value.readOnly !== true || value.storageMutationEnabled !== false ||
      value.liveTradingEnabled !== false || value.orderPlacementEnabled !== false || value.replayRunnerStarted !== false ||
      value.dataAvailabilityChecked !== false || value.sourceDataKind !== "unknown" || !equalJson(value.requestedConfig, candidate)) return null;
  const e = value.effectiveConfig;
  if (!isObject(e) || e.mode !== "paper_only" || e.runType !== candidate.runType || !Number.isSafeInteger(e.runCount) || Number(e.runCount) < 1 ||
      e.sourceDataDir !== candidate.sourceDataDir || e.riskProfile !== candidate.riskProfile || e.portfolioPolicyApplied !== false || !finite(e.tickDelayMs)) return null;
  const { universe: u, window: w, samplingPolicy: s, capital: c, decisionProvider: p, benchmarkPolicy: b } = e;
  if (!isObject(u) || u.selection !== "source_snapshots" || u.presetApplied !== false || u.marketFilterApplied !== false || typeof u.allocationMode !== "string" ||
      !isObject(w) || w.mode !== candidate.window.mode || w.seed !== candidate.window.seed || !date(w.rangeStartAt) || !date(w.rangeEndAt) || !finite(w.timezoneOffsetMinutes) ||
      !(w.windowMonths === null || finite(w.windowMonths)) || !(w.fixedWindow === null || isObject(w.fixedWindow)) ||
      !isObject(s) || s.decisionFrequency !== candidate.samplingPolicy.decisionFrequency || !finite(s.stepSeconds) || !finite(s.maxDecisionCalls) || s.maxCodexCallsPerRun !== 0 ||
      !isObject(c) || !finite(c.initialCashKrw) || !isObject(p) || p.mode !== "dry_run_fixture" || p.modelId !== null || p.outputSchema !== null ||
      !isObject(b) || b.mode !== "fixed_report_benchmarks" || !Array.isArray(b.names) || !b.names.every(n => typeof n === "string") || typeof b.equalWeightAvailability !== "string") return null;
  if (![e.constraints, e.riskPolicy, e.allocationPolicy, e.costModel].every(isObject) || !(e.paperExitPolicy === null || isObject(e.paperExitPolicy))) return null;
  const constraints = e.constraints as Record<string, unknown>, allocation = e.allocationPolicy as Record<string, unknown>, cost = e.costModel as Record<string, unknown>;
  if (!numericFields(constraints, ["maxNewPositions", "maxBudgetPerSymbolKrw"]) || !Array.isArray(constraints.allowedActions) || !constraints.allowedActions.every(action => typeof action === "string") ||
      !numericFields(e.riskPolicy, ["maxBudgetPerDecisionKrw", "maxSymbolExposureKrw", "targetExposureRatio", "maxPositionWeightRatio", "minCashReserveRatio", "minCashReserveKrw"]) ||
      typeof allocation.policyName !== "string" || !numericFields(allocation, ["targetExposureRatio", "minCashReserveRatio", "maxBudgetPerDecisionRatio", "maxSymbolExposureRatio"]) ||
      typeof cost.modelVersion !== "string" || typeof cost.executionModelVersion !== "string" ||
      !numericFields(cost.executionPolicy, ["slippageBps", "feeBps", "taxBps", "halfSpreadBps", "fillRatio", "maxVolumeParticipationRate", "minLiquidityFillRatio", "marketImpactBpsPerParticipationRate"])) return null;
  if (!Array.isArray(value.notices) || !value.notices.every(n => isObject(n) && [n.field, n.code, n.message].every(v => typeof v === "string"))) return null;
  return value as unknown as SimulationValidation;
}

export function acceptedSimulationId(value: unknown, validation: SimulationValidation): string | null {
  if (!isObject(value) || value.mode !== "paper_only" || value.mutation !== "paper_simulation_create" || value.status !== "accepted" ||
      value.readOnlyLiveTrading !== true || value.dataAvailabilityChecked !== false || typeof value.simulationRunId !== "string" ||
      !/^paper_sim_\d{17}_[A-Za-z0-9_-]{1,32}(?![\s\S])/.test(value.simulationRunId) || value.batchId !== value.simulationRunId ||
      !equalJson(value.requestedConfig, validation.requestedConfig) || !equalJson(value.effectiveConfig, validation.effectiveConfig) || !equalJson(value.notices, validation.notices)) return null;
  return value.simulationRunId;
}
