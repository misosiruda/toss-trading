import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { createOpeningCapacityReservationEventPaths, OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { createCandidateAssignmentPaths } from "./candidateAssignmentFiles.js";
import { createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { START } from "./storedManualOpeningCapacityTestFixtures.js";

for (const kind of ["manual", "selector"] as const) {
  test(`current sizing binds ${kind} proposed mandate sources through first publish and retry`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const paths = [createInvestmentMandatePaths(dir).recordsPath, createOpeningCapacityReservationEventPaths(dir).eventsPath];
      const before = await Promise.all(paths.map((path) => fs.readFile(path))), portfolio = await store.readSnapshot();
      const snapshot = await publish(request, options);
      assert.deepEqual(await publish(request, options), snapshot);
      assert.equal((await fs.readFile(records, "utf8")).trim().split("\n").length, 2);
      assert.deepEqual(await Promise.all(paths.map((path) => fs.readFile(path))), before);
      assert.deepEqual(await store.readSnapshot(), portfolio);
      assert.deepEqual((await new InvestmentMandateFileRepository(dir).readSnapshot()).events, []);
    }, kind);
  });

  for (const retry of [false, true]) {
    test(`current sizing rejects ${kind} missing corrupt and mismatched bound mandate without pending BUY retry=${retry}`, async (context) => {
      await fixture(context, async ({ dir, root, request, records, store }) => {
        if (retry) await publish(request, options);
        const destination = await fs.readFile(records), portfolio = await store.readSnapshot();
        const path = createInvestmentMandatePaths(dir).recordsPath, capacityPath = createOpeningCapacityReservationEventPaths(dir).eventsPath;
        const valid = await fs.readFile(path), validCapacity = await fs.readFile(capacityPath);
        for (const failure of ["missing", "corrupt", "lineage"] as const) {
          await fs.unlink(path);
          if (failure === "corrupt") await fs.writeFile(path, Buffer.concat([valid, Buffer.from("{bad}\n")]));
          if (failure === "lineage") {
            const { mandateId: _id, mandateHash: _hash, ...payload } = root.mandate;
            const mandate = createInvestmentMandateRecord({ ...payload, targetWeightRatio: 0.11 });
            await new InvestmentMandateFileRepository(dir).appendRecord(mandate);
            await fs.unlink(capacityPath);
            const capacity = new OpeningCapacityReservationEventFileRepository(dir);
            context.mock.timers.setTime(START + 20);
            await capacity.append(root.root);
            const { capacityReservationEventId: _eventId, capacityReservationEventHash: _eventHash, ...bound } = root.bound;
            if (bound.eventType !== "bound_to_mandate") throw new Error("bound fixture required");
            context.mock.timers.setTime(START + 40);
            await capacity.append(createOpeningCapacityReservationEvent({ ...bound, mandateId: mandate.mandateId, mandateHash: mandate.mandateHash }));
            context.mock.timers.setTime(START + 100);
          }
          await assert.rejects(publish(request, options));
          assert.deepEqual(await fs.readFile(records), destination);
          assert.deepEqual(await store.readSnapshot(), portfolio);
          if (failure === "missing") await assert.rejects(fs.access(path), { code: "ENOENT" });
          if (failure === "corrupt") assert.deepEqual(await fs.readFile(path), Buffer.concat([valid, Buffer.from("{bad}\n")]));
          await fs.writeFile(path, valid); await fs.writeFile(capacityPath, validCapacity);
        }
        await publish(request, options);
      }, kind);
    });
  }

  test(`current sizing retains ${kind} assignment and mandate locks through append and exact retry`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      const original = fs.open; let finalPhase = false, checked = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] === createPortfolioSizingSnapshotPaths(dir).lockPath && args[1] === "wx") finalPhase = false;
        const handle = await original(...args);
        if (args[0] === createOpeningCapacityReservationEventPaths(dir).lockPath && args[1] === "wx") finalPhase = true;
        if (args[0] === records && finalPhase && (args[1] === "a" || args[1] === "r+")) {
          const sync = handle.sync.bind(handle);
          context.mock.method(handle, "sync", async () => {
            for (const path of [createBucketSelectionRequestPaths(dir).lockPath, createCandidateSizingInputPaths(dir).lockPath,
              createCandidateAssignmentPaths(dir).lockPath, createInvestmentMandatePaths(dir).lockPath]) {
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
      await new InvestmentMandateFileRepository(dir, options).readSnapshot();
    }, kind);
  });
}
