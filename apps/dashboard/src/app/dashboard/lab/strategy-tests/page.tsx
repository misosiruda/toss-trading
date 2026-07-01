import Link from "next/link";
import {
  readStrategyTestLabPageData,
  type JsonReadStatus,
  type StrategyBucket,
  type StrategyBucketComparisonView,
  type StrategyBucketTestCapability,
  type StrategyBucketTestLabViewModel,
  type StrategyBucketTestResultSummary,
  type ViewModelResult
} from "@/lib/dashboardViewModels";
import { StrategyBucketTestProgressPanel } from "./StrategyBucketTestProgressPanel";
import { StrategyBucketTestValidationForm } from "./StrategyBucketTestValidationForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

type UnavailableStrategyLab = Extract<
  ViewModelResult<StrategyBucketTestLabViewModel>,
  { status: "offline" | "invalid" }
>;

export default async function StrategyTestsPage() {
  const pageData = await readStrategyTestLabPageData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Strategy Lab
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Strategy Bucket Test Lab
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Backend ViewModel 기준으로 장기, 스윙, 단기, 초단기, hedge
                bucket의 isolated paper test 준비 상태를 조회합니다.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="Lab navigation">
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
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                paper-only
              </span>
            </nav>
          </div>
        </header>

        <section
          aria-label="Strategy lab safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard
            label="Source"
            tone="ok"
            value="backend ViewModel"
          />
          <BoundaryCard
            label="Queued records"
            tone="watch"
            value="create only"
          />
          <BoundaryCard
            label="Live order"
            tone="blocked"
            value="not exposed"
          />
        </section>

        {pageData.strategyLab.status === "ok" ? (
          <StrategyLabView data={pageData.strategyLab.data} />
        ) : (
          <UnavailablePanel result={pageData.strategyLab} />
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

function StrategyLabView({ data }: { data: StrategyBucketTestLabViewModel }) {
  const enabledCount = data.supportedBuckets.filter(
    (bucket) => bucket.canRunIsolatedReplay
  ).length;

  return (
    <>
      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Policy" value={data.policyId} />
        <Metric label="Policy status" value={data.policyStatus} />
        <Metric
          label="Runnable buckets"
          value={`${enabledCount}/${data.supportedBuckets.length}`}
        />
        <Metric label="Active tests" value={String(data.activeTests.length)} />
      </section>

      <section>
        <SectionHeader
          eyebrow="bucket capabilities"
          title="Bucket Test Readiness"
        />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {data.supportedBuckets.map((bucket) => (
            <BucketCapabilityCard bucket={bucket} key={bucket.bucket} />
          ))}
        </div>
      </section>

      <StrategyBucketTestValidationForm />

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <StrategyBucketTestProgressPanel
          initialActiveTests={data.activeTests}
          key={data.activeTests
            .map(
              (test) =>
                `${test.testId}:${test.status}:${test.progress.phase}:${test.progress.updatedAt}`
            )
            .join("\n")}
        />
        <ResultsPanel results={data.recentResults} />
      </section>

      <ComparisonPanel comparison={data.comparison} labStatus={data.status} />
      <SourceStatusList sourceStatus={data.sourceStatus} />
    </>
  );
}

function BucketCapabilityCard({
  bucket
}: {
  bucket: StrategyBucketTestCapability;
}) {
  return (
    <article
      className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4"
      id={`bucket-${bucket.bucket}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{BUCKET_LABELS[bucket.bucket]}</h2>
          <p className="mt-1 font-mono text-xs text-[var(--muted)]">
            {bucket.bucket}
          </p>
        </div>
        <Badge
          tone={bucket.canRunIsolatedReplay ? "ok" : "watch"}
          value={bucket.canRunIsolatedReplay ? "enabled" : "pending"}
        />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase text-[var(--muted)]">
            Holding period
          </dt>
          <dd className="mt-1 font-mono text-xs">
            {bucket.defaultHoldingPeriodHint}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-[var(--muted)]">
            Required fields
          </dt>
          <dd className="mt-1 text-[var(--muted)]">
            {bucket.requiredPolicyFields.join(", ")}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-5 text-[var(--muted)]">
        {bucket.disabledReason ?? "isolated replay available"}
      </p>
      <Link
        className="mt-4 inline-flex rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-semibold"
        href={`/dashboard/lab/strategy-tests/buckets/${bucket.bucket}/new`}
      >
        Open bucket test
      </Link>
    </article>
  );
}

function ResultsPanel({
  results
}: {
  results: StrategyBucketTestResultSummary[];
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="recent results" title="Bucket Result Matrix" />
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Bucket</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Split</th>
              <th className="py-2 pr-3 font-medium">Return</th>
              <th className="py-2 pr-3 font-medium">Drawdown</th>
              <th className="py-2 pr-3 font-medium">Turnover</th>
              <th className="py-2 font-medium">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr>
                <td className="py-4 text-[var(--muted)]" colSpan={7}>
                  No isolated bucket result artifacts are available.
                </td>
              </tr>
            ) : (
              results.map((result) => (
                <tr className="border-t border-[var(--border)]" key={result.testId}>
                  <td className="py-2 pr-3">{BUCKET_LABELS[result.bucket]}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{result.status}</td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {result.validationSplitRole ?? "missing"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatNullableRatio(result.totalReturnRatio)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatNullableRatio(result.maxDrawdownRatio)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatNullableRatio(result.turnoverRatio)}
                  </td>
                  <td className="py-2 text-[var(--muted)]">
                    {result.warnings.length > 0
                      ? result.warnings.join(", ")
                      : "none"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonPanel({
  comparison,
  labStatus
}: {
  comparison: StrategyBucketComparisonView;
  labStatus: string;
}) {
  const baseline = comparison.portfolioBaseline;
  const deltaByTestId = new Map(
    comparison.portfolioDeltaRows.map((row) => [row.testId, row])
  );

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader
        eyebrow="comparison"
        title="Full Portfolio Baseline Comparison"
      />
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        {comparison.selectionWarning ??
          "No isolated bucket comparison warning is available."}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric
          label="Baseline source"
          value={baseline?.source ?? "missing"}
        />
        <Metric
          label="Baseline return"
          value={formatNullableRatio(baseline?.averageTotalReturnRatio ?? null)}
        />
        <Metric
          label="Comparison rows"
          value={String(comparison.rows.length)}
        />
        <Metric label="Lab status" value={labStatus} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Bucket</th>
              <th className="py-2 pr-3 font-medium">Bucket return</th>
              <th className="py-2 pr-3 font-medium">Portfolio baseline</th>
              <th className="py-2 font-medium">Return delta</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.length === 0 ? (
              <tr>
                <td className="py-4 text-[var(--muted)]" colSpan={4}>
                  No bucket result is available for portfolio baseline comparison.
                </td>
              </tr>
            ) : (
              comparison.rows.map((row) => {
                const delta = deltaByTestId.get(row.testId);
                return (
                  <tr className="border-t border-[var(--border)]" key={row.testId}>
                    <td className="py-2 pr-3">{BUCKET_LABELS[row.bucket]}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {formatNullableRatio(row.totalReturnRatio)}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {formatNullableRatio(
                        baseline?.averageTotalReturnRatio ?? null
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {formatNullableRatio(delta?.totalReturnDeltaRatio ?? null)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UnavailablePanel({ result }: { result: UnavailableStrategyLab }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow={result.endpoint} title="Strategy Test Lab" />
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

function statusTone(status: string): "ok" | "watch" | "blocked" {
  if (status === "ok" || status === "enabled") {
    return "ok";
  }
  if (status === "offline" || status === "invalid" || status === "corrupt") {
    return "blocked";
  }
  return "watch";
}

function formatNullableRatio(value: number | null): string {
  return value === null ? "missing" : formatRatio(value);
}

function formatRatio(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    style: "percent"
  }).format(value);
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
