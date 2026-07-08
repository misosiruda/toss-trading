import type {
  CostRiskWarningView,
  CpcvPboValidationView,
  MetaLabelEvaluationView,
  SharpeValidationView,
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
        <DataUniverseCoverageSummary value={data.dataUniverseCoverage} />
        <ObjectSummary
          title="Provider failure"
          value={data.providerFailureSummary}
        />
        <ObjectSummary title="Risk rejects" value={data.riskRejectSummary} />
      </div>
      <CostRiskWarning warning={data.costRiskWarning} variant={variant} />
      <SharpeValidationWarning
        validation={data.sharpeValidation}
        variant={variant}
      />
      <CpcvPboValidationWarning
        validation={data.cpcvPboValidation}
        variant={variant}
      />
      <MetaLabelEvaluationSummary
        validation={data.metaLabelEvaluation}
        variant={variant}
      />
      <ValidationCandidateComparison
        comparison={data.candidateComparison}
        variant={variant}
      />
      <Warnings warnings={data.warnings} />
    </section>
  );
}

function CostRiskWarning({
  warning,
  variant
}: {
  warning: CostRiskWarningView;
  variant: ValidationPanelVariant;
}) {
  const bucket = warning.highestCostBucket;
  return (
    <section aria-label="Cost risk warning" className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-[var(--accent)]">
            RH4 cost warning
          </p>
          <h3 className="mt-1 text-base font-semibold">
            Execution cost risk
          </h3>
        </div>
        <Badge
          tone={costRiskWarningStatusTone(warning.status)}
          value={warning.status}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Samples" value={String(warning.sampleCount)} />
        <Metric label="Trades" value={String(warning.tradeCount)} />
        <Metric label="Total cost" value={formatKrw(warning.totalCostKrw)} />
        <Metric label="Impact cost" value={formatKrw(warning.impactCostKrw)} />
        <Metric
          label="Spread/slippage"
          value={`${formatKrw(warning.spreadCostKrw)} / ${formatKrw(warning.slippageKrw)}`}
        />
        <Metric
          label="Max participation"
          value={formatNullableRatio(warning.maxParticipationRate)}
        />
        <Metric
          label="Partial fills"
          value={String(warning.partialFillCount)}
        />
        <Metric label="Warnings" value={String(warning.warningCount)} />
      </div>

      {bucket === null ? null : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Highest cost bucket" value={bucket.strategyBucket} />
          <Metric label="Bucket trades" value={String(bucket.tradeCount)} />
          <Metric label="Bucket cost" value={formatKrw(bucket.totalCostKrw)} />
          <Metric
            label="Bucket max participation"
            value={formatNullableRatio(bucket.maxParticipationRate)}
          />
        </div>
      )}

      {variant === "detail" &&
      warning.missingStrategyBucketBreakdownCount > 0 ? (
        <p className="mt-3 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
          Missing strategy bucket cost breakdown runs:{" "}
          {warning.missingStrategyBucketBreakdownCount} total; sample:{" "}
          {warning.missingStrategyBucketBreakdownRunIds.join(", ")}
        </p>
      ) : null}

      <p className="mt-3 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {warning.readOnlyNotice}
      </p>

      {warning.warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-2 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
          {warning.warnings.map((item) => (
            <li key={`${item.code}:${item.message}`}>
              <span className="font-mono">{item.code}</span>
              <span aria-hidden="true">: </span>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SharpeValidationWarning({
  validation,
  variant
}: {
  validation: SharpeValidationView;
  variant: ValidationPanelVariant;
}) {
  return (
    <section aria-label="Sharpe validation warning" className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Sharpe Validation Warning</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Read-only sharpe_validation.v1 summary from stored batch aggregate
            artifacts.
          </p>
        </div>
        <Badge
          tone={validationStatusTone(validation.status)}
          value={validation.status}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Metric
          label="Sample Sharpe"
          value={[
            validation.sampleSharpeStatus ?? "missing",
            formatNullableSharpeEstimate(validation.sampleSharpeValue)
          ].join(" / ")}
        />
        <Metric
          label="Lo-adjusted"
          value={validation.loAdjustedSharpeStatus ?? "missing"}
        />
        <Metric
          label="PSR"
          value={[
            validation.probabilisticSharpeRatioStatus ?? "missing",
            formatNullableRatio(validation.probabilisticSharpeRatioProbability)
          ].join(" / ")}
        />
        <Metric
          label="DSR"
          value={[
            validation.deflatedSharpeRatioStatus ?? "missing",
            formatNullableRatio(validation.deflatedSharpeRatioProbability)
          ].join(" / ")}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Metric
          label="Samples"
          value={`${validation.returnSampleCount}/${validation.minimumSampleCount ?? "missing"}`}
        />
        <Metric
          label="Trials"
          value={formatNullableInteger(validation.selectionContext.trialCount)}
        />
        <Metric
          label="Adjustment"
          value={
            validation.selectionContext.multipleTestingAdjustment ?? "missing"
          }
        />
        <Metric label="Warnings" value={String(validation.warningCount)} />
      </div>

      {variant === "detail" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Metric
            label="Schema"
            value={validation.schemaVersion ?? "missing"}
          />
          <Metric
            label="Candidates"
            value={formatNullableInteger(
              validation.selectionContext.candidateCount
            )}
          />
          <Metric
            label="Trial Sharpe dispersion"
            value={formatNullableSharpeEstimate(
              validation.selectionContext.trialSharpeRatioStandardDeviation
            )}
          />
        </div>
      ) : null}

      <p className="mt-3 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {validation.readOnlyNotice}
      </p>

      {validation.warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
          {validation.warnings.map((warning) => (
            <li key={`${warning.code}:${warning.message}`}>
              <span className="font-mono">{warning.code}</span>
              <span aria-hidden="true"> · </span>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CpcvPboValidationWarning({
  validation,
  variant
}: {
  validation: CpcvPboValidationView;
  variant: ValidationPanelVariant;
}) {
  return (
    <section aria-label="CPCV PBO validation warning" className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            CPCV/PBO Validation Warning
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Read-only cpcv_pbo_validation.v1 summary from stored batch
            aggregate artifacts.
          </p>
        </div>
        <Badge
          tone={cpcvPboStatusTone(validation.status)}
          value={validation.status}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Metric
          label="PBO probability"
          value={formatNullableRatio(validation.pboProbability)}
        />
        <Metric label="PBO status" value={validation.pboStatus ?? "missing"} />
        <Metric
          label="Evaluated"
          value={String(validation.evaluatedCombinationCount)}
        />
        <Metric label="Warnings" value={String(validation.warningCount)} />
      </div>

      {variant === "detail" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Metric
            label="Schema"
            value={validation.schemaVersion ?? "missing"}
          />
          <Metric
            label="Combination mode"
            value={validation.combinationMode ?? "missing"}
          />
          <Metric
            label="Split plan"
            value={validation.splitPlanAvailable ? "available" : "missing"}
          />
        </div>
      ) : null}

      <p className="mt-3 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {validation.readOnlyNotice}
      </p>

      {validation.warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
          {validation.warnings.map((warning) => (
            <li key={`${warning.code}:${warning.message}`}>
              <span className="font-mono">{warning.code}</span>
              <span aria-hidden="true"> · </span>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MetaLabelEvaluationSummary({
  validation,
  variant
}: {
  validation: MetaLabelEvaluationView;
  variant: ValidationPanelVariant;
}) {
  return (
    <section aria-label="Meta-label evaluation summary" className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Meta-label Evaluation</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Read-only meta_label_evaluation.v1 summary from stored research
            artifacts.
          </p>
        </div>
        <Badge
          tone={metaLabelEvaluationStatusTone(validation.status)}
          value={validation.status}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Metric
          label="Candidates"
          value={String(validation.totalCandidateCount)}
        />
        <Metric
          label="Actionable"
          value={String(validation.actionableCandidateCount)}
        />
        <Metric
          label="Accuracy"
          value={formatNullableRatio(validation.accuracyRatio)}
        />
        <Metric
          label="Warnings"
          value={String(validation.warningCount)}
        />
      </div>

      {variant === "detail" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Metric
            label="Schema"
            value={validation.schemaVersion ?? "missing"}
          />
          <Metric
            label="Correct side"
            value={String(validation.correctSideCount)}
          />
          <Metric
            label="Wrong side"
            value={String(validation.wrongSideCount)}
          />
          <Metric
            label="Not actionable"
            value={String(validation.notActionableCount)}
          />
        </div>
      ) : null}

      <p className="mt-3 rounded-[8px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm leading-5 text-[var(--warning)]">
        {validation.readOnlyNotice}
      </p>

      {validation.warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--muted)]">
          {validation.warnings.map((warning) => (
            <li key={`${warning.code}:${warning.message}`}>
              <span className="font-mono">{warning.code}</span>
              <span aria-hidden="true"> · </span>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
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

function DataUniverseCoverageSummary({ value }: { value: unknown }) {
  const metrics = dataUniverseCoverageMetrics(value);
  return (
    <article className="rounded-[8px] border border-[var(--border)] p-3">
      <h3 className="text-sm font-semibold">Data universe coverage</h3>
      {metrics === null ? null : (
        <dl
          aria-label="Data universe coverage strategy bucket metrics"
          className="mt-3 grid gap-2 text-xs sm:grid-cols-2"
        >
          <CoverageMetric label="Status" value={metrics.status} />
          <CoverageMetric label="Universe" value={metrics.universeId} />
          <CoverageMetric
            label="Available buckets"
            value={metrics.availableBuckets}
          />
          <CoverageMetric label="Bucket gaps" value={metrics.bucketGaps} />
        </dl>
      )}
      <pre
        aria-label="Data universe coverage summary"
        className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel-muted)] p-3 font-mono text-xs leading-5 text-[var(--muted)]"
        tabIndex={0}
      >
        {formatObject(value)}
      </pre>
    </article>
  );
}

function CoverageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[var(--foreground)]">
        {value}
      </dd>
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

function cpcvPboStatusTone(
  status: CpcvPboValidationView["status"]
): "ok" | "watch" | "blocked" {
  if (status === "available") {
    return "ok";
  }
  if (status === "sampled") {
    return "watch";
  }
  return "blocked";
}

function metaLabelEvaluationStatusTone(
  status: MetaLabelEvaluationView["status"]
): "ok" | "watch" | "blocked" {
  if (status === "available") {
    return "ok";
  }
  if (status === "missing") {
    return "watch";
  }
  return "blocked";
}

function costRiskWarningStatusTone(
  status: CostRiskWarningView["status"]
): "ok" | "watch" | "blocked" {
  if (status === "available") {
    return "ok";
  }
  if (status === "warning") {
    return "watch";
  }
  return "blocked";
}

function validationStatusTone(
  status: "missing" | "available" | "sampled" | "unavailable"
): "ok" | "watch" | "blocked" {
  if (status === "available") {
    return "ok";
  }
  if (status === "sampled") {
    return "watch";
  }
  return "blocked";
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

function formatKrw(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "KRW"
  }).format(value);
}

function formatSharpeEstimate(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 4
  }).format(value);
}

function formatNullableSharpeEstimate(value: number | null): string {
  return value === null ? "missing" : formatSharpeEstimate(value);
}

function formatNullableInteger(value: number | null): string {
  return value === null ? "missing" : String(value);
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

function dataUniverseCoverageMetrics(value: unknown): {
  status: string;
  universeId: string;
  availableBuckets: string;
  bucketGaps: string;
} | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const missingRequiredBucketCount = readNullableNumber(
    value["missingRequiredStrategyBucketCount"]
  );
  const insufficientBucketCount = readNullableNumber(
    value["insufficientAvailableStrategyBucketSymbolCount"]
  );
  return {
    status: readNullableString(value["coverageReportStatus"]) ?? "missing",
    universeId: readNullableString(value["universeId"]) ?? "missing",
    availableBuckets: formatNumberRecord(
      readNumberRecord(value["availableStrategyBucketSymbolCounts"])
    ),
    bucketGaps: [
      `missing required: ${formatNullableInteger(missingRequiredBucketCount)}`,
      `insufficient: ${formatNullableInteger(insufficientBucketCount)}`
    ].join(", ")
  };
}

function formatNumberRecord(value: Record<string, number>): string {
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length === 0) {
    return "missing";
  }
  return entries.map(([key, count]) => `${key}: ${count}`).join(", ");
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

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isPlainRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1])
    )
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
