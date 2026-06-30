import Link from "next/link";
import type { ReactNode } from "react";
import type {
  BucketComplianceRow,
  BucketCostTurnoverRow,
  ComplianceAnalyticsView,
  ExposureBucket,
  FetchStatus,
  JsonReadStatus,
  PolicyComplianceViewModel,
  StrategyBucket,
  ViewModelResult,
  ViewModelStatus
} from "@/lib/dashboardViewModels";
import { readPortfolioCompliancePageData } from "@/lib/dashboardViewModels";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

type UnavailablePortfolio = Extract<
  ViewModelResult<PolicyComplianceViewModel>,
  { status: "offline" | "invalid" }
>;

export default async function PortfolioCompliancePage() {
  const pageData = await readPortfolioCompliancePageData();

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Paper-only portfolio
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Portfolio Compliance
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Backend ViewModel 기준으로 strategy bucket, cash reserve,
                hedge, exposure, cost and turnover compliance를 조회합니다.
              </p>
            </div>
            <nav
              aria-label="Portfolio compliance navigation"
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
                href="/dashboard/audit"
              >
                Audit
              </Link>
              <span className="rounded-[6px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 font-semibold text-[var(--danger)]">
                paper-only
              </span>
            </nav>
          </div>
        </header>

        <section
          aria-label="Portfolio compliance safety boundary"
          className="grid gap-3 md:grid-cols-3"
        >
          <BoundaryCard label="Source" tone="ok" value="backend ViewModel" />
          <BoundaryCard label="Actions" tone="ok" value="read-only" />
          <BoundaryCard label="Live order" tone="blocked" value="not exposed" />
        </section>

        {pageData.portfolio.status === "ok" ? (
          <PortfolioComplianceView data={pageData.portfolio.data} />
        ) : (
          <UnavailablePanel result={pageData.portfolio} />
        )}

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          <span className="font-mono">{pageData.apiBaseLabel}</span>
          <span aria-hidden="true"> / </span>
          <span>fetched {formatDateTime(pageData.fetchedAt)}</span>
        </footer>
      </div>
    </main>
  );
}

function PortfolioComplianceView({
  data
}: {
  data: PolicyComplianceViewModel;
}) {
  return (
    <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Net worth" value={formatKrw(data.virtualNetWorthKrw)} />
        <Metric
          label="Portfolio"
          value={data.portfolioId ?? "missing"}
        />
        <Metric
          label="Cash ratio"
          value={formatRatio(data.cashCompliance.currentCashRatio)}
        />
        <Metric
          label="Risk rejects"
          value={String(data.riskGateSummary.rejectedCount)}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <SectionHeader
            eyebrow={data.asOf === null ? "missing asOf" : formatDateTime(data.asOf)}
            status={data.status}
            title="Bucket Allocation Matrix"
          />
          <BucketAllocationMatrix rows={data.bucketCompliance} />
        </section>

        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <SectionHeader
            eyebrow={data.policyStatus}
            status={data.status}
            title="Compliance Breaches"
          />
          <ComplianceBreachList data={data} />
          <Warnings warnings={data.warnings} />
          <SourceStatusList sourceStatus={data.sourceStatus} />
        </section>
      </section>

      <AnalyticsGrid analytics={data.complianceAnalytics} />

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <ExposureCompliancePanel data={data} />
        <CostTurnoverPanel analytics={data.complianceAnalytics} />
      </section>

      <RiskGateSummaryPanel data={data} />
    </>
  );
}

function BucketAllocationMatrix({ rows }: { rows: BucketComplianceRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        aria-label="Bucket allocation compliance table"
        className="min-w-full text-left text-sm"
      >
        <thead className="text-xs uppercase text-[var(--muted)]">
          <tr>
            <th className="py-2 pr-3 font-medium">Bucket</th>
            <th className="py-2 pr-3 font-medium">Target</th>
            <th className="py-2 pr-3 font-medium">Current</th>
            <th className="py-2 pr-3 font-medium">Gap</th>
            <th className="py-2 pr-3 font-medium">Exposure</th>
            <th className="py-2 pr-3 font-medium">Turnover</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.length === 0 ? (
            <tr>
              <td className="py-4 text-[var(--muted)]" colSpan={8}>
                No bucket compliance rows are available.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.bucket}>
                <td className="py-2 pr-3">{BUCKET_LABELS[row.bucket]}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatRatio(row.targetWeightRatio)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatRatio(row.currentWeightRatio)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatSignedRatio(row.gapRatio)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatKrw(row.exposureKrw)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatNullableRatio(row.turnoverRatio)}
                </td>
                <td className="py-2 pr-3">
                  <Badge tone={statusTone(row.status)} value={row.status} />
                </td>
                <td className="min-w-[14rem] py-2 text-[var(--muted)]">
                  {row.primaryReason ?? "none"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ComplianceBreachList({
  data
}: {
  data: PolicyComplianceViewModel;
}) {
  const breaches = [
    ...data.bucketCompliance
      .filter((row) => row.status !== "ok")
      .map((row) => ({
        key: `bucket-${row.bucket}`,
        label: BUCKET_LABELS[row.bucket],
        status: row.status,
        detail: row.primaryReason ?? `gap ${formatSignedRatio(row.gapRatio)}`
      })),
    ...(data.cashCompliance.status === "ok"
      ? []
      : [
          {
            key: "cash",
            label: "Cash reserve",
            status: data.cashCompliance.status,
            detail: `gap ${formatKrw(data.cashCompliance.cashGapKrw)}`
          }
        ]),
    ...(data.hedgeCompliance.status === "ok"
      ? []
      : [
          {
            key: "hedge",
            label: "Hedge",
            status: data.hedgeCompliance.status,
            detail: `coverage ${formatRatio(
              data.hedgeCompliance.hedgeExposureRatio
            )}`
          }
        ]),
    ...(data.exposureCompliance.status === "ok"
      ? []
      : [
          {
            key: "exposure",
            label: "Exposure",
            status: data.exposureCompliance.status,
            detail: `gross ${formatRatio(
              data.exposureCompliance.grossExposureRatio
            )}`
          }
        ])
  ];

  if (breaches.length === 0) {
    return (
      <p className="mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm text-[var(--muted)]">
        none
      </p>
    );
  }

  return (
    <ul className="mt-4 grid gap-2 text-sm">
      {breaches.map((breach) => (
        <li
          className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3"
          key={breach.key}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-medium">{breach.label}</span>
            <Badge tone={statusTone(breach.status)} value={breach.status} />
          </div>
          <p className="mt-2 break-words font-mono text-xs text-[var(--muted)]">
            {breach.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AnalyticsGrid({ analytics }: { analytics: ComplianceAnalyticsView }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader
        eyebrow="backend summary"
        status={analytics.strategyBucket.status}
        title="Compliance Analytics"
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AnalyticsCard
          detail={`largest ${
            analytics.strategyBucket.largestBucket?.key ?? "missing"
          }`}
          label="Strategy Bucket Mix"
          status={analytics.strategyBucket.status}
          value={`${analytics.strategyBucket.occupiedBucketCount}/5 active`}
        >
          concentration{" "}
          {formatNullableRatio(analytics.strategyBucket.concentrationRatio)}
        </AnalyticsCard>
        <AnalyticsCard
          detail={`${analytics.cashReserve.marketRegime} / ${analytics.cashReserve.ruleSource}`}
          label="Cash Reserve"
          status={analytics.cashReserve.reserveStatus}
          value={formatRatio(analytics.cashReserve.currentCashRatio)}
        >
          target {formatRatio(analytics.cashReserve.targetCashRatio)} / gap{" "}
          {formatKrw(analytics.cashReserve.cashGapKrw)}
        </AnalyticsCard>
        <AnalyticsCard
          detail={`net downside ${formatNullableRatio(
            analytics.hedgeEffectiveness.netDownsideExposureRatio
          )}`}
          label="Hedge Effectiveness"
          status={analytics.hedgeEffectiveness.status}
          value={formatNullableRatio(
            analytics.hedgeEffectiveness.hedgeCoverageRatio
          )}
        >
          cost drag{" "}
          {formatNullableRatio(analytics.hedgeEffectiveness.costDragRatio)}
        </AnalyticsCard>
        <AnalyticsCard
          detail={`cost ${formatKrw(analytics.costTurnover.totalCostKrw)}`}
          label="Cost & Turnover"
          value={formatNullableRatio(analytics.costTurnover.totalTurnoverRatio)}
        >
          drag {formatNullableRatio(analytics.costTurnover.totalCostDragRatio)}
        </AnalyticsCard>
      </div>
    </section>
  );
}

function AnalyticsCard({
  children,
  detail,
  label,
  status,
  value
}: {
  children: ReactNode;
  detail: string;
  label: string;
  status?: string;
  value: string;
}) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-medium uppercase text-[var(--muted)]">
          {label}
        </h3>
        {status === undefined ? null : (
          <Badge tone={statusTone(status)} value={status} />
        )}
      </div>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{children}</p>
      <p className="mt-1 break-words font-mono text-xs text-[var(--muted)]">
        {detail}
      </p>
    </article>
  );
}

function ExposureCompliancePanel({
  data
}: {
  data: PolicyComplianceViewModel;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader
        eyebrow="concentration"
        status={data.exposureCompliance.status}
        title="Exposure Compliance"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Gross exposure"
          value={formatKrw(data.exposureCompliance.grossExposureKrw)}
        />
        <Metric
          label="Gross ratio"
          value={formatRatio(data.exposureCompliance.grossExposureRatio)}
        />
      </div>
      <ExposureList
        exposures={data.exposureCompliance.byMarket}
        title="Market Exposure"
      />
      <ExposureList
        exposures={data.exposureCompliance.byStrategyBucket}
        title="Strategy Bucket Exposure"
      />
      <div className="mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
        <h3 className="text-sm font-semibold">Max Symbol Exposure</h3>
        {data.exposureCompliance.maxSymbolExposure === null ? (
          <p className="mt-3 text-sm text-[var(--muted)]">missing</p>
        ) : (
          <dl className="mt-3 text-sm">
            <ExposureKeyValue
              exposure={data.exposureCompliance.maxSymbolExposure}
            />
          </dl>
        )}
      </div>
    </section>
  );
}

function ExposureList({
  exposures,
  title
}: {
  exposures: ExposureBucket[];
  title: string;
}) {
  return (
    <div className="mt-4 rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {exposures.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">missing</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm">
          {exposures.map((exposure) => (
            <ExposureKeyValue exposure={exposure} key={exposure.key} />
          ))}
        </dl>
      )}
    </div>
  );
}

function ExposureKeyValue({ exposure }: { exposure: ExposureBucket }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <dt className="break-all font-mono text-xs">{exposure.key}</dt>
      <dd className="break-words font-mono text-xs text-[var(--muted)]">
        {formatKrw(exposure.exposureKrw)} / {formatRatio(exposure.exposureRatio)}
      </dd>
    </div>
  );
}

function CostTurnoverPanel({
  analytics
}: {
  analytics: ComplianceAnalyticsView;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader
        eyebrow="paper execution assumptions"
        title="Cost and Turnover"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Trade amount"
          value={formatKrw(analytics.costTurnover.totalTradeAmountKrw)}
        />
        <Metric
          label="Total cost"
          value={formatKrw(analytics.costTurnover.totalCostKrw)}
        />
        <Metric
          label="Turnover"
          value={formatNullableRatio(analytics.costTurnover.totalTurnoverRatio)}
        />
        <Metric
          label="Cost drag"
          value={formatNullableRatio(analytics.costTurnover.totalCostDragRatio)}
        />
      </div>
      <BucketCostTurnoverTable rows={analytics.costTurnover.byStrategyBucket} />
    </section>
  );
}

function BucketCostTurnoverTable({
  rows
}: {
  rows: BucketCostTurnoverRow[];
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table
        aria-label="Bucket cost and turnover table"
        className="min-w-full text-left text-sm"
      >
        <thead className="text-xs uppercase text-[var(--muted)]">
          <tr>
            <th className="py-2 pr-3 font-medium">Bucket</th>
            <th className="py-2 pr-3 font-medium">Count</th>
            <th className="py-2 pr-3 font-medium">Amount</th>
            <th className="py-2 pr-3 font-medium">Cost</th>
            <th className="py-2 pr-3 font-medium">Turnover</th>
            <th className="py-2 font-medium">Drag</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.length === 0 ? (
            <tr>
              <td className="py-4 text-[var(--muted)]" colSpan={6}>
                No bucket cost rows are available.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.bucket}>
                <td className="py-2 pr-3">{BUCKET_LABELS[row.bucket]}</td>
                <td className="py-2 pr-3 font-mono text-xs">{row.tradeCount}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatKrw(row.grossTradeAmountKrw)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatKrw(row.totalCostKrw)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {formatNullableRatio(row.turnoverRatio)}
                </td>
                <td className="py-2 font-mono text-xs">
                  {formatNullableRatio(row.costDragRatio)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RiskGateSummaryPanel({
  data
}: {
  data: PolicyComplianceViewModel;
}) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader eyebrow="deterministic gate" title="Risk Gate Summary" />
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Decision records"
          value={String(data.riskGateSummary.decisionRecordCount)}
        />
        <Metric
          label="Decision items"
          value={String(data.riskGateSummary.decisionItemCount)}
        />
        <Metric
          label="Actionable"
          value={String(data.riskGateSummary.actionableDecisionCount)}
        />
        <Metric
          label="Simulated trades"
          value={String(data.riskGateSummary.simulatedTradeCount)}
        />
        <Metric
          label="Rejected"
          value={String(data.riskGateSummary.rejectedCount)}
        />
      </div>
      <CountList title="Reject Codes" values={data.riskGateSummary.rejectCodes} />
    </section>
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
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">none</p>
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

function UnavailablePanel({ result }: { result: UnavailablePortfolio }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <SectionHeader
        eyebrow={result.endpoint}
        status={result.status}
        title="Portfolio Compliance Detail"
      />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <p className="text-xs font-medium uppercase text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  status,
  title
}: {
  eyebrow: string;
  status?: ViewModelStatus | FetchStatus | string;
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
      {status === undefined ? null : (
        <Badge tone={statusTone(status)} value={status} />
      )}
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
  if (status === "ok") {
    return "ok";
  }
  if (
    status === "breach" ||
    status === "offline" ||
    status === "invalid" ||
    status === "corrupt" ||
    status === "under" ||
    status === "over" ||
    status === "under_reserved" ||
    status === "over_hedged"
  ) {
    return "blocked";
  }
  return "watch";
}

function formatKrw(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    currency: "KRW",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatRatio(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    style: "percent"
  }).format(value);
}

function formatNullableRatio(value: number | null): string {
  return value === null ? "missing" : formatRatio(value);
}

function formatSignedRatio(value: number): string {
  const formatted = formatRatio(value);
  return value > 0 ? `+${formatted}` : formatted;
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
