import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { START, PORTFOLIO, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { ManualAssignmentFileRepository, createManualAssignmentPaths } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationPaths } from "./manualOpeningCapacityReservationFiles.js";
import { createSelectorOpeningCapacityReservationPaths } from "./selectorOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEventPaths, OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";

test("current sizing binds actual old-policy roots and preserves retry and source bytes without deadlock", async (context) => {
  await fixture(context, async ({ dir, request, records, store }) => {
    const paths = [createManualAssignmentPaths(dir).eventsPath, createManualOpeningCapacityReservationPaths(dir).recordsPath,
      createOpeningCapacityReservationEventPaths(dir).eventsPath];
    const before = await Promise.all(paths.map((path) => fs.readFile(path)));
    const portfolio = await store.readSnapshot();
    const snapshot = await publish(request, options);
    assert.deepEqual(await publish(request, options), snapshot);
    assert.equal((await fs.readFile(records, "utf8")).trim().split("\n").length, 2);
    assert.deepEqual(await Promise.all(paths.map((path) => fs.readFile(path))), before);
    assert.deepEqual(await store.readSnapshot(), portfolio);
  });
});

for (const retry of [false, true]) {
  test(`current sizing rejects actual root source deletion and corruption before writing retry=${retry}`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      if (retry) await publish(request, options);
      const destination = await fs.readFile(records);
      for (const path of [createManualOpeningCapacityReservationPaths(dir).recordsPath, createManualAssignmentPaths(dir).eventsPath]) {
        const valid = await fs.readFile(path);
        await fs.unlink(path);
        await assert.rejects(publish(request, options));
        assert.deepEqual(await fs.readFile(records), destination);
        await fs.writeFile(path, Buffer.concat([valid, Buffer.from("{bad}\n")]));
        await assert.rejects(publish(request, options));
        assert.deepEqual(await fs.readFile(records), destination);
        await fs.writeFile(path, valid);
      }
      await publish(request, options);
    });
  });
}

test("current sizing refuses an unissued selector root even without pending BUY and preserves destination", async (context) => {
  await fixture(context, async ({ dir, request, records }) => {
    const event = createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: PORTFOLIO,
      policyHash: request.policyHash, bucket: "swing", reservationId: "missing-selector", reservationHash: request.policyHash,
      capacityLedgerVersion: 1, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true,
      reservationSource: { sourceKind: "selector", candidateAssignmentSetId: "missing", candidateAssignmentSetHash: request.policyHash,
        candidateAssignmentId: "missing", reservedSlotOrdinal: 1 }, asOf: at(100), createdAt: at(100) });
    await new OpeningCapacityReservationEventFileRepository(dir).append(event);
    const before = await fs.readFile(records);
    await assert.rejects(publish(request, options), /selector capacity root issuance source is missing/);
    assert.deepEqual(await fs.readFile(records), before);
  });
});

test("current sizing holds issuance and capacity locks through destination append and exact retry", async (context) => {
  await fixture(context, async ({ dir, request, records, root }) => {
    const original = fs.open; let finalPhase = false, checked = 0;
    const capacityPath = createOpeningCapacityReservationEventPaths(dir).lockPath;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === createPortfolioSizingSnapshotPaths(dir).lockPath && args[1] === "wx") finalPhase = false;
      const handle = await original(...args);
      if (args[0] === capacityPath && args[1] === "wx") finalPhase = true;
      if (args[0] === records && finalPhase && (args[1] === "a" || args[1] === "r+")) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await assert.rejects(new ManualAssignmentFileRepository(dir, options).readAll(), /lock|timeout/i);
          await assert.rejects(new OpeningCapacityReservationEventFileRepository(dir, options).append(root.root), /lock|timeout/i);
          for (const path of [createManualOpeningCapacityReservationPaths(dir).lockPath, createSelectorOpeningCapacityReservationPaths(dir).lockPath]) {
            await assert.rejects(original(path, "wx"), { code: "EEXIST" });
          }
          checked++; await sync();
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await publish(request, options); await publish(request, options); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checked, 2);
    await new ManualAssignmentFileRepository(dir, options).readAll();
    await new OpeningCapacityReservationEventFileRepository(dir, options).append(root.root);
  });
});

test("current sizing rejects unused selector journal corruption without appending or repairing", async (context) => {
  await fixture(context, async ({ dir, request, records }) => {
    const path = createSelectorOpeningCapacityReservationPaths(dir).recordsPath;
    const before = await fs.readFile(records), corrupt = "{bad}\n";
    await fs.writeFile(path, corrupt);
    await assert.rejects(publish(request, options));
    assert.deepEqual(await fs.readFile(records), before);
    assert.equal(await fs.readFile(path, "utf8"), corrupt);
  });
});

for (const failure of ["sync", "clock"] as const) {
  test(`current sizing rejects capacity ${failure} failure and releases source locks`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      const before = await fs.readFile(records), path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
      const original = fs.open, denied = new Error("synthetic capacity sync failure");
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (args[0] === path && args[1] === "r+") {
          if (failure === "sync") context.mock.method(handle, "sync", async () => { throw denied; });
          else context.mock.timers.setTime(START + 99);
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(publish(request, options), failure === "sync" ? (error) => error === denied : /clock moved backwards/); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); context.mock.timers.setTime(START + 100); }
      assert.deepEqual(await fs.readFile(records), before);
      await publish(request, options);
    });
  });
}
