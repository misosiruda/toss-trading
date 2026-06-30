import type {
  JsonReadStatus,
  RiskGateTraceViewModel,
  ViewModelResult
} from "@/lib/dashboardViewModels";

type RiskGateTraceRow = RiskGateTraceViewModel["traces"][number];
type RiskGatePanelVariant = "summary" | "detail";
type UnavailableRiskGateTrace = Extract<
  ViewModelResult<RiskGateTraceViewModel>,
  { status: "offline" | "invalid" }
>;

const BUCKET_LABELS: Record<RiskGateTraceRow["strategyBucket"], string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge",
  unknown: "Unknown"
};

export function RiskGateTracePanel({
  result,
  variant = "summary"
}: {
  result: ViewModelResult<RiskGateTraceViewModel>;
  variant?: RiskGatePanelVariant;
}) {
  if (result.status !== "ok") {
    return <UnavailablePanel result={result} />;
  }

  const data = result.data;
  const rejectedTraceCount = data.traces.filter(
    (trace) => !trace.riskApproved
  ).length;
  const executedTraceCount = data.traces.filter(
    (trace) =>
      trace.riskApproved &&
      (trace.simulatedExecutionStatus === "filled" ||
        trace.simulatedExecutionStatus === "partial")
  ).length;

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={data.sourceFamily}
        status="ok"
        title={
          variant === "detail"
            ? "Decision to Risk Gate Trace"
            : "Risk Gate Trace"
        }
      />
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric label="Shown traces" value={String(data.count)} />
        <Metric
          label="Decision items"
          value={String(data.totalDecisionItemCount)}
        />
        <Metric label="Risk rejects" value={String(rejectedTraceCount)} />
        <Metric label="Executed" value={String(executedTraceCount)} />
      </div>

      {variant === "detail" ? (
        <section
          aria-label="Trace safety contract"
          className="mt-4 grid gap-3 md:grid-cols-3"
        >
          <TraceContractItem label="AI decision" value="evidence only" />
          <TraceContractItem label="Risk gate" value="deterministic verdict" />
          <TraceContractItem label="Execution" value="simulated status" />
        </section>
      ) : null}

      <div
        aria-label="Risk gate trace table scroll area"
        className="mt-5 overflow-x-auto"
        tabIndex={0}
      >
        <table
          aria-label="Risk gate trace table"
          className="min-w-full text-left text-sm"
        >
          <thead className="text-xs uppercase text-[var(--muted)]">
            {variant === "detail" ? (
              <tr>
                <th className="py-2 pr-3 font-medium">Packet</th>
                <th className="py-2 pr-3 font-medium">Decision</th>
                <th className="py-2 pr-3 font-medium">Risk gate</th>
                <th className="py-2 pr-3 font-medium">Execution</th>
                <th className="py-2 pr-3 font-medium">Evidence</th>
                <th className="py-2 font-medium">Audit refs</th>
              </tr>
            ) : (
              <tr>
                <th className="py-2 pr-3 font-medium">Packet</th>
                <th className="py-2 pr-3 font-medium">Symbol</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Risk</th>
                <th className="py-2 pr-3 font-medium">Execution</th>
                <th className="py-2 font-medium">Reject codes</th>
              </tr>
            )}
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
              data.traces.map((trace) =>
                variant === "detail" ? (
                  <DetailedTraceRow key={trace.decisionId} trace={trace} />
                ) : (
                  <SummaryTraceRow key={trace.decisionId} trace={trace} />
                )
              )
            )}
          </tbody>
        </table>
      </div>
      <SourceStatusList sourceStatus={data.sourceStatus} />
    </section>
  );
}

function SummaryTraceRow({ trace }: { trace: RiskGateTraceRow }) {
  return (
    <tr>
      <td className="py-2 pr-3 font-mono text-xs">{trace.packetId}</td>
      <td className="py-2 pr-3 font-mono text-xs">
        {trace.market}:{trace.symbol}
      </td>
      <td className="py-2 pr-3">{trace.action}</td>
      <td className="py-2 pr-3">
        <RiskVerdictBadge trace={trace} />
      </td>
      <td className="py-2 pr-3">
        <ExecutionStatusBadge trace={trace} />
      </td>
      <td className="py-2 text-xs text-[var(--muted)]">
        {formatList(trace.rejectCodes, "none")}
      </td>
    </tr>
  );
}

function DetailedTraceRow({ trace }: { trace: RiskGateTraceRow }) {
  return (
    <tr>
      <td className="min-w-[12rem] py-2 pr-3 align-top">
        <div className="flex flex-col gap-1">
          <span className="break-all font-mono text-xs">{trace.packetId}</span>
          <span className="break-all font-mono text-[11px] leading-4 text-[var(--muted)]">
            {trace.market}:{trace.symbol}
          </span>
          <span className="text-[11px] leading-4 text-[var(--muted)]">
            {BUCKET_LABELS[trace.strategyBucket]}
          </span>
        </div>
      </td>
      <td className="min-w-[18rem] py-2 pr-3 align-top">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs">{trace.action}</span>
          <span className="font-mono text-[11px] leading-4 text-[var(--muted)]">
            budget {formatKrw(trace.normalizedBudgetKrw)}
          </span>
          <span className="text-xs leading-5 text-[var(--muted)]">
            {trace.aiThesis ?? "thesis missing"}
          </span>
        </div>
      </td>
      <td className="min-w-[12rem] py-2 pr-3 align-top">
        <div className="flex flex-col items-start gap-2">
          <RiskVerdictBadge trace={trace} />
          <span className="break-all font-mono text-[11px] leading-4 text-[var(--muted)]">
            {formatList(trace.rejectCodes, "no reject code")}
          </span>
        </div>
      </td>
      <td className="min-w-[13rem] py-2 pr-3 align-top">
        <div className="flex flex-col items-start gap-2">
          <ExecutionStatusBadge trace={trace} />
          <span className="font-mono text-[11px] leading-4 text-[var(--muted)]">
            raw status {trace.simulatedExecutionStatus}
          </span>
        </div>
      </td>
      <td className="min-w-[14rem] py-2 pr-3 align-top font-mono text-[11px] leading-4 text-[var(--muted)]">
        {formatList(trace.evidenceRefs, "no evidence ref")}
      </td>
      <td className="min-w-[10rem] py-2 align-top font-mono text-[11px] leading-4 text-[var(--muted)]">
        {formatList(trace.auditEventRefs, "no audit ref")}
      </td>
    </tr>
  );
}

function RiskVerdictBadge({ trace }: { trace: RiskGateTraceRow }) {
  return (
    <Badge
      tone={trace.riskApproved ? "ok" : "blocked"}
      value={trace.riskApproved ? "risk approved" : "risk rejected"}
    />
  );
}

function ExecutionStatusBadge({ trace }: { trace: RiskGateTraceRow }) {
  const value = !trace.riskApproved
    ? "not executed by risk gate"
    : trace.simulatedExecutionStatus === "none"
      ? "no simulated fill"
      : trace.simulatedExecutionStatus;
  return <Badge tone={executionTone(trace)} value={value} />;
}

function TraceContractItem({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
      <p className="text-xs font-medium uppercase text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 break-words font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function UnavailablePanel({ result }: { result: UnavailableRiskGateTrace }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <PanelHeader
        eyebrow={result.endpoint}
        status={result.status}
        title="Risk Gate Trace"
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

function executionTone(trace: RiskGateTraceRow): "ok" | "watch" | "blocked" {
  if (!trace.riskApproved || trace.simulatedExecutionStatus === "rejected") {
    return "blocked";
  }
  if (trace.simulatedExecutionStatus === "filled") {
    return "ok";
  }
  return "watch";
}

function formatKrw(value: number | null): string {
  if (value === null) {
    return "missing";
  }
  return new Intl.NumberFormat("ko-KR", {
    currency: "KRW",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatList(values: string[], emptyValue: string): string {
  return values.length === 0 ? emptyValue : values.join(", ");
}
