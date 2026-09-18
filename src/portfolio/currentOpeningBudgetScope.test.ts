import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { withPublishedCurrentOpeningBudget as consume, assertHeldCurrentOpeningBudget as assertHeld,
  appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import type { OpeningBudgetBoundSizingPublication } from "./portfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { createRuntimePortfolioPolicyActivationPaths } from "./runtimePortfolioPolicyActivationFiles.js";
import { createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { START } from "./storedManualOpeningCapacityTestFixtures.js";

for (const kind of ["manual", "selector"] as const) {
  test(`current opening ${kind} scope authenticates identity path and asynchronous lifetime`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const paths = { baseDir: dir, portfolioPath: request.portfolioPath };
      const detached = await publish(request, options), before = await fs.readFile(records), original = await store.readSnapshot();
      assert.throws(() => assertHeld(detached, paths), /active publication scope/);
      let escaped!: OpeningBudgetBoundSizingPublication;
      const result = await consume(request, async (publication) => {
        escaped = publication; assertHeld(publication, paths);
        assert.equal(publication.snapshot.portfolioVersion, original.revisionHash);
        assert.throws(() => assertHeld({ ...publication }, paths), /active publication scope/);
        assert.throws(() => assertHeld(structuredClone(publication), paths), /active publication scope/);
        assert.throws(() => assertHeld(publication, { ...paths, baseDir: join(dir, "foreign") }), /different source path/);
        assert.throws(() => assertHeld(publication, { ...paths, portfolioPath: join(dir, "other.json") }), /different source path/);
        assert.throws(() => assertHeld(publication, { ...paths, trusted: true } as never));
        await Promise.resolve(); assertHeld(publication, paths);
        for (const path of [createSourcePriceEvidencePaths(dir).lockPath, createRuntimePortfolioPolicyActivationPaths(dir).lockPath,
          createOpeningCapacityReservationEventPaths(dir).lockPath]) await assert.rejects(fs.open(path, "wx"), { code: "EEXIST" });
        await assert.rejects(store.withLockedSnapshot(async () => {}), /lock|timeout/i);
        return "consumer-result";
      }, options);
      assert.equal(result, "consumer-result"); assert.throws(() => assertHeld(escaped, paths), /active publication scope/);
      assert.deepEqual(await fs.readFile(records), before); assert.deepEqual(await store.readSnapshot(), original);
      await consume(request, async (fresh) => { assertHeld(fresh, paths); assert.throws(() => assertHeld(escaped, paths), /active publication scope/); }, options);
    }, kind, true);
  });

  test(`current opening ${kind} consumer failure revokes scope but preserves the durably published snapshot`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const paths = { baseDir: dir, portfolioPath: request.portfolioPath }, original = await store.readSnapshot();
      let escaped!: OpeningBudgetBoundSizingPublication, published!: Buffer;
      await assert.rejects(consume(request, async (publication) => {
        escaped = publication; assertHeld(publication, paths); published = await fs.readFile(records);
        assert.equal(published.toString("utf8").trim().split("\n").length, 2);
        throw new Error("synthetic consumer rejection");
      }, options), /synthetic consumer rejection/);
      assert.throws(() => assertHeld(escaped, paths), /active publication scope/);
      assert.deepEqual(await fs.readFile(records), published); assert.deepEqual(await store.readSnapshot(), original);
      const next = await consume(request, async (publication) => { assertHeld(publication, paths); return publication; }, options);
      assert.deepEqual(next.snapshot, escaped.snapshot); assert.throws(() => assertHeld(next, paths), /active publication scope/);
      assert.deepEqual(await fs.readFile(records), published);
    }, kind, true);
  });

  test(`current opening ${kind} scope rejects backward observation time and revokes on post-consumer failure`, async (context) => {
    await fixture(context, async ({ dir, request }) => {
      const paths = { baseDir: dir, portfolioPath: request.portfolioPath }; let escaped!: OpeningBudgetBoundSizingPublication;
      try {
        await assert.rejects(consume(request, async (publication) => {
          escaped = publication; assertHeld(publication, paths); context.mock.timers.setTime(START + 99);
          assert.throws(() => assertHeld(publication, paths), /clock moved backwards/);
        }, options), /clock moved backwards/);
      } finally { context.mock.timers.setTime(START + 100); }
      assert.throws(() => assertHeld(escaped, paths), /active publication scope/);
      await consume(request, async (publication) => assertHeld(publication, paths), options);
    }, kind, true);
  });

  test(`current opening ${kind} source failure never invokes consumer or changes destination`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      const before = await fs.readFile(records), path = createOpeningCapacityReservationEventPaths(dir).eventsPath;
      const bytes = await fs.readFile(path), damaged = bytes.subarray(0, -1); let called = false;
      await assert.rejects(consume(request, undefined as never, options), /consumer must be a function/);
      await fs.writeFile(path, damaged);
      await assert.rejects(consume(request, async () => { called = true; }, options), /torn final line/);
      assert.equal(called, false); assert.deepEqual(await fs.readFile(records), before); assert.deepEqual(await fs.readFile(path), damaged);
      await fs.writeFile(path, bytes); await consume(request, async () => { called = true; }, options); assert.equal(called, true);
    }, kind, true);
  });
}
