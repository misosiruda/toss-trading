import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { resolvePaperSimulationConfig } from "../api/paperSimulationConfig.js";
import { simulationConfig } from "../api/paperSimulationTestFixtures.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { withPaperExecutionLogBatch } from "./paperExecutionLogLocks.js";
import { paperSimulationInputPath, persistPaperSimulationInput, readPaperSimulationInput } from "./paperSimulationInputStore.js";
import { acceptPaperSimulation, acceptPaperSimulationWithAdmissionContext, paperSimulationObservationPath,
  resolvePaperSimulationAdmissionContext } from "./paperSimulationObservationStore.js";
import { paperSimulationRequestPath } from "./paperSimulationRequestStore.js";

const id = "paper_sim_20261007090000000_context";
const acceptedAt = "2026-10-07T09:00:00.000Z";
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "admission-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const snapshot = resolvePaperSimulationConfig(simulationConfig(), { PAPER_SIMULATION_TICK_DELAY_MS: "17" });
  return { storage: join(root, "paper"), snapshot };
}

test("only an actual accepted identity resolves to the exact frozen persisted snapshot and whole-record hashes", async t => {
  const { storage, snapshot } = await fixture(t);
  const context = await acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt,
    { requestedConfig: snapshot.requestedConfig, inputSnapshot: snapshot });
  const evidence = resolvePaperSimulationAdmissionContext(context);
  assert.equal(evidence.status, "available");
  if (evidence.status !== "available") return;
  const canonical = JSON.parse(await fs.readFile(paperSimulationRequestPath(storage, id), "utf8"));
  const input = JSON.parse(await fs.readFile(paperSimulationInputPath(storage, id), "utf8"));
  const accepted = JSON.parse((await fs.readFile(paperSimulationObservationPath(storage, id), "utf8")).trim());
  assert.deepEqual(evidence.snapshot, input.snapshot);
  assert.deepEqual(evidence.receipt, { receiptVersion: "paper_simulation_admission_receipt.v1",
    simulationRunId: id, batchId: id, acceptedAt, canonicalVersion: canonical.schemaVersion,
    canonicalRequestHash: createReplayResearchHash(canonical), inputVersion: input.schemaVersion,
    inputProvenanceHash: createReplayResearchHash(input) });
  assert.equal(accepted.canonicalRequestHash, evidence.receipt.canonicalRequestHash);
  assert.equal(accepted.inputProvenanceHash, evidence.receipt.inputProvenanceHash);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.getPrototypeOf(context), null);
  assert.equal(JSON.stringify(context), "{}");
  assert.equal(Object.isFrozen(evidence), true); assert.equal(Object.isFrozen(evidence.receipt), true);
  assert.equal(Object.isFrozen(evidence.snapshot.effectiveConfig.constraints.allowedActions), true);
  assert.throws(() => { evidence.snapshot.effectiveConfig.window.seed = "changed"; }, TypeError);
  snapshot.requestedConfig.window.seed = "changed";
  snapshot.effectiveConfig.constraints.allowedActions.reverse();
  snapshot.notices[0]!.message = "changed";
  assert.deepEqual(resolvePaperSimulationAdmissionContext(context), evidence);
  assert.deepEqual(evidence.snapshot, input.snapshot);
  // Later forensic unavailability cannot change this writer's accepted historical evidence.
  await fs.writeFile(paperSimulationInputPath(storage, id), "{}\n");
  assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable");
  assert.deepEqual(evidence.snapshot, input.snapshot);
});

test("plain, copied, inherited, proxy, revoked-proxy and accessor contexts reject without running untrusted code", async t => {
  const { storage, snapshot } = await fixture(t);
  const context = await acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt,
    { requestedConfig: snapshot.requestedConfig, inputSnapshot: snapshot });
  const evidence = resolvePaperSimulationAdmissionContext(context);
  let executions = 0;
  const trap = () => { executions++; throw new Error("untrusted accessor executed"); };
  const forged = Object.defineProperties({}, {
    status: { get: trap }, receipt: { get: trap }, snapshot: { get: trap }, toJSON: { get: trap }
  });
  const revocable = Proxy.revocable(context, {}); revocable.revoke();
  const wrappers = [new Proxy(context, {}), new Proxy(forged,
    { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, has: trap }), revocable.proxy];
  for (const value of [null, undefined, true, "context", {}, { ...context }, JSON.parse(JSON.stringify(context)),
    Object.create(context), evidence, evidence.status === "available" ? evidence.receipt : {}, forged, ...wrappers]) {
    assert.throws(() => resolvePaperSimulationAdmissionContext(value),
      { message: "paper simulation admission context is not issued" });
  }
  assert.equal(executions, 0);
  assert.equal(resolvePaperSimulationAdmissionContext(context), evidence);
});

test("mutating caller objects during input write cannot change the owned receipt snapshot", async t => {
  const { storage, snapshot } = await fixture(t), expected = structuredClone(snapshot);
  const originalOpen = fs.open;
  const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === paperSimulationInputPath(storage, id)) {
      snapshot.requestedConfig.window.seed = "later-seed";
      snapshot.effectiveConfig.capital.initialCashKrw = 123_456;
      snapshot.notices[0]!.message = "later-notice";
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try {
    const context = await acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt,
      { requestedConfig: snapshot.requestedConfig, inputSnapshot: snapshot });
    const evidence = resolvePaperSimulationAdmissionContext(context);
    assert.equal(evidence.status, "available");
    assert.deepEqual(evidence.status === "available" && evidence.snapshot, expected);
  } finally { open.mock.restore(); syncBuiltinESMExports(); }
});

test("legacy void and hash-only writers stay compatible and canonical-only issuance is input_missing", async t => {
  const a = await fixture(t), b = await fixture(t), c = await fixture(t);
  assert.equal(await acceptPaperSimulation(a.storage, id, acceptedAt, { requestedConfig: a.snapshot.requestedConfig }), undefined);
  const hash = await persistPaperSimulationInput(a.storage, id, acceptedAt,
    createReplayResearchHash(JSON.parse(await fs.readFile(paperSimulationRequestPath(a.storage, id), "utf8"))), a.snapshot);
  assert.equal(hash, createReplayResearchHash(JSON.parse(await fs.readFile(paperSimulationInputPath(a.storage, id), "utf8"))));
  for (const [storage, input] of [[b.storage, undefined], [c.storage, { requestedConfig: c.snapshot.requestedConfig }]] as const) {
    const context = await acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt, input);
    assert.deepEqual(resolvePaperSimulationAdmissionContext(context),
      { status: "unavailable", reason: "input_missing" });
  }
});

for (const secret of ["abcdefghijklmnop.abcdefgh.ijklmnop", "password=seed", "api_key%3DSYNTHETIC", "https://user:pass@example.invalid"]) {
  test("redacted writer state never retains a snapshot or receipt: " + secret.split(/[=.:%]/)[0], async t => {
    const { storage } = await fixture(t), config = simulationConfig();
    config.decisionProvider.modelId = secret;
    const snapshot = resolvePaperSimulationConfig(config, {});
    const context = await acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt,
      { requestedConfig: config, inputSnapshot: snapshot });
    const evidence = resolvePaperSimulationAdmissionContext(context);
    assert.deepEqual(evidence, { status: "unavailable", reason: "redacted" });
    assert.equal(JSON.stringify(evidence).includes(secret), false);
    assert.equal(JSON.stringify(evidence).includes("sha256:"), false);
    assert.equal(Object.isFrozen(evidence), true);
  });
}

test("an inherited append batch cannot issue context before the outer lock releases", async t => {
  const { storage } = await fixture(t);
  await withPaperExecutionLogBatch([join(storage, "outer.jsonl")], async () => {
    await assert.rejects(acceptPaperSimulationWithAdmissionContext(storage, id, acceptedAt),
      { message: "paper execution log batches must not be nested" });
  });
  await assert.rejects(fs.lstat(paperSimulationObservationPath(storage, id)), { code: "ENOENT" });
});
