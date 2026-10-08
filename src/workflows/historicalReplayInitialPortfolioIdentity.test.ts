import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { replayInitialPortfolioIdentitySchema } from "../domain/replayInitialPortfolioObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { createStoragePaths } from "../storage/repositories.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { initialOptions, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";

for (const identity of [
  { runId: "child_raw", batchId: "  terminal completed: / 한  " },
  { runId: "-child", batchId: "../synthetic:../outside" },
  { runId: "_stored_child", batchId: "batch.with.punctuation" },
  { runId: "ord_abcdef_run_000001", batchId: "ord_abcdef" },
  { runId: "exec_abcdef_run_000001", batchId: "exec_abcdef" },
  { runId: "a".repeat(220) + "_run_000001_2026-01", batchId: "a".repeat(220) },
  { runId: "child_unicode", batchId: "한".repeat(4096) }
]) {
  test(`child initial observation preserves opaque batch identity for ${identity.runId.slice(0, 24)}`, async t => {
    const root = await mkdtemp(join(tmpdir(), "child-identity-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const result = await runHistoricalReplayWorkflow({ ...initialOptions(root), ...identity });
    assert.equal(result.status, "completed");
    const expected = { ...identity, batchId: identity.batchId.trim(), runIndex: 1 };
    const observation = JSON.parse(await readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    const reservation = JSON.parse(await readFile(join(root, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), "utf8"));
    const metadata = JSON.parse(await readFile(createStoragePaths(root).historicalReplayRunMetadataPath, "utf8"));
    assert.deepEqual(observation.identity, expected);
    assert.deepEqual(reservation.identity, expected);
    assert.deepEqual(metadata.identity, expected);
    assert.equal(observation.reservationHash, createReplayResearchHash(reservation));
    assert.deepEqual(observation.initialPortfolio.snapshot, result.replayResult.initialPortfolio);
    assert.equal((await readdir(root)).some(name => name.includes(identity.batchId)), false);
  });
}

test("initial observation identity bounds preserve stored child grammar without coercion", () => {
  const identity = { runId: "a".repeat(256), batchId: "한 / raw", runIndex: 0 };
  assert.deepEqual(replayInitialPortfolioIdentitySchema.parse(identity), identity);
  for (const runId of ["", ".", "..", "a/b", "a\\b", "a\n", "a".repeat(257)]) {
    assert.equal(replayInitialPortfolioIdentitySchema.safeParse({ ...identity, runId }).success, false, runId);
  }
  for (const batchId of ["", " ", " padded ", "a".repeat(4097)]) {
    assert.equal(replayInitialPortfolioIdentitySchema.safeParse({ ...identity, batchId }).success, false);
  }
  assert.equal(replayInitialPortfolioIdentitySchema.safeParse({ ...identity, extra: true }).success, false);
});

test("opaque batch identity still rejects masking before any initial output or provider", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-identity-redacted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const before = await readdir(root);
  let calls = 0;
  await assert.rejects(runHistoricalReplayWorkflow({ ...initialOptions(root), batchId: "batch account:123456-123-123456",
    decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } }
  }), /observation reservation failed/);
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(root), before);
});

for (const field of ["runId", "batchId"] as const) for (const secret of ["123456-123-123456", "a".repeat(16) + "." + "b".repeat(8) + "." + "c".repeat(8)]) {
  test(`replay ${field} still rejects ${secret.includes(".") ? "token" : "account"} patterns before output`, async t => {
    const root = await mkdtemp(join(tmpdir(), "child-identity-sensitive-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const before = await readdir(root);
    let calls = 0;
    await assert.rejects(runHistoricalReplayWorkflow({ ...initialOptions(root), [field]: secret,
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } }
    }), /observation reservation failed/);
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(root), before);
  });
}
