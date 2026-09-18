import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot as publish,
  appendPolicyBoundCurrentPortfolioSizingSnapshot as legacy } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { resolveStoredSnapshotOpeningBudget } from "./storedSnapshotOpeningBudget.js";
import { createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createRuntimePortfolioPolicyActivationPaths } from "./runtimePortfolioPolicyActivationFiles.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

for (const kind of ["manual", "selector"] as const) {
  test(`current opening budget binds actual portfolio and active policy for ${kind} publish and retry`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const portfolio = await store.readSnapshot(), original = await fs.readFile(request.portfolioPath);
      const result = await publish(request, options), historical = await resolveStoredSnapshotOpeningBudget({ baseDir: dir,
        portfolioSnapshotId: result.snapshot.portfolioSnapshotId });
      assert.equal(result.snapshot.portfolioVersion, portfolio.revisionHash);
      assert.deepEqual(result.snapshot.virtualPortfolio, portfolio.portfolio);
      assert.deepEqual(result.openingBudget.cash, historical.cash); assert.deepEqual(result.openingBudget.budgets, historical.budgets);
      assert.equal(result.openingBudget.cash.reservedOpeningNotionalKrw, 100);
      assert.equal(result.openingBudget.cash.maximumAdditionalNetCashDebitKrw, 750);
      assert.equal(result.openingBudget.cash.unsubmittedReservedNotionalKrw, 100);
      assert.equal(result.openingBudget.occupancy.capacities.find((item) => item.bucket === "intraday")!.availableSlots, 3);
      assert.equal(result.openingBudget.occupancy.policy.policyHash, request.policyHash);
      assert.equal(result.openingBudget.assessment.currentExecutionAuthority, "not_granted");
      assert.equal(result.openingBudget.assessmentHash, hashCanonicalPayload(result.openingBudget.assessment));
      assert.ok(Object.isFrozen(result));
      const before = await fs.readFile(records), retry = await publish(request, options);
      assert.deepEqual(retry.snapshot, result.snapshot); assert.deepEqual(retry.openingBudget.cash, result.openingBudget.cash);
      assert.deepEqual(await fs.readFile(records), before); assert.deepEqual(await fs.readFile(request.portfolioPath), original);
      assert.deepEqual(await legacy(request, options), result.snapshot);
    }, kind, true);
  });

  test(`current opening budget requires explicit ${kind} limits without changing legacy publication`, async (context) => {
    await fixture(context, async ({ request, records }) => {
      const before = await fs.readFile(records);
      await assert.rejects(publish(request, options), /explicit policy limits/);
      assert.deepEqual(await fs.readFile(records), before);
      const old = await legacy(request, options), after = await fs.readFile(records);
      await assert.rejects(publish(request, options), /explicit policy limits/);
      assert.deepEqual(await fs.readFile(records), after); assert.deepEqual(await legacy(request, options), old);
    }, kind);
  });

  for (const retry of [false, true]) test(`current opening budget rejects ${kind} invalid sources and caller overrides retry=${retry}`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      if (retry) await publish(request, options);
      const before = await fs.readFile(records), portfolio = await store.readSnapshot();
      for (const extra of [{ policy: {} }, { openingBudget: {} }, { virtualPortfolio: {} }, { portfolioVersion: "forged" }]) {
        await assert.rejects(publish({ ...request, ...extra }, options));
      }
      await assert.rejects(publish({ ...request, policyHash: `sha256:${"f".repeat(64)}` }, options), /active policy mismatch/);
      for (const path of [createOpeningCapacityReservationEventPaths(dir).eventsPath, createRuntimePortfolioPolicyActivationPaths(dir).eventsPath]) {
        const original = await fs.readFile(path), corrupt = original.subarray(0, -1);
        await fs.writeFile(path, corrupt); await assert.rejects(publish(request, options));
        assert.deepEqual(await fs.readFile(path), corrupt); assert.deepEqual(await fs.readFile(records), before);
        await fs.writeFile(path, original);
      }
      assert.deepEqual(await store.readSnapshot(), portfolio); await publish(request, options);
    }, kind, true);
  });

  test(`current opening budget propagates ${kind} retry fsync failure and releases source locks`, async (context) => {
    await fixture(context, async ({ request, records, store }) => {
      const first = await publish(request, options), bytes = await fs.readFile(records), portfolio = await store.readSnapshot();
      const original = fs.open, failure = new Error("synthetic opening publication sync failure");
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (args[0] === records && args[1] === "r+") context.mock.method(handle, "sync", async () => { throw failure; });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(publish(request, options), /synthetic opening publication sync failure/); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.deepEqual(await fs.readFile(records), bytes); assert.deepEqual(await store.readSnapshot(), portfolio);
      assert.deepEqual((await publish(request, options)).snapshot, first.snapshot);
    }, kind, true);
  });

  test(`current opening budget keeps ${kind} portfolio activation price and capacity locks through first and retry fsync`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const original = fs.open; let finalPhase = false, checked = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] === createPortfolioSizingSnapshotPaths(dir).lockPath && args[1] === "wx") finalPhase = false;
        const handle = await original(...args);
        if (args[0] === createOpeningCapacityReservationEventPaths(dir).lockPath && args[1] === "wx") finalPhase = true;
        if (args[0] === records && finalPhase && (args[1] === "a" || args[1] === "r+")) {
          const sync = handle.sync.bind(handle);
          context.mock.method(handle, "sync", async () => {
            for (const path of [createSourcePriceEvidencePaths(dir).lockPath, createRuntimePortfolioPolicyActivationPaths(dir).lockPath,
              createOpeningCapacityReservationEventPaths(dir).lockPath]) await assert.rejects(original(path, "wx"), { code: "EEXIST" });
            await assert.rejects(store.withLockedSnapshot(async () => {}), /lock|timeout/i);
            checked++; await sync();
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await publish(request, options); await publish(request, options); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(checked, 2); await store.readSnapshot();
    }, kind, true);
  });
}
