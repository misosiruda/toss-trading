import Link from "next/link";
import {
  readAuditPageData,
  type DashboardAuditEventRow,
  type DashboardAuditViewModel,
  type FetchStatus,
  type JsonReadStatus,
  type ViewModelResult,
  type ViewModelStatus
} from "@/lib/dashboardViewModels";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UnavailableAudit = Extract<
  ViewModelResult<DashboardAuditViewModel>,
  { status: "offline" | "invalid" }
>;

export default async function AuditPage() {
  const pageData = await readAuditPageData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Paper-only audit
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Audit Event Review
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Backend ViewModel 기준으로 rejected action, failure trace,
                audit event를 조회합니다.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="Audit navigation">
              <Link
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard"
              >
                Dashboard
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
          aria-label="Audit safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard label="Source" tone="ok" value="backend ViewModel" />
          <BoundaryCard label="Actions" tone="ok" value="read-only" />
          <BoundaryCard label="Live order" tone="blocked" value="not exposed" />
        </section>

        {pageData.audit.status === "ok" ? (
          <AuditView data={pageData.audit.data} />
        ) : (
          <UnavailablePanel result={pageData.audit} />
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

function AuditView({ data }: { data: DashboardAuditViewModel }) {
  return (
    <>
      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Total events" value={String(data.totalCount)} />
        <Metric label="Shown events" value={String(data.count)} />
        <Metric
          label="Rejected actions"
          value={String(data.rejectedActionCount)}
        />
        <Metric label="Failure traces" value={String(data.failureTraceCount)} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <SectionHeader eyebrow={data.status} title="Audit Summary" />
          <div className="mt-4 grid gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-[var(--muted)]">
                Latest event
              </p>
              <p className="mt-2 break-words font-mono text-sm font-semibold">
                {data.latestEventAt === null
                  ? "missing"
                  : formatDateTime(data.latestEventAt)}
              </p>
            </div>
            <CountList title="Event Type Counts" values={data.eventTypeCounts} />
            <CountList title="Actor Counts" values={data.actorCounts} />
          </div>
          <Warnings warnings={data.warnings} />
          <SourceStatusList sourceStatus={data.sourceStatus} />
        </section>

        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <SectionHeader eyebrow="recent evidence" title="Audit Events" />
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.events.length === 0 ? (
                  <tr>
                    <td className="py-4 text-[var(--muted)]" colSpan={5}>
                      No audit events are available.
                    </td>
                  </tr>
                ) : (
                  data.events.map((event) => (
                    <AuditEventTableRow event={event} key={event.eventId} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </>
  );
}

function AuditEventTableRow({ event }: { event: DashboardAuditEventRow }) {
  return (
    <tr>
      <td className="py-2 pr-3">
        <div className="flex flex-col gap-1">
          <span className="break-all font-mono text-xs">{event.eventId}</span>
          <span className="break-all font-mono text-[11px] leading-4 text-[var(--muted)]">
            {event.eventType}
          </span>
        </div>
      </td>
      <td className="py-2 pr-3 font-mono text-xs">{event.category}</td>
      <td className="py-2 pr-3">
        <Badge tone={statusTone(event.severity)} value={event.severity} />
      </td>
      <td className="py-2 pr-3 font-mono text-xs">
        {formatDateTime(event.createdAt)}
      </td>
      <td className="min-w-[18rem] py-2 text-sm leading-5 text-[var(--muted)]">
        {event.summary}
      </td>
    </tr>
  );
}

function CountList({
  title,
  values
}: {
  title: string;
  values: Record<string, number>;
}) {
  const entries = Object.entries(values).sort(
    (left, right) => right[1] - left[1]
  );
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">missing</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm">
          {entries.map(([key, value]) => (
            <div className="flex justify-between gap-3" key={key}>
              <dt className="break-all font-mono text-xs">{key}</dt>
              <dd className="font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <ul className="mt-4 space-y-2 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function UnavailablePanel({ result }: { result: UnavailableAudit }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow={result.endpoint} title="Audit Event Review" />
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

function SectionHeader({
  eyebrow,
  title
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="font-mono text-xs text-[var(--muted)]">{eyebrow}</p>
      <h2 className="mt-1 text-base font-semibold">{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <p className="text-xs font-medium uppercase text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function SourceStatusList({
  sourceStatus
}: {
  sourceStatus: Record<string, JsonReadStatus>;
}) {
  return (
    <dl className="mt-4 flex flex-wrap gap-2 text-xs">
      {Object.entries(sourceStatus).map(([key, value]) => (
        <div
          className="flex items-center gap-2 rounded-[6px] border border-[var(--border)] px-2 py-1"
          key={key}
        >
          <dt className="text-[var(--muted)]">{key}</dt>
          <dd>
            <Badge tone={statusTone(value)} value={value} />
          </dd>
        </div>
      ))}
    </dl>
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

function statusTone(
  status:
    | string
    | ViewModelStatus
    | FetchStatus
    | DashboardAuditEventRow["severity"]
): "ok" | "watch" | "blocked" {
  if (status === "ok" || status === "info") {
    return "ok";
  }
  if (
    status === "breach" ||
    status === "offline" ||
    status === "invalid" ||
    status === "corrupt" ||
    status === "degraded" ||
    status === "failure"
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
