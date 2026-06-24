"use client";

import { useMemo, useState } from "react";
import {
  buildPolicyPreview,
  createDefaultPolicyDraft,
  formatPct,
  validatePolicyDraft,
  type CashRuleSource,
  type PolicyBucketDraft,
  type PortfolioPolicyDraft,
  type StrategyBucket
} from "@/lib/policyDraft";

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

const CASH_RULE_OPTIONS: Array<{ label: string; value: CashRuleSource }> = [
  { label: "Static", value: "static" },
  { label: "Dynamic regime", value: "dynamic_regime" },
  { label: "High volatility", value: "high_volatility" },
  { label: "Fallback", value: "fallback" }
];

export function PolicyBuilderForm() {
  const [draft, setDraft] = useState<PortfolioPolicyDraft>(() =>
    createDefaultPolicyDraft()
  );
  const [validationRunCount, setValidationRunCount] = useState(0);
  const validation = useMemo(() => validatePolicyDraft(draft), [draft]);
  const preview = useMemo(
    () => buildPolicyPreview(draft, validation),
    [draft, validation]
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-xs text-[var(--muted)]">
              PortfolioPolicy draft
            </p>
            <h2 className="mt-1 text-base font-semibold">Policy Controls</h2>
          </div>
          <StatusBadge
            tone={validation.status === "valid" ? "ok" : "blocked"}
            value={validation.status}
          />
        </div>

        <div className="mt-4 grid gap-4">
          <label className="grid gap-2 text-sm font-medium" htmlFor="policy-name">
            Policy name
            <input
              className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 text-sm"
              id="policy-name"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              value={draft.name}
            />
          </label>

          <div className="overflow-x-auto">
            <table className="min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Bucket</th>
                  <th className="py-2 pr-3 font-medium">Target</th>
                  <th className="py-2 pr-3 font-medium">Min</th>
                  <th className="py-2 pr-3 font-medium">Max</th>
                  <th className="py-2 pr-3 font-medium">Turnover</th>
                  <th className="py-2 font-medium">Horizon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {draft.buckets.map((bucket) => (
                  <BucketInputRow
                    bucket={bucket}
                    key={bucket.bucket}
                    onChange={(nextBucket) => updateBucket(nextBucket, setDraft)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <section
            aria-label="Cash and hedge policy"
            className="grid gap-3 md:grid-cols-2"
          >
            <div className="rounded-[8px] border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold">Cash Reserve</h3>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-2 text-sm" htmlFor="cash-rule">
                  Cash rule
                  <select
                    className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                    id="cash-rule"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cashPolicy: {
                          ...current.cashPolicy,
                          ruleSource: event.target.value as CashRuleSource
                        }
                      }))
                    }
                    value={draft.cashPolicy.ruleSource}
                  >
                    {CASH_RULE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  id="target-cash-reserve"
                  label="Target cash reserve"
                  max={80}
                  min={0}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      cashPolicy: {
                        ...current.cashPolicy,
                        targetCashPct: value
                      }
                    }))
                  }
                  suffix="%"
                  value={draft.cashPolicy.targetCashPct}
                />
                <NumberField
                  id="minimum-cash-reserve"
                  label="Minimum cash reserve KRW"
                  min={0}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      cashPolicy: {
                        ...current.cashPolicy,
                        minimumCashReserveKrw: value
                      }
                    }))
                  }
                  step={100000}
                  value={draft.cashPolicy.minimumCashReserveKrw}
                />
              </div>
            </div>

            <div className="rounded-[8px] border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold">Hedge Policy</h3>
              <div className="mt-3 grid gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    checked={draft.hedgePolicy.enabled}
                    className="h-4 w-4"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        hedgePolicy: {
                          ...current.hedgePolicy,
                          enabled: event.target.checked
                        }
                      }))
                    }
                    type="checkbox"
                  />
                  Hedge enabled
                </label>
                <NumberField
                  id="hedge-cost-cap"
                  label="Hedge cost cap"
                  max={10}
                  min={0}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      hedgePolicy: {
                        ...current.hedgePolicy,
                        maxCostPct: value
                      }
                    }))
                  }
                  step={0.1}
                  suffix="%"
                  value={draft.hedgePolicy.maxCostPct}
                />
              </div>
            </div>
          </section>

          <section
            aria-label="Exposure caps"
            className="grid gap-3 rounded-[8px] border border-[var(--border)] p-3 md:grid-cols-3"
          >
            <NumberField
              id="max-symbol-exposure"
              label="Maximum symbol exposure"
              max={100}
              min={1}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  exposurePolicy: {
                    ...current.exposurePolicy,
                    maxSymbolExposurePct: value
                  }
                }))
              }
              suffix="%"
              value={draft.exposurePolicy.maxSymbolExposurePct}
            />
            <NumberField
              id="max-country-exposure"
              label="Maximum country exposure"
              max={100}
              min={1}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  exposurePolicy: {
                    ...current.exposurePolicy,
                    maxCountryExposurePct: value
                  }
                }))
              }
              suffix="%"
              value={draft.exposurePolicy.maxCountryExposurePct}
            />
            <NumberField
              id="max-currency-exposure"
              label="Maximum currency exposure"
              max={100}
              min={1}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  exposurePolicy: {
                    ...current.exposurePolicy,
                    maxCurrencyExposurePct: value
                  }
                }))
              }
              suffix="%"
              value={draft.exposurePolicy.maxCurrencyExposurePct}
            />
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="rounded-[6px] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setValidationRunCount((count) => count + 1)}
              type="button"
            >
              Validate draft
            </button>
            <button
              className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setDraft(createDefaultPolicyDraft());
                setValidationRunCount(0);
              }}
              type="button"
            >
              Reset draft
            </button>
          </div>
        </div>
      </section>

      <aside className="grid gap-5">
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-[var(--muted)]">
                {formatPct(validation.totalAllocationPct)} · local checks{" "}
                {validationRunCount}
              </p>
              <h2 className="mt-1 text-base font-semibold">Draft Validation</h2>
            </div>
            <StatusBadge
              tone={validation.status === "valid" ? "ok" : "blocked"}
              value={
                validation.status === "valid"
                  ? "backend-ready"
                  : "needs changes"
              }
            />
          </div>
          {validation.issues.length === 0 ? (
            <p
              aria-live="polite"
              className="mt-4 rounded-[8px] border border-[var(--success-soft)] bg-[var(--success-soft)] p-3 text-sm leading-5 text-[var(--success)]"
            >
              Draft passes local validation. Backend validation is still required
              before any paper simulation can use it.
            </p>
          ) : (
            <ul
              aria-live="polite"
              className="mt-4 space-y-2 rounded-[8px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger)]"
            >
              {validation.issues.map((issue) => (
                <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-[var(--muted)]">
                paper_only
              </p>
              <h2 className="mt-1 text-base font-semibold">Config Preview</h2>
            </div>
            <StatusBadge tone="blocked" value="no mutation" />
          </div>
          <pre
            aria-label="PortfolioPolicy preview"
            className="mt-4 max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel-muted)] p-3 font-mono text-xs leading-5 text-[var(--muted)]"
            tabIndex={0}
          >
            {JSON.stringify(preview, null, 2)}
          </pre>
        </section>
      </aside>
    </div>
  );
}

function BucketInputRow({
  bucket,
  onChange
}: {
  bucket: PolicyBucketDraft;
  onChange: (bucket: PolicyBucketDraft) => void;
}) {
  const label = BUCKET_LABELS[bucket.bucket];

  return (
    <tr>
      <th className="py-2 pr-3 font-medium" scope="row">
        <span>{label}</span>
        <span className="mt-1 block font-mono text-xs font-normal text-[var(--muted)]">
          {bucket.bucket}
        </span>
      </th>
      <td className="py-2 pr-3">
        <NumberInput
          id={`${bucket.bucket}-target`}
          label={`${label} target`}
          max={100}
          min={0}
          onChange={(value) => onChange({ ...bucket, targetWeightPct: value })}
          value={bucket.targetWeightPct}
        />
      </td>
      <td className="py-2 pr-3">
        <NumberInput
          id={`${bucket.bucket}-min`}
          label={`${label} minimum`}
          max={100}
          min={0}
          onChange={(value) => onChange({ ...bucket, minWeightPct: value })}
          value={bucket.minWeightPct}
        />
      </td>
      <td className="py-2 pr-3">
        <NumberInput
          id={`${bucket.bucket}-max`}
          label={`${label} maximum`}
          max={100}
          min={0}
          onChange={(value) => onChange({ ...bucket, maxWeightPct: value })}
          value={bucket.maxWeightPct}
        />
      </td>
      <td className="py-2 pr-3">
        <NumberInput
          id={`${bucket.bucket}-turnover`}
          label={`${label} turnover cap`}
          max={100}
          min={0}
          onChange={(value) => onChange({ ...bucket, maxTurnoverPct: value })}
          value={bucket.maxTurnoverPct}
        />
      </td>
      <td className="py-2 font-mono text-xs text-[var(--muted)]">
        {bucket.holdingPeriodHint}
      </td>
    </tr>
  );
}

function NumberField({
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value
}: {
  id: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <label className="grid gap-2 text-sm" htmlFor={id}>
      {label}
      <div className="flex items-center overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)]">
        <input
          className="min-w-0 flex-1 bg-transparent px-3 py-2"
          id={id}
          max={max}
          min={min}
          onChange={(event) => onChange(parseNumericInput(event.target.value))}
          step={step}
          type="number"
          value={String(value)}
        />
        {suffix === undefined ? null : (
          <span className="border-l border-[var(--border)] px-2 text-xs text-[var(--muted)]">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function NumberInput({
  id,
  label,
  max,
  min,
  onChange,
  value
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        className="w-24 rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-2 py-1 font-mono text-xs"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(parseNumericInput(event.target.value))}
        step={1}
        type="number"
        value={String(value)}
      />
    </>
  );
}

function StatusBadge({
  tone,
  value
}: {
  tone: "ok" | "blocked";
  value: string;
}) {
  const className =
    tone === "ok"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : "bg-[var(--danger-soft)] text-[var(--danger)]";
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-[6px] px-2 py-1 text-xs font-semibold ${className}`}
    >
      {value}
    </span>
  );
}

function updateBucket(
  nextBucket: PolicyBucketDraft,
  setDraft: (updater: (current: PortfolioPolicyDraft) => PortfolioPolicyDraft) => void
) {
  setDraft((current) => ({
    ...current,
    buckets: current.buckets.map((bucket) =>
      bucket.bucket === nextBucket.bucket ? nextBucket : bucket
    )
  }));
}

function parseNumericInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
