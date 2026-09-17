import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { calculatePendingPlanActionProgress, PENDING_PLAN_ACTION_PROGRESS_MODEL_VERSION } from "./pendingPlanActionProgress.js";
import { rebalancePlanRecordSchema } from "./rebalancePlan.js";
import { type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation, resolveDurableRebalancePlanEventObservedAt,
  resolveVerifiedRebalancePlanEventOrigin, getHeldRebalancePlanEventObservation, assertHeldRebalancePlanEventSource,
  type VerifiedRebalancePlanEventHistory } from "./rebalancePlanEventFiles.js";
import { RebalancePlanFileRepository, type RebalancePlanFileRepositoryOptions } from "./rebalancePlanFiles.js";
import { compareText, hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

const inputSchema = z.object({ baseDir: z.string().min(1), portfolioId: rebalancePlanRecordSchema.shape.portfolioId,
  asOf: offsetQualifiedIsoDateTimeSchema }).strict();

/**
 * Replays every observed plan for the portfolio, including older policy hashes.
 * Commit timestamps select a historical prefix; they do not prove historical disk availability,
 * current generation, genuine Risk/fill sources, valuation or opening-capacity reservations.
 */
export async function resolveStoredPendingPlanActionProgress(value: z.input<typeof inputSchema>,
  options: RebalancePlanFileRepositoryOptions = {}) {
  const { input, repository, readStartedAt } = captureRequest(value, options);
  const history = await repository.readDurableVerifiedHistory();
  return projectHistory(input, history, readStartedAt);
}

/** Keeps concrete event -> plan writer locks through consumption. The second argument is the complete actual held history,
 * not the cutoff-filtered projection. Its lease is revoked on callback exit. Escaping results are historical only.
 * This is not reservation, fill/Risk, portfolio or current execution authority.
 */
export async function withStoredPendingPlanActionProgress<T>(value: z.input<typeof inputSchema>,
  operation: (result: ReturnType<typeof projectHistory>, history: VerifiedRebalancePlanEventHistory) => Promise<T>, options: RebalancePlanFileRepositoryOptions = {}): Promise<T> {
  const { input, repository, readStartedAt } = captureRequest(value, options);
  return repository.withDurableVerifiedHistory(async (history) => {
    getHeldRebalancePlanEventObservation(history);
    return operation(projectHistory(input, history, readStartedAt), history);
  });
}

/** Holds complete actual event -> plan sources without calculating or certifying a cutoff projection.
 * Consumers must project and bind under this callback. No current execution or reservation authority is granted.
 */
export async function withStoredPendingPlanActionHistory<T>(value: z.input<typeof inputSchema>,
  operation: (history: VerifiedRebalancePlanEventHistory) => Promise<T>, options: RebalancePlanFileRepositoryOptions = {}): Promise<T> {
  const { repository, readStartedAt } = captureRequest(value, options);
  return repository.withDurableVerifiedHistory(async (history) => {
    const observedAt = Date.parse(getHeldRebalancePlanEventObservation(history).observedAt);
    if (observedAt < readStartedAt || Date.now() < observedAt) throw new Error("pending plan observation clock moved backwards");
    return operation(history);
  });
}

/** Rebuilds the cutoff projection from a concrete caller-held event/plan source, without reading or reacquiring locks.
 * A copied projection or expired/foreign history cannot stand in for the actual source. No new lease is issued.
 */
export function projectHeldPendingPlanActionProgress(value: z.input<typeof inputSchema>, history: VerifiedRebalancePlanEventHistory) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("held pending plan input must already be canonical");
  assertHeldRebalancePlanEventSource(history, input.baseDir);
  const observedAt = Date.parse(getHeldRebalancePlanEventObservation(history).observedAt);
  if (Date.parse(input.asOf) > observedAt) throw new Error("pending plan cutoff follows source observation");
  return projectHistory(input, history, observedAt);
}

function captureRequest(value: z.input<typeof inputSchema>, options: RebalancePlanFileRepositoryOptions) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("stored pending plan input must already be canonical");
  const baseDir = resolve(input.baseDir);
  const lockOptions = { ...options };
  const readStartedAt = Date.now();
  if (Date.parse(input.asOf) > readStartedAt) throw new Error("pending plan cutoff follows source observation");
  const plans = new RebalancePlanFileRepository(baseDir, lockOptions);
  const repository = new RebalancePlanEventFileRepository(baseDir, plans, lockOptions);
  return { input, repository, readStartedAt };
}

function projectHistory(input: z.infer<typeof inputSchema>, history: VerifiedRebalancePlanEventHistory, readStartedAt: number) {
  const cutoff = Date.parse(input.asOf);
  // The repository validates complete histories, including foreign and post-cutoff suffixes, before filtering.
  const observedAt = resolveDurableRebalancePlanEventObservedAt(history);
  if (Date.parse(observedAt) < readStartedAt || Date.now() < Date.parse(observedAt)) {
    throw new Error("pending plan observation clock moved backwards");
  }
  const groups = new Map<string, RebalancePlanEvent[]>();
  for (const event of history.events) {
    const origin = resolveVerifiedRebalancePlanEventOrigin(history, event.planEventId);
    if (Date.parse(origin.appendedAt) > Date.parse(observedAt)) throw new Error("pending plan observation clock moved backwards");
    if (event.portfolioId !== input.portfolioId) continue;
    // A same-millisecond commit cannot establish that it preceded the requested evaluation.
    if (Date.parse(origin.appendedAt) === cutoff) throw new Error("pending plan commit is ambiguous at cutoff");
    if (Date.parse(origin.appendedAt) > cutoff) continue;
    const events = groups.get(event.planId) ?? [];
    events.push(event); groups.set(event.planId, events);
  }
  const planReplays = [...groups].sort(([left], [right]) => compareText(left, right)).map(([planId, events]) => {
    const observation = resolveDurableRebalancePlanEventObservation(history, planId);
    if (Date.parse(observation.observedAt) > Date.parse(observedAt)) throw new Error("pending plan observation clock moved backwards");
    const eventOrigins = events.map((event) => resolveVerifiedRebalancePlanEventOrigin(history, event.planEventId));
    const calculation = calculatePendingPlanActionProgress({ modelVersion: PENDING_PLAN_ACTION_PROGRESS_MODEL_VERSION,
      plan: observation.plan.record, events, asOf: input.asOf });
    return Object.freeze({ planOrigin: observation.plan, eventOrigins: Object.freeze(eventOrigins), calculation });
  });
  const pendingActions = planReplays.flatMap(({ calculation }) => calculation.pendingActions).sort((left, right) =>
    compareText(left.action.market, right.action.market) || compareText(left.action.symbol, right.action.symbol) ||
    compareText(left.action.side, right.action.side) || compareText(left.planId, right.planId) ||
    compareText(left.action.actionId, right.action.actionId));
  const projection = Object.freeze({ portfolioId: input.portfolioId, asOf: input.asOf,
    planReplays: Object.freeze(planReplays), pendingActions: Object.freeze(pendingActions) });
  const assessment = Object.freeze({ verificationScope: "stored_pending_plan_action_progress_only" as const,
    projectionHash: hashCanonicalPayload(projection), sourceGenerationHash: history.generationHash,
    sourceEventCount: history.events.length, observedAt,
    historicalDiskAvailability: "not_proven" as const, fillAndRiskOriginAuthority: "not_verified" as const,
    valuationAndReservationAuthority: "not_verified" as const, snapshotPendingInputs: "not_verified" as const,
    currentExecutionAuthority: "not_granted" as const });
  return Object.freeze({ projection, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
