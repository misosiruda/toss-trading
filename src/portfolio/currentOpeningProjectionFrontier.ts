import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { assertDurableOpeningCapacityEventSource, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin, type VerifiedOpeningCapacityEventHistory } from "./openingCapacityReservationEventFiles.js";
import { assertHeldRebalancePlanEventSource, getHeldRebalancePlanEventObservation, resolveHeldRebalancePlanOrigins,
  resolveVerifiedRebalancePlanEventOrigin, type VerifiedRebalancePlanEventHistory } from "./rebalancePlanEventFiles.js";
import { assertHeldPaperFillExecutionSource, getHeldPaperFillExecutionObservation,
  resolvePersistedPaperFillExecutionOrigin, type VerifiedPaperFillExecutionHistory } from "./paperFillExecutionFiles.js";

const querySchema = portfolioSizingSnapshotSchema.pick({ portfolioId: true, asOf: true }).extend({ baseDir: z.string().min(1) }).strict();
type Sources = { events: VerifiedOpeningCapacityEventHistory; planEvents: VerifiedRebalancePlanEventHistory; fills: VerifiedPaperFillExecutionHistory };

/** Rejects a cutoff that excludes any observed portfolio plan, plan event, fill/completion or capacity commit.
 * Actual source identity/path/lifetime is mandatory. No I/O, new lease, economic reconciliation, freshness or allocation authority.
 * Origin binding remains the publisher's separate prerequisite; a timestamp check never authenticates business claims.
 */
export function assertHeldCurrentOpeningProjectionFrontier(value: z.input<typeof querySchema>, sources: Sources): void {
  const input = querySchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("current opening frontier input must already be canonical");
  assertDurableOpeningCapacityEventSource(sources.events, input.baseDir);
  assertHeldRebalancePlanEventSource(sources.planEvents, input.baseDir);
  assertHeldPaperFillExecutionSource(sources.fills, input.baseDir);
  const observed = [getHeldRebalancePlanEventObservation(sources.planEvents).observedAt,
    getHeldPaperFillExecutionObservation(sources.fills).observedAt, getDurableOpeningCapacityEventObservedAt(sources.events)].map(Date.parse);
  const cutoff = Date.parse(input.asOf), latestObservation = Math.max(...observed);
  if (Date.now() < latestObservation) throw new Error("current opening frontier observation clock moved backwards");
  if (cutoff > latestObservation) throw new Error("current opening frontier cutoff follows source observation");
  const requireBefore = (time: string, source: string) => {
    if (Date.parse(time) >= cutoff) throw new Error(`current opening frontier excludes or coincides with ${source}`);
  };
  for (const origin of resolveHeldRebalancePlanOrigins(sources.planEvents, input.baseDir)) {
    if (origin.record.portfolioId === input.portfolioId) requireBefore(origin.appendedAt, "plan commit");
  }
  for (const event of sources.planEvents.events) {
    if (event.portfolioId === input.portfolioId) requireBefore(resolveVerifiedRebalancePlanEventOrigin(sources.planEvents, event.planEventId).appendedAt, "plan event commit");
  }
  for (const fill of sources.fills.records) {
    if (fill.portfolioId !== input.portfolioId) continue;
    const origin = resolvePersistedPaperFillExecutionOrigin(sources.fills, fill.paperFillRecordId);
    requireBefore(origin.appendedAt, "fill commit");
    if (origin.completion !== null) requireBefore(origin.completion.completedAt, "fill completion");
  }
  for (const event of sources.events.events) {
    if (event.portfolioId === input.portfolioId) requireBefore(resolveStoredOpeningCapacityEventOrigin(sources.events, event.capacityReservationEventId).committedAt, "capacity commit");
  }
}
