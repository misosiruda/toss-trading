import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { withPublishedCurrentOpeningBudget as consume, assertHeldCurrentOpeningBudget as assertHeld } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioSizingSnapshotPaths, assertDurablePortfolioSizingSnapshotSource as assertSource,
  getDurablePortfolioSizingSnapshotObservation as observation, type VerifiedPortfolioSizingSnapshotHistory as History,
  type OpeningBudgetBoundSizingPublication as Publication } from "./portfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { START, at } from "./storedManualOpeningCapacityTestFixtures.js";

async function withPostReadSync<T>(context: TestContext, path: string, hook: () => Promise<void>, operation: () => Promise<T>) {
  const original = fs.open; let reads = 0;
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (args[0] === path && args[1] === "r+") {
      const read = handle.readFile.bind(handle), sync = handle.sync.bind(handle); let ordinal = 0;
      context.mock.method(handle, "readFile", async (...parts: Parameters<typeof handle.readFile>) => { ordinal = ++reads; return read(...parts); });
      context.mock.method(handle, "sync", async () => { await sync(); if (ordinal === 2) await hook(); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try { return await operation(); } finally { mock.mock.restore(); syncBuiltinESMExports(); }
}

for (const kind of ["manual", "selector"] as const) {
  test(`published ${kind} snapshot source includes the durable append and expires across exact retries`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const portfolio = await store.readSnapshot(); let escaped!: History;
      await consume(request, async (publication, snapshots) => {
        escaped = snapshots; assertSource(snapshots, dir); assertHeld(publication, { baseDir: dir, portfolioPath: request.portfolioPath });
        assert.equal(snapshots.snapshots.length, 2); assert.deepEqual(snapshots.snapshots.at(-1), publication.snapshot);
        assert.equal(observation(snapshots).recordsHash, hashCanonicalPayload(snapshots.snapshots));
        assert.equal(observation(snapshots).recordCount, 2); assert.ok(Object.isFrozen(snapshots));
        assert.throws(() => assertSource({ ...snapshots }, dir), /lease/);
        assert.throws(() => assertSource(snapshots, join(dir, "foreign")), /different source path/);
        await Promise.resolve(); assertSource(snapshots, dir);
        await assert.rejects(fs.open(createPortfolioSizingSnapshotPaths(dir).lockPath, "wx"), { code: "EEXIST" });
      }, options);
      const bytes = await fs.readFile(records); assert.throws(() => assertSource(escaped, dir), /lease/);
      await consume(request, async (publication, snapshots) => {
        assert.notEqual(snapshots, escaped); assertSource(snapshots, dir);
        assert.throws(() => assertSource(escaped, dir), /lease/);
        assert.equal(snapshots.snapshots.length, 2); assert.deepEqual(snapshots.snapshots.at(-1), publication.snapshot);
      }, options);
      assert.deepEqual(await fs.readFile(records), bytes); assert.deepEqual(await store.readSnapshot(), portfolio);
    }, kind, true);
  });

  test(`published ${kind} source and current scope are revoked after consumer failure without rolling back snapshot`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      let history!: History, publication!: Publication, bytes!: Buffer;
      await assert.rejects(consume(request, async (value, source) => {
        history = source; publication = value; assertSource(source, dir); bytes = await fs.readFile(records);
        throw new Error("synthetic published source consumer failure");
      }, options), /consumer failure/);
      assert.throws(() => assertSource(history, dir), /lease/);
      assert.throws(() => assertHeld(publication, { baseDir: dir, portfolioPath: request.portfolioPath }), /active publication scope/);
      assert.deepEqual(await fs.readFile(records), bytes);
      await consume(request, async (_value, source) => assertSource(source, dir), options);
      assert.deepEqual(await fs.readFile(records), bytes);
    }, kind, true);
  });

  for (const retry of [false, true]) test(`published ${kind} source refuses post-publication read fsync failure retry=${retry}`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      if (retry) await consume(request, async () => {}, options);
      const portfolio = await store.readSnapshot(); let called = false, injected = false;
      await withPostReadSync(context, records, async () => { injected = true; throw new Error("synthetic post-publication source sync failure"); }, async () => {
        await assert.rejects(consume(request, async () => { called = true; }, options), /post-publication source sync failure/);
      });
      assert.equal(injected, true); assert.equal(called, false);
      const published = await fs.readFile(records); assert.equal(published.toString("utf8").trim().split("\n").length, 2);
      await consume(request, async (_value, source) => assertSource(source, dir), options);
      assert.deepEqual(await fs.readFile(records), published); assert.deepEqual(await store.readSnapshot(), portfolio);
    }, kind, true);
  });

  test(`published ${kind} source rejects an independently valid truncated prefix without repairing it`, async (context) => {
    await fixture(context, async ({ request, records }) => {
      const original = fs.open; let opens = 0, published!: Buffer, damaged!: Buffer, called = false;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] === records && args[1] === "r+" && ++opens === 2) {
          published = await fs.readFile(records);
          damaged = Buffer.from(`${published.toString("utf8").trim().split("\n").at(-1)}\n`);
          await fs.writeFile(records, damaged);
        }
        return original(...args);
      });
      syncBuiltinESMExports();
      try { await assert.rejects(consume(request, async () => { called = true; }, options), /owned append generation/); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(called, false); assert.deepEqual(await fs.readFile(records), damaged);
      // Explicit fixture recovery only; production never repairs an unexpected generation.
      await fs.writeFile(records, published); await consume(request, async () => {}, options);
      assert.deepEqual(await fs.readFile(records), published);
    }, kind, true);
  });

  test(`published ${kind} current scope uses the later post-publication source observation clock`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      let history!: History, publication!: Publication;
      try {
        await withPostReadSync(context, records, async () => { context.mock.timers.setTime(START + 102); }, async () => {
          await assert.rejects(consume(request, async (value, source) => {
            history = source; publication = value; assert.equal(observation(source).observedAt, at(102));
            const paths = { baseDir: dir, portfolioPath: request.portfolioPath }; assertHeld(value, paths);
            context.mock.timers.setTime(START + 101); assert.throws(() => assertHeld(value, paths), /clock moved backwards/);
          }, options), /clock moved backwards/);
        });
      } finally { context.mock.timers.setTime(START + 102); }
      assert.throws(() => assertSource(history, dir), /lease/);
      assert.throws(() => assertHeld(publication, { baseDir: dir, portfolioPath: request.portfolioPath }), /active publication scope/);
      await consume(request, async (_value, source) => assertSource(source, dir), options);
    }, kind, true);
  });
}
