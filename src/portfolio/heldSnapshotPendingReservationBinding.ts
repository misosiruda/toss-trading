import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { OpeningCapacityConsumptionSources } from "./openingCapacityConsumptionBinding.js";
import { bindOpeningCapacityTerminalOrigins } from "./openingCapacityTerminalBinding.js";
import { resolveStoredOpeningCapacityEventOrigin, type VerifiedOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { bindSnapshotPendingExecutionOrigins } from "./snapshotPendingExecutionBinding.js";
import { bindSnapshotPendingMandateOrigins } from "./snapshotPendingMandateBinding.js";
import { bindSnapshotPendingPlanProgress } from "./snapshotPendingPlanBinding.js";
import { projectHeldPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

const querySchema = z.object({ baseDir: z.string().min(1), snapshot: portfolioSizingSnapshotSchema }).strict();

/** Rebuilds pending membership and reservation gross coverage only from actual held sources.
 * Does not authenticate the supplied portfolio state, active policy, allocator, accounting, external prices or execution authority.
 * No I/O, locks or writes. Returned values are not leases. Unverified cancellation releases fail closed.
 */
export function bindHeldSnapshotPendingReservationOrigins(value: z.input<typeof querySchema>, sources: OpeningCapacityConsumptionSources) {
  const input = querySchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("held pending reservation input must already be canonical");
  const { snapshot } = resolvePortfolioSizingSnapshot(input.snapshot);
  const terminal = bindOpeningCapacityTerminalOrigins({ baseDir: input.baseDir, portfolioId: snapshot.portfolioId }, sources);
  if (terminal.unverifiedReleaseEventIds.length !== 0) throw new Error("held pending reservation cannot accept unverified cancellation releases");
  const progress = projectHeldPendingPlanActionProgress({ baseDir: input.baseDir, portfolioId: snapshot.portfolioId, asOf: snapshot.asOf }, sources.planEvents);
  const pending = bindSnapshotPendingPlanProgress(snapshot, progress, sources.prices);
  const executions = bindSnapshotPendingExecutionOrigins(progress, sources.risks, sources.fills, sources.prices);
  bindSnapshotPendingMandateOrigins(progress, pending, executions, sources.mandates);
  if (executions.some(({ event, fillOrigin }) => fillOrigin.completion !== null &&
    Date.parse(fillOrigin.completion.completedAt) >= Date.parse(event.asOf))) {
    throw new Error("held pending reservation fill completion follows its execution event");
  }
  const reservations = terminal.consumption.mandates.bindings;
  const byMandate = new Map(reservations.map((binding) => [binding.mandate.mandateId, binding]));
  if (byMandate.size !== reservations.length) throw new Error("held pending reservation repeats a mandate binding");
  const byFill = new Map(terminal.consumption.bindings.map((binding) => [binding.event.paperFillRecordId, binding]));
  const plans = new Map(progress.projection.planReplays.map((replay) => [replay.calculation.input.plan.planId, replay.calculation.input.plan]));
  const priorExecutions = new Map<string, typeof executions[number][]>();
  for (const execution of executions) {
    const key = actionKey(execution.event.planId, execution.event.actionId), group = priorExecutions.get(key) ?? [];
    group.push(execution); priorExecutions.set(key, group);
  }
  const cutoff = Date.parse(snapshot.asOf), heads = new Map<string, VerifiedOpeningCapacityEventOrigin>();
  for (const event of sources.events.events) {
    if (event.portfolioId !== snapshot.portfolioId) continue;
    const origin = resolveStoredOpeningCapacityEventOrigin(sources.events, event.capacityReservationEventId);
    if (Date.parse(origin.committedAt) === cutoff) throw new Error("held pending reservation commit is ambiguous at cutoff");
    if (Date.parse(origin.committedAt) < cutoff && Date.parse(event.asOf) <= cutoff && Date.parse(event.createdAt) <= cutoff) heads.set(scope(event), origin);
  }
  const totals = new Map<string, bigint>();
  const bindings = pending.filter((item) => item.pending.side === "BUY").map((item) => {
    const action = item.remaining.action, input = item.pending;
    if (input.side !== "BUY" || action.lineageKind !== "mandate") throw new Error("pending BUY requires a mandate reservation");
    const reservation = byMandate.get(action.mandateId), plan = plans.get(input.planId)!;
    if (!reservation || reservation.mandate.portfolioId !== snapshot.portfolioId || reservation.mandate.policyHash !== plan.policyHash ||
      reservation.mandate.market !== input.market || reservation.mandate.symbol !== input.symbol ||
      reservation.root.event.reservationId !== input.openingCapacityReservationId || reservation.root.event.reservationHash !== input.openingCapacityReservationHash) {
      throw new Error("held pending BUY reservation or mandate lineage mismatch");
    }
    const key = scope(reservation.event), head = heads.get(key);
    if (!head || head.event.eventType === "reserved" || head.event.eventType === "released" || head.event.remainingReservedNotionalKrw === 0 ||
      Date.parse(reservation.eventOrigin.committedAt) >= cutoff) throw new Error("held pending BUY lacks an available bound reservation at cutoff");
    const consumedOrigins = (priorExecutions.get(actionKey(input.planId, input.actionId)) ?? []).map((execution) => {
      const consumed = byFill.get(execution.paperFill.paperFillRecordId);
      if (!consumed || scope(consumed.event) !== key || consumed.event.capacityLedgerVersion > head.event.capacityLedgerVersion ||
        consumed.event.paperFillHash !== execution.paperFill.paperFillHash || Date.parse(consumed.eventOrigin.committedAt) >= cutoff) {
        throw new Error("held pending BUY prior execution lacks its actual reservation consumption");
      }
      return consumed.eventOrigin;
    });
    const total = (totals.get(key) ?? 0n) + BigInt(input.remainingNotionalKrw);
    if (total > BigInt(head.event.remainingReservedNotionalKrw)) throw new Error("held pending BUY exceeds remaining reservation gross");
    totals.set(key, total);
    return Object.freeze({ pending: input, reservation, headOrigin: head, priorConsumptionOrigins: Object.freeze(consumedOrigins) });
  });
  const reservationTotals = Object.freeze([...totals].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, total]) => Object.freeze({ reservationScope: key, pendingNotionalKrw: Number(total),
      remainingReservedNotionalKrw: heads.get(key)!.event.remainingReservedNotionalKrw })));
  return Object.freeze({ snapshot, terminal, progress, pending, executions, bindings: Object.freeze(bindings), reservationTotals });
}

function actionKey(planId: string, actionId: string) { return JSON.stringify([planId, actionId]); }
function scope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
