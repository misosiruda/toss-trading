import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { HASH, OTHER, PORTFOLIO, at, snapshot } from "./storedManualOpeningCapacityTestFixtures.js";
import { run, storeSnapshot, appendOtherPlan, fixture } from "./snapshotPendingReservationTestFixtures.js";

test("pending BUY reservation origins aggregate separate pending actions instead of reusing the full reservation", async (context) => {
  await fixture(context, "selector", { count: 0 }, async (state) => {
    await appendOtherPlan(state, context);
    await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context, { cutoff: 190 }) }), /exceeds remaining reservation gross/);
  });
});


test("pending BUY reservation origins reject final capacity generation changes and preserve corrupt fill bytes", async (context) => {
  await fixture(context, "selector", { count: 1 }, async (state) => {
    const stored = { state, snapshot: await storeSnapshot(state, context) };
    const capacityPath = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
    const originalCapacity = await readFile(capacityPath);
    const original = OpeningCapacityReservationEventFileRepository.prototype.withDurableVerifiedHistory;
    let observations = 0;
    const mocked = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory",
      async function(this: OpeningCapacityReservationEventFileRepository, operation: Parameters<typeof original>[0]) {
        if (++observations === 9) await this.append(createOpeningCapacityReservationEvent({ eventType: "reserved",
          portfolioId: PORTFOLIO, policyHash: OTHER, bucket: "intraday", reservationId: "concurrent", reservationHash: HASH,
          capacityLedgerVersion: 1, remainingReservedNotionalKrw: 1, occupiesNewPositionSlot: true, asOf: at(200), createdAt: at(200),
          reservationSource: { sourceKind: "selector", candidateAssignmentId: "unverified", candidateAssignmentSetId: "unverified",
            candidateAssignmentSetHash: HASH, reservedSlotOrdinal: 0 } }));
        return original.call(this, operation);
      } as typeof original);
    try { await assert.rejects(run(stored), /capacity generation changed/); assert.equal(observations, 9); }
    finally { mocked.mock.restore(); }
    // The appended older-policy root lacks actual issuance, so even a fresh resolution must reject it.
    await assert.rejects(run(stored), /issuance source is missing/);
    // Restore only this synthetic fixture to independently exercise corrupt fill propagation.
    await writeFile(capacityPath, originalCapacity);
    assert.equal((await run(stored)).bindings.length, 1);
    const path = createPaperFillExecutionPaths(state.dir).recordsPath, valid = await readFile(path, "utf8");
    await writeFile(path, valid + "{broken}\n");
    await assert.rejects(run(stored)); assert.equal(await readFile(path, "utf8"), valid + "{broken}\n");
  });
});
