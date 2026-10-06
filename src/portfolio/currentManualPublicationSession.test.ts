import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { withPublishedCurrentOpeningBudget } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture, options } from "./currentSizingCapacityTestFixtures.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository, createManualOpeningCapacityReservationPaths } from "./manualOpeningCapacityReservationFiles.js";
for (const unawaited of [false, true]) {
  test(`independent publication drains manual writes before revoking snapshot; unawaited=${unawaited}`, async context => {
    await withCurrentCapacityFixture(context, async ({ dir, request, root }) => {
      assert.ok("source" in root && "record" in root);
      const { manualAssignmentEventId: _id, manualAssignmentEventHash: _hash, ...sourcePayload } = root.source;
      const source = createManualAssignmentEvent({ ...sourcePayload, policyHash: request.policyHash, authorizationRef: 'review-fresh-manual' });
      await new ManualAssignmentFileRepository(dir).append(source);
      const { manualCapacityReservationId: _rid, manualCapacityReservationHash: _rhash, ...payload } = root.record;
      assert.equal(payload.reservationKind, "new_position");
      assert.ok(payload.reservationKind === "new_position");
      const paths = createManualOpeningCapacityReservationPaths(dir);
      const realOpen = fs.open;
      let hitPending!: () => void, releasePending!: () => void;
      const hit = new Promise<void>(resolve => { hitPending = resolve; });
      const release = new Promise<void>(resolve => { releasePending = resolve; });
      let armed = false;
      context.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await realOpen(...args);
        if (armed && args[0] === paths.pendingPath && args[1] === 'wx') {
          hitPending();
          await release;
        }
        return handle;
      });
      syncBuiltinESMExports();
      let pending!: Promise<unknown>, result: unknown, publicationError: unknown;
      try {
        try {
          result = await withPublishedCurrentOpeningBudget(request, async (publication, snapshots, sessions) => {
            assert.ok(sessions);
            const record = createManualOpeningCapacityReservationRecord({ ...payload,
              manualAssignmentEventId: source.manualAssignmentEventId, manualAssignmentEventHash: source.manualAssignmentEventHash,
              authorizationRef: source.authorizationRef, policyHash: source.policyHash,
              currentPortfolioSnapshotId: publication.snapshot.portfolioSnapshotId,
              currentPortfolioSnapshotHash: publication.snapshot.portfolioSnapshotHash,
              capacityLedgerVersion: 3, reservedSlotOrdinal: 20, createdAt: new Date().toISOString() });
            armed = true;
            pending = sessions.manualSession.append(record, snapshots);
            pending.catch(() => {});
            await hit;
            setTimeout(releasePending, 100);
            if (!unawaited) await pending;
            return 'done';
          }, options);
        } catch (error) { publicationError = error; }
        const write = await pending.then(() => 'fulfilled', error => error.message);
        const barrier = await fs.stat(paths.pendingPath).then(() => true, () => false);
        console.log(JSON.stringify({ case: 'manual-lease', unawaited, result, publicationError: publicationError instanceof Error ? publicationError.message : undefined, write, pendingBarrier: barrier }));
        assert.equal(publicationError, undefined);
        assert.equal(barrier, false);
        assert.equal((await new ManualOpeningCapacityReservationFileRepository(dir).readAll()).length, 2);
      } finally { releasePending(); context.mock.restoreAll(); syncBuiltinESMExports(); }
    }, 'manual', true);
  });
}
