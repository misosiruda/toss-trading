import Link from "next/link";
import { readValidationLabPageData } from "@/lib/dashboardViewModels";
import { ValidationLabPanel } from "../ValidationLabPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ValidationLabPage() {
  const pageData = await readValidationLabPageData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Paper-only validation
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Validation Lab
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Backend ViewModel 기준으로 policy candidate split matrix,
                overfitting warning, provider failure, risk reject evidence를
                조회합니다.
              </p>
            </div>
            <nav
              aria-label="Validation navigation"
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
          aria-label="Validation safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard label="Source" tone="ok" value="backend ViewModel" />
          <BoundaryCard label="Actions" tone="ok" value="read-only" />
          <BoundaryCard label="Live order" tone="blocked" value="not exposed" />
        </section>

        <ValidationLabPanel
          result={pageData.validationLab}
          variant="detail"
        />

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          <span className="font-mono">{pageData.apiBaseLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>fetched {formatDateTime(pageData.fetchedAt)}</span>
        </footer>
      </div>
    </main>
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
