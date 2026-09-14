import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { BucketOpeningCapacityStateFileRepository, createBucketOpeningCapacityStatePaths } from "./bucketOpeningCapacityStateFiles.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { snapshot, START, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { resolveStoredBucketOpeningCapacityStates } from "./storedBucketOpeningCapacityStates.js";

test("opening capacity file persists all buckets and replays their sources after restart", async (context) => {
  await fixture(context, async (dir) => {
    const source = await storeSource(dir), repository = new BucketOpeningCapacityStateFileRepository(dir);
    assert.equal(await repository.readVerifiedSnapshot(), null);
    const request = { portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null };
    const result = await repository.refresh(request), { documentHash, ...payload } = result;
    assert.equal(documentHash, hashCanonicalPayload(payload));
    assert.equal(result.projections.length, 1); assert.equal(result.projections[0]!.states.length, 5);
    assert.deepEqual(result.projections[0], (await resolveStoredBucketOpeningCapacityStates({ baseDir: dir,
      portfolioSnapshotId: source.portfolioSnapshotId })).projection);
    const bytes = await fs.readFile(createBucketOpeningCapacityStatePaths(dir).statePath);
    assert.equal(bytes.toString(), `${JSON.stringify(result)}\n`);
    context.mock.timers.setTime(START + 2000);
    const restarted = new BucketOpeningCapacityStateFileRepository(dir);
    assert.deepEqual(await restarted.readVerifiedSnapshot(), result);
    assert.deepEqual(await restarted.refresh(request), result);
    assert.deepEqual(await fs.readFile(createBucketOpeningCapacityStatePaths(dir).statePath), bytes);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.projections));
    assert.ok(result.projections.every((item) => Object.isFrozen(item) && Object.isFrozen(item.states) && item.states.every(Object.isFrozen)));
    await assert.rejects(fs.readFile(createBucketOpeningCapacityStatePaths(dir).lockPath), { code: "ENOENT" });
  });
});

test("opening capacity document CAS rejects stale writers and time regression while exact retries converge", async (context) => {
  await fixture(context, async (dir) => {
    const sources = [];
    for (const cutoff of [100, 200, 300]) sources.push(await storeSource(dir, "paper-portfolio", cutoff));
    const repository = new BucketOpeningCapacityStateFileRepository(dir);
    const first = await repository.refresh({ portfolioSnapshotId: sources[0]!.portfolioSnapshotId, expectedDocumentHash: null });
    const second = await repository.refresh({ portfolioSnapshotId: sources[1]!.portfolioSnapshotId, expectedDocumentHash: first.documentHash });
    await assert.rejects(repository.refresh({ portfolioSnapshotId: sources[2]!.portfolioSnapshotId, expectedDocumentHash: first.documentHash }), /CAS mismatch/);
    await assert.rejects(repository.refresh({ portfolioSnapshotId: sources[0]!.portfolioSnapshotId, expectedDocumentHash: second.documentHash }), /must advance/);
    const sameTime = await storeSource(dir, "paper-portfolio", 200, "ambiguous");
    await assert.rejects(repository.refresh({ portfolioSnapshotId: sameTime.portfolioSnapshotId, expectedDocumentHash: second.documentHash }), /same-time/);
    assert.deepEqual(await repository.refresh({ portfolioSnapshotId: sources[1]!.portfolioSnapshotId, expectedDocumentHash: first.documentHash }), second);
    assert.deepEqual(await repository.readVerifiedSnapshot(), second);
  });
});

test("opening capacity document preserves other portfolios and rejects duplicate or reordered scope", async (context) => {
  await fixture(context, async (dir) => {
    const z = await storeSource(dir, "paper-z"), a = await storeSource(dir, "paper-a");
    const repository = new BucketOpeningCapacityStateFileRepository(dir);
    const one = await repository.refresh({ portfolioSnapshotId: z.portfolioSnapshotId, expectedDocumentHash: null });
    const two = await repository.refresh({ portfolioSnapshotId: a.portfolioSnapshotId, expectedDocumentHash: one.documentHash });
    assert.deepEqual(two.projections.map((item) => item.portfolioId), ["paper-a", "paper-z"]);
    assert.deepEqual(two.projections[1], one.projections[0]);
    const path = createBucketOpeningCapacityStatePaths(dir).statePath;
    for (const projections of [[...two.projections].reverse(), [two.projections[0], two.projections[0]]]) {
      const payload = { schemaVersion: two.schemaVersion, projections };
      const corrupt = `${JSON.stringify({ ...payload, documentHash: hashCanonicalPayload(payload) })}\n`;
      await fs.writeFile(path, corrupt);
      await assert.rejects(repository.readVerifiedSnapshot(), /canonical source replay|repeats a portfolio/);
      assert.equal(await fs.readFile(path, "utf8"), corrupt);
    }
  });
});

test("opening capacity file fails closed on forged rehashed state and missing or corrupt actual sources", async (context) => {
  await fixture(context, async (dir) => {
    const source = await storeSource(dir), repository = new BucketOpeningCapacityStateFileRepository(dir);
    const request = { portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null };
    const original = await repository.refresh(request), path = createBucketOpeningCapacityStatePaths(dir).statePath;
    const originalBytes = await fs.readFile(path);
    const forged = JSON.parse(JSON.stringify(original));
    const state = forged.projections[0].states[0]; state.availableSlots += 1;
    const { capacityStateHash: _stateHash, ...statePayload } = state;
    state.capacityStateHash = hashCanonicalPayload(statePayload);
    const { projectionHash: _projectionHash, ...projectionPayload } = forged.projections[0];
    forged.projections[0].projectionHash = hashCanonicalPayload(projectionPayload);
    const { documentHash: _documentHash, ...documentPayload } = forged;
    forged.documentHash = hashCanonicalPayload(documentPayload);
    const corrupt = `${JSON.stringify(forged)}\n`;
    await fs.writeFile(path, corrupt);
    await assert.rejects(repository.readVerifiedSnapshot(), /differs from stored source replay/);
    await assert.rejects(repository.refresh({ ...request, expectedDocumentHash: forged.documentHash }), /differs from stored source replay/);
    assert.equal(await fs.readFile(path, "utf8"), corrupt);
    await fs.writeFile(path, originalBytes);
    const sourcePath = createPortfolioSizingSnapshotPaths(dir).recordsPath, sourceBytes = await fs.readFile(sourcePath);
    for (const broken of [sourceBytes.subarray(0, -1), Buffer.from("")]) {
      await fs.writeFile(sourcePath, broken);
      await assert.rejects(repository.readVerifiedSnapshot());
      await assert.rejects(repository.refresh(request));
      assert.deepEqual(await fs.readFile(path), originalBytes);
      assert.deepEqual(await fs.readFile(sourcePath), broken);
    }
  });
});

test("opening capacity file rejects torn invalid UTF-8 duplicate keys and unknown document fields without repair", async (context) => {
  await fixture(context, async (dir) => {
    const source = await storeSource(dir), repository = new BucketOpeningCapacityStateFileRepository(dir);
    const result = await repository.refresh({ portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null });
    const path = createBucketOpeningCapacityStatePaths(dir).statePath, raw = `${JSON.stringify(result)}\n`;
    for (const corrupt of [Buffer.from(raw.slice(0, -1)), Buffer.from([0xff, 10]), Buffer.from("{}\n"),
      Buffer.from(raw.replace('"schemaVersion":', '"schemaVersion":"ignored","schemaVersion":')),
      Buffer.from(`${JSON.stringify({ ...result, trusted: true })}\n`), Buffer.from(raw.replace(result.documentHash, `sha256:${"0".repeat(64)}`))]) {
      await fs.writeFile(path, corrupt);
      await assert.rejects(repository.readVerifiedSnapshot());
      await assert.rejects(repository.refresh({ portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null }));
      assert.deepEqual(await fs.readFile(path), corrupt);
    }
  });
});

test("opening capacity file rejects reordered nested projection and state keys without rewriting bytes", async (context) => {
  await fixture(context, async (dir) => {
    const source = await storeSource(dir), repository = new BucketOpeningCapacityStateFileRepository(dir);
    const request = { portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null };
    const stored = await repository.refresh(request), path = createBucketOpeningCapacityStatePaths(dir).statePath;
    for (const level of ["projection", "state"]) {
      const value = JSON.parse(JSON.stringify(stored));
      if (level === "projection") value.projections[0] = Object.fromEntries(Object.entries(value.projections[0]).reverse());
      else value.projections[0].states[0] = Object.fromEntries(Object.entries(value.projections[0].states[0]).reverse());
      const corrupt = `${JSON.stringify(value)}\n`;
      await fs.writeFile(path, corrupt);
      await assert.rejects(repository.readVerifiedSnapshot(), /noncanonical/);
      await assert.rejects(repository.refresh(request), /noncanonical/);
      assert.equal(await fs.readFile(path, "utf8"), corrupt);
    }
  });
});

test("opening capacity refresh captures its request and options before waiting and rejects caller states", async (context) => {
  await fixture(context, async (dir) => {
    const source = await storeSource(dir), options = { lockTimeoutMs: 5000 };
    const repository = new BucketOpeningCapacityStateFileRepository(dir, options); options.lockTimeoutMs = 0;
    const input = { portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null };
    const pending = repository.refresh(input); input.portfolioSnapshotId = "missing";
    assert.equal((await pending).projections[0]!.portfolioSnapshotId, source.portfolioSnapshotId);
    await assert.rejects(repository.refresh({ portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null, states: [] } as never));
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => new BucketOpeningCapacityStateFileRepository(dir, { lockTimeoutMs: value }));
      assert.throws(() => new BucketOpeningCapacityStateFileRepository(dir, { lockRetryDelayMs: value }));
    }
  });
});

test("opening capacity file serializes real process retries and competing document CAS writes", async (context) => {
  await fixture(context, async (dir) => {
    const first = await storeSource(dir), next = await storeSource(dir, "paper-portfolio", 200), other = await storeSource(dir, "paper-portfolio", 300);
    const retries = await Promise.all(Array.from({ length: 3 }, () => childRefresh(dir, first.portfolioSnapshotId, null)));
    assert.ok(retries.every((item) => item.code === 0), JSON.stringify(retries));
    assert.equal(new Set(retries.map((item) => item.output)).size, 1);
    const hash = retries[0]!.output.trim();
    const competing = await Promise.all([next, other].map((source) => childRefresh(dir, source.portfolioSnapshotId, hash)));
    assert.equal(competing.filter((item) => item.code === 0).length, 1, JSON.stringify(competing));
    assert.match(competing.find((item) => item.code !== 0)!.output, /CAS mismatch/);
    const stored = await new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot();
    assert.equal(stored!.documentHash, competing.find((item) => item.code === 0)!.output.trim());
    assert.equal(stored!.projections[0]!.states.length, 5);
  });
});

test("opening capacity atomic replacement preserves prior bytes on write sync and rename failures", async (context) => {
  await fixture(context, async (dir) => {
    const first = await storeSource(dir), next = await storeSource(dir, "paper-portfolio", 200);
    const repository = new BucketOpeningCapacityStateFileRepository(dir), path = createBucketOpeningCapacityStatePaths(dir).statePath;
    const old = await repository.refresh({ portfolioSnapshotId: first.portfolioSnapshotId, expectedDocumentHash: null });
    const bytes = await fs.readFile(path);
    for (const phase of ["write", "sync", "rename"] as const) {
      const denied = failure("EIO"), originalOpen = fs.open, originalRename = fs.rename;
      const mock = phase === "rename" ? context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
        if (args[1] === path) throw denied; return originalRename(...args);
      }) : context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (String(args[0]).startsWith(`${path}.tmp-`)) context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => { throw denied; });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(repository.refresh({ portfolioSnapshotId: next.portfolioSnapshotId, expectedDocumentHash: old.documentHash }), (error) => error === denied); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.deepEqual(await fs.readFile(path), bytes);
      assert.equal((await fs.readdir(dir)).filter((item) => item.includes(".tmp-")).length, 0);
    }
    await repository.refresh({ portfolioSnapshotId: next.portfolioSnapshotId, expectedDocumentHash: old.documentHash });
    assert.notDeepEqual(await fs.readFile(path), bytes);
  });
});

test("opening capacity replacement uncertain directory sync converges through an exact retry", async (context) => {
  await fixture(context, async (dir) => {
    const source = await storeSource(dir), repository = new BucketOpeningCapacityStateFileRepository(dir);
    const request = { portfolioSnapshotId: source.portfolioSnapshotId, expectedDocumentHash: null };
    const originalRename = fs.rename, originalOpen = fs.open, path = createBucketOpeningCapacityStatePaths(dir).statePath;
    let renamed = false, injected = false;
    const denied = failure("EIO");
    const renameMock = context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      await originalRename(...args); if (args[1] === path) renamed = true;
    });
    const openMock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === dir && renamed && !injected) { injected = true; throw denied; }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repository.refresh(request), (error) => error === denied); }
    finally { renameMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
    const bytes = await fs.readFile(path), retried = await new BucketOpeningCapacityStateFileRepository(dir).refresh(request);
    assert.equal(bytes.toString(), `${JSON.stringify(retried)}\n`);
    assert.deepEqual(await fs.readFile(path), bytes);
  });
});

async function fixture(context: TestContext, run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "toss-opening-capacity-state-"));
  context.mock.timers.enable({ apis: ["Date"], now: START + 1000 });
  try { await run(dir); } finally { context.mock.timers.reset(); await fs.rm(dir, { recursive: true, force: true }); }
}
async function storeSource(dir: string, portfolioId = "paper-portfolio", cutoff = 100, version = "snapshot") {
  const fixture = policyFixture();
  const { runtimePolicyRecordId: _id, policyHash: _hash, lineageHash: _lineage, createdAt, ...base } = fixture.policy;
  const payload = { ...base, portfolioId, strategyBuckets: base.strategyBuckets.map((item) => ({ ...item,
    openingCapacityPolicy: { modelVersion: "bucket_opening_capacity_policy.v1" as const, maximumPositionCount: 4 } })) };
  const policyHash = hashCanonicalPayload(payload), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  if ((await fs.readdir(dir)).length === 0) await storePolicyFixture(dir, { ...fixture, policy });
  else {
    const policies = new RuntimePortfolioPolicyFileRepository(dir, fixture.dependencies);
    const all = await policies.readAll();
    if (!all.some((item) => item.policyHash === policy.policyHash)) {
      await policies.append(policy);
      await new RuntimePortfolioPolicyActivationFileRepository(dir, [...all, policy], fixture.dependencies)
        .appendActivated({ policy, createdAt });
    }
  }
  const original = snapshot(policyHash), { portfolioSnapshotId: _snapshotId, portfolioSnapshotHash: _snapshotHash, ...source } = original;
  return new PortfolioSizingSnapshotFileRepository(dir).append(createPortfolioSizingSnapshot({ ...source, portfolioId,
    portfolioVersion: version, asOf: at(cutoff), virtualPortfolio: { ...source.virtualPortfolio, portfolioId, updatedAt: at(cutoff) } }));
}
function failure(code: string) { return Object.assign(new Error(`injected ${code}`), { code }); }
function childRefresh(dir: string, snapshotId: string, hash: string | null): Promise<{ code: number | null; output: string }> {
  const moduleUrl = new URL("./bucketOpeningCapacityStateFiles.js", import.meta.url).href;
  const code = `import { BucketOpeningCapacityStateFileRepository as Repository } from ${JSON.stringify(moduleUrl)};
    try { const result = await new Repository(process.argv[1], { lockTimeoutMs: 60000 }).refresh({
      portfolioSnapshotId: process.argv[2], expectedDocumentHash: JSON.parse(process.argv[3]) }); console.log(result.documentHash); }
    catch (error) { console.error(error.message); process.exitCode = 1; }`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, dir, snapshotId, JSON.stringify(hash)], { windowsHide: true });
    let output = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
    child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => { clearTimeout(timer); if (timedOut) reject(new Error("capacity child timed out")); else resolve({ code: exitCode, output }); });
  });
}
