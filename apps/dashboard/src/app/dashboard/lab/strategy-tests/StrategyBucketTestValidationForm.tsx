"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
const STRATEGY_BUCKET_TEST_CREATE_INTENT_HEADER =
  "x-toss-trading-dashboard-intent";
const STRATEGY_BUCKET_TEST_CREATE_INTENT = "strategy-bucket-test-create";
const STRATEGY_BUCKET_TEST_MATRIX_CREATE_INTENT =
  "strategy-bucket-test-matrix-create";
const STRATEGY_BUCKET_TEST_CREATE_MUTATION_TOKEN_HEADER =
  "x-toss-trading-dashboard-mutation-token";

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

interface StrategyBucketTestCreateResponse {
  mode: "paper_only";
  mutation: "strategy_bucket_test_create";
  status: "queued";
  testId: string;
  bucket: StrategyBucket;
  configHash: string;
  recordPath: string;
  storageMutationEnabled: true;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  disclaimer: string;
}

interface StrategyBucketTestMatrixCreateResponse {
  mode: "paper_only";
  mutation: "strategy_bucket_test_matrix_create";
  status: "queued";
  matrixId: string;
  bucketCount: number;
  queuedTests: StrategyBucketTestCreateResponse[];
  recordPath: string;
  storageMutationEnabled: true;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  disclaimer: string;
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

type CreateState =
  | { status: "idle" }
  | { status: "pending"; requestJson: string }
  | {
      status: "queued";
      requestJson: string;
      response: StrategyBucketTestCreateResponse;
    }
  | { status: "error"; requestJson: string; message: string };

type MatrixCreateState =
  | { status: "idle" }
  | { status: "pending"; requestJson: string }
  | {
      status: "queued";
      requestJson: string;
      response: StrategyBucketTestMatrixCreateResponse;
    }
  | { status: "error"; requestJson: string; message: string };

export function StrategyBucketTestValidationForm() {
  const router = useRouter();
  const refreshedCreateRequestRef = useRef<string | null>(null);
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
  const [mutationToken, setMutationToken] = useState("");
  const [backendValidation, setBackendValidation] =
    useState<BackendValidationState>({ status: "idle" });
  const [createState, setCreateState] = useState<CreateState>({
    status: "idle"
  });
  const [matrixCreateState, setMatrixCreateState] = useState<MatrixCreateState>({
    status: "idle"
  });

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
      requestId: `strategy-test-lab-${bucket}-candidate`,
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
  const matrixRequestPreview = useMemo(
    () => ({
      mode: "paper_only",
      mutation: "strategy_bucket_test_matrix_create",
      matrixId: `strategy-test-lab-matrix-${validationSplitRole}`,
      candidate: requestPreview
    }),
    [requestPreview, validationSplitRole]
  );
  const matrixRequestJson = useMemo(
    () => JSON.stringify(matrixRequestPreview),
    [matrixRequestPreview]
  );
  const visibleBackendValidation = currentBackendValidation(
    backendValidation,
    requestJson
  );
  const visibleCreateState = currentCreateState(createState, requestJson);
  const visibleMatrixCreateState = currentMatrixCreateState(
    matrixCreateState,
    matrixRequestJson
  );
  const trimmedMutationToken = mutationToken.trim();
  const canCreateQueuedRecord =
    visibleBackendValidation.status === "ready" &&
    visibleBackendValidation.response.status === "valid" &&
    visibleBackendValidation.response.validatedForStrategyBucketTestConfig &&
    trimmedMutationToken.length > 0 &&
    visibleCreateState.status !== "pending" &&
    visibleCreateState.status !== "queued";
  const canCreateBucketMatrix =
    visibleBackendValidation.status === "ready" &&
    visibleBackendValidation.response.status === "valid" &&
    visibleBackendValidation.response.validatedForStrategyBucketTestConfig &&
    trimmedMutationToken.length > 0 &&
    visibleMatrixCreateState.status !== "pending" &&
    visibleMatrixCreateState.status !== "queued";

  useEffect(() => {
    if (visibleCreateState.status === "idle") {
      refreshedCreateRequestRef.current = null;
      return;
    }
    if (visibleCreateState.status !== "queued") {
      return;
    }
    if (refreshedCreateRequestRef.current === visibleCreateState.requestJson) {
      return;
    }
    refreshedCreateRequestRef.current = visibleCreateState.requestJson;
    router.refresh();
  }, [router, visibleCreateState]);

  useEffect(() => {
    if (visibleMatrixCreateState.status === "idle") {
      return;
    }
    if (visibleMatrixCreateState.status !== "queued") {
      return;
    }
    if (
      refreshedCreateRequestRef.current === visibleMatrixCreateState.requestJson
    ) {
      return;
    }
    refreshedCreateRequestRef.current = visibleMatrixCreateState.requestJson;
    router.refresh();
  }, [router, visibleMatrixCreateState]);

  async function validateWithBackend() {
    const currentRequestJson = requestJson;
    setBackendValidation({
      status: "pending",
      requestJson: currentRequestJson
    });
    setCreateState({ status: "idle" });
    setMatrixCreateState({ status: "idle" });

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

  async function createQueuedRecord() {
    const currentRequestJson = requestJson;
    if (!canCreateQueuedRecord) {
      return;
    }
    setCreateState({
      status: "pending",
      requestJson: currentRequestJson
    });

    try {
      const response = await fetch("/dashboard/lab/strategy-tests/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [STRATEGY_BUCKET_TEST_CREATE_INTENT_HEADER]:
            STRATEGY_BUCKET_TEST_CREATE_INTENT,
          [STRATEGY_BUCKET_TEST_CREATE_MUTATION_TOKEN_HEADER]:
            trimmedMutationToken
        },
        body: currentRequestJson
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isStrategyBucketTestCreateResponse(payload)) {
        setCreateState((current) =>
          isPendingCreate(current, currentRequestJson)
            ? {
                status: "error",
                requestJson: currentRequestJson,
                message: readErrorMessage(payload, response.status)
              }
            : current
        );
        return;
      }

      setCreateState((current) =>
        isPendingCreate(current, currentRequestJson)
          ? {
              status: "queued",
              requestJson: currentRequestJson,
              response: payload
            }
          : current
      );
    } catch (error) {
      setCreateState((current) =>
        isPendingCreate(current, currentRequestJson)
          ? {
              status: "error",
              requestJson: currentRequestJson,
              message:
                error instanceof Error
                  ? error.message
                  : "Strategy bucket test create request failed"
            }
          : current
      );
    }
  }

  async function createBucketMatrix() {
    const currentMatrixRequestJson = matrixRequestJson;
    if (!canCreateBucketMatrix) {
      return;
    }
    setMatrixCreateState({
      status: "pending",
      requestJson: currentMatrixRequestJson
    });

    try {
      const response = await fetch(
        "/dashboard/lab/strategy-tests/matrix-create",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [STRATEGY_BUCKET_TEST_CREATE_INTENT_HEADER]:
              STRATEGY_BUCKET_TEST_MATRIX_CREATE_INTENT,
            [STRATEGY_BUCKET_TEST_CREATE_MUTATION_TOKEN_HEADER]:
              trimmedMutationToken
          },
          body: currentMatrixRequestJson
        }
      );
      const payload: unknown = await response.json();
      if (!response.ok || !isStrategyBucketTestMatrixCreateResponse(payload)) {
        setMatrixCreateState((current) =>
          isPendingMatrixCreate(current, currentMatrixRequestJson)
            ? {
                status: "error",
                requestJson: currentMatrixRequestJson,
                message: readErrorMessage(payload, response.status)
              }
            : current
        );
        return;
      }

      setMatrixCreateState((current) =>
        isPendingMatrixCreate(current, currentMatrixRequestJson)
          ? {
              status: "queued",
              requestJson: currentMatrixRequestJson,
              response: payload
            }
          : current
      );
    } catch (error) {
      setMatrixCreateState((current) =>
        isPendingMatrixCreate(current, currentMatrixRequestJson)
          ? {
              status: "error",
              requestJson: currentMatrixRequestJson,
              message:
                error instanceof Error
                  ? error.message
                  : "Strategy bucket test matrix create request failed"
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

          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="mutation-token"
          >
            Mutation token
            <input
              autoComplete="off"
              className="rounded-[6px] border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 font-mono text-xs"
              id="mutation-token"
              onChange={(event) => setMutationToken(event.target.value)}
              type="password"
              value={mutationToken}
            />
          </label>

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
              className="rounded-[6px] bg-[var(--success)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canCreateBucketMatrix}
              onClick={() => void createBucketMatrix()}
              type="button"
            >
              {visibleMatrixCreateState.status === "pending"
                ? "Queueing matrix"
                : visibleMatrixCreateState.status === "queued"
                  ? "Bucket matrix queued"
                : "Queue enabled bucket matrix"}
            </button>
            <button
              className="rounded-[6px] bg-[var(--success)] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canCreateQueuedRecord}
              onClick={() => void createQueuedRecord()}
              type="button"
            >
              {visibleCreateState.status === "pending"
                ? "Queueing record"
                : visibleCreateState.status === "queued"
                  ? "Queued record created"
                : "Queue bucket test record"}
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
                setMutationToken("");
                setBackendValidation({ status: "idle" });
                setCreateState({ status: "idle" });
                setMatrixCreateState({ status: "idle" });
              }}
              type="button"
            >
              Reset config
            </button>
          </div>

          <BackendValidationPanel state={visibleBackendValidation} />
          <CreateResultPanel
            canCreateQueuedRecord={canCreateQueuedRecord}
            state={visibleCreateState}
          />
          <MatrixCreateResultPanel
            canCreateBucketMatrix={canCreateBucketMatrix}
            state={visibleMatrixCreateState}
          />
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

function CreateResultPanel({
  canCreateQueuedRecord,
  state
}: {
  canCreateQueuedRecord: boolean;
  state: CreateState;
}) {
  if (state.status === "idle") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        {canCreateQueuedRecord
          ? "Backend validation passed. A queued paper-only test record can be created; replay runner remains disabled."
          : "Queued test record not created. Backend validation and mutation token are required."}
      </p>
    );
  }

  if (state.status === "pending") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Creating queued record. Replay runner remains disabled.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger)]"
      >
        Strategy bucket test record was not queued. {state.message}
      </p>
    );
  }

  const result = state.response;
  return (
    <div
      aria-live="polite"
      className="rounded-[8px] border border-[var(--success-soft)] bg-[var(--success-soft)] p-3 text-sm leading-5 text-[var(--success)]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">Strategy bucket test queued</p>
          <p
            className="mt-1 font-mono text-xs"
            data-testid="strategy-bucket-created-test-id"
          >
            {result.testId} · runner not started
          </p>
        </div>
        <StatusBadge tone="ok" value="storage mutation enabled" />
      </div>
      <dl className="mt-3 grid gap-2 md:grid-cols-3">
        <Metric label="Bucket" value={result.bucket} />
        <Metric label="Status" value={result.status} />
        <Metric
          label="Config"
          value={result.configHash.slice(0, 19)}
        />
      </dl>
      <p className="mt-3 text-xs leading-5">
        live orders disabled · order placement disabled · replay runner not
        started
      </p>
    </div>
  );
}

function MatrixCreateResultPanel({
  canCreateBucketMatrix,
  state
}: {
  canCreateBucketMatrix: boolean;
  state: MatrixCreateState;
}) {
  if (state.status === "idle") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        {canCreateBucketMatrix
          ? "Backend validation passed. Enabled buckets can be queued as independent paper-only records."
          : "Bucket matrix not created. Backend validation and mutation token are required."}
      </p>
    );
  }

  if (state.status === "pending") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-muted)] p-3 text-sm leading-5 text-[var(--muted)]"
      >
        Creating bucket matrix records. Replay runner remains disabled.
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        aria-live="polite"
        className="rounded-[8px] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-3 text-sm leading-5 text-[var(--danger)]"
      >
        Strategy bucket matrix was not queued. {state.message}
      </p>
    );
  }

  const result = state.response;
  return (
    <div
      aria-live="polite"
      className="rounded-[8px] border border-[var(--success-soft)] bg-[var(--success-soft)] p-3 text-sm leading-5 text-[var(--success)]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">Strategy bucket matrix queued</p>
          <p
            className="mt-1 font-mono text-xs"
            data-testid="strategy-bucket-matrix-created-id"
          >
            {result.matrixId} · {result.bucketCount} bucket records · runner not
            started
          </p>
        </div>
        <StatusBadge tone="ok" value="storage mutation enabled" />
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {result.queuedTests.map((queuedTest) => (
          <li
            className="rounded-[6px] border border-current/20 p-2"
            data-testid={`strategy-bucket-matrix-test-${queuedTest.bucket}`}
            key={queuedTest.testId}
          >
            <span className="font-semibold">{BUCKET_LABELS[queuedTest.bucket]}</span>
            <span className="mt-1 block break-all font-mono text-xs">
              {queuedTest.testId}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-5">
        live orders disabled · order placement disabled · replay runner not
        started
      </p>
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

function currentCreateState(
  state: CreateState,
  requestJson: string
): CreateState {
  if (state.status === "idle") {
    return state;
  }
  if (state.requestJson !== requestJson) {
    return { status: "idle" };
  }
  return state;
}

function currentMatrixCreateState(
  state: MatrixCreateState,
  requestJson: string
): MatrixCreateState {
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

function isPendingCreate(
  state: CreateState,
  requestJson: string
): state is Extract<CreateState, { status: "pending" }> {
  return state.status === "pending" && state.requestJson === requestJson;
}

function isPendingMatrixCreate(
  state: MatrixCreateState,
  requestJson: string
): state is Extract<MatrixCreateState, { status: "pending" }> {
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

function isStrategyBucketTestCreateResponse(
  value: unknown
): value is StrategyBucketTestCreateResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["mode"] === "paper_only" &&
    value["mutation"] === "strategy_bucket_test_create" &&
    value["status"] === "queued" &&
    typeof value["testId"] === "string" &&
    isStrategyBucket(value["bucket"]) &&
    typeof value["configHash"] === "string" &&
    typeof value["recordPath"] === "string" &&
    value["storageMutationEnabled"] === true &&
    value["liveTradingEnabled"] === false &&
    value["orderPlacementEnabled"] === false &&
    value["replayRunnerStarted"] === false &&
    typeof value["disclaimer"] === "string"
  );
}

function isStrategyBucketTestMatrixCreateResponse(
  value: unknown
): value is StrategyBucketTestMatrixCreateResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["mode"] === "paper_only" &&
    value["mutation"] === "strategy_bucket_test_matrix_create" &&
    value["status"] === "queued" &&
    typeof value["matrixId"] === "string" &&
    typeof value["bucketCount"] === "number" &&
    Array.isArray(value["queuedTests"]) &&
    value["queuedTests"].every(isStrategyBucketTestCreateResponse) &&
    typeof value["recordPath"] === "string" &&
    value["storageMutationEnabled"] === true &&
    value["liveTradingEnabled"] === false &&
    value["orderPlacementEnabled"] === false &&
    value["replayRunnerStarted"] === false &&
    typeof value["disclaimer"] === "string"
  );
}

function isStrategyBucket(value: unknown): value is StrategyBucket {
  return (
    value === "long_term" ||
    value === "swing" ||
    value === "short_term" ||
    value === "intraday" ||
    value === "hedge"
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
