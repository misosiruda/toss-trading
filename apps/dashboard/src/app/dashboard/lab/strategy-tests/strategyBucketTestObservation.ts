import {
  isStrategyBucketTestProgressViewModel,
  type StrategyBucketTestSummary
} from "@/lib/dashboardViewModels";

export type QueuedTestIdentity = Pick<StrategyBucketTestSummary, "testId" | "bucket" | "configHash">;
export const RECENT_CREATED_TEST_LIMIT = 20;

export function sameTestIdentity(a: QueuedTestIdentity, b: QueuedTestIdentity) {
  return a.testId === b.testId && a.bucket === b.bucket && a.configHash === b.configHash;
}

export function rememberQueuedTests(current: QueuedTestIdentity[], incoming: QueuedTestIdentity[]) {
  const next = [...current];
  for (const test of incoming) {
    if (next.some((item) => item.testId === test.testId)) continue;
    next.push({ testId: test.testId, bucket: test.bucket, configHash: test.configHash });
  }
  return next.length === current.length ? current : next.slice(-RECENT_CREATED_TEST_LIMIT);
}

export function isActiveTest(test: StrategyBucketTestSummary) {
  return test.status === "queued" || test.status === "running";
}

export function latestTestObservation(current: StrategyBucketTestSummary | undefined, incoming: StrategyBucketTestSummary, preferCurrentOnEqual = false) {
  const incomingTime = Date.parse(incoming.progress.updatedAt);
  if (!Number.isFinite(incomingTime)) return current;
  if (!current) return incoming;
  if (!sameTestIdentity(current, incoming)) return current;
  const currentTime = Date.parse(current.progress.updatedAt);
  if (!Number.isFinite(currentTime)) return incoming;
  if (!isActiveTest(current) && isActiveTest(incoming)) return current;
  if (incomingTime < currentTime || (preferCurrentOnEqual && incomingTime === currentTime)) return current;
  // Equal timestamps may still contain a newer heartbeat observation.
  return incoming;
}

export function allowedTestIdentities(source: StrategyBucketTestSummary[], queued: QueuedTestIdentity[]) {
  // A creation acknowledgement fixes identity even if a stale snapshot disagrees.
  return new Map([...source, ...queued].map((test) => [test.testId, test]));
}

export function mergeTestObservations(
  current: Map<string, StrategyBucketTestSummary>,
  incoming: StrategyBucketTestSummary[],
  allowed: Map<string, QueuedTestIdentity>,
  preferCurrentOnEqual = false
) {
  const next = new Map([...current].filter(([id, test]) => {
    const identity = allowed.get(id);
    return identity && sameTestIdentity(identity, test);
  }));
  for (const test of incoming) {
    const identity = allowed.get(test.testId);
    if (!identity || !sameTestIdentity(identity, test)) continue;
    const latest = latestTestObservation(next.get(test.testId), test, preferCurrentOnEqual);
    if (latest) next.set(test.testId, latest);
  }
  return next;
}

export function visibleActiveTests(
  source: StrategyBucketTestSummary[],
  queued: QueuedTestIdentity[],
  observations: Map<string, StrategyBucketTestSummary>
) {
  const allowed = allowedTestIdentities(source, queued);
  const latest = mergeTestObservations(observations, source, allowed, true);
  return [...allowed.keys()].flatMap((id) => {
    const test = latest.get(id);
    return test && isActiveTest(test) ? [test] : [];
  });
}

export async function readTestObservation(identity: QueuedTestIdentity, signal: AbortSignal) {
  const response = await fetch(`/dashboard/lab/strategy-tests/tests/${encodeURIComponent(identity.testId)}/progress`, {
    cache: "no-store", headers: { accept: "application/json" }, signal
  });
  const payload: unknown = await response.json();
  if (!response.ok || !isStrategyBucketTestProgressViewModel(payload) || payload.status !== "ok" ||
    payload.testId !== identity.testId || payload.test === null || !sameTestIdentity(payload.test, identity) ||
    !Number.isFinite(Date.parse(payload.test.progress.updatedAt))) {
    throw new Error("Record progress could not be confirmed from the read-only API.");
  }
  return payload.test;
}

// Only the new post-acceptance observation has this deadline. Existing periodic
// progress reads retain their previous timeout behavior and 5s schedule.
export const CREATED_TEST_OBSERVATION_TIMEOUT_MS = 2_000;
export function createTestObservationReader({ isAllowed, onObservation, onError }: {
  isAllowed: (identity: QueuedTestIdentity) => boolean;
  onObservation: (test: StrategyBucketTestSummary) => void;
  onError: (identity: QueuedTestIdentity) => void;
}) {
  type Request = { identity: QueuedTestIdentity; controller: AbortController; promise: Promise<void>;
    timer?: ReturnType<typeof setTimeout>; reject: (error: Error) => void };
  const requests = new Map<string, Request>();
  let disposed = false;
  function bound(request: Request) {
    if (request.timer !== undefined) return;
    request.timer = setTimeout(() => {
      request.controller.abort();
      request.reject(new Error("Created record progress observation timed out."));
    }, CREATED_TEST_OBSERVATION_TIMEOUT_MS);
  }
  function cancel(request: Request) {
    requests.delete(request.identity.testId);
    request.controller.abort();
    request.reject(new Error("Observation cancelled."));
  }
  function observe(identity: QueuedTestIdentity, bounded = false): Promise<void> {
    if (disposed || !isAllowed(identity)) return Promise.resolve();
    const existing = requests.get(identity.testId);
    if (existing && sameTestIdentity(existing.identity, identity)) {
      if (bounded) bound(existing);
      return existing.promise;
    }
    if (existing) cancel(existing);
    let reject!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const controller = new AbortController();
    const request: Request = { identity, controller, reject, promise: Promise.resolve() };
    requests.set(identity.testId, request);
    const current = () => !disposed && requests.get(identity.testId) === request && isAllowed(identity);
    request.promise = Promise.race([readTestObservation(identity, controller.signal), cancellation]).then((test) => {
      if (current() && !controller.signal.aborted) onObservation(test);
    }).catch(() => {
      if (!current()) return;
      onError(identity);
      // Do not expose transport URLs, server internals, or raw payloads.
      throw new Error("Record progress could not be confirmed from the read-only API.");
    }).finally(() => {
      if (request.timer !== undefined) clearTimeout(request.timer);
      if (requests.get(identity.testId) === request) requests.delete(identity.testId);
    });
    if (bounded) bound(request);
    return request.promise;
  }
  return {
    observe,
    cancelUnwanted() { for (const request of requests.values()) if (!isAllowed(request.identity)) cancel(request); },
    dispose() { disposed = true; for (const request of requests.values()) cancel(request); }
  };
}
