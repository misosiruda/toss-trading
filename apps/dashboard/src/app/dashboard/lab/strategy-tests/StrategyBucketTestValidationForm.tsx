"use client";

import { useMemo, useState } from "react";
import {
  buildPolicyPreview,
  createDefaultPolicyDraft,
  validatePolicyDraft,
  type StrategyBucket
} from "@/lib/policyDraft";

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

const DECISION_FREQUENCY_OPTIONS = [
  { label: "Weekly", stepSeconds: 604800, value: "once_per_week" },
  { label: "Daily", stepSeconds: 86400, value: "once_per_day" },
  { label: "Every tick", stepSeconds: 300, value: "every_tick" }
] as const;

type DecisionFrequency = (typeof DECISION_FREQUENCY_OPTIONS)[number]["value"];
type DecisionProviderMode = "dry_run_fixture" | "codex_paper_only";
type ValidationSplitRole = "train" | "validation" | "test";
type UniverseMarket = "mixed_global" | "kr" | "us";

interface StrategyBucketTestValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error";
}

interface StrategyBucketTestValidationResponse {
  mode: "paper_only";
  validation: "strategy_bucket_test";
  readOnly: true;
  storageMutationEnabled: false;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  status: "valid" | "invalid";
  validatedForStrategyBucketTestConfig: boolean;
  bucket: StrategyBucket;
  policyId: string;
  policyHash: string;
  configHash: string;
  issueCount: number;
  issues: StrategyBucketTestValidationIssue[];
  summary: {
    sourceDataDir: string;
    market: UniverseMarket;
    validationSplitRole: ValidationSplitRole;
    bucketTargetWeightRatio: number;
    decisionFrequency: DecisionFrequency;
    backendValidationRequired: true;
  };
  validatedAt: string;
}

type BackendValidationState =
  | { status: "idle" }
  | { status: "pending"; requestJson: string }
  | {
      status: "ready";
      requestJson: string;
      response: StrategyBucketTestValidationResponse;
    }
  | { status: "error"; requestJson: string; message: string };

export function StrategyBucketTestValidationForm() {
  const [bucket, setBucket] = useState<StrategyBucket>("long_term");
  const [sourceDataDir, setSourceDataDir] = useState(
    "data/replay-2023-01-2026-05-global-yahoo-daily"
  );
  const [market, setMarket] = useState<UniverseMarket>("mixed_global");
  const [validationSplitRole, setValidationSplitRole] =
    useState<ValidationSplitRole>("validation");
  const [startAt, setStartAt] = useState("2024-01-01");
  const [endAt, setEndAt] = useState("2024-02-01");
  const [windowMonths, setWindowMonths] = useState(1);
  const [decisionFrequency, setDecisionFrequency] =
    useState<DecisionFrequency>("once_per_week");
  const [maxDecisionCalls, setMaxDecisionCalls] = useState(5);
  const [decisionProvider, setDecisionProvider] =
    useState<DecisionProviderMode>("dry_run_fixture");
  const [maxCodexCallsPerRun, setMaxCodexCallsPerRun] = useState(0);
  const [initialCashKrw, setInitialCashKrw] = useState(10_000_000);
  const [backendValidation, setBackendValidation] =
    useState<BackendValidationState>({ status: "idle" });

  const policyDraft = useMemo(() => createDefaultPolicyDraft(), []);
  const policyValidation = useMemo(
    () => validatePolicyDraft(policyDraft),
    [policyDraft]
  );
  const policyPreview = useMemo(
    () => buildPolicyPreview(policyDraft, policyValidation),
    [policyDraft, policyValidation]
  );
  const selectedFrequency = DECISION_FREQUENCY_OPTIONS.find(
    (option) => option.value === decisionFrequency
  );
  const requestPreview = useMemo(
    () => ({
      mode: "paper_only",
      requestId: `strategy-test-lab-${bucket}-validation`,
      bucket,
      policy: policyPreview,
      testConfig: {
        sourceDataDir,
        universe: {
          preset: "global_broad",
          market
        },
        validationSplitRole,
        window: {
          seed: `strategy-test-lab-${bucket}-seed`,
          startAt,
          endAt,
          windowMonths
        },
        samplingPolicy: {
          decisionFrequency,
          stepSeconds: selectedFrequency?.stepSeconds ?? 604800,
          maxDecisionCalls,
          maxCodexCallsPerRun
        },
        capital: {
          initialCashKrw
        },
        decisionProvider: {
          mode: decisionProvider,
          modelId:
            decisionProvider === "codex_paper_only"
              ? "gpt-5.3-codex-spark"
              : "dry-run",
          outputSchema: "schemas/virtual-decision.schema.json"
        }
      }
    }),
    [
      bucket,
      decisionFrequency,
      decisionProvider,
      endAt,
      initialCashKrw,
      market,
      maxCodexCallsPerRun,
      maxDecisionCalls,
      policyPreview,
      selectedFrequency?.stepSeconds,
      sourceDataDir,
      startAt,
      validationSplitRole,
      windowMonths
    ]
  );
  const requestJson = useMemo(
    () => JSON.stringify(requestPreview),
    [requestPreview]
  );
  const visibleBackendValidation = currentBackendValidation(
    backendValidation,
    requestJson
  );

  async function validateWithBackend() {
    const currentRequestJson = requestJson;
    setBackendValidation({
      status: "pending",
      requestJson: currentRequestJson
    });

    try {
      const response = await fetch("/dashboard/lab/strategy-tests/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: currentRequestJson
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isStrategyBucketTestValidationResponse(payload)) {
        setBackendValidation((current) =>
          isPendingBackendValidation(current, currentRequestJson)
            ? {
                status: "error",
                requestJson: currentRequestJson,
                message: readErrorMessage(payload, response.status)
              }
            : current
        );
        return;
      }

      setBackendValidation((current) =>
        isPendingBackendValidation(current, currentRequestJson)
          ? {
              status: "ready",
              requestJson: currentRequestJson,
              response: payload
            }
          : current
      );
    } catch (error) {
      setBackendValidation((current) =>
        isPendingBackendValidation(current, currentRequestJson)
          ? {
              status: "error",
              requestJson: currentRequestJson,
              message:
                error instanceof Error
                  ? error.message
                  : "Strategy bucket validation request failed"
            }
          : current
      );
    }
  }

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs text-[var(--muted)]">
            validation-only
          </p>
          <h2 className="mt-1 text-base font-semibold">Bucket Test Config</h2>
        </div>
        <StatusBadge tone="blocked" value="runner disabled" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium" htmlFor="test-bucket">
              Bucket
              <select
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                id="test-bucket"
                onChange={(event) =>
                  setBucket(event.target.value as StrategyBucket)
                }
                value={bucket}
              >
                {Object.entries(BUCKET_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="validation-split-role"
            >
              Split role
              <select
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                id="validation-split-role"
                onChange={(event) =>
                  setValidationSplitRole(
                    event.target.value as ValidationSplitRole
                  )
                }
                value={validationSplitRole}
              >
                <option value="train">Train</option>
                <option value="validation">Validation</option>
                <option value="test">Test</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="test-market">
              Market
              <select
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                id="test-market"
                onChange={(event) =>
                  setMarket(event.target.value as UniverseMarket)
                }
                value={market}
              >
                <option value="mixed_global">Mixed global</option>
                <option value="kr">KR</option>
                <option value="us">US</option>
              </select>
            </label>
          </div>

          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="source-data-dir"
          >
            Source data directory
            <input
              className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
              id="source-data-dir"
              onChange={(event) => setSourceDataDir(event.target.value)}
              value={sourceDataDir}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium" htmlFor="start-at">
              Start
              <input
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
                id="start-at"
                onChange={(event) => setStartAt(event.target.value)}
                value={startAt}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="end-at">
              End
              <input
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
                id="end-at"
                onChange={(event) => setEndAt(event.target.value)}
                value={endAt}
              />
            </label>
            <NumberField
              id="window-months"
              label="Window months"
              max={12}
              min={1}
              onChange={setWindowMonths}
              value={windowMonths}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="decision-frequency"
            >
              Frequency
              <select
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                id="decision-frequency"
                onChange={(event) =>
                  setDecisionFrequency(event.target.value as DecisionFrequency)
                }
                value={decisionFrequency}
              >
                {DECISION_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              id="max-decision-calls"
              label="Max decisions"
              max={100}
              min={1}
              onChange={setMaxDecisionCalls}
              value={maxDecisionCalls}
            />
            <NumberField
              id="initial-cash-krw"
              label="Initial cash KRW"
              min={100000}
              onChange={setInitialCashKrw}
              step={100000}
              value={initialCashKrw}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="decision-provider"
            >
              Decision provider
              <select
                className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2"
                id="decision-provider"
                onChange={(event) => {
                  const nextProvider = event.target
                    .value as DecisionProviderMode;
                  setDecisionProvider(nextProvider);
                  setMaxCodexCallsPerRun(
                    nextProvider === "codex_paper_only" ? 3 : 0
                  );
                }}
                value={decisionProvider}
              >
                <option value="dry_run_fixture">Dry-run fixture</option>
                <option value="codex_paper_only">Codex paper-only</option>
              </select>
            </label>
            <NumberField
              id="max-codex-calls"
              label="Max Codex calls"
              max={31}
              min={0}
              onChange={setMaxCodexCallsPerRun}
              value={maxCodexCallsPerRun}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="rounded-[6px] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={visibleBackendValidation.status === "pending"}
              onClick={() => void validateWithBackend()}
              type="button"
            >
              {visibleBackendValidation.status === "pending"
                ? "Validating bucket"
                : "Validate bucket config"}
            </button>
            <button
              className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setBucket("long_term");
                setSourceDataDir(
                  "data/replay-2023-01-2026-05-global-yahoo-daily"
                );
                setMarket("mixed_global");
                setValidationSplitRole("validation");
                setStartAt("2024-01-01");
                setEndAt("2024-02-01");
                setWindowMonths(1);
                setDecisionFrequency("once_per_week");
                setMaxDecisionCalls(5);
                setDecisionProvider("dry_run_fixture");
                setMaxCodexCallsPerRun(0);
                setInitialCashKrw(10_000_000);
                setBackendValidation({ status: "idle" });
              }}
              type="button"
            >
              Reset config
            </button>
          </div>

          <BackendValidationPanel state={visibleBackendValidation} />
        </div>

        <aside className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-[var(--muted)]">
                {policyPreview.policyId}
              </p>
              <h3 className="mt-1 text-sm font-semibold">Request Preview</h3>
            </div>
            <StatusBadge tone="blocked" value="no runner" />
          </div>
          <pre
            aria-label="Strategy bucket test request preview"
            className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel)] p-3 font-mono text-xs leading-5 text-[var(--muted)]"
            tabIndex={0}
          >
            {JSON.stringify(requestPreview, null, 2)}
          </pre>
        </aside>
      </div>
    </section>
  );
}

function BackendValidationPanel({ state }: { state: BackendValidationState }) {
  if (state.status === "idle") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Backend validation not run. Bucket test is not created.
      </p>
    );
  }

  if (state.status === "pending") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Backend validation pending. Runner remains disabled.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger)]"
      >
        Strategy validation unavailable. {state.message}
      </p>
    );
  }

  const validation = state.response;
  return (
    <div
      aria-live="polite"
      className={`rounded-[8px] border p-3 text-sm leading-5 ${
        validation.status === "valid"
          ? "border-[var(--success-soft)] bg-[var(--success-soft)] text-[var(--success)]"
          : "border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--danger)]"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">
            Strategy validation {validation.status}
          </p>
          <p className="mt-1 font-mono text-xs">
            config {validation.configHash.slice(0, 19)} · runner not started
          </p>
        </div>
        <StatusBadge
          tone={
            validation.validatedForStrategyBucketTestConfig ? "ok" : "blocked"
          }
          value={
            validation.validatedForStrategyBucketTestConfig
              ? "config-valid"
              : "blocked"
          }
        />
      </div>
      <dl className="mt-3 grid gap-2 md:grid-cols-3">
        <Metric label="Bucket" value={validation.bucket} />
        <Metric
          label="Split"
          value={validation.summary.validationSplitRole}
        />
        <Metric
          label="Frequency"
          value={validation.summary.decisionFrequency}
        />
      </dl>
      {validation.issues.length === 0 ? null : (
        <ul className="mt-3 space-y-1">
          {validation.issues.map((issue) => (
            <li key={`${issue.path}:${issue.code}`}>
              <span className="font-mono text-xs">{issue.code}</span>:{" "}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  value
}: {
  id: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={id}>
      {label}
      <input
        className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        step={step}
        type="number"
        value={Number.isFinite(value) ? value : ""}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-current">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-xs">{value}</dd>
    </div>
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

function currentBackendValidation(
  state: BackendValidationState,
  requestJson: string
): BackendValidationState {
  if (state.status === "idle") {
    return state;
  }
  if (state.requestJson !== requestJson) {
    return { status: "idle" };
  }
  return state;
}

function isPendingBackendValidation(
  state: BackendValidationState,
  requestJson: string
): state is Extract<BackendValidationState, { status: "pending" }> {
  return state.status === "pending" && state.requestJson === requestJson;
}

function isStrategyBucketTestValidationResponse(
  value: unknown
): value is StrategyBucketTestValidationResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["mode"] === "paper_only" &&
    value["validation"] === "strategy_bucket_test" &&
    value["readOnly"] === true &&
    value["storageMutationEnabled"] === false &&
    value["liveTradingEnabled"] === false &&
    value["orderPlacementEnabled"] === false &&
    value["replayRunnerStarted"] === false &&
    (value["status"] === "valid" || value["status"] === "invalid") &&
    typeof value["validatedForStrategyBucketTestConfig"] === "boolean" &&
    typeof value["bucket"] === "string" &&
    typeof value["policyId"] === "string" &&
    typeof value["policyHash"] === "string" &&
    typeof value["configHash"] === "string" &&
    typeof value["issueCount"] === "number" &&
    Array.isArray(value["issues"]) &&
    isRecord(value["summary"]) &&
    typeof value["validatedAt"] === "string"
  );
}

function readErrorMessage(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload["message"] === "string") {
    return payload["message"];
  }
  if (isRecord(payload) && typeof payload["error"] === "string") {
    return payload["error"];
  }
  return `HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
