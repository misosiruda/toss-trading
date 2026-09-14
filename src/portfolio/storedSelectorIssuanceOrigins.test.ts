import assert from "node:assert/strict";
import fs, { readFile, unlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createSelectorOpeningCapacityReservationPaths, SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { resolveStoredSelectorOpeningCapacityMandateOrigins } from "./storedSelectorOpeningCapacityMandateOrigins.js";
import { resolveStoredSelectorOpeningCapacityFillOrigins } from "./storedSelectorOpeningCapacityFillOrigins.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { PORTFOLIO, START, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture } from "./storedSelectorOpeningCapacityTestFixtures.js";

test("stored selector issuance binds actual receipt to root and mandate across restart", async (context) => {
  await fixture(context, { count: 1 }, async (state) => {
    const origin = (await new SelectorOpeningCapacityReservationFileRepository(state.dir).readAll())[0]!;
    const result = await run(state.dir);
    assert.equal(result.assessment.verifiedSelectorRootCount, 1);
    assert.equal(result.assessment.issuanceGenerationHash, origin.commitHash);
    assert.deepEqual(result.bindings[0]!.reservationOrigin, origin);
    assert.equal(result.bindings[0]!.root.reservationId, origin.record.selectorCapacityReservationId);
    assert.equal(result.bindings[0]!.source.binding.mandate.openingCapacityReservationHash, origin.record.selectorCapacityReservationHash);
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    assert.equal(result.assessment.slotAndBudgetAllocationAuthority, "not_verified");
    assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
    assert.ok(Object.isFrozen(result.bindings[0]!.reservationOrigin));
    assert.deepEqual(await run(state.dir), result);
  });
});

test("stored selector issuance rejects absent damaged and pending origins in mandate and fill consumers", async (context) => {
  await fixture(context, { count: 1 }, async (state) => {
    const paths = createSelectorOpeningCapacityReservationPaths(state.dir), valid = await readFile(paths.recordsPath, "utf8");
    for (const invalid of ["", valid.trimEnd(), valid + "{broken}\n"]) {
      await writeFile(paths.recordsPath, invalid);
      await assert.rejects(run(state.dir));
      await assert.rejects(resolveStoredSelectorOpeningCapacityFillOrigins({ baseDir: state.dir, portfolioId: PORTFOLIO }));
      assert.equal(await readFile(paths.recordsPath, "utf8"), invalid);
    }
    await unlink(paths.recordsPath);
    await assert.rejects(run(state.dir), /issuance source is missing/);
    await writeFile(paths.recordsPath, valid);
    await writeFile(paths.pendingPath, "incomplete synthetic append\n");
    await assert.rejects(run(state.dir), /pending/);
    assert.equal(await readFile(paths.pendingPath, "utf8"), "incomplete synthetic append\n");
    await unlink(paths.pendingPath);
    assert.equal((await run(state.dir)).bindings.length, 1);
  });
});

test("stored selector issuance rejects equal or later commit time even with valid rehashed journal", async (context) => {
  await fixture(context, { count: 0 }, async (state) => {
    const path = createSelectorOpeningCapacityReservationPaths(state.dir).recordsPath, valid = await readFile(path, "utf8");
    const [entry, marker] = valid.trim().split("\n").map((line) => JSON.parse(line));
    for (const ms of [20, 21]) {
      const { commitHash: _hash, ...payload } = { ...marker, committedAt: at(ms) };
      const changed = `${JSON.stringify(entry)}\n${JSON.stringify({ ...payload, commitHash: hashCanonicalPayload(payload) })}\n`;
      await writeFile(path, changed);
      assert.equal((await new SelectorOpeningCapacityReservationFileRepository(state.dir).readAll()).length, 1);
      await assert.rejects(run(state.dir), /issuance source chronology mismatch/);
      assert.equal(await readFile(path, "utf8"), changed);
    }
    await writeFile(path, valid);
  });
});

test("stored selector issuance never promotes legacy roots without a persisted issuance", async (context) => {
  await fixture(context, { count: 0, storeSelectorIssuance: false }, async (state) => {
    await assert.rejects(run(state.dir), /issuance source is missing/);
    await assert.rejects(readFile(createSelectorOpeningCapacityReservationPaths(state.dir).recordsPath), { code: "ENOENT" });
  });
});

test("stored selector issuance fails before mandate binding on fsync failure or observation rollback", async (context) => {
  await fixture(context, { count: 0 }, async (state) => {
    const path = createSelectorOpeningCapacityReservationPaths(state.dir).recordsPath, original = fs.open;
    for (const mode of ["sync", "clock"]) {
      context.mock.timers.setTime(START + 200);
      const mocked = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (args[0] === path && args[1] === "r+") {
          if (mode === "sync") context.mock.method(handle, "sync", async () => { throw new Error("injected issuance sync failure"); });
          else context.mock.timers.setTime(START + 100);
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(run(state.dir), /injected issuance sync failure|clock moved backwards/); }
      finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    }
    context.mock.timers.setTime(START + 300);
    assert.equal((await run(state.dir)).bindings.length, 1);
  });
});

function run(baseDir: string) { return resolveStoredSelectorOpeningCapacityMandateOrigins({ baseDir, portfolioId: PORTFOLIO }); }
