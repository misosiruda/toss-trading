import type {
  ValidationCandidateComparisonView,
  ValidationLabViewModel,
  ViewModelResult
} from "@/lib/dashboardViewModels";

type ValidationPanelVariant = "summary" | "detail";
type UnavailableValidationLab = Extract<
  ViewModelResult<ValidationLabViewModel>,
  { status: "offline" | "invalid" }
>;

export function ValidationLabPanel({
  result,
  variant = "summary"
}: {
  result: ViewModelResult<ValidationLabViewModel>;
  variant?: ValidationPanelVariant;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} />;
  }

  const data = result.data;
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={data.aggregateReportStatus}
        status={data.status}
        title={variant === "detail" ? "Validation Lab Detail" : "Validation Lab"}
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

      {variant === "detail" ? (
        <section
          aria-label="Validation safety contract"
          className="mt-4 grid gap-3 md:grid-cols-3"
        >
          <Metric
            label="Selection"
            value={
              data.candidateComparison.selectedCandidateKey === null
                ? "not selected"
                : "train evidence only"
            }
          />
          <Metric
            label="Candidate rows"
            value={String(data.candidateComparison.rows.length)}
          />
          <Metric
            label="Warnings"
            value={String(data.candidateComparison.warnings.length)}
          />
        </section>
      ) : null}

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
          title="Data universe coverage"
          value={data.dataUniverseCoverage}
        />
        <ObjectSummary
          title="Provider failure"
          value={data.providerFailureSummary}
        />
        <ObjectSummary title="Risk rejects" value={data.riskRejectSummary} />
      </div>
      <ValidationCandidateComparison
        comparison={data.candidateComparison}
        variant={variant}
      />
      <Warnings warnings={data.warnings} />
    </section>
  );
}

function ValidationCandidateComparison({
  comparison,
  variant
}: {
  comparison: ValidationCandidateComparisonView;
  variant: ValidationPanelVariant;
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
        <div
          aria-label="Policy candidate comparison table scroll area"
          className="mt-4 overflow-x-auto"
          tabIndex={0}
        >
          <table
            aria-label="Policy candidate comparison table"
            className="min-w-full text-left text-sm"
          >
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
                      <span
                        className="max-w-[28rem] break-all font-mono text-xs"
                        title={row.candidateKey}
                      >
                        {formatCandidateKeyLabel(row.candidateKey)}
                      </span>
                      <span className="max-w-[28rem] break-all font-mono text-[11px] leading-4 text-[var(--muted)]">
                        prompt {formatCandidateIdentifier(row.promptHash)}
                      </span>
                      <span className="max-w-[28rem] break-all font-mono text-[11px] leading-4 text-[var(--muted)]">
                        config {formatCandidateIdentifierList(row.configHashes)}
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

      {variant === "detail" ? (
        <p className="mt-3 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
          Candidate comparison is paper-only validation evidence. It is not a
          strategy recommendation or performance guarantee.
        </p>
      ) : null}

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

function UnavailablePanel({ result }: { result: UnavailableValidationLab }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={result.endpoint}
        status={result.status}
        title="Validation Lab"
      />
      <div className="mt-4 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {result.message}
      </div>
    </section>
  );
}

function PanelHeader({
  eyebrow,
  status,
  title
}: {
  eyebrow: string;
  status: string;
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

function formatRatio(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    style: "percent"
  }).format(value);
}

function formatNullableRatio(value: number | null): string {
  return value === null ? "missing" : formatRatio(value);
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

function formatCandidateKeyLabel(value: string): string {
  return value.length <= 72
    ? value
    : `${value.slice(0, 34)}...${value.slice(-34)}`;
}

function formatCandidateIdentifier(value: string | null): string {
  return value ?? "missing";
}

function formatCandidateIdentifierList(values: Array<string | null>): string {
  if (values.length === 0) {
    return "missing";
  }
  return values.map(formatCandidateIdentifier).join(", ");
}
