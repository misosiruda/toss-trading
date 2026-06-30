import Link from "next/link";
import {
  readRunDetailPageData,
  type BatchReplayRunArtifacts,
  type BatchReplayRunSummary,
  type RunDetailView,
  type RunArtifactReadStatus,
  type ViewModelResult
} from "@/lib/dashboardViewModels";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RunDetailParams = {
  params: Promise<{ runId: string }>;
};

type UnavailableRunDetail = Extract<
  ViewModelResult<RunDetailView>,
  { status: "offline" | "invalid" }
>;

export default async function RunDetailPage({ params }: RunDetailParams) {
  const { runId } = await params;
  const pageData = await readRunDetailPageData(runId);

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Paper-only run detail
              </p>
              <h1 className="mt-2 break-words text-2xl font-semibold text-[var(--foreground)]">
                Run Detail
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Stored batch replay run, progress, report, risk decision and
                simulated execution artifacts를 read-only로 조회합니다.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="Run navigation">
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard"
              >
                Dashboard
              </Link>
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/lab/policies"
              >
                Policy Builder
              </Link>
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/lab/strategy-tests"
              >
                Strategy Lab
              </Link>
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                no live orders
              </span>
            </nav>
          </div>
        </header>

        <section
          aria-label="Run detail safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard
            label="Source"
            tone="ok"
            value="/batch/replay/runs"
          />
          <BoundaryCard label="Mode" tone="ok" value="read-only" />
          <BoundaryCard label="Live order" tone="blocked" value="not exposed" />
        </section>

        {pageData.runDetail.status === "ok" ? (
          <RunDetailViewPanel data={pageData.runDetail.data} />
        ) : (
          <UnavailablePanel result={pageData.runDetail} />
        )}

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          <span className="font-mono">{pageData.apiBaseLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>fetched {formatDateTime(pageData.fetchedAt)}</span>
        </footer>
      </div>
    </main>
  );
}

function RunDetailViewPanel({ data }: { data: RunDetailView }) {
  if (data.status === "missing" || data.run === null) {
    return (
      <section className="rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-4 text-sm leading-6 text-[var(--warning)]">
        <h2 className="text-base font-semibold">Run artifact unavailable</h2>
        <p className="mt-2 break-words font-mono text-xs">{data.runId}</p>
        <p className="mt-2">
          The run id was not found in the latest batch replay run index.
        </p>
      </section>
    );
  }

  return (
    <>
      <RunSummary run={data.run} />
      <ArtifactStatusGrid artifacts={data.artifacts} run={data.run} />
      <ProgressPanel artifacts={data.artifacts} />
      <EvidencePanel artifacts={data.artifacts} />
      <SourcePanel data={data} />
    </>
  );
}

function RunSummary({ run }: { run: BatchReplayRunSummary }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs text-[var(--muted)]">
            batch {run.batchId ?? "missing"}
          </p>
          <h2 className="mt-1 break-words text-base font-semibold">{run.runId}</h2>
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
      </div>
      {run.error === null && run.skipReason === null ? null : (
        <p className="mt-4 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
          {run.error ?? run.skipReason}
        </p>
      )}
    </section>
  );
}

function ArtifactStatusGrid({
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
        {artifacts.reportTitle ?? "report title missing"}
      </p>
    </section>
  );
}

function ProgressPanel({
  artifacts
}: {
  artifacts: BatchReplayRunArtifacts | null;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="progress" title="Replay Progress Snapshot" />
      {artifacts === null ? (
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

function EvidencePanel({
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
            value={`${artifacts.decisionCount}/${artifacts.totalDecisionCount}`}
          />
          <Metric
            label="Risk decisions"
            value={`${artifacts.riskDecisionCount}/${artifacts.totalRiskDecisionCount}`}
          />
          <Metric
            label="Simulated executions"
            value={`${artifacts.tradeCount}/${artifacts.totalTradeCount}`}
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

function SourcePanel({ data }: { data: RunDetailView }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="source" title="Read-only Source Boundary" />
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
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

function UnavailablePanel({ result }: { result: UnavailableRunDetail }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow={result.endpoint} title="Run Detail Unavailable" />
      <div className="mt-4 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {result.message}
      </div>
    </section>
  );
}

function BoundaryCard({
  label,
  tone,
  value
}: {
  label: string;
  tone: "ok" | "watch" | "blocked";
  value: string;
}) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--muted)]">{label}</h2>
        <Badge tone={tone} value={tone === "blocked" ? "disabled" : tone} />
      </div>
      <p className="mt-3 break-words font-mono text-sm font-semibold">{value}</p>
    </article>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="font-mono text-xs text-[var(--muted)]">{eyebrow}</p>
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
    <div>
      <dt className="text-xs font-medium uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 break-words font-mono text-xs">{value}</dd>
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
  }).format(date);
}
