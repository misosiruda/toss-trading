import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStaticDecisionIdentityMetadata } from "../paper/decisionIdentity.js";
import { preparePaperApplication, verifyPreparedPaperApplication, hashPreparedApplicationPayload,
  type PreparedPaperApplication, type PreparedPaperApplicationInput } from "../paper/preparedApplication.js";
import { FileVirtualPortfolioStore, VirtualPortfolioStateChangedError } from "./virtualPortfolioFileStore.js";
import { hashPortfolioRevisionPayload } from "./virtualPortfolioRevisionJournal.js";
import { preparedPaperApplicationPath, readPreparedPaperApplication, writePreparedPaperApplication } from "./preparedPaperApplicationFiles.js";

test("prepared paper application replays BUY SELL HOLD and risk rejection without external calls", () => {
  const input = sample(), buy = preparePaperApplication(input);
  assert.equal(buy.steps[0]!.trade!.action, "VIRTUAL_BUY"); assert.equal(buy.portfolio.cashKrw, 930_000);
  assert.deepEqual(verifyPreparedPaperApplication(JSON.parse(JSON.stringify(buy))), buy);
  assert.deepEqual(preparePaperApplication(input), buy);
  const sellInput = sample(); sellInput.packet.virtualPortfolio = buy.portfolio;
  sellInput.expectedSnapshot.portfolio = buy.portfolio;
  sellInput.providerDecision.packetHash = createMarketPacketHash(sellInput.packet);
  Object.assign(sellInput.providerDecision.decisions[0]!, { action: "VIRTUAL_SELL", budgetKrw: 0, sellAll: true, reduceOnly: true });
  const sell = preparePaperApplication(sellInput);
  assert.equal(sell.steps[0]!.trade!.action, "VIRTUAL_SELL"); assert.equal(sell.portfolio.positions.length, 0);
  assert.deepEqual(verifyPreparedPaperApplication(sell), sell);
  const holdInput = sample(); holdInput.providerDecision.decisions = [];
  const hold = preparePaperApplication(holdInput);
  assert.equal(hold.steps.length, 0); assert.equal(hold.auditEvents.length, 1);
  assert.deepEqual(hold.portfolio, holdInput.packet.virtualPortfolio);
  const rejectInput = sample(); rejectInput.evaluatedAt = "2026-06-12T00:00:00.000Z";
  const rejected = preparePaperApplication(rejectInput);
  assert.equal(rejected.steps[0]!.riskDecision.approved, false); assert.equal(rejected.steps[0]!.trade, null);
  assert.deepEqual(verifyPreparedPaperApplication(rejected), rejected);
});

test("prepared paper application rejects independently rehashed effect and lineage tampering", () => {
  const original = preparePaperApplication(sample());
  const changes: Array<(record: PreparedPaperApplication) => void> = [
    (record) => { record.portfolio.cashKrw++; },
    (record) => { record.steps[0]!.portfolio.cashKrw++; },
    (record) => { record.steps[0]!.trade!.quantity++; },
    (record) => { record.steps[0]!.riskDecision.approved = false; },
    (record) => { record.auditEvents[1]!.summary = "forged"; },
    (record) => { record.decision.decisionHash = "forged"; },
    (record) => { record.expectedSnapshot.portfolio!.cashKrw--; },
    (record) => { record.providerDecision.packetId = "other"; },
    (record) => { record.steps = []; },
    (record) => { record.executionModelVersion = "unknown" as typeof record.executionModelVersion; }
  ];
  for (const change of changes) {
    const modified = structuredClone(original); change(modified); rehash(modified);
    assert.throws(() => verifyPreparedPaperApplication(modified));
  }
  assert.throws(() => verifyPreparedPaperApplication({ ...original, extra: true }));
  assert.throws(() => verifyPreparedPaperApplication({ ...original, applicationHash: `sha256:${"0".repeat(64)}` }));
});

test("prepared application is synced before effects and linked through mixed revision history after restart", async (context) => {
  await fixture(context, async (path, store) => {
    const input = sample(); await store.write(input.packet.virtualPortfolio);
    input.expectedSnapshot = await store.readSnapshot(); const application = preparePaperApplication(input);
    const result = await store.withPreparedApplication(input.expectedSnapshot, () => application, async (received) => {
      assert.deepEqual(await readPreparedPaperApplication(path, application.applicationHash), application);
      assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
      assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), input.packet.virtualPortfolio);
      received.portfolio.cashKrw = 1; return "applied"; // consumer mutation cannot change the persisted intent/result
    });
    assert.equal(result, "applied"); assert.deepEqual(await new FileVirtualPortfolioStore(path).read(), application.portfolio);
    await store.write(application.portfolio);
    const revisions = (await fs.readFile(`${path}.revisions.jsonl`, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(revisions.map((entry) => entry.schemaVersion), ["paper_portfolio_revision.v1", "paper_portfolio_revision.v2", "paper_portfolio_revision.v1"]);
    assert.equal(revisions[1].applicationHash, application.applicationHash);
    assert.deepEqual(await readPreparedPaperApplication(path, application.applicationHash), application);
  });
});

test("prepared application handles bootstrap and unchanged outcomes with distinct revision origins", async (context) => {
  await fixture(context, async (path, store) => {
    const input = sample(); input.providerDecision.decisions = [];
    input.expectedSnapshot = await store.readSnapshot(); const first = preparePaperApplication(input);
    await store.withPreparedApplication(input.expectedSnapshot, () => first, async () => null);
    input.expectedSnapshot = await store.readSnapshot(); const second = preparePaperApplication(input);
    await store.withPreparedApplication(input.expectedSnapshot, () => second, async () => null);
    assert.notEqual(first.applicationHash, second.applicationHash);
    assert.equal((await fs.readdir(`${path}.applications`)).length, 2);
    assert.deepEqual(await store.read(), input.packet.virtualPortfolio);
    let prepared = false;
    await assert.rejects(store.withPreparedApplication(first.expectedSnapshot, () => { prepared = true; return first; }, async () => null), VirtualPortfolioStateChangedError);
    assert.equal(prepared, false);
  });
});

test("prepared application origin and corrupted intent block revision reads and all writer paths", async (context) => {
  await fixture(context, async (path, store) => {
    const input = sample(); await store.write(input.packet.virtualPortfolio); input.expectedSnapshot = await store.readSnapshot();
    const application = preparePaperApplication(input);
    await store.withPreparedApplication(input.expectedSnapshot, () => application, async () => null);
    const intentPath = preparedPaperApplicationPath(path, application.applicationHash), bytes = await fs.readFile(intentPath);
    const journalPath = `${path}.revisions.jsonl`, journal = await fs.readFile(journalPath, "utf8");
    const expected = await store.readSnapshot();
    for (const corrupt of [Buffer.from([0xff]), bytes.subarray(0, bytes.length - 2),
      Buffer.from(bytes.toString().replace('"schemaVersion":', '"duplicate":1,"schemaVersion":')),
      Buffer.from(bytes.toString().replace('"schemaVersion":"paper_prepared_application.v1"',
        '"schemaVersion":"paper_prepared_application.v1","schemaVersion":"paper_prepared_application.v1"'))]) {
      await fs.writeFile(intentPath, corrupt);
      await assert.rejects(store.read()); await assert.rejects(store.write(application.portfolio));
      let called = false;
      await assert.rejects(store.withExclusiveSnapshotUpdate(expected, async () => { called = true; return { portfolio: application.portfolio, result: null }; }));
      await assert.rejects(store.withPreparedApplication(expected, () => { called = true; return application; }, async () => null));
      assert.equal(called, false);
      assert.deepEqual(await fs.readFile(intentPath), corrupt);
    }
    await fs.writeFile(intentPath, bytes);
    const forged = structuredClone(application); forged.expectedSnapshot.revisionHash = `sha256:${"a".repeat(64)}`; rehash(forged);
    await writePreparedPaperApplication(path, forged); // coherent intent but not this revision's observed origin
    const lines = journal.trimEnd().split("\n"), entry = JSON.parse(lines[1]!);
    entry.applicationHash = forged.applicationHash;
    const { revisionHash: _old, ...payload } = entry; entry.revisionHash = hashPortfolioRevisionPayload(payload);
    await fs.writeFile(journalPath, `${lines[0]}\n${JSON.stringify(entry)}\n`);
    await assert.rejects(store.readSnapshot(), /application origin mismatch/);
    await fs.writeFile(journalPath, journal);
    await fs.unlink(intentPath); await assert.rejects(store.read(), { code: "ENOENT" });
    await fs.writeFile(intentPath, bytes); assert.deepEqual(await store.read(), application.portfolio);
  });
});

test("prepared intent write and fsync failures preserve old state and prevent every effect", async (context) => {
  for (const phase of ["write", "sync", "directory"] as const) await fixture(context, async (path, store) => {
    const input = sample(); await store.write(input.packet.virtualPortfolio); input.expectedSnapshot = await store.readSnapshot();
    const application = preparePaperApplication(input), before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`);
    const originalOpen = fs.open, denied = Object.assign(new Error(`intent ${phase} failure`), { code: "EIO" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (phase === "directory" && args[0] === `${path}.applications`) throw denied;
      const handle = await originalOpen(...args);
      if (args[0] === preparedPaperApplicationPath(path, application.applicationHash)) {
        const originalWrite = handle.writeFile.bind(handle);
        if (phase === "write") context.mock.method(handle, "writeFile", async () => { await originalWrite("{"); throw denied; });
        else if (phase === "sync") context.mock.method(handle, "sync", async () => { throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports(); let effects = 0;
    try { await assert.rejects(store.withPreparedApplication(input.expectedSnapshot, () => application, async () => { effects++; }), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(effects, 0); assert.deepEqual(await fs.readFile(path), before);
    assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
    await assert.rejects(store.read(), /lock is unavailable/);
    await assert.rejects(store.write(input.packet.virtualPortfolio), /lock is unavailable/);
  });
});

test("prepared application effect or projection failure leaves complete offline replay but no retry authority", async (context) => {
  for (const phase of ["effect", "rename"] as const) await fixture(context, async (path, store) => {
    const input = sample(); await store.write(input.packet.virtualPortfolio); input.expectedSnapshot = await store.readSnapshot();
    const application = preparePaperApplication(input), before = await fs.readFile(path);
    const originalRename = fs.rename, denied = new Error(`${phase} failed`);
    const mock = context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      if (phase === "rename" && args[1] === path) throw denied; return originalRename(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.withPreparedApplication(input.expectedSnapshot, () => application, async () => {
      if (phase === "effect") throw denied;
    }), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await readPreparedPaperApplication(path, application.applicationHash), application);
    assert.deepEqual(await fs.readFile(path), before);
    await assert.rejects(store.readSnapshot(), /lock is unavailable/);
    await assert.rejects(writePreparedPaperApplication(path, application), { code: "EEXIST" });
    assert.deepEqual(await readPreparedPaperApplication(path, application.applicationHash), application);
  });
});

test("independent processes cannot prepare two applications from the same revision", async (context) => {
  await fixture(context, async (path, store) => {
    const input = sample(); await store.write(input.packet.virtualPortfolio); input.expectedSnapshot = await store.readSnapshot();
    const script = `import { FileVirtualPortfolioStore } from ${JSON.stringify(new URL("./virtualPortfolioFileStore.js", import.meta.url).href)};
      import { preparePaperApplication } from ${JSON.stringify(new URL("../paper/preparedApplication.js", import.meta.url).href)};
      const input = JSON.parse(process.argv[2]);
      try { await new FileVirtualPortfolioStore(process.argv[1]).withPreparedApplication(input.expectedSnapshot, () => preparePaperApplication(input), async () => null); }
      catch (error) { console.error(error.message); process.exitCode = 1; }`;
    const child = () => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const processHandle = spawn(process.execPath, ["--input-type=module", "-e", script, path, JSON.stringify(input)], { windowsHide: true });
      let output = "", timedOut = false;
      const timer = setTimeout(() => { timedOut = true; processHandle.kill(); }, 30000);
      processHandle.stderr.on("data", (data) => { output += String(data); });
      processHandle.once("error", (error) => { clearTimeout(timer); reject(error); });
      processHandle.once("close", (code) => { clearTimeout(timer); if (timedOut) reject(new Error("prepared application child timed out")); else resolve({ code, output }); });
    });
    const results = await Promise.all([child(), child()]);
    assert.equal(results.filter((result) => result.code === 0).length, 1, JSON.stringify(results));
    assert.match(results.find((result) => result.code !== 0)!.output, /portfolio state changed/);
    assert.equal((await fs.readdir(`${path}.applications`)).length, 1);
    assert.deepEqual(await store.read(), preparePaperApplication(input).portfolio);
  });
});

function sample(): PreparedPaperApplicationInput {
  const packet = { packetId: "prepared_fixture", mode: "paper_only" as const, generatedAt: "2026-06-11T00:00:00.000Z", expiresAt: "2026-06-11T00:05:00.000Z",
    virtualPortfolio: { portfolioId: "paper_fixture", cashKrw: 1_000_000, positions: [], updatedAt: "2026-06-11T00:00:00.000Z" },
    candidates: [{ market: "KR" as const, symbol: "SYNTHETIC", name: "Synthetic", lastPriceKrw: 70_000, ranking: 1, score: 90,
      reasonCodes: ["fixture"], sourceRefs: ["synthetic:fixture"], collectedAt: "2026-06-11T00:00:00.000Z", staleAfter: "2026-06-11T00:05:00.000Z" }],
    constraints: { maxNewPositions: 3, maxBudgetPerSymbolKrw: 100_000, allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"] as PreparedPaperApplicationInput["packet"]["constraints"]["allowedActions"] } };
  return { expectedSnapshot: { portfolio: structuredClone(packet.virtualPortfolio), revisionHash: null }, packet,
    evaluatedAt: "2026-06-11T00:01:00.000Z", decisionSummary: "Synthetic paper intent",
    providerDecision: { ...createStaticDecisionIdentityMetadata(), packetId: packet.packetId, packetHash: createMarketPacketHash(packet), summary: "Synthetic decision", decisions: [{ market: "KR", symbol: "SYNTHETIC", action: "VIRTUAL_BUY",
      confidence: 0.7, budgetKrw: 70_000, thesis: "Synthetic fixture", riskFactors: ["synthetic"], dataRefs: ["synthetic:fixture"],
      claimSupport: [{ claim: "Synthetic fixture", dataRefs: ["synthetic:fixture"] }], expiresAt: packet.expiresAt }] } };
}
function rehash(record: PreparedPaperApplication) {
  const { applicationHash: _old, ...payload } = record; record.applicationHash = hashPreparedApplicationPayload(payload);
}
async function fixture(context: TestContext, run: (path: string, store: FileVirtualPortfolioStore) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), "paper-prepared-application-")), path = join(root, "portfolio.json");
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await run(path, new FileVirtualPortfolioStore(path, { lockTimeoutMs: 100 }));
}
