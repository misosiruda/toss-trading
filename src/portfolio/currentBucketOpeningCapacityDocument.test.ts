import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { BucketOpeningCapacityStateFileRepository as Repository, createBucketOpeningCapacityStatePaths } from "./bucketOpeningCapacityStateFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { resolveStoredBucketOpeningCapacityStates } from "./storedBucketOpeningCapacityStates.js";
import { createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createRuntimePortfolioPolicyActivationPaths } from "./runtimePortfolioPolicyActivationFiles.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { START, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const stateOptions = { lockTimeoutMs: 10_000, lockRetryDelayMs: 3 };
function currentInput(request: Parameters<typeof import("./currentPortfolioSizingSnapshotFiles.js").withPublishedCurrentOpeningBudget>[0]) {
  const { baseDir: _baseDir, ...snapshotInput } = request;
  return { snapshotInput, expectedDocumentHash: null as string | null };
}

for (const kind of ["manual", "selector"] as const) {
  test(`current ${kind} capacity document matches historical replay and converges exact restart retries`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      const repository = new Repository(dir, stateOptions), input = currentInput(request), portfolio = await store.readSnapshot();
      const first = await repository.refreshFromCurrentPublication(input), projection = first.projections[0]!;
      assert.equal(projection.states.length, 5);
      assert.deepEqual(projection, (await resolveStoredBucketOpeningCapacityStates({ baseDir: dir, portfolioSnapshotId: projection.portfolioSnapshotId })).projection);
      const { documentHash, ...payload } = first; assert.equal(documentHash, hashCanonicalPayload(payload));
      const day = projection.states.find((item) => item.bucket === "intraday")!;
      assert.equal(day.availableSlots, 3); assert.equal(day.reservedOpeningNotionalKrw, 100); assert.equal(day.remainingOpeningBudgetKrw, 400);
      const path = createBucketOpeningCapacityStatePaths(dir).statePath, bytes = await fs.readFile(path), snapshots = await fs.readFile(records);
      const restarted = new Repository(dir, stateOptions);
      assert.deepEqual(await restarted.readVerifiedSnapshot(), first);
      assert.deepEqual(await restarted.refreshFromCurrentPublication(input), first);
      assert.deepEqual(await restarted.refresh({ portfolioSnapshotId: projection.portfolioSnapshotId, expectedDocumentHash: null }), first);
      assert.deepEqual(await fs.readFile(path), bytes); assert.deepEqual(await fs.readFile(records), snapshots);
      assert.deepEqual(await store.readSnapshot(), portfolio); assert.ok(Object.isFrozen(first));
    }, kind, true);
  });

  test(`current ${kind} capacity CAS failure preserves document but can leave its immutable snapshot`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      const repository = new Repository(dir, stateOptions), input = currentInput(request), first = await repository.refreshFromCurrentPublication(input);
      const path = createBucketOpeningCapacityStatePaths(dir).statePath, bytes = await fs.readFile(path), before = await fs.readFile(records);
      context.mock.timers.setTime(START + 110); input.snapshotInput.asOf = at(101);
      await assert.rejects(repository.refreshFromCurrentPublication(input), /CAS mismatch/);
      assert.deepEqual(await fs.readFile(path), bytes);
      const published = await fs.readFile(records); assert.notDeepEqual(published, before);
      assert.equal(published.toString("utf8").trim().split("\n").length, before.toString("utf8").trim().split("\n").length + 1);
      const second = await repository.refreshFromCurrentPublication({ ...input, expectedDocumentHash: first.documentHash });
      assert.notEqual(second.documentHash, first.documentHash); assert.deepEqual(await fs.readFile(records), published);
      await assert.rejects(repository.refreshFromCurrentPublication({ ...currentInput(request), expectedDocumentHash: second.documentHash }), /must advance/);
      assert.deepEqual(await repository.refreshFromCurrentPublication(input), second);
    }, kind, true);
  });

  test(`current ${kind} capacity rejects ambiguous same-cutoff portfolio ABA replacement`, async (context) => {
    await fixture(context, async ({ dir, request, store }) => {
      const repository = new Repository(dir, stateOptions), input = currentInput(request), first = await repository.refreshFromCurrentPublication(input);
      const portfolio = (await store.readSnapshot()).portfolio!;
      await store.write({ ...portfolio, cashKrw: 900 }); await store.write(portfolio);
      await assert.rejects(repository.refreshFromCurrentPublication({ ...input, expectedDocumentHash: first.documentHash }), /same-time/);
      assert.deepEqual(await repository.readVerifiedSnapshot(), first);
    }, kind, true);
  });

  test(`current ${kind} capacity serializes exact retries and competing whole-document CAS`, async (context) => {
    await fixture(context, async ({ dir, request }) => {
      const repository = new Repository(dir, { lockTimeoutMs: 30_000, lockRetryDelayMs: 3 }), input = currentInput(request);
      const [first, same] = await Promise.all([repository.refreshFromCurrentPublication(input), repository.refreshFromCurrentPublication(input)]);
      assert.deepEqual(first, same); context.mock.timers.setTime(START + 120);
      const results = await Promise.allSettled([101, 102].map((cutoff) => repository.refreshFromCurrentPublication({
        snapshotInput: { ...input.snapshotInput, asOf: at(cutoff) }, expectedDocumentHash: first.documentHash })));
      const winners = results.filter((item) => item.status === "fulfilled"), losers = results.filter((item) => item.status === "rejected");
      assert.equal(winners.length, 1); assert.equal(losers.length, 1); assert.match(String(losers[0]!.reason), /CAS mismatch/);
      assert.deepEqual(await repository.readVerifiedSnapshot(), winners[0]!.value);
    }, kind, true);
  });

  test(`current ${kind} capacity captures strict input before awaiting document lock`, async (context) => {
    await fixture(context, async ({ dir, request }) => {
      const repository = new Repository(dir, stateOptions), input = currentInput(request);
      await assert.rejects(repository.refreshFromCurrentPublication({ ...input, trusted: true } as never));
      await assert.rejects(repository.refreshFromCurrentPublication({ ...input, snapshotInput: { ...input.snapshotInput, baseDir: dir } } as never));
      const pending = repository.refreshFromCurrentPublication(input);
      input.snapshotInput.portfolioPath = "missing"; input.snapshotInput.asOf = "2020-01-01T00:00:00.000Z";
      assert.equal((await pending).projections[0]!.asOf, request.asOf);
    }, kind, true);
  });

  test(`current ${kind} capacity holds document portfolio and source locks through replacement and retry sync`, async (context) => {
    await fixture(context, async ({ dir, request, store }) => {
      const repository = new Repository(dir, stateOptions), path = createBucketOpeningCapacityStatePaths(dir).statePath;
      const original = fs.open; let checked = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if ((typeof args[0] === "string" && args[0].startsWith(`${path}.tmp-`)) || (args[0] === path && args[1] === "r+")) {
          const sync = handle.sync.bind(handle);
          context.mock.method(handle, "sync", async () => {
            for (const source of [createSourcePriceEvidencePaths(dir).lockPath, createRuntimePortfolioPolicyActivationPaths(dir).lockPath,
              createOpeningCapacityReservationEventPaths(dir).lockPath]) await assert.rejects(original(source, "wx"), { code: "EEXIST" });
            await assert.rejects(store.withLockedSnapshot(async () => {}), /lock|timeout/i);
            await assert.rejects(new Repository(dir, options).readVerifiedSnapshot(), /lock|timeout/i);
            checked++; await sync();
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await repository.refreshFromCurrentPublication(currentInput(request)); await repository.refreshFromCurrentPublication(currentInput(request)); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(checked, 2); await repository.readVerifiedSnapshot(); await store.readSnapshot();
    }, kind, true);
  });

  test(`current ${kind} capacity preserves old bytes on pre-rename sync failure and retries safely`, async (context) => {
    await fixture(context, async ({ dir, request }) => {
      const repository = new Repository(dir, stateOptions), input = currentInput(request), first = await repository.refreshFromCurrentPublication(input);
      const path = createBucketOpeningCapacityStatePaths(dir).statePath, bytes = await fs.readFile(path), original = fs.open;
      context.mock.timers.setTime(START + 110); input.snapshotInput.asOf = at(101); input.expectedDocumentHash = first.documentHash;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (typeof args[0] === "string" && args[0].startsWith(`${path}.tmp-`)) {
          context.mock.method(handle, "sync", async () => { throw new Error("synthetic capacity document sync failure"); });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(repository.refreshFromCurrentPublication(input), /synthetic capacity document sync failure/); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.deepEqual(await fs.readFile(path), bytes);
      assert.ok(!(await fs.readdir(dir)).some((name) => name.startsWith("bucket-opening-capacity-state.json.tmp-")));
      assert.notEqual((await repository.refreshFromCurrentPublication(input)).documentHash, first.documentHash);
    }, kind, true);
  });

  test(`current ${kind} capacity rejects damaged source and document without repairing bytes`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      const repository = new Repository(dir, stateOptions), input = currentInput(request), source = createOpeningCapacityReservationEventPaths(dir).eventsPath;
      const original = await fs.readFile(source), before = await fs.readFile(records), corrupt = original.subarray(0, -1);
      await fs.writeFile(source, corrupt); await assert.rejects(repository.refreshFromCurrentPublication(input), /torn final line/);
      assert.deepEqual(await fs.readFile(source), corrupt); assert.deepEqual(await fs.readFile(records), before);
      await fs.writeFile(source, original); await repository.refreshFromCurrentPublication(input);
      const path = createBucketOpeningCapacityStatePaths(dir).statePath, document = await fs.readFile(path), damaged = document.subarray(0, -1);
      await fs.writeFile(path, damaged); await assert.rejects(repository.refreshFromCurrentPublication(input), /torn final line/);
      assert.deepEqual(await fs.readFile(path), damaged);
    }, kind, true);
  });
}
