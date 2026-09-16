import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { HASH, START, PORTFOLIO, at, snapshot, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";
import { run, storeSnapshot, fixture } from "./snapshotPendingReservationTestFixtures.js";

test("pending BUY reservation origins reject missing consumption and ambiguous or not-yet-consumed cutoff", async (context) => {
  for (const mode of ["missing", "ambiguous", "before_consumption"] as const) await fixture(context, "selector", { count: 1 }, async (state) => {
    if (mode === "missing") {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const rows = (await readFile(path, "utf8")).trimEnd().split("\n");
      await writeFile(path, rows.slice(0, -2).join("\n") + "\n");
    }
    const stored = { state, snapshot: await storeSnapshot(state, context, { cutoff: mode === "ambiguous" ? 95 : mode === "before_consumption" ? 93 : 170 }) };
    await assert.rejects(run(stored), /ambiguous at cutoff|prior execution lacks its actual reservation consumption/);
  });
});


test("pending BUY reservation origins retain historical balance after later consumption but reject released capacity", async (context) => {
  await fixture(context, "selector", { count: 2 }, async (state) => {
    const result = await run({ state, snapshot: await storeSnapshot(state, context, { cutoff: 100 }) });
    assert.equal(result.bindings[0]!.priorConsumptionOrigins.length, 1);
    assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, 60);
    assert.equal(state.capacity.at(-1)!.remainingReservedNotionalKrw, 30);
  });
  await fixture(context, "manual", { count: 1 }, async (state) => {
    const mandates = new InvestmentMandateFileRepository(state.dir);
    const activated = (await mandates.readSnapshot()).events[0]!;
    context.mock.timers.setTime(START + 160);
    const retired = mandateEvent(state.manual.mandate, "retired", 160, activated.mandateEventId);
    await mandates.appendEvent(retired);
    const previous = state.capacity.at(-1)!;
    context.mock.timers.setTime(START + 165);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({ eventType: "released",
      portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday", reservationId: previous.reservationId, reservationHash: previous.reservationHash,
      previousCapacityReservationEventId: previous.capacityReservationEventId, capacityLedgerVersion: previous.capacityLedgerVersion + 1,
      remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(165), createdAt: at(165), releaseReasonCode: "retired",
      releaseOrigin: { originKind: "mandate_terminal", mandateId: retired.mandateId, mandateHash: retired.mandateHash,
        mandateEventId: retired.mandateEventId, mandateEventHash: retired.mandateEventHash } }));
    const historical = await run({ state, snapshot: await storeSnapshot(state, context, { cutoff: 100 }) });
    assert.equal(historical.bindings[0]!.mandateState.status, "active");
    assert.equal(historical.reservationTotals[0]!.remainingReservedNotionalKrw, 60);
    await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context) }), /available bound reservation at cutoff/);
  });
});
