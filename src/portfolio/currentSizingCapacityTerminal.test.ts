import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { seedCapacityExecutionHistory, START, at, PORTFOLIO, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";

type Fixture = Parameters<Parameters<typeof fixture>[1]>[0];
async function seedRelease(state: Fixture, context: TestContext, partial = false) {
  const { dir, root, store } = state, mandates = new InvestmentMandateFileRepository(dir);
  let predecessor = root.bound;
  if (partial) predecessor = (await seedCapacityExecutionHistory(dir, context, { count: 1, feeBps: 250 }, root)).capacity[0]!;
  else {
    context.mock.timers.setTime(START + 41);
    await mandates.appendEvent(mandateEvent(root.mandate, "activated", 41));
  }
  const active = (await mandates.readSnapshot()).events[0]!;
  const terminal = mandateEvent(root.mandate, "retired", 170, active.mandateEventId);
  context.mock.timers.setTime(START + 170); await mandates.appendEvent(terminal);
  const release = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO,
    policyHash: predecessor.policyHash, bucket: predecessor.bucket, reservationId: predecessor.reservationId,
    reservationHash: predecessor.reservationHash, previousCapacityReservationEventId: predecessor.capacityReservationEventId,
    capacityLedgerVersion: predecessor.capacityLedgerVersion + 1, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
    asOf: at(180), createdAt: at(180), releaseReasonCode: "retired", releaseOrigin: { originKind: "mandate_terminal",
      mandateId: terminal.mandateId, mandateHash: terminal.mandateHash, mandateEventId: terminal.mandateEventId, mandateEventHash: terminal.mandateEventHash } });
  context.mock.timers.setTime(START + 180); await new OpeningCapacityReservationEventFileRepository(dir).append(release);
  context.mock.timers.setTime(START + 200);
  await store.write({ portfolioId: PORTFOLIO, cashKrw: 1000, positions: [], updatedAt: at(50) });
  return release;
}

for (const kind of ["manual", "selector"] as const) {
  for (const cutoff of [55, 200]) test(`current sizing binds ${kind} actual retirement on append and retry cutoff=${cutoff}`, async (context) => {
    await fixture(context, async (state) => {
      await seedRelease(state, context);
      const { dir, request, records, store } = state, input = { ...request, asOf: at(cutoff) };
      const path = createOpeningCapacityReservationEventPaths(dir).eventsPath, source = await fs.readFile(path), portfolio = await store.readSnapshot();
      const snapshot = await publish(input, options), destination = await fs.readFile(records);
      assert.deepEqual(await publish(input, options), snapshot);
      assert.deepEqual(await fs.readFile(records), destination); assert.deepEqual(await fs.readFile(path), source);
      assert.deepEqual(await store.readSnapshot(), portfolio);
    }, kind);
  });
  test(`current sizing binds ${kind} post-cutoff partial gross consumption before retirement`, async (context) => {
    await fixture(context, async (state) => {
      await seedRelease(state, context, true);
      const input = { ...state.request, asOf: at(55) }, portfolio = await state.store.readSnapshot();
      const result = await publish(input, options);
      assert.deepEqual(await publish(input, options), result);
      assert.deepEqual(await state.store.readSnapshot(), portfolio);
    }, kind);
  });
  for (const retry of [false, true]) test(`current sizing rejects ${kind} invalid post-cutoff retirement before saving retry=${retry}`, async (context) => {
    await fixture(context, async (state) => {
      const release = await seedRelease(state, context), { dir, root, request, records, store } = state;
      if (release.eventType !== "released" || release.releaseOrigin.originKind !== "mandate_terminal") throw new Error("retirement fixture required");
      const input = { ...request, asOf: at(55) };
      if (retry) await publish(input, options);
      const destination = await fs.readFile(records), portfolio = await store.readSnapshot();
      const path = createOpeningCapacityReservationEventPaths(dir).eventsPath, original = await fs.readFile(path);
      const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = release;
      const invalid = [{ ...payload, releaseOrigin: { ...release.releaseOrigin, mandateEventId: "missing" } }, { ...payload, asOf: at(160) }];
      for (const value of invalid) {
        await fs.unlink(path); const repository = new OpeningCapacityReservationEventFileRepository(dir);
        context.mock.timers.setTime(START + 20); await repository.append(root.root);
        context.mock.timers.setTime(START + 40); await repository.append(root.bound);
        context.mock.timers.setTime(START + 180); await repository.append(createOpeningCapacityReservationEvent(value));
        context.mock.timers.setTime(START + 200); const damaged = await fs.readFile(path);
        await assert.rejects(publish(input, options), /actual retired mandate event|release source chronology mismatch/);
        assert.deepEqual(await fs.readFile(records), destination); assert.deepEqual(await fs.readFile(path), damaged);
        assert.deepEqual(await store.readSnapshot(), portfolio);
      }
      await fs.writeFile(path, original); await publish(input, options);
    }, kind);
  });
  for (const retry of [false, true]) test(`current sizing rejects ${kind} unverified cancellation release retry=${retry}`, async (context) => {
    await fixture(context, async (state) => {
      await seedRelease(state, context);
      const { dir, root, request, records, store } = state, input = { ...request, asOf: at(55) };
      if (retry) await publish(input, options);
      const destination = await fs.readFile(records), portfolio = await store.readSnapshot();
      const path = createOpeningCapacityReservationEventPaths(dir).eventsPath, original = await fs.readFile(path);
      await fs.unlink(path); const repository = new OpeningCapacityReservationEventFileRepository(dir);
      context.mock.timers.setTime(START + 20); await repository.append(root.root);
      context.mock.timers.setTime(START + 180);
      await repository.append(createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO,
        policyHash: root.root.policyHash, bucket: root.root.bucket, reservationId: root.root.reservationId, reservationHash: root.root.reservationHash,
        previousCapacityReservationEventId: root.root.capacityReservationEventId, capacityLedgerVersion: 2, remainingReservedNotionalKrw: 0,
        occupiesNewPositionSlot: false, asOf: at(180), createdAt: at(180), releaseReasonCode: "cancelled",
        releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "unverified" } }));
      context.mock.timers.setTime(START + 200); const damaged = await fs.readFile(path);
      await assert.rejects(publish(input, options), /held pending reservation cannot accept unverified cancellation releases/);
      assert.deepEqual(await fs.readFile(records), destination); assert.deepEqual(await fs.readFile(path), damaged);
      assert.deepEqual(await store.readSnapshot(), portfolio);
      await fs.writeFile(path, original); await publish(input, options);
    }, kind);
  });
  test(`current sizing holds ${kind} retirement source locks through destination fsync and retry`, async (context) => {
    await fixture(context, async (state) => {
      await seedRelease(state, context);
      const { dir, request, records } = state, input = { ...request, asOf: at(200) }, original = fs.open;
      let finalPhase = false, checked = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (args[0] === createOpeningCapacityReservationEventPaths(dir).lockPath && args[1] === "wx") finalPhase = true;
        if (args[0] === records && finalPhase && (args[1] === "a" || args[1] === "r+")) {
          const sync = handle.sync.bind(handle);
          context.mock.method(handle, "sync", async () => {
            for (const path of [createInvestmentMandatePaths(dir).lockPath, createOpeningCapacityReservationEventPaths(dir).lockPath]) {
              await assert.rejects(original(path, "wx"), { code: "EEXIST" });
            }
            checked++; await sync();
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await publish(input, options); finalPhase = false; await publish(input, options); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(checked, 2);
      await new InvestmentMandateFileRepository(dir, options).readSnapshot();
      await new OpeningCapacityReservationEventFileRepository(dir, options).withDurableVerifiedHistory(async () => {});
    }, kind);
  });
}
