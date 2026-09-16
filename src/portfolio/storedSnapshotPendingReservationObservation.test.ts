import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { at, snapshot } from "./storedManualOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotPendingReservationOrigins } from "./storedSnapshotPendingReservationOrigins.js";
import { run, storeSnapshot, fixture } from "./snapshotPendingReservationTestFixtures.js";

test("pending BUY reservation origins capture strict query input before asynchronous source reads", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const stored = await storeSnapshot(state, context), input = { baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId };
    const pending = resolveStoredSnapshotPendingReservationOrigins(input);
    input.baseDir = join(state.dir, "missing"); input.portfolioSnapshotId = "missing";
    assert.equal((await pending).bindings.length, 1);
    await assert.rejects(resolveStoredSnapshotPendingReservationOrigins({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId, trusted: true } as never));
  });
});


test("pending BUY reservation origins reject a changed mandate generation instead of combining source observations", async (context) => {
  await fixture(context, "selector", { count: 0 }, async (state) => {
    const stored = { state, snapshot: await storeSnapshot(state, context) };
    const capacitySpy = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory");
    const original = InvestmentMandateFileRepository.prototype.withDurableVerifiedHistory;
    let injected = false;
    const mocked = context.mock.method(InvestmentMandateFileRepository.prototype, "withDurableVerifiedHistory",
      async function(this: InvestmentMandateFileRepository, operation: Parameters<typeof original>[0]) {
        if (!injected && capacitySpy.mock.callCount() === 8) {
          injected = true;
          const { mandateId: _id, mandateHash: _hash, ...payload } = state.manual.mandate;
          await this.appendRecord(createInvestmentMandateRecord({ ...payload, symbol: "000660", createdAt: at(200) }));
        }
        return original.call(this, operation);
      } as typeof original);
    try { await assert.rejects(run(stored), /mandate generation changed/); assert.equal(injected, true); }
    finally { mocked.mock.restore(); capacitySpy.mock.restore(); }
    assert.equal((await run(stored)).bindings.length, 1);
  });
});
