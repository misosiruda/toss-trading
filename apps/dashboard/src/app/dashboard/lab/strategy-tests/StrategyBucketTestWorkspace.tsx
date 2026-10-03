"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { StrategyBucketTestSummary } from "@/lib/dashboardViewModels";
import { StrategyBucketTestValidationForm } from "./StrategyBucketTestValidationForm";
import { StrategyBucketTestProgressPanel } from "./StrategyBucketTestProgressPanel";
import {
  allowedTestIdentities, mergeTestObservations, createTestObservationReader, rememberQueuedTests,
  sameTestIdentity, visibleActiveTests, type QueuedTestIdentity
} from "./strategyBucketTestObservation";

export function StrategyBucketTestWorkspace({ initialActiveTests, children }: {
  initialActiveTests: StrategyBucketTestSummary[];
  children: ReactNode;
}) {
  const [queued, setQueued] = useState<QueuedTestIdentity[]>([]);
  const [state, setState] = useState(() => ({
    source: initialActiveTests,
    observations: new Map(initialActiveTests.map((test) => [test.testId, test]))
  }));
  const [observationErrors, setObservationErrors] = useState<string[]>([]);
  const allowed = allowedTestIdentities(initialActiveTests, queued);
  // Retain actual progress (including terminal evidence) across RSC refreshes.
  // Updating the remembered prop during render prevents a stale snapshot flash.
  if (state.source !== initialActiveTests) {
    setState({ source: initialActiveTests, observations: mergeTestObservations(state.observations, initialActiveTests, allowed, true) });
  }
  const activeTests = visibleActiveTests(initialActiveTests, queued, state.observations);
  const latest = useRef({ allowed, queued, activeTests });
  useLayoutEffect(() => { latest.current = { allowed, queued, activeTests }; }, [allowed, queued, activeTests]);
  const reader = useRef<ReturnType<typeof createTestObservationReader> | null>(null);
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    const observer = createTestObservationReader({
      isAllowed(identity) {
        const current = latest.current.allowed.get(identity.testId);
        return current !== undefined && sameTestIdentity(current, identity);
      },
      onObservation(test) {
        setState((current) => ({ ...current,
          observations: mergeTestObservations(current.observations, [test], latest.current.allowed)
        }));
        setObservationErrors((current) => current.filter((id) => id !== test.testId));
      },
      onError(identity) {
        if (latest.current.queued.some((test) => sameTestIdentity(test, identity))) {
          setObservationErrors((current) => [...new Set([...current, identity.testId])]
            .filter((id) => latest.current.queued.some((test) => test.testId === id)));
        }
      }
    });
    reader.current = observer;
    const attempts = attempted.current;
    return () => { observer.dispose(); reader.current = null; attempts.clear(); };
  }, []);

  useEffect(() => {
    const queuedIds = new Set(queued.map((test) => test.testId));
    for (const id of attempted.current) if (!queuedIds.has(id)) attempted.current.delete(id);
    reader.current?.cancelUnwanted();
    for (const identity of queued) {
      if (attempted.current.has(identity.testId)) continue;
      attempted.current.add(identity.testId);
      // One read after acceptance; failures need an explicit user retry.
      void reader.current?.observe(identity, true).catch(() => {});
    }
  }, [queued, initialActiveTests]);

  const onQueuedTests = useCallback((tests: QueuedTestIdentity[]) => {
    setQueued((current) => rememberQueuedTests(current, tests));
  }, []);
  const refreshProgress = useCallback(async () => {
    await Promise.all(latest.current.activeTests.map((test) => reader.current?.observe(test)));
  }, []);
  const failedIdentities = queued.filter((test) => observationErrors.includes(test.testId));

  return <>
    {/* Exact progress observations own this update; an unrelated RSC failure must not discard acceptance. */}
    <StrategyBucketTestValidationForm onQueuedTests={onQueuedTests} refreshAfterCreate={false} />
    {failedIdentities.length > 0 ? <div role="status" className="rounded-[6px] border border-[var(--warning-soft)] bg-[var(--warning-soft)] p-3 text-sm">
      <p>Record accepted, but progress observation is unavailable. Acceptance does not mean the runner started.</p>
      <button className="mt-2 underline" type="button" onClick={() => {
        for (const identity of failedIdentities) void reader.current?.observe(identity, true).catch(() => {});
      }}>Retry created record observation</button>
    </div> : null}
    <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <StrategyBucketTestProgressPanel activeTests={activeTests} onRefreshProgress={refreshProgress} />
      {children}
    </section>
  </>;
}
