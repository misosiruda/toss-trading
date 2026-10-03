"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type StrategyBucket,
  type StrategyBucketTestSummary
} from "@/lib/dashboardViewModels";

const POLLING_INTERVAL_MS = 5_000;

const BUCKET_LABELS: Record<StrategyBucket, string> = {
  long_term: "Long-term",
  swing: "Swing",
  short_term: "Short-term",
  intraday: "Intraday",
  hedge: "Hedge"
};

export function StrategyBucketTestProgressPanel({
  activeTests, onRefreshProgress
}: {
  activeTests: StrategyBucketTestSummary[];
  onRefreshProgress: () => Promise<void>;
}) {
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const inFlightRefreshRef = useRef(false);
  const refreshRequestIdRef = useRef(0);
  const latestProgressUpdatedAt = readLatestProgressUpdatedAt(activeTests);

  const refreshProgress = useCallback(async () => {
    if (activeTests.length === 0) {
      return;
    }
    if (inFlightRefreshRef.current) {
      return;
    }

    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    inFlightRefreshRef.current = true;

    try {
      await onRefreshProgress();
      if (refreshRequestIdRef.current !== requestId) {
        return;
      }
      setRefreshError(null);
    } catch (error) {
      if (refreshRequestIdRef.current === requestId) {
        setRefreshError(
          error instanceof Error
            ? error.message
            : "Strategy bucket progress refresh failed"
        );
      }
    } finally {
      if (refreshRequestIdRef.current === requestId) {
        inFlightRefreshRef.current = false;
      }
    }
  }, [activeTests.length, onRefreshProgress]);

  useEffect(() => {
    if (activeTests.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshProgress();
    }, POLLING_INTERVAL_MS);

    return () => {
      refreshRequestIdRef.current += 1;
      inFlightRefreshRef.current = false;
      window.clearInterval(interval);
    };
  }, [activeTests.length, refreshProgress]);

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader eyebrow="active progress" title="Bucket Test Progress" />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-[6px] bg-[var(--success-soft)] px-2 py-1 font-semibold text-[var(--success)]">
            polling fallback
          </span>
          <span className="font-mono text-[var(--muted)]">
            {latestProgressUpdatedAt === null
              ? "not refreshed"
              : formatDateTime(latestProgressUpdatedAt)}
          </span>
          <button
            className="rounded-[6px] border border-[var(--border)] px-2 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            disabled={activeTests.length === 0}
            onClick={() => void refreshProgress()}
            type="button"
          >
            Refresh progress
          </button>
        </div>
      </div>

      {refreshError === null ? null : (
        <p
          aria-live="polite"
          className="mt-3 rounded-[6px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-2 text-sm text-[var(--warning)]"
        >
          Progress refresh unavailable. {refreshError}
        </p>
      )}

      <p className="mt-3 text-xs text-[var(--muted)]">Server active snapshot (up to 20) plus records created and confirmed in this view (up to 20), deduplicated. This is not the full test history.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Test</th>
              <th className="py-2 pr-3 font-medium">Bucket</th>
              <th className="py-2 pr-3 font-medium">Phase</th>
              <th className="py-2 pr-3 font-medium">Heartbeat</th>
              <th className="py-2 pr-3 font-medium">Progress</th>
              <th className="py-2 font-medium">Counts</th>
            </tr>
          </thead>
          <tbody>
            {activeTests.length === 0 ? (
              <tr>
                <td className="py-4 text-[var(--muted)]" colSpan={6}>
                  No active bucket tests are reported by backend ViewModel.
                </td>
              </tr>
            ) : (
              activeTests.map((test) => (
                <tr
                  className="border-t border-[var(--border)]"
                  data-testid={`strategy-bucket-active-test-${test.testId}`}
                  key={test.testId}
                >
                  <td className="max-w-[18rem] break-words py-2 pr-3 font-mono text-xs">
                    {test.testId}
                  </td>
                  <td className="py-2 pr-3">{BUCKET_LABELS[test.bucket]}</td>
                  <td className="py-2 pr-3">
                    <div className="font-mono text-xs">{test.progress.phase}</div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {test.progress.latestMessage ?? "No progress message"}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{test.heartbeat.status}</div>
                    <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                      {test.heartbeat.lastSeenAt ?? "missing"}
                    </div>
                  </td>
                  <td className="min-w-[10rem] py-2 pr-3">
                    <div className="font-mono text-xs">
                      {formatNullableRatio(test.progress.progressRatio)}
                    </div>
                    <ProgressMeter ratio={test.progress.progressRatio} />
                    <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                      {test.progress.updatedAt}
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="text-xs text-[var(--muted)]">
                      decisions {test.progress.decisionCount} · approved{" "}
                      {test.progress.riskApprovedCount} · rejected{" "}
                      {test.progress.riskRejectedCount}
                    </div>
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      trades {test.progress.simulatedTradeCount} · provider failures{" "}
                      {test.progress.providerFailureCount}
                    </div>
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

function readLatestProgressUpdatedAt(
  tests: StrategyBucketTestSummary[]
): string | null {
  return (
    tests
      .map((test) => test.progress.updatedAt)
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort()
      .at(-1) ?? null
  );
}

function ProgressMeter({ ratio }: { ratio: number | null }) {
  const percentage =
    ratio === null ? null : Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return (
    <div
      aria-label="Bucket test progress ratio"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percentage ?? undefined}
      className="mt-2 h-2 w-full overflow-hidden rounded-[4px] bg-[var(--border)]"
      role="progressbar"
    >
      <div
        className="h-full bg-[var(--accent)]"
        style={{ width: `${percentage ?? 35}%`, opacity: percentage === null ? 0.45 : 1 }}
      />
    </div>
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
