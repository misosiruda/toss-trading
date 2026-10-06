import type { BatchReplayRunArtifacts, BatchReplayRunSummary, RunDetailView, RunArtifactReadStatus, ViewModelResult } from '@/lib/dashboardViewModels';
type UnavailableRunDetail = Extract<ViewModelResult<RunDetailView>, {status: 'offline' | 'invalid'}>;
export function SimulationObservationPanel({ data }: { data: RunDetailView }) {
  const observation = data.simulationObservation;
  const labels = {
    missing: "접수 관측 원본 없음", invalid: "접수 관측 형식 또는 ID 불일치",
    unavailable: "접수 관측 판독 불가", unsupported: "접수 관측 필드 미지원", not_requested: "접수 관측 자료 없음 (요청 안 됨)"
  };
  return <section aria-label="Simulation 접수 관측" className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4 text-sm leading-6">
    <h2 className="text-base font-semibold">{observation.status === "available" ? observation.outcome === "runner_failed" ? "Runner 실패 관측" : "접수 관측 · 이후 실행 상태 미확인" : labels[observation.status]}</h2>
    <p className="break-all">조회 ID: {data.requestedId}</p>
    <p>실행 index 판독: {data.endpointStatus ?? "미확인"} · batch 상태: {data.batchStatus ?? "미확인"}</p>
    {observation.status === "available" && <>
      <p>접수 시각: {observation.acceptedAt}</p>
      {observation.runnerFailure && <p>실패 관측 시각: {observation.runnerFailure.observedAt} · {observation.runnerFailure.reasonCode}</p>}
      <p>{observation.outcome === "runner_failed" ? "Batch 범위의 runner rejection 관측입니다. 아래 child 실행의 상태와 부분·완료 결과는 별도로 보존합니다." : "접수 사실만 확인됐습니다. running·생존·완료를 뜻하지 않으며, 아래 실행 원본이 있으면 함께 확인하세요."}</p>
    </>}
    {observation.status !== "available" && <p>이 관측의 부재나 오류로 기존 child 실행의 상태를 변경하지 않습니다.</p>}
    <a className="mt-2 inline-flex min-h-11 items-center underline" href={`/dashboard/lab/runs/${encodeURIComponent(data.requestedId)}`}>같은 ID 새로 조회 (GET)</a>
  </section>;
}

export function RunSummary({ run }: { run: BatchReplayRunSummary }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs text-[var(--muted)] [overflow-wrap:anywhere]">
            batch {run.batchId ?? "missing"}
          </p>
          <h2 className="mt-1 text-base font-semibold [overflow-wrap:anywhere]">{run.runId}</h2>
        </div>
        <Badge tone={statusTone(run.status)} value={run.status} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Started" value={formatDateTime(run.startedAt)} />
        <Metric
          label="Completed"
          value={formatDateTime(run.completedAt ?? run.failedAt ?? run.skippedAt)}
        />
        <Metric
          label="Market regime"
          value={run.marketRegimeLabel ?? "missing"}
        />
        <Metric label="Run index" value={formatNullableNumber(run.runIndex)} />
        <Metric
          label="Total return"
          value={formatNullableRatio(run.totalReturnRatio)}
        />
        <Metric
          label="Final net worth"
          value={formatNullableKrw(run.finalVirtualNetWorthKrw)}
        />
        <Metric label="Trades" value={formatNullableNumber(run.tradeCount)} />
        <Metric
          label="Risk rejects"
          value={formatNullableNumber(run.rejectedCount)}
        />
        <Metric label="AI decision failures" value={formatNullableNumber(run.aiDecisionFailureCount)} />
      </div>
      {run.error === null && run.skipReason === null ? null : (
        <p className="mt-4 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
          {run.error ?? run.skipReason}
        </p>
      )}
    </section>
  );
}

export function ArtifactStatusGrid({
  artifacts,
  run
}: {
  artifacts: BatchReplayRunArtifacts | null;
  run: BatchReplayRunSummary;
}) {
  if (artifacts === null) {
    return (
      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
        <SectionHeader eyebrow="artifacts" title="Latest Run Artifacts" />
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Detailed artifacts are available only for the active or latest run
          returned by Local Operations API. This page still renders the run
          summary from the append-only run index.
        </p>
        <p className="mt-2 break-words font-mono text-xs text-[var(--muted)]">
          {run.storageBaseDir ?? "storageBaseDir missing"}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="artifacts" title="Latest Run Artifacts" />
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <ArtifactStatus label="Report" status={artifacts.reportStatus} />
        <ArtifactStatus label="Progress" status={artifacts.progressStatus} />
        <ArtifactStatus label="Decisions" status={artifacts.decisionsStatus} />
        <ArtifactStatus label="Risk" status={artifacts.riskDecisionsStatus} />
        <ArtifactStatus label="Executions" status={artifacts.tradesStatus} />
      </div>
      <p className="mt-4 break-words font-mono text-xs text-[var(--muted)]">
        {artifacts.reportStatus === "ok" ? artifacts.reportTitle ?? "report title missing" : "report title 미관측"}
      </p>
    </section>
  );
}

export function ProgressPanel({
  artifacts
}: {
  artifacts: BatchReplayRunArtifacts | null;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="progress" title="Replay Progress Snapshot" />
      {artifacts === null || artifacts.progressStatus !== "ok" ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Progress artifact is not available for this run detail view.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Metric
            label="Progress status"
            value={artifacts.progressStatusLabel ?? artifacts.progressStatus}
          />
          <Metric label="Simulated at" value={formatDateTime(artifacts.simulatedAt)} />
          <Metric
            label="Ticks"
            value={`${formatNullableNumber(
              artifacts.completedTickCount
            )}/${formatNullableNumber(artifacts.tickCount)}`}
          />
          <Metric
            label="Current net worth"
            value={formatNullableKrw(artifacts.currentVirtualNetWorthKrw)}
          />
          <Metric
            label="Current cash"
            value={formatNullableKrw(artifacts.currentCashKrw)}
          />
          <Metric
            label="Positions"
            value={formatNullableNumber(artifacts.currentPositionCount)}
          />
          <Metric
            label="Risk rejects"
            value={formatNullableNumber(artifacts.rejectedCount)}
          />
          <Metric label="Mode" value="paper_only" />
        </div>
      )}
    </section>
  );
}

export function EvidencePanel({
  artifacts
}: {
  artifacts: BatchReplayRunArtifacts | null;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="trace" title="Decision Risk Execution Counts" />
      {artifacts === null ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          Decision, risk and simulated execution artifacts are unavailable.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric
            label="Decision records"
            value={["ok", "degraded"].includes(artifacts.decisionsStatus) ? `${artifacts.decisionCount}/${artifacts.totalDecisionCount}` : "미관측"}
          />
          <Metric
            label="Risk decisions"
            value={["ok", "degraded"].includes(artifacts.riskDecisionsStatus) ? `${artifacts.riskDecisionCount}/${artifacts.totalRiskDecisionCount}` : "미관측"}
          />
          <Metric
            label="Simulated executions"
            value={["ok", "degraded"].includes(artifacts.tradesStatus) ? `${artifacts.tradeCount}/${artifacts.totalTradeCount}` : "미관측"}
          />
        </div>
      )}
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
        Counts are loaded from stored historical replay artifacts. This route
        does not call a replay runner, Codex CLI, TossInvest collector or broker
        order endpoint.
      </p>
    </section>
  );
}

export function SourcePanel({ data }: { data: RunDetailView }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="source" title="Read-only Source Boundary" />
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <KeyValue label="Batch status" value={data.batchStatus ?? "missing"} />
        <KeyValue label="Batch id" value={data.batchId ?? "missing"} />
        <KeyValue
          label="Latest artifact run"
          value={data.latestArtifactsRunId ?? "missing"}
        />
        <KeyValue label="Runs path" value={data.sourceRunsPath ?? "missing"} />
      </dl>
      {data.warnings.length === 0 ? null : (
        <ul className="mt-4 grid gap-2 text-sm text-[var(--warning)]">
          {data.warnings.map((warning) => (
            <li
              className="rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3"
              key={warning}
            >
              {warning}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UnavailablePanel({ result }: { result: UnavailableRunDetail }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow={result.endpoint} title="Run Detail Unavailable" />
      <div className="mt-4 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {result.message}
      </div>
    </section>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="font-mono text-xs text-[var(--muted)] [overflow-wrap:anywhere]">{eyebrow}</p>
      <h2 className="mt-1 text-base font-semibold">{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <p className="text-xs font-medium uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function ArtifactStatus({
  label,
  status
}: {
  label: string;
  status: RunArtifactReadStatus;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-[var(--muted)]">
          {label}
        </p>
        <Badge tone={statusTone(status)} value={status} />
      </div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Badge({
  tone,
  value
}: {
  tone: "ok" | "watch" | "blocked";
  value: string;
}) {
  const className =
    tone === "ok"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : tone === "watch"
        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
        : "bg-[var(--danger-soft)] text-[var(--danger)]";
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-[6px] px-2 py-1 text-xs font-semibold ${className}`}
    >
      {value}
    </span>
  );
}

function statusTone(status: string): "ok" | "watch" | "blocked" {
  if (status === "ok" || status === "completed") {
    return "ok";
  }
  if (
    status === "failed" ||
    status === "blocked" ||
    status === "invalid" ||
    status === "corrupt"
  ) {
    return "blocked";
  }
  return "watch";
}

function formatNullableRatio(value: number | null): string {
  if (value === null) {
    return "missing";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatNullableKrw(value: number | null): string {
  if (value === null) {
    return "missing";
  }
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))} KRW`;
}

function formatNullableNumber(value: number | null): string {
  if (value === null) {
    return "missing";
  }
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatDateTime(value: string | null): string {
  if (value === null) {
    return "missing";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(date) + " KST";
}
