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

const DEFAULT_SIMULATION_SOURCE_DATA_DIR =
  "data/replay-2023-01-2026-05-global-yahoo-daily";
const DEFAULT_SIMULATION_MODEL_ID = "gpt-5.3-codex-spark";
const DASHBOARD_INTENT_HEADER_NAME = "x-toss-trading-dashboard-intent";
const PAPER_SIMULATION_CREATE_INTENT = "paper-simulation-create";
const DASHBOARD_MUTATION_TOKEN_HEADER_NAME =
  "x-toss-trading-dashboard-mutation-token";

interface BackendPolicyValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error";
}

interface BackendPolicyValidationResponse {
  mode: "paper_only";
  validation: "paper_policy";
  readOnly: true;
  storageMutationEnabled: false;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  policyHash: string;
  status: "valid" | "invalid";
  validatedForPaperSimulationConfig: boolean;
  issueCount: number;
  issues: BackendPolicyValidationIssue[];
}

type BackendValidationState =
  | { status: "idle" }
  | { status: "pending"; previewJson: string }
  | {
      status: "ready";
      previewJson: string;
      response: BackendPolicyValidationResponse;
    }
  | { status: "error"; previewJson: string; message: string };

interface PolicyPaperSimulationConfig {
  mode: "paper_only";
  runType: "batch_replay";
  runCount: number;
  sourceDataDir: string;
  universe: {
    preset: "global_broad";
    market: "mixed_global";
  };
  window: {
    mode: "random_month";
    seed: string;
    startAt: "2024-01-01";
    endAt: "2024-12-31";
    windowMonths: 1;
  };
  samplingPolicy: {
    decisionFrequency: "once_per_week";
    stepSeconds: 604800;
    maxDecisionCalls: 5;
    maxCodexCallsPerRun: 0;
  };
  capital: {
    initialCashKrw: 10000000;
  };
  decisionProvider: {
    mode: "dry_run_fixture";
    modelId: string;
    outputSchema: "schemas/virtual-decision.schema.json";
  };
  riskProfile: "balanced";
  paperExitPolicy: "none";
  costModel: "standard";
  benchmarkPolicy: "cash_equal_weight_initial_hold";
}

interface PaperSimulationCreateResponse {
  mode: "paper_only";
  mutation: "paper_simulation_create";
  status: "accepted";
  simulationRunId: string;
  batchId: string;
  runType: "single_replay" | "batch_replay";
  requestedRunCount: number;
  sourceDataDir: string;
  outputBaseDir: string;
  activeUrl: string;
  historyUrl: string;
  readOnlyLiveTrading: true;
  disclaimer: string;
}

type PaperSimulationCreateState =
  | { status: "idle" }
  | { status: "pending"; configJson: string }
  | {
      status: "ready";
      configJson: string;
      response: PaperSimulationCreateResponse;
    }
  | { status: "error"; configJson: string; message: string };

export function PolicyBuilderForm() {
  const [draft, setDraft] = useState<PortfolioPolicyDraft>(() =>
    createDefaultPolicyDraft()
  );
  const [validationRunCount, setValidationRunCount] = useState(0);
  const [backendValidation, setBackendValidation] =
    useState<BackendValidationState>({ status: "idle" });
  const [simulationSourceDataDir, setSimulationSourceDataDir] = useState(
    DEFAULT_SIMULATION_SOURCE_DATA_DIR
  );
  const [simulationRunCount, setSimulationRunCount] = useState(1);
  const [mutationToken, setMutationToken] = useState("");
  const [paperSimulationCreate, setPaperSimulationCreate] =
    useState<PaperSimulationCreateState>({ status: "idle" });
  const validation = useMemo(() => validatePolicyDraft(draft), [draft]);
  const preview = useMemo(
    () => buildPolicyPreview(draft, validation),
    [draft, validation]
  );
  const previewJson = useMemo(() => JSON.stringify(preview), [preview]);
  const visibleBackendValidation = currentBackendValidation(
    backendValidation,
    previewJson
  );
  const paperSimulationConfig = useMemo(
    () =>
      buildPaperSimulationConfig(
        visibleBackendValidation,
        simulationSourceDataDir,
        simulationRunCount
      ),
    [simulationRunCount, simulationSourceDataDir, visibleBackendValidation]
  );
  const paperSimulationConfigJson = useMemo(
    () =>
      paperSimulationConfig === null
        ? ""
        : JSON.stringify(paperSimulationConfig),
    [paperSimulationConfig]
  );
  const visiblePaperSimulationCreate = currentPaperSimulationCreate(
    paperSimulationCreate,
    paperSimulationConfigJson
  );
  const paperSimulationDisabledReason = readPaperSimulationDisabledReason({
    backendValidation: visibleBackendValidation,
    config: paperSimulationConfig,
    createState: visiblePaperSimulationCreate,
    mutationToken,
    sourceDataDir: simulationSourceDataDir
  });

  async function validateWithBackend() {
    const requestPreviewJson = previewJson;
    setBackendValidation({ status: "pending", previewJson: requestPreviewJson });

    try {
      const response = await fetch("/dashboard/lab/policies/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: requestPreviewJson
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isBackendPolicyValidationResponse(payload)) {
        setBackendValidation((current) =>
          isPendingBackendValidation(current, requestPreviewJson)
            ? {
                status: "error",
                previewJson: requestPreviewJson,
                message: readErrorMessage(payload, response.status)
              }
            : current
        );
        return;
      }
      setBackendValidation((current) =>
        isPendingBackendValidation(current, requestPreviewJson)
          ? {
              status: "ready",
              previewJson: requestPreviewJson,
              response: payload
            }
          : current
      );
    } catch (error) {
      setBackendValidation((current) =>
        isPendingBackendValidation(current, requestPreviewJson)
          ? {
              status: "error",
              previewJson: requestPreviewJson,
              message:
                error instanceof Error
                  ? error.message
                  : "Backend validation request failed"
            }
          : current
      );
    }
  }

  async function createPaperSimulation() {
    if (paperSimulationDisabledReason !== null || paperSimulationConfig === null) {
      return;
    }

    const requestConfigJson = JSON.stringify(paperSimulationConfig);
    setPaperSimulationCreate({
      status: "pending",
      configJson: requestConfigJson
    });

    try {
      const response = await fetch(
        "/dashboard/lab/policies/simulations/create",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [DASHBOARD_INTENT_HEADER_NAME]: PAPER_SIMULATION_CREATE_INTENT,
            [DASHBOARD_MUTATION_TOKEN_HEADER_NAME]: mutationToken.trim()
          },
          body: requestConfigJson
        }
      );
      const payload: unknown = await response.json();
      if (!response.ok || !isPaperSimulationCreateResponse(payload)) {
        setPaperSimulationCreate((current) =>
          isPendingPaperSimulationCreate(current, requestConfigJson)
            ? {
                status: "error",
                configJson: requestConfigJson,
                message: readErrorMessage(payload, response.status)
              }
            : current
        );
        return;
      }
      setPaperSimulationCreate((current) =>
        isPendingPaperSimulationCreate(current, requestConfigJson)
          ? {
              status: "ready",
              configJson: requestConfigJson,
              response: payload
            }
          : current
      );
    } catch (error) {
      setPaperSimulationCreate((current) =>
        isPendingPaperSimulationCreate(current, requestConfigJson)
          ? {
              status: "error",
              configJson: requestConfigJson,
              message:
                error instanceof Error
                  ? error.message
                  : "Paper simulation create request failed"
            }
          : current
      );
    }
  }

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
              className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={visibleBackendValidation.status === "pending"}
              onClick={() => void validateWithBackend()}
              type="button"
            >
              {visibleBackendValidation.status === "pending"
                ? "Backend validating"
                : "Backend validate"}
            </button>
            <button
              className="rounded-[6px] border border-[var(--border)] px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setDraft(createDefaultPolicyDraft());
                setValidationRunCount(0);
                setBackendValidation({ status: "idle" });
                setPaperSimulationCreate({ status: "idle" });
                setSimulationSourceDataDir(DEFAULT_SIMULATION_SOURCE_DATA_DIR);
                setSimulationRunCount(1);
                setMutationToken("");
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
          <BackendValidationPanel state={visibleBackendValidation} />
        </section>

        <PaperSimulationCreatePanel
          config={paperSimulationConfig}
          createState={visiblePaperSimulationCreate}
          disabledReason={paperSimulationDisabledReason}
          mutationToken={mutationToken}
          onCreate={() => void createPaperSimulation()}
          onMutationTokenChange={setMutationToken}
          onRunCountChange={setSimulationRunCount}
          onSourceDataDirChange={setSimulationSourceDataDir}
          runCount={simulationRunCount}
          sourceDataDir={simulationSourceDataDir}
        />

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

function PaperSimulationCreatePanel({
  config,
  createState,
  disabledReason,
  mutationToken,
  onCreate,
  onMutationTokenChange,
  onRunCountChange,
  onSourceDataDirChange,
  runCount,
  sourceDataDir
}: {
  config: PolicyPaperSimulationConfig | null;
  createState: PaperSimulationCreateState;
  disabledReason: string | null;
  mutationToken: string;
  onCreate: () => void;
  onMutationTokenChange: (value: string) => void;
  onRunCountChange: (value: number) => void;
  onSourceDataDirChange: (value: string) => void;
  runCount: number;
  sourceDataDir: string;
}) {
  const canCreate = disabledReason === null;

  return (
    <section
      aria-label="Policy paper simulation create"
      className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-[var(--muted)]">
            POST /paper/simulations
          </p>
          <h2 className="mt-1 text-base font-semibold">
            Paper Simulation Create
          </h2>
        </div>
        <StatusBadge tone={canCreate ? "ok" : "blocked"} value="guarded" />
      </div>

      <div className="mt-4 grid gap-3">
        <label
          className="grid gap-2 text-sm"
          htmlFor="policy-simulation-source-data-dir"
        >
          Source data dir
          <input
            className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
            id="policy-simulation-source-data-dir"
            onChange={(event) => onSourceDataDirChange(event.target.value)}
            value={sourceDataDir}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            id="policy-simulation-run-count"
            label="Run count"
            max={20}
            min={1}
            onChange={(value) => onRunCountChange(clampRunCount(value))}
            value={runCount}
          />
          <label
            className="grid gap-2 text-sm"
            htmlFor="paper-simulation-mutation-token"
          >
            Mutation token
            <input
              autoComplete="off"
              className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
              id="paper-simulation-mutation-token"
              onChange={(event) => onMutationTokenChange(event.target.value)}
              type="password"
              value={mutationToken}
            />
          </label>
        </div>

        {disabledReason === null ? (
          <p
            aria-live="polite"
            className="rounded-[8px] border border-[var(--success-soft)] bg-[var(--success-soft)] p-3 text-sm leading-5 text-[var(--success)]"
          >
            Backend validation passed. This creates a paper-only simulation
            request through the guarded backend endpoint.
          </p>
        ) : (
          <p
            aria-live="polite"
            className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
          >
            {disabledReason}
          </p>
        )}

        <pre
          aria-label="Policy paper simulation config preview"
          className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] bg-[var(--panel-muted)] p-3 font-mono text-xs leading-5 text-[var(--muted)]"
          tabIndex={0}
        >
          {config === null
            ? "Backend validation is required before config generation."
            : JSON.stringify(config, null, 2)}
        </pre>

        <button
          className="rounded-[6px] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canCreate}
          onClick={onCreate}
          type="button"
        >
          {createState.status === "pending"
            ? "Creating paper simulation"
            : "Create paper simulation"}
        </button>

        <PaperSimulationCreateStatus state={createState} />
      </div>
    </section>
  );
}

function PaperSimulationCreateStatus({
  state
}: {
  state: PaperSimulationCreateState;
}) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "pending") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Paper simulation create request pending.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger)]"
      >
        Paper simulation create failed. {state.message}
      </p>
    );
  }

  const response = state.response;
  return (
    <div
      aria-live="polite"
      className="rounded-[8px] border border-[var(--success-soft)] bg-[var(--success-soft)] p-3 text-sm leading-5 text-[var(--success)]"
    >
      <p className="font-semibold">Paper simulation accepted</p>
      <p
        className="mt-1 font-mono text-xs"
        data-testid="policy-paper-simulation-created-run-id"
      >
        {response.simulationRunId} · {response.batchId}
      </p>
      <p className="mt-1 font-mono text-xs">
        runType {response.runType} · runCount {response.requestedRunCount} ·
        live orders disabled
      </p>
    </div>
  );
}

function BackendValidationPanel({ state }: { state: BackendValidationState }) {
  if (state.status === "idle") {
    return (
      <p
        aria-live="polite"
        className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Backend validation not run. Draft is not stored.
      </p>
    );
  }

  if (state.status === "pending") {
    return (
      <p
        aria-live="polite"
        className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Backend validation pending. Draft is being checked without storage
        mutation.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        aria-live="polite"
        className="mt-3 rounded-[8px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger)]"
      >
        Backend validation unavailable. {state.message}
      </p>
    );
  }

  const validation = state.response;
  return (
    <div
      aria-live="polite"
      className={`mt-3 rounded-[8px] border p-3 text-sm leading-5 ${
        validation.status === "valid"
          ? "border-[var(--success-soft)] bg-[var(--success-soft)] text-[var(--success)]"
          : "border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--danger)]"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">
            Backend validation {validation.status}
          </p>
          <p className="mt-1 font-mono text-xs">
            hash {validation.policyHash.slice(0, 12)} · storage mutation
            disabled
          </p>
        </div>
        <StatusBadge
          tone={validation.validatedForPaperSimulationConfig ? "ok" : "blocked"}
          value={
            validation.validatedForPaperSimulationConfig
              ? "config-valid"
              : "blocked"
          }
        />
      </div>
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

function clampRunCount(value: number): number {
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function buildPaperSimulationConfig(
  state: BackendValidationState,
  sourceDataDir: string,
  runCount: number
): PolicyPaperSimulationConfig | null {
  if (
    state.status !== "ready" ||
    state.response.status !== "valid" ||
    !state.response.validatedForPaperSimulationConfig
  ) {
    return null;
  }

  return {
    mode: "paper_only",
    runType: "batch_replay",
    runCount: clampRunCount(runCount),
    sourceDataDir: sourceDataDir.trim(),
    universe: {
      preset: "global_broad",
      market: "mixed_global"
    },
    window: {
      mode: "random_month",
      seed: policyHashSeed(state.response.policyHash),
      startAt: "2024-01-01",
      endAt: "2024-12-31",
      windowMonths: 1
    },
    samplingPolicy: {
      decisionFrequency: "once_per_week",
      stepSeconds: 604800,
      maxDecisionCalls: 5,
      maxCodexCallsPerRun: 0
    },
    capital: {
      initialCashKrw: 10000000
    },
    decisionProvider: {
      mode: "dry_run_fixture",
      modelId: DEFAULT_SIMULATION_MODEL_ID,
      outputSchema: "schemas/virtual-decision.schema.json"
    },
    riskProfile: "balanced",
    paperExitPolicy: "none",
    costModel: "standard",
    benchmarkPolicy: "cash_equal_weight_initial_hold"
  };
}

function policyHashSeed(policyHash: string): string {
  const seedSuffix = policyHash.replace(/[^a-zA-Z0-9]/gu, "").slice(0, 24);
  return `policy-${seedSuffix || "validated"}`;
}

function readPaperSimulationDisabledReason({
  backendValidation,
  config,
  createState,
  mutationToken,
  sourceDataDir
}: {
  backendValidation: BackendValidationState;
  config: PolicyPaperSimulationConfig | null;
  createState: PaperSimulationCreateState;
  mutationToken: string;
  sourceDataDir: string;
}): string | null {
  if (createState.status === "pending") {
    return "Paper simulation create request is pending.";
  }

  if (backendValidation.status === "pending") {
    return "Backend validation is pending.";
  }

  if (backendValidation.status !== "ready") {
    return "Backend validation is required before paper simulation create.";
  }

  if (
    backendValidation.response.status !== "valid" ||
    !backendValidation.response.validatedForPaperSimulationConfig
  ) {
    return "Backend validation must pass before paper simulation create.";
  }

  if (config === null) {
    return "Paper simulation config is not available.";
  }

  if (sourceDataDir.trim() === "") {
    return "Source data dir is required.";
  }

  if (mutationToken.trim() === "") {
    return "Dashboard mutation token is required.";
  }

  return null;
}

function isBackendPolicyValidationResponse(
  value: unknown
): value is BackendPolicyValidationResponse {
  return (
    isRecord(value) &&
    value["mode"] === "paper_only" &&
    value["validation"] === "paper_policy" &&
    value["readOnly"] === true &&
    value["storageMutationEnabled"] === false &&
    value["liveTradingEnabled"] === false &&
    value["orderPlacementEnabled"] === false &&
    typeof value["policyHash"] === "string" &&
    (value["status"] === "valid" || value["status"] === "invalid") &&
    typeof value["validatedForPaperSimulationConfig"] === "boolean" &&
    typeof value["issueCount"] === "number" &&
    Array.isArray(value["issues"]) &&
    value["issues"].every(isBackendPolicyValidationIssue)
  );
}

function isBackendPolicyValidationIssue(
  value: unknown
): value is BackendPolicyValidationIssue {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    typeof value["path"] === "string" &&
    typeof value["message"] === "string" &&
    value["severity"] === "error"
  );
}

function isPaperSimulationCreateResponse(
  value: unknown
): value is PaperSimulationCreateResponse {
  return (
    isRecord(value) &&
    value["mode"] === "paper_only" &&
    value["mutation"] === "paper_simulation_create" &&
    value["status"] === "accepted" &&
    typeof value["simulationRunId"] === "string" &&
    typeof value["batchId"] === "string" &&
    (value["runType"] === "single_replay" ||
      value["runType"] === "batch_replay") &&
    typeof value["requestedRunCount"] === "number" &&
    typeof value["sourceDataDir"] === "string" &&
    typeof value["outputBaseDir"] === "string" &&
    typeof value["activeUrl"] === "string" &&
    typeof value["historyUrl"] === "string" &&
    value["readOnlyLiveTrading"] === true &&
    typeof value["disclaimer"] === "string"
  );
}

function readErrorMessage(value: unknown, status: number): string {
  if (isRecord(value) && typeof value["message"] === "string") {
    return value["message"];
  }
  return `Backend request returned HTTP ${status}`;
}

function currentBackendValidation(
  state: BackendValidationState,
  previewJson: string
): BackendValidationState {
  if (state.status === "idle") {
    return state;
  }
  return state.previewJson === previewJson ? state : { status: "idle" };
}

function isPendingBackendValidation(
  state: BackendValidationState,
  previewJson: string
): state is Extract<BackendValidationState, { status: "pending" }> {
  return state.status === "pending" && state.previewJson === previewJson;
}

function currentPaperSimulationCreate(
  state: PaperSimulationCreateState,
  configJson: string
): PaperSimulationCreateState {
  if (state.status === "idle") {
    return state;
  }
  return state.configJson === configJson ? state : { status: "idle" };
}

function isPendingPaperSimulationCreate(
  state: PaperSimulationCreateState,
  configJson: string
): state is Extract<PaperSimulationCreateState, { status: "pending" }> {
  return state.status === "pending" && state.configJson === configJson;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
