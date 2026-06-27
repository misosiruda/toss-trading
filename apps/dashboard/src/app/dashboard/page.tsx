import Link from "next/link";
import type { ReactNode } from "react";
import {
  countOnlineViewModels,
  readDashboardViewModels,
  type BucketComplianceRow,
  type ComplianceAnalyticsView,
  type ExposureBucket,
  type FetchStatus,
  type JsonReadStatus,
  type PolicyComplianceViewModel,
  type RiskGateTraceViewModel,
  type StrategyBucket,
  type StrategyBucketTestLabViewModel,
  type ValidationCandidateComparisonView,
  type ValidationLabViewModel,
  type ViewModelResult,
  type ViewModelStatus
} from "@/lib/dashboardViewModels";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

type UnavailableViewModelResult<T> = Extract<
  ViewModelResult<T>,
  { status: "offline" | "invalid" }
>;

export default async function DashboardPage() {
  const viewModels = await readDashboardViewModels();
  const onlineCount = countOnlineViewModels(viewModels);

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[var(--border)] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
                Paper-only operations
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                Paper-only Dashboard
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Backend ViewModel 기준으로 portfolio compliance, strategy test
                readiness, risk gate trace, validation lab을 조회합니다.
              </p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:w-[440px]">
              <StatusPill
                label="Live trading"
                tone="blocked"
                value="disabled"
              />
              <StatusPill
                label="ViewModel API"
                tone={onlineCount === 4 ? "ok" : "watch"}
                value={`${onlineCount}/4 online`}
              />
              <Link
                className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/lab/policies"
              >
                <span className="text-[var(--muted)]">Policy lab</span>
                <span className="text-[var(--accent)]">Builder</span>
              </Link>
              <Link
                className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-medium"
                href="/dashboard/lab/strategy-tests"
              >
                <span className="text-[var(--muted)]">Strategy lab</span>
                <span className="text-[var(--accent)]">Buckets</span>
              </Link>
            </div>
          </div>
        </header>

        <section
          aria-label="Safety boundary"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          <SafetyCard
            detail="Dashboard does not expose live broker mutation."
            label="TRADING_ENABLED"
            tone="ok"
            value="false"
          />
          <SafetyCard
            detail="Server-rendered UI consumes read-only ViewModel endpoints."
            label="Data source"
            tone={onlineCount === 4 ? "ok" : "watch"}
            value={onlineCount === 4 ? "ready" : "partial"}
          />
          <SafetyCard
            detail="No live OrderIntent path is connected."
            label="OrderRouter"
            tone="blocked"
            value="not connected"
          />
          <SafetyCard
            detail="No raw command or place_order surface is present."
            label="Mutation tools"
            tone="blocked"
            value="not exposed"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <PortfolioPanel result={viewModels.portfolio} />
          <RiskGatePanel result={viewModels.riskGate} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <StrategyLabPanel result={viewModels.strategyLab} />
          <ValidationPanel result={viewModels.validationLab} />
        </section>

        <footer className="border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          <span className="font-mono">{viewModels.apiBaseLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>fetched {formatDateTime(viewModels.fetchedAt)}</span>
        </footer>
      </div>
    </main>
  );
}

function PortfolioPanel({
  result
}: {
  result: ViewModelResult<PolicyComplianceViewModel>;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} title="Portfolio Compliance" />;
  }

  const data = result.data;
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow="Portfolio policy"
        status={data.status}
        title="Portfolio Compliance"
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label="Net worth" value={formatKrw(data.virtualNetWorthKrw)} />
        <Metric
          label="Cash"
          value={formatRatio(data.cashCompliance.currentCashRatio)}
        />
        <Metric
          label="Risk rejects"
          value={String(data.riskGateSummary.rejectedCount)}
        />
      </div>
      <ComplianceAnalyticsGrid analytics={data.complianceAnalytics} />

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Bucket</th>
              <th className="py-2 pr-3 font-medium">Exposure</th>
              <th className="py-2 pr-3 font-medium">Current</th>
              <th className="py-2 pr-3 font-medium">Turnover</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {data.bucketCompliance.map((row) => (
              <BucketRow key={row.bucket} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <ExposureSummary exposure={data.exposureCompliance.byMarket} />
        <PolicyWarnings warnings={data.warnings} />
      </div>
      <SourceStatusList sourceStatus={data.sourceStatus} />
    </section>
  );
}

function ComplianceAnalyticsGrid({
  analytics
}: {
  analytics: ComplianceAnalyticsView;
}) {
  const topCostBucket = analytics.costTurnover.byStrategyBucket
    .filter((bucket) => bucket.totalCostKrw > 0)
    .sort((left, right) => right.totalCostKrw - left.totalCostKrw)[0];

  return (
    <section aria-label="Compliance Analytics" className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold">Compliance Analytics</h3>
        <Badge
          tone={statusTone(analytics.strategyBucket.status)}
          value={analytics.strategyBucket.status}
        />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AnalyticsSummary
          badgeValue={analytics.strategyBucket.status}
          detail={`largest ${
            analytics.strategyBucket.largestBucket?.key ?? "missing"
          }`}
          label="Strategy Bucket Mix"
          tone={statusTone(analytics.strategyBucket.status)}
          value={`${analytics.strategyBucket.occupiedBucketCount}/5 active`}
        >
          concentration{" "}
          {formatNullableRatio(analytics.strategyBucket.concentrationRatio)}
        </AnalyticsSummary>
        <AnalyticsSummary
          detail={`${analytics.cashReserve.marketRegime} / ${analytics.cashReserve.ruleSource}`}
          label="Cash Reserve"
          badgeValue={analytics.cashReserve.reserveStatus}
          tone={statusTone(analytics.cashReserve.reserveStatus)}
          value={formatRatio(analytics.cashReserve.currentCashRatio)}
        >
          target {formatRatio(analytics.cashReserve.targetCashRatio)} · gap{" "}
          {formatKrw(analytics.cashReserve.cashGapKrw)}
        </AnalyticsSummary>
        <AnalyticsSummary
          detail={`net downside ${formatNullableRatio(
            analytics.hedgeEffectiveness.netDownsideExposureRatio
          )}`}
          label="Hedge Effectiveness"
          badgeValue={analytics.hedgeEffectiveness.status}
          tone={statusTone(analytics.hedgeEffectiveness.status)}
          value={formatNullableRatio(
            analytics.hedgeEffectiveness.hedgeCoverageRatio
          )}
        >
          cost drag {formatNullableRatio(analytics.hedgeEffectiveness.costDragRatio)}
        </AnalyticsSummary>
        <AnalyticsSummary
          detail={
            topCostBucket === undefined
              ? "no bucket cost"
              : `${BUCKET_LABELS[topCostBucket.bucket]} ${formatKrw(
                  topCostBucket.totalCostKrw
                )}`
          }
          label="Cost & Turnover"
          value={formatNullableRatio(analytics.costTurnover.totalTurnoverRatio)}
        >
          cost {formatKrw(analytics.costTurnover.totalCostKrw)} · drag{" "}
          {formatNullableRatio(analytics.costTurnover.totalCostDragRatio)}
        </AnalyticsSummary>
      </div>
    </section>
  );
}

function AnalyticsSummary({
  badgeValue,
  children,
  detail,
  label,
  tone,
  value
}: {
  badgeValue?: string;
  children: ReactNode;
  detail: string;
  label: string;
  tone?: "ok" | "watch" | "blocked";
  value: string;
}) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-medium uppercase text-[var(--muted)]">
          {label}
        </h4>
        {badgeValue === undefined || tone === undefined ? null : (
          <Badge tone={tone} value={badgeValue} />
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

function RiskGatePanel({
  result
}: {
  result: ViewModelResult<RiskGateTraceViewModel>;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} title="Risk Gate Trace" />;
  }

  const data = result.data;
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader eyebrow={data.sourceFamily} status="ok" title="Risk Gate Trace" />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label="Shown traces" value={String(data.count)} />
        <Metric
          label="Decision items"
          value={String(data.totalDecisionItemCount)}
        />
        <Metric label="Risk source" value={data.sourceFamily} />
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Packet</th>
              <th className="py-2 pr-3 font-medium">Symbol</th>
              <th className="py-2 pr-3 font-medium">Action</th>
              <th className="py-2 pr-3 font-medium">Risk</th>
              <th className="py-2 pr-3 font-medium">Execution</th>
              <th className="py-2 font-medium">Reject codes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {data.traces.length === 0 ? (
              <tr>
                <td className="py-4 text-[var(--muted)]" colSpan={6}>
                  No risk trace rows available from the selected artifact
                  family.
                </td>
              </tr>
            ) : (
              data.traces.map((trace) => (
                <tr key={trace.decisionId}>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {trace.packetId}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {trace.market}:{trace.symbol}
                  </td>
                  <td className="py-2 pr-3">{trace.action}</td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={trace.riskApproved ? "ok" : "blocked"}
                      value={trace.riskApproved ? "approved" : "rejected"}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    {trace.simulatedExecutionStatus}
                  </td>
                  <td className="py-2 text-xs text-[var(--muted)]">
                    {trace.rejectCodes.length > 0
                      ? trace.rejectCodes.join(", ")
                      : "none"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <SourceStatusList sourceStatus={data.sourceStatus} />
    </section>
  );
}

function StrategyLabPanel({
  result
}: {
  result: ViewModelResult<StrategyBucketTestLabViewModel>;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} title="Strategy Test Lab" />;
  }

  const data = result.data;
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={data.policyId}
        status={data.policyStatus}
        title="Strategy Test Lab"
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.supportedBuckets.map((bucket) => (
          <article
            className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3"
            key={bucket.bucket}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {BUCKET_LABELS[bucket.bucket]}
              </h3>
              <Badge
                tone={bucket.canRunIsolatedReplay ? "ok" : "watch"}
                value={bucket.canRunIsolatedReplay ? "enabled" : "pending"}
              />
            </div>
            <p className="mt-2 font-mono text-xs text-[var(--muted)]">
              {bucket.defaultHoldingPeriodHint}
            </p>
            <p className="mt-3 text-sm leading-5 text-[var(--muted)]">
              {bucket.disabledReason ?? "isolated replay available"}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-4 rounded-[8px] border border-[var(--border)] p-3 text-sm leading-5 text-[var(--muted)]">
        {data.comparison.selectionWarning}
      </div>
      <SourceStatusList sourceStatus={data.sourceStatus} />
    </section>
  );
}

function ValidationPanel({
  result
}: {
  result: ViewModelResult<ValidationLabViewModel>;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} title="Validation Lab" />;
  }

  const data = result.data;
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={data.aggregateReportStatus}
        status={data.status}
        title="Validation Lab"
      />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric
          label="Generated"
          value={
            data.sourceGeneratedAt === null
              ? "missing"
              : formatDateTime(data.sourceGeneratedAt)
          }
        />
        <Metric
          label="Paper-only"
          value={data.executionAssumptions.paperOnly ? "true" : "false"}
        />
        <Metric
          label="Order placement"
          value={
            data.executionAssumptions.orderPlacementEnabled
              ? "enabled"
              : "disabled"
          }
        />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <ObjectSummary
          title="Validation protocol"
          value={data.validationProtocol}
        />
        <ObjectSummary
          title="Overfitting warning"
          value={data.overfittingWarning}
        />
        <ObjectSummary
          title="Provider failure"
          value={data.providerFailureSummary}
        />
        <ObjectSummary title="Risk rejects" value={data.riskRejectSummary} />
      </div>
      <ValidationCandidateComparison
        comparison={data.candidateComparison}
      />
      <PolicyWarnings warnings={data.warnings} />
    </section>
  );
}

function ValidationCandidateComparison({
  comparison
}: {
  comparison: ValidationCandidateComparisonView;
}) {
  return (
    <section aria-label="Policy Candidate Comparison" className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Policy Candidate Comparison</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Read-only split metric matrix from stored batch aggregate artifacts.
          </p>
        </div>
        <Badge
          tone={comparison.status === "available" ? "ok" : "watch"}
          value={comparison.status}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Metric label="Candidates" value={String(comparison.candidateCount)} />
        <Metric
          label="Return samples"
          value={String(comparison.returnSampleCount)}
        />
        <Metric
          label="Selection metric"
          value={comparison.selectionMetric ?? "missing"}
        />
      </div>

      {comparison.rows.length === 0 ? (
        <div className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]">
          Candidate comparison unavailable from the current aggregate artifact.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-3 font-medium">Candidate</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Train</th>
                <th className="py-2 pr-3 font-medium">Validation</th>
                <th className="py-2 pr-3 font-medium">Test</th>
                <th className="py-2 font-medium">Holdout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {comparison.rows.map((row) => (
                <tr key={row.candidateKey}>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs">
                        {shortenCandidateKey(row.candidateKey)}
                      </span>
                      {row.selected ? (
                        <Badge tone="watch" value="selected in train" />
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-1">
                      <span>{row.decisionProviderMode}</span>
                      <span className="font-mono text-xs text-[var(--muted)]">
                        {row.riskProfile ?? "risk profile missing"}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatNullableRatio(row.trainAverageTotalReturnRatio)}
                    <br />
                    n={row.trainReturnSampleCount}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatNullableRatio(row.validationAverageTotalReturnRatio)}
                    <br />
                    n={row.validationReturnSampleCount}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatNullableRatio(row.testAverageTotalReturnRatio)}
                    <br />
                    n={row.testReturnSampleCount}
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {row.holdoutDegradationCount} degradation checks
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {comparison.warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
          {comparison.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
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

function SafetyCard({
  detail,
  label,
  tone,
  value
}: {
  detail: string;
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
      <p className="mt-3 font-mono text-lg font-semibold">{value}</p>
      <p className="mt-3 text-sm leading-5 text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function StatusPill({
  label,
  tone,
  value
}: {
  label: string;
  tone: "ok" | "watch" | "blocked";
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
      <span className="text-[var(--muted)]">{label}</span>
      <Badge tone={tone} value={value} />
    </div>
  );
}

function PanelHeader({
  eyebrow,
  status,
  title
}: {
  eyebrow: string;
  status: ViewModelStatus | FetchStatus | ValidationLabViewModel["status"];
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="font-mono text-xs text-[var(--muted)]">{eyebrow}</p>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
      </div>
      <Badge tone={statusTone(status)} value={status} />
    </div>
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

function BucketRow({ row }: { row: BucketComplianceRow }) {
  return (
    <tr>
      <td className="py-2 pr-3">{BUCKET_LABELS[row.bucket]}</td>
      <td className="py-2 pr-3 font-mono text-xs">
        {formatKrw(row.exposureKrw)}
      </td>
      <td className="py-2 pr-3 font-mono text-xs">
        {formatRatio(row.currentWeightRatio)}
      </td>
      <td className="py-2 pr-3 font-mono text-xs">
        {row.turnoverRatio === null ? "missing" : formatRatio(row.turnoverRatio)}
      </td>
      <td className="py-2">
        <Badge tone={statusTone(row.status)} value={row.status} />
      </td>
    </tr>
  );
}

function ExposureSummary({ exposure }: { exposure: ExposureBucket[] }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] p-3">
      <h3 className="text-sm font-semibold">Market Exposure</h3>
      {exposure.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">missing</p>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm">
          {exposure.map((entry) => (
            <div className="flex justify-between gap-3" key={entry.key}>
              <dt>{entry.key}</dt>
              <dd className="font-mono text-xs">
                {formatKrw(entry.exposureKrw)} / {formatRatio(entry.exposureRatio)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function PolicyWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] p-3">
      <h3 className="text-sm font-semibold">Warnings</h3>
      {warnings.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">none</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ObjectSummary({ title, value }: { title: string; value: unknown }) {
  return (
    <article className="rounded-[8px] border border-[var(--border)] p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <pre
        aria-label={`${title} summary`}
        className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel-muted)] p-3 font-mono text-xs leading-5 text-[var(--muted)]"
        tabIndex={0}
      >
        {formatObject(value)}
      </pre>
    </article>
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
  if (
    status === "ok" ||
    status === "filled" ||
    status === "approved" ||
    status === "enabled"
  ) {
    return "ok";
  }
  if (
    status === "breach" ||
    status === "offline" ||
    status === "invalid" ||
    status === "corrupt" ||
    status === "rejected" ||
    status === "blocked"
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

function formatObject(value: unknown): string {
  if (value === null || value === undefined) {
    return "missing";
  }
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= 900) {
    return serialized;
  }
  return `${serialized.slice(0, 900)}...`;
}

function shortenCandidateKey(value: string): string {
  return value.length <= 48 ? value : `${value.slice(0, 45)}...`;
}
