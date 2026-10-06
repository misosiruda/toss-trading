import assert from "node:assert/strict";
import test from "node:test";
import { withPublishedCurrentOpeningBudget } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture, options } from "./currentSizingCapacityTestFixtures.js";
import type { ManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import type { SelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";

function contains(error: unknown, expected: unknown): boolean {
  if (error === expected) return true;
  if (!(error instanceof Error)) return false;
  return (error.cause !== undefined && contains(error.cause, expected)) ||
    (error instanceof AggregateError && error.errors.some(item => contains(item, expected)));
}

for (const consumerFails of [false, true]) {
  for (const failedSessions of [[], ["manual"], ["selector"], ["manual", "selector"]] as const) {
    test(`publication preserves every error: consumer=${consumerFails}, drains=${failedSessions.join(",")}`, async context => {
      await withCurrentCapacityFixture(context, async ({ request }) => {
        const original = new Error("original publication consumer failure");
        const appendErrors: unknown[] = [];
        let failure: unknown;
        try {
          const result = await withPublishedCurrentOpeningBudget(request, async (_publication, _snapshots, sessions) => {
            assert.ok(sessions);
            for (const kind of failedSessions) {
              try {
                if (kind === "manual") await sessions.manualSession.append({} as ManualOpeningCapacityReservationRecord);
                else await sessions.selectorSession.append({} as SelectorOpeningCapacityReservationRecord);
              } catch (error) { appendErrors.push(error); }
            }
            if (consumerFails) throw original;
            return "completed";
          }, options);
          assert.equal(result, "completed");
        } catch (error) { failure = error; }
        assert.equal(appendErrors.length, failedSessions.length);
        if (!consumerFails && !failedSessions.length) assert.equal(failure, undefined);
        if (consumerFails) assert.ok(contains(failure, original), "consumer error must survive every cleanup layer");
        if (consumerFails && !failedSessions.length) assert.equal(failure, original);
        for (const error of appendErrors) assert.ok(contains(failure, error), "each drain error must remain inspectable");
      }, "manual", true);
    });
  }
}
