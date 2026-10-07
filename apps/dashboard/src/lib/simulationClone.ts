import { emptySimulationDraft, equalJson, isObject, restoreSimulationDraft, typedCandidate, type SimulationCandidate, type SimulationDraft } from "./simulationCandidate";
export const CLONE_DRAFT_KEY = "paper-experiment-clone-draft-v1";
export const exactSimulationId = (value: unknown): value is string => typeof value === "string" && /^paper_sim_\d{17}_[A-Za-z0-9_-]{1,32}(?![\s\S])/.test(value);
export interface SimulationCloneSource {
  mode: "paper_only"; readOnly: true; status: "available"; schemaVersion: "paper_simulation_canonical_request.v1";
  simulationRunId: string; batchId: string; acceptedAt: string; canonicalRequestHash: string;
  sourceRuntime: { schemaVersion: "paper_simulation_source_runtime.v1"; sourceRuntimeId: string; nodeVersion: string; executionModelVersion: string };
  requestedConfig: SimulationCandidate;
}
const exactKeys = (value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> => isObject(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const oneOf = (value: unknown, values: string[]) => typeof value === "string" && values.includes(value);
function sensitive(value: unknown): boolean {
  if (typeof value === "string") return /\*{3,}|\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:ord|exec)_[A-Za-z0-9_-]{6,}\b/.test(value)
    || [...value.matchAll(/\b\d{3,6}-\d{2,6}-\d{2,8}\b/g)].some(match => !/^\d{4}-\d{2}-\d{2}$/.test(match[0]));
  return isObject(value) && Object.values(value).some(sensitive);
}
export function completeCloneRequest(value: unknown): value is SimulationCandidate {
  if (!exactKeys(value, ["mode", "runType", "sourceDataDir", "universe", "window", "samplingPolicy", "capital", "decisionProvider", "riskProfile", "paperExitPolicy", "costModel", "benchmarkPolicy"], ["runCount", "executionCosts"]) || sensitive(value)) return false;
  if (value.mode !== "paper_only" || !oneOf(value.runType, ["single_replay", "batch_replay"]) || !text(value.sourceDataDir, 240)
    || (Object.hasOwn(value, "runCount") && !integer(value.runCount, 1, 20)) || !oneOf(value.riskProfile, ["conservative", "balanced", "aggressive_paper"])
    || !oneOf(value.paperExitPolicy, ["none", "take_profit_stop_loss", "rebalance_threshold"]) || value.costModel !== "standard" || value.benchmarkPolicy !== "cash_equal_weight_initial_hold") return false;
  const { universe: u, window: w, samplingPolicy: s, capital: c, decisionProvider: p, executionCosts: costs } = value;
  if (!exactKeys(u, ["preset", "market"]) || !text(u.preset, 80) || !oneOf(u.market, ["mixed_global", "kr", "us"])
    || !exactKeys(w, ["mode", "seed", "startAt", "endAt", "windowMonths"]) || !oneOf(w.mode, ["fixed_range", "random_month"]) || !text(w.seed, 120)
    || !text(w.startAt, 80) || !text(w.endAt, 80) || !integer(w.windowMonths, 1, 12)
    || !exactKeys(s, ["decisionFrequency", "stepSeconds", "maxDecisionCalls", "maxCodexCallsPerRun"]) || !oneOf(s.decisionFrequency, ["every_tick", "once_per_day", "once_per_week"])
    || !integer(s.stepSeconds, 60, 2592000) || !integer(s.maxDecisionCalls, 1, 100) || !integer(s.maxCodexCallsPerRun, 0, 31)
    || !exactKeys(c, ["initialCashKrw"]) || !integer(c.initialCashKrw, 100000, 10000000000)
    || !exactKeys(p, ["mode", "modelId", "outputSchema"]) || !oneOf(p.mode, ["dry_run_fixture", "codex_paper_only"]) || !text(p.modelId, 120) || p.outputSchema !== "schemas/virtual-decision.schema.json") return false;
  return !Object.hasOwn(value, "executionCosts") || (exactKeys(costs, ["feeBps", "taxBps", "slippageBps"]) && Object.values(costs).every(cost => typeof cost === "number" && Number.isFinite(cost) && cost >= 0));
}
export function readCloneSource(value: unknown, id: string): SimulationCloneSource | null {
  if (!exactSimulationId(id) || !exactKeys(value, ["mode", "readOnly", "status", "schemaVersion", "simulationRunId", "batchId", "acceptedAt", "sourceRuntime", "canonicalRequestHash", "requestedConfig"])
    || value.mode !== "paper_only" || value.readOnly !== true || value.status !== "available" || value.schemaVersion !== "paper_simulation_canonical_request.v1"
    || value.simulationRunId !== id || value.batchId !== id || typeof value.acceptedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.acceptedAt) || !Number.isFinite(Date.parse(value.acceptedAt))
    || typeof value.canonicalRequestHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.canonicalRequestHash) || !completeCloneRequest(value.requestedConfig)) return null;
  const runtime = value.sourceRuntime;
  if (!exactKeys(runtime, ["schemaVersion", "sourceRuntimeId", "nodeVersion", "executionModelVersion"]) || runtime.schemaVersion !== "paper_simulation_source_runtime.v1"
    || typeof runtime.sourceRuntimeId !== "string" || !/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(runtime.sourceRuntimeId)
    || !text(runtime.nodeVersion, 80) || typeof runtime.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(runtime.nodeVersion)
    || !text(runtime.executionModelVersion, 80) || typeof runtime.executionModelVersion !== "string" || !/^execution_simulator\.v\d+$/.test(runtime.executionModelVersion)) return null;
  return value as unknown as SimulationCloneSource;
}
export function cloneDraft(source: SimulationCloneSource): SimulationDraft {
  const r = source.requestedConfig;
  return { riskProfile: r.riskProfile, market: r.universe.market, runType: r.runType, runCount: r.runCount === undefined ? "" : String(r.runCount), sourceDataDir: r.sourceDataDir,
    windowMode: r.window.mode, startAt: r.window.startAt, endAt: r.window.endAt, windowMonths: String(r.window.windowMonths), seed: r.window.seed,
    initialCashKrw: String(r.capital.initialCashKrw), decisionFrequency: r.samplingPolicy.decisionFrequency, stepSeconds: String(r.samplingPolicy.stepSeconds), maxDecisionCalls: String(r.samplingPolicy.maxDecisionCalls),
    feeBps: r.executionCosts === undefined ? "" : String(r.executionCosts.feeBps), taxBps: r.executionCosts === undefined ? "" : String(r.executionCosts.taxBps), slippageBps: r.executionCosts === undefined ? "" : String(r.executionCosts.slippageBps), paperExitPolicy: r.paperExitPolicy };
}
export function restoreCloneDraft(value: unknown, source: SimulationCloneSource): SimulationDraft | null {
  if (!exactKeys(value, ["sourceId", "canonicalRequestHash", "draft"]) || value.sourceId !== source.simulationRunId || value.canonicalRequestHash !== source.canonicalRequestHash) return null;
  if (!exactKeys(value.draft, Object.keys(emptySimulationDraft))) return null;
  return restoreSimulationDraft(value.draft);
}
export function cloneDraftEnvelope(source: SimulationCloneSource, draft: SimulationDraft) {
  // Raw owned input only: never store the source DTO, credential, admission or validation receipt here.
  const owned = Object.fromEntries(Object.keys(emptySimulationDraft).map(key => [key, draft[key as keyof SimulationDraft]]));
  return { sourceId: source.simulationRunId, canonicalRequestHash: source.canonicalRequestHash, draft: owned };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (isObject(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  const json = JSON.stringify(value); if (json === undefined) throw new Error("unsupported canonical value"); return json;
}
export function cloneCanonicalText(source: SimulationCloneSource): string {
  return stable({ schemaVersion: source.schemaVersion, simulationRunId: source.simulationRunId, batchId: source.batchId, acceptedAt: source.acceptedAt,
    sourceRuntime: source.sourceRuntime, requestedConfig: source.requestedConfig, redacted: false });
}
export function faithfulCloneDraft(source: SimulationCloneSource): SimulationDraft | null {
  const draft = cloneDraft(source); return equalJson(typedCandidate(draft, source.requestedConfig), source.requestedConfig) ? draft : null;
}
