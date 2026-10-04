import type { RunDetailPageData, RunDetailView, ViewModelResult } from "./dashboardViewModels";

export type RunWorkspaceTab = "summary" | "record";
export const RUN_REFRESH_INTERVAL_MS = 5_000;
export const RUN_REFRESH_LIMIT = 12;
const TERMINAL = new Set(["completed", "completed_with_failures", "failed", "skipped"]);

export function readRunWorkspaceTab(value: string | null): RunWorkspaceTab {
  return value === "record" ? "record" : "summary";
}

export function runWorkspaceState(result: ViewModelResult<RunDetailView>) {
  if (result.status !== "ok") return { poll: false, completeness: "unavailable" as const, execution: "unknown" };
  const data = result.data;
  const execution = data.run?.status ?? "unknown";
  const acceptedOnly = data.run === null && data.simulationObservation.status === "available" && data.simulationObservation.outcome === "unknown";
  const artifact = data.artifacts;
  // Defend the selected child identity again at the presentation boundary.
  const bound = artifact !== null && data.run !== null && artifact.runId === data.run.runId;
  const completeness = !bound ? "missing" :
    [artifact.reportStatus, artifact.progressStatus, artifact.decisionsStatus, artifact.riskDecisionsStatus, artifact.tradesStatus].every(status => status === "ok") ? "complete" : "partial";
  return { poll: !TERMINAL.has(execution) && (execution === "running" || acceptedOnly), completeness, execution };
}

export function validRunLookupId(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

export function isRunSnapshot(value: unknown, requestedId: string): value is RunDetailPageData {
  if (!value || typeof value !== "object") return false;
  const page = value as RunDetailPageData;
  if (typeof page.apiBaseLabel !== "string" || typeof page.fetchedAt !== "string" || !Number.isFinite(Date.parse(page.fetchedAt))) return false;
  const result = page.runDetail;
  if (!result || typeof result.endpoint !== "string" || typeof result.fetchedAt !== "string" || !Number.isFinite(Date.parse(result.fetchedAt))) return false;
  if (result.status === "offline" || result.status === "invalid") return result.data === null && typeof result.message === "string";
  if (result.status !== "ok") return false;
  const data = result.data;
  if (!(!!data && data.mode === "paper_only" && data.readOnly === true && data.requestedId === requestedId &&
    typeof data.runId === "string" && (data.status === "ok" || data.status === "missing") &&
    Array.isArray(data.warnings) && data.warnings.every(warning => typeof warning === "string") &&
    (data.run === null || (typeof data.run.runId === "string" && typeof data.run.status === "string")) &&
    (data.artifacts === null || (data.run !== null && data.artifacts.runId === data.run.runId)) &&
    !!data.simulationObservation && typeof data.simulationObservation.status === "string")) return false;
  const nullableString = (entry: unknown) => entry === null || typeof entry === "string";
  const nullableNumber = (entry: unknown) => entry === null || (typeof entry === "number" && Number.isFinite(entry));
  if (![data.batchId, data.batchStatus, data.sourceRunsPath, data.latestArtifactsRunId, data.endpointStatus].every(nullableString)) return false;
  const run = data.run;
  if (run ? data.runId !== run.runId || data.status !== "ok" : data.runId !== requestedId || data.status !== "missing") return false;
  if (run && (!["running", "active", ...TERMINAL].includes(run.status) ||
    ![run.batchId, run.startedAt, run.completedAt, run.failedAt, run.skippedAt, run.marketRegimeLabel, run.storageBaseDir, run.reportPath, run.error, run.skipReason].every(nullableString) ||
    ![run.runIndex, run.totalReturnRatio, run.finalVirtualNetWorthKrw, run.tradeCount, run.rejectedCount, run.aiDecisionFailureCount].every(nullableNumber))) return false;
  // Legacy active is observable, but is not evidence of running or terminal execution.
  // A child or existing batch alias must identify it without borrowing artifact identity.
  if (run?.status === "active" && (!validRunLookupId(run.runId) || run.runId.trim().length === 0 ||
    !(run.runId === requestedId || (run.batchId === requestedId && data.batchId === requestedId)) ||
    run.completedAt !== null || run.failedAt !== null || run.skippedAt !== null)) return false;
  const artifact = data.artifacts;
  if (artifact && (!Object.values({ report: artifact.reportStatus, progress: artifact.progressStatus, decisions: artifact.decisionsStatus, risk: artifact.riskDecisionsStatus, trades: artifact.tradesStatus }).every(entry => ["ok", "missing", "corrupt", "degraded", "blocked", "invalid"].includes(entry)) ||
    typeof artifact.status !== "string" || ![artifact.runStatus, artifact.reportTitle, artifact.progressStatusLabel, artifact.simulatedAt].every(nullableString) ||
    ![artifact.completedTickCount, artifact.tickCount, artifact.rejectedCount, artifact.currentVirtualNetWorthKrw, artifact.currentCashKrw, artifact.currentPositionCount].every(nullableNumber) ||
    ![artifact.decisionCount, artifact.totalDecisionCount, artifact.riskDecisionCount, artifact.totalRiskDecisionCount, artifact.tradeCount, artifact.totalTradeCount].every(entry => Number.isSafeInteger(entry) && entry >= 0))) return false;
  const observation = data.simulationObservation;
  if (observation.status !== "available") return ["missing", "invalid", "unavailable", "unsupported", "not_requested"].includes(observation.status);
  if (observation.simulationRunId !== requestedId || !Number.isFinite(Date.parse(observation.acceptedAt))) return false;
  return observation.outcome === "unknown" ? observation.runnerFailure === null : observation.outcome === "runner_failed" &&
    observation.runnerFailure !== null && observation.runnerFailure.reasonCode === "runner_rejected" && Number.isFinite(Date.parse(observation.runnerFailure.observedAt));
}

export interface RunRefreshState { busy: boolean; automaticCount: number; limited: boolean }

// A single lifecycle owns every timer/request. Aborted or superseded promises
// never apply, even if an HTTP client ignores AbortSignal.
export function createRunRefresh(options: {
  initial: RunDetailPageData;
  read: (signal: AbortSignal) => Promise<RunDetailPageData>;
  apply: (snapshot: RunDetailPageData) => void;
  state: (state: RunRefreshState) => void;
  error: () => void;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let snapshot = options.initial, disposed = false, visible = true, busy = false, automaticCount = 0, requestId = 0;
  let controller: AbortController | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = options.schedule ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  const emit = () => options.state({ busy, automaticCount, limited: automaticCount >= RUN_REFRESH_LIMIT && runWorkspaceState(snapshot.runDetail).poll });
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const queue = () => {
    clear();
    if (!disposed && visible && !busy && automaticCount < RUN_REFRESH_LIMIT && runWorkspaceState(snapshot.runDetail).poll) timer = schedule(() => { timer = null; void refresh(true); }, RUN_REFRESH_INTERVAL_MS);
  };
  async function refresh(automatic = false) {
    if (disposed || !visible || busy || (automatic && automaticCount >= RUN_REFRESH_LIMIT)) return;
    clear(); busy = true; if (automatic) automaticCount++;
    const identity = ++requestId;
    controller = new AbortController(); const signal = controller.signal; emit();
    try {
      const next = await options.read(signal);
      if (disposed || identity !== requestId || signal.aborted) return;
      snapshot = next; options.apply(next);
    } catch {
      if (!disposed && identity === requestId && !signal.aborted) {
        // Stop automatic reads after a transport failure; only an explicit GET
        // can restore the current state. Never infer a runner failure.
        snapshot = { ...snapshot, runDetail: { status: "offline", endpoint: snapshot.runDetail.endpoint, fetchedAt: new Date().toISOString(), data: null, message: "GET refresh unavailable" } };
        options.error();
      }
    } finally {
      if (!disposed && identity === requestId) { busy = false; controller = null; emit(); queue(); }
    }
  }
  function setVisible(next: boolean) {
    if (disposed || visible === next) return;
    visible = next; clear();
    if (!visible) { requestId++; controller?.abort(); controller = null; busy = false; emit(); }
    else queue();
  }
  emit(); queue();
  return { refresh: () => refresh(false), setVisible, dispose() { disposed = true; requestId++; clear(); controller?.abort(); controller = null; } };
}
