import Link from "next/link";
import {
  readLiveReadinessPageData,
  type FetchStatus,
  type LiveReadinessCheck,
  type LiveReadinessViewModel,
  type ViewModelResult,
  type ViewModelStatus
} from "@/lib/dashboardViewModels";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UnavailableViewModelResult<T> = Extract<
  ViewModelResult<T>,
  { status: "offline" | "invalid" }
>;

export default async function LiveReadinessPage() {
  const pageData = await readLiveReadinessPageData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Paper-only readiness
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Live Readiness
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Backend ViewModel 기준으로 live trading disabled 상태, official
                read-only API config, gateway boundary를 분리해서 조회합니다.
              </p>
            </div>
            <nav
              aria-label="Live readiness navigation"
              className="flex flex-wrap gap-2 text-sm"
            >
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard"
              >
                Dashboard
              </Link>
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/risk-gate"
              >
                Risk Gate
              </Link>
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/validation"
              >
                Validation
              </Link>
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/lab/strategy-tests"
              >
                Strategy Lab
              </Link>
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                paper-only
              </span>
            </nav>
          </div>
        </header>

        <section
          aria-label="Live readiness safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard label="Source" tone="ok" value="backend ViewModel" />
          <BoundaryCard label="Actions" tone="ok" value="read-only" />
          <BoundaryCard label="Live surface" tone="blocked" value="not exposed" />
        </section>

        <LiveReadinessPanel result={pageData.liveReadiness} />

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          <span className="font-mono">{pageData.apiBaseLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>fetched {formatDateTime(pageData.fetchedAt)}</span>
        </footer>
      </div>
    </main>
  );
}

function LiveReadinessPanel({
  result
}: {
  result: ViewModelResult<LiveReadinessViewModel>;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} title="Live Readiness Detail" />;
  }

  const data = result.data;
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={data.generatedAt}
        status={data.status}
        title="Live Readiness Detail"
      />

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="TRADING_ENABLED"
          tone={data.environment.tradingEnabled ? "blocked" : "ok"}
          value={String(data.environment.tradingEnabled)}
        />
        <Metric label="BROKER_PROVIDER" value={data.environment.brokerProvider} />
        <Metric label="AI_DECISION_MODE" value={data.environment.aiDecisionMode} />
        <Metric
          label="AI_DECISION_ENABLED"
          tone={data.environment.aiDecisionEnabled ? "watch" : "ok"}
          value={String(data.environment.aiDecisionEnabled)}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-4">
          <PanelHeader
            eyebrow="safe config summary"
            status={data.officialApi.authStatus === "invalid" ? "breach" : "watch"}
            title="Official Read-only API"
          />
          <dl className="mt-4 grid gap-3 text-sm">
            <KeyValue label="Auth enabled" value={String(data.officialApi.authEnabled)} />
            <KeyValue label="Auth status" value={data.officialApi.authStatus} />
            <KeyValue label="Base URL" value={data.officialApi.baseUrl} />
            <KeyValue
              label="Client ID present"
              value={String(data.officialApi.clientIdConfigured)}
            />
            <KeyValue
              label="Client secret present"
              value={String(data.officialApi.clientCredentialConfigured)}
            />
            <KeyValue
              label="Snapshot status"
              value={data.officialApi.snapshotStatus}
            />
          </dl>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            Credential values are not included in this ViewModel.
          </p>
        </section>

        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-4">
          <PanelHeader
            eyebrow="gateway boundary"
            status="ok"
            title="Gateway Exposure"
          />
          <dl className="mt-4 grid gap-3 text-sm">
            <KeyValue
              label="Live gateway"
              value={data.orderGateway.liveOrderGatewayStatus}
            />
            <KeyValue
              label="OrderRouter"
              value={data.orderGateway.orderRouterConnectionStatus}
            />
            <KeyValue
              label="MCP mutation tools"
              value={data.orderGateway.mcpMutationToolExposureStatus}
            />
            <KeyValue
              label="Placement enabled"
              value={String(data.orderGateway.orderPlacementEnabled)}
            />
            <KeyValue
              label="Raw tossctl"
              value={String(data.orderGateway.rawTossctlExecutionEnabled)}
            />
            <KeyValue
              label="Raw codex exec"
              value={String(data.orderGateway.rawCodexExecEnabled)}
            />
          </dl>
        </section>
      </div>

      <section aria-label="Readiness checks" className="mt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">Readiness Checks</h2>
          <Badge tone={statusTone(data.status)} value={data.status} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.checks.map((check) => (
            <ReadinessCheckCard check={check} key={check.key} />
          ))}
        </div>
      </section>

      <section className="mt-5 rounded-[8px] border border-[var(--border)] p-3">
        <h2 className="text-sm font-semibold">Warnings</h2>
        {data.warnings.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">none</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ReadinessCheckCard({ check }: { check: LiveReadinessCheck }) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{check.label}</h3>
        <Badge tone={check.tone} value={check.tone} />
      </div>
      <p className="mt-2 break-words font-mono text-sm font-semibold">
        {check.value}
      </p>
      <p className="mt-3 text-sm leading-5 text-[var(--muted)]">{check.detail}</p>
    </article>
  );
}

function UnavailablePanel<T>({
  result,
  title
}: {
  result: UnavailableViewModelResult<T>;
  title: string;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader eyebrow={result.endpoint} status={result.status} title={title} />
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

function Metric({
  label,
  tone,
  value
}: {
  label: string;
  tone?: "ok" | "watch" | "blocked";
  value: string;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase text-[var(--muted)]">
          {label}
        </p>
        {tone === undefined ? null : <Badge tone={tone} value={tone} />}
      </div>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="break-words font-mono text-xs font-semibold">{value}</dd>
    </div>
  );
}

function PanelHeader({
  eyebrow,
  status,
  title
}: {
  eyebrow: string;
  status: ViewModelStatus | FetchStatus;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="break-words font-mono text-xs text-[var(--muted)]">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
      </div>
      <Badge tone={statusTone(status)} value={status} />
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
  if (status === "ok" || status === "ready" || status === "configured") {
    return "ok";
  }
  if (
    status === "breach" ||
    status === "offline" ||
    status === "invalid" ||
    status === "blocked"
  ) {
    return "blocked";
  }
  return "watch";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Seoul"
  }).format(date);
}
