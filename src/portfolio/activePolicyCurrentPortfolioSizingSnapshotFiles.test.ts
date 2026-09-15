import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { createRuntimePortfolioPolicyPaths, RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";

const START = "2026-09-01T00:00:00.000Z";
const CUTOFF = "2026-09-02T00:00:00.000Z";
const RETIRE = "2026-09-03T00:00:00.000Z";
const options = { lockTimeoutMs: 60, lockRetryDelayMs: 5 };

async function fixture(context: TestContext, run: (value: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "paper-active-current-sizing-"));
  context.after(() => fs.rm(baseDir, { recursive: true, force: true }));
  await run(await setup(baseDir));
}

async function setup(baseDir: string) {
  const policy = policyFixture(), path = join(baseDir, "portfolio.json");
  const store = new FileVirtualPortfolioStore(path, options);
  await store.write({ portfolioId: policy.policy.portfolioId, cashKrw: 100, positions: [], updatedAt: START });
  await storePolicyFixture(baseDir, policy);
  const activations = new RuntimePortfolioPolicyActivationFileRepository(baseDir, [policy.policy], policy.dependencies, options);
  const request = { baseDir, portfolioPath: path, policyHash: policy.policy.policyHash, asOf: CUTOFF,
    valuationInputs: [], pendingActionInputs: [], ...createPortfolioExposureSnapshot({
      virtualNetWorthKrw: 100, cashKrw: 100,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) };
  const retirement = { portfolioId: policy.policy.portfolioId, retiredActivationId: policy.activation.activationId,
    reasonCode: "synthetic-test-retirement", createdAt: RETIRE };
  return { baseDir, path, store, policy, activations, request, retirement,
    records: createPortfolioSizingSnapshotPaths(baseDir).recordsPath,
    events: createRuntimePortfolioPolicyActivationPaths(baseDir).eventsPath };
}

test("active-policy current sizing binds disk policy and portfolio revision without changing sources", async (context) => {
  await fixture(context, async ({ baseDir, path, store, request, events }) => {
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`), history = await fs.readFile(events);
    const observed = await store.readSnapshot(), snapshot = await publish(request, options);
    assert.equal(snapshot.policyHash, request.policyHash); assert.equal(snapshot.portfolioVersion, observed.revisionHash);
    assert.deepEqual(snapshot.virtualPortfolio, observed.portfolio);
    assert.deepEqual(await publish(request, options), snapshot);
    assert.deepEqual(await new PortfolioSizingSnapshotFileRepository(baseDir).readAll(), [snapshot]);
    assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.deepEqual(await fs.readFile(events), history);
  });
});

test("active-policy current sizing rejects wrong policy, portfolio and evaluation intervals before append", async (context) => {
  await fixture(context, async ({ path, store, request, records, activations, retirement, policy }) => {
    await assert.rejects(publish({ ...request, policyHash: `sha256:${"e".repeat(64)}` }, options), /active policy mismatch/);
    await assert.rejects(publish({ ...request, asOf: "9999-01-01T00:00:00.000Z" }, options), /outside/);
    await store.write({ portfolioId: "other-paper", cashKrw: 100, positions: [], updatedAt: START });
    await assert.rejects(publish(request, options));
    await store.write({ portfolioId: policy.policy.portfolioId, cashKrw: 100, positions: [], updatedAt: START });
    await activations.appendRetired(retirement);
    await activations.appendActivated({ policy: policy.policy, createdAt: "2026-09-04T00:00:00.000Z" });
    // Same policy hash, but the old cutoff is outside this activation epoch.
    await assert.rejects(publish(request, options), /outside/);
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
    assert.ok(await fs.readFile(path));
  });
});

test("active-policy current sizing refuses retired and replaced policy even on exact retry", async (context) => {
  await fixture(context, async ({ baseDir, request, records, activations, retirement, policy }) => {
    const snapshot = await publish(request, options), before = await fs.readFile(records);
    await activations.appendRetired(retirement);
    await assert.rejects(publish(request, options));
    const replacement = policyFixture("v2");
    await new RuntimePortfolioPolicyFileRepository(baseDir, replacement.dependencies).append(replacement.policy);
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [policy.policy, replacement.policy], replacement.dependencies)
      .appendActivated({ policy: replacement.policy, createdAt: "2026-09-04T00:00:00.000Z" });
    await assert.rejects(publish(request, options), /active policy mismatch/);
    assert.deepEqual(await fs.readFile(records), before);
    assert.deepEqual(await new PortfolioSizingSnapshotFileRepository(baseDir).readAll(), [snapshot]);
    const newer = await publish({ ...request, policyHash: replacement.policy.policyHash, asOf: "2026-09-05T00:00:00.000Z" }, options);
    assert.equal(newer.policyHash, replacement.policy.policyHash);
  });
});

test("active-policy current sizing requires actual complete activation and dependency files", async (context) => {
  await fixture(context, async ({ request, events, records, baseDir }) => {
    const original = await fs.readFile(events);
    await fs.unlink(events);
    await assert.rejects(publish(request, options));
    await fs.writeFile(events, Buffer.concat([original, Buffer.from("{")]));
    await assert.rejects(publish(request, options), /torn/);
    await fs.writeFile(events, original);
    const { createImmutablePolicyDependencyPaths } = await import("./runtimePolicyDependencyFiles.js");
    const dependencies = createImmutablePolicyDependencyPaths(baseDir);
    await fs.appendFile(dependencies.riskParameters, "{");
    await assert.rejects(publish(request, options));
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
  });
});

test("active-policy current sizing holds portfolio and activation locks through destination fsync and retry", async (context) => {
  await fixture(context, async ({ request, records, activations, retirement, store }) => {
    const original = fs.open; let checked = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === records && (args[1] === "a" || args[1] === "r+")) {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await assert.rejects(activations.appendRetired(retirement), /lock/);
          await assert.rejects(store.read(), /lock/);
          checked++; await sync();
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await publish(request, options); await publish(request, options); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(checked, 2);
    await activations.appendRetired(retirement); assert.ok(await store.read());
    await assert.rejects(publish(request, options));
  });
});

test("active-policy current sizing preserves partial destination and releases source locks on I/O failure", async (context) => {
  await fixture(context, async ({ request, records, activations, retirement, path, store }) => {
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`);
    const original = fs.open, failure = new Error("synthetic partial append");
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === records && args[1] === "a") {
        const write = handle.writeFile.bind(handle);
        context.mock.method(handle, "writeFile", async () => { await write("{"); throw failure; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(publish(request, options), (error) => error === failure); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    await assert.rejects(publish(request, options), /torn/);
    assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.equal(await fs.readFile(records, "utf8"), "{"); assert.ok(await store.read());
    await activations.appendRetired(retirement);
  });
});

test("active-policy current sizing observes retirement occurring while acquiring the sizing lock", async (context) => {
  await fixture(context, async ({ baseDir, request, records, activations, retirement }) => {
    const lock = createPortfolioSizingSnapshotPaths(baseDir).lockPath, original = fs.open;
    let retired = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lock && args[1] === "wx" && !retired) {
        retired = true; await activations.appendRetired(retirement);
      }
      return original(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(publish(request, options)); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(retired, true);
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
  });
});

test("active-policy current sizing rejects a policy writer's partial append during the sizing lock wait", async (context) => {
  await fixture(context, async ({ baseDir, request, records, store, policy }) => {
    const lock = createPortfolioSizingSnapshotPaths(baseDir).lockPath, original = fs.open;
    const policyPath = createRuntimePortfolioPolicyPaths(baseDir).recordsPath;
    const failure = new Error("synthetic policy writer failure"); let attempted = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lock && args[1] === "wx" && !attempted) {
        attempted = true;
        await assert.rejects(new RuntimePortfolioPolicyFileRepository(baseDir, policy.dependencies)
          .append(policyFixture("v2").policy), (error) => error === failure);
      }
      const handle = await original(...args);
      if (args[0] === policyPath && args[1] === "a") {
        const write = handle.writeFile.bind(handle);
        context.mock.method(handle, "writeFile", async () => { await write("{"); throw failure; });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(publish(request, options), /torn/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempted, true);
    await assert.rejects(fs.readFile(records), { code: "ENOENT" });
    await assert.rejects(new RuntimePortfolioPolicyFileRepository(baseDir, policy.dependencies).readAll(), /torn/);
    assert.ok(await store.read());
  });
});

test("active-policy current sizing captures inputs and propagates exact-retry sync failures", async (context) => {
  await fixture(context, async ({ request, store, records, activations, retirement }) => {
    let pending!: ReturnType<typeof publish>;
    await store.withLockedSnapshot(async () => {
      pending = publish(request); request.policyHash = `sha256:${"e".repeat(64)}`;
    });
    const snapshot = await pending, before = await fs.readFile(records);
    const original = fs.open, failure = new Error("synthetic retry sync failure");
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === records && args[1] === "r+") context.mock.method(handle, "sync", async () => { throw failure; });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(publish({ ...request, policyHash: snapshot.policyHash }, options), (error) => error === failure); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readFile(records), before); assert.ok(await store.read());
    await activations.appendRetired(retirement);
  });
});
