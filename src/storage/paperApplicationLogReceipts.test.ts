import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { preparePaperApplication, verifyPreparedPaperApplication, hashPreparedApplicationPayload,
  type PreparedPaperApplication } from "../paper/preparedApplication.js";
import { FileAuditLog, FileVirtualDecisionStore, FileVirtualTradeStore } from "./repositories.js";
import { FileVirtualPortfolioStore } from "./virtualPortfolioFileStore.js";
import { hashPortfolioRevisionPayload } from "./virtualPortfolioRevisionJournal.js";
import { completePaperApplicationLogs, defaultPaperExecutionLogPaths, paperApplicationLogPlanPath,
  paperApplicationLogReceiptPath, preparePaperApplicationLogPlan, readPaperApplicationLogPlan,
  readPaperApplicationLogReceipt, type PaperExecutionLogPaths } from "./paperApplicationLogReceipts.js";

test("logged applications bind BUY SELL HOLD and rejection suffixes to v3 revisions and restart", async (context) => {
  const golden = await readGolden();
  for (const source of Object.values(golden)) await fixture(context, source, async ({ path, paths, store, app }) => {
    await store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async (application) => {
      const [name] = await fs.readdir(`${path}.application-log-plans`);
      const plan = await readPaperApplicationLogPlan(path, `sha256:${name!.slice(0, -5)}`);
      assert.equal(plan.applicationHash, application.applicationHash);
      assert.equal(plan.before.decision.exists, false);
      await appendApplication(application, paths);
    }, paths);
    const head = await revision(path);
    assert.equal(head.schemaVersion, "paper_portfolio_revision.v3");
    const receipt = await readPaperApplicationLogReceipt(path, head.logReceiptHash, paths);
    assert.equal(receipt.applicationHash, app.applicationHash);
    const mutablePaths = { ...paths };
    const capturedRead = readPaperApplicationLogReceipt(path, head.logReceiptHash, mutablePaths);
    mutablePaths.decision = join(path, "mutated-after-call");
    assert.deepEqual(await capturedRead, receipt);
    assert.deepEqual(await new FileVirtualPortfolioStore(path).read(), app.portfolio);
    await store.write(app.portfolio); // v1 after v3 is still readable.
    assert.equal((await revision(path)).schemaVersion, "paper_portfolio_revision.v1");
    assert.deepEqual(await new FileVirtualPortfolioStore(path).read(), app.portfolio);
    await new FileAuditLog(paths.audit).append({ ...app.auditEvents[0]!, eventId: "later", summary: "later independent audit" });
    assert.deepEqual(await readPaperApplicationLogReceipt(path, head.logReceiptHash, paths), receipt);
    assert.deepEqual(await store.read(), app.portfolio);
  });
});

test("logged application refuses omitted duplicated altered and extra effects before portfolio commit", async (context) => {
  const source = (await readGolden()).buy!;
  for (const mode of ["missing", "duplicate", "quantity", "extra-audit"] as const) await fixture(context, source, async ({ path, paths, store, app }) => {
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`);
    await assert.rejects(store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async (application) => {
      if (mode === "missing") return;
      if (mode === "quantity") application.steps[0]!.trade!.quantity += 1;
      await appendApplication(application, paths);
      if (mode === "duplicate") await new FileVirtualDecisionStore(paths.decision).append(application.decision);
      if (mode === "extra-audit") await new FileAuditLog(paths.audit).append(application.auditEvents[0]!);
    }, paths), /log suffix mismatch/);
    assert.deepEqual(await fs.readFile(path), before);
    assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.equal((await fs.readdir(`${path}.application-log-plans`)).length, 1);
    await assert.rejects(fs.readdir(`${path}.application-log-receipts`), { code: "ENOENT" });
    await assert.rejects(store.read(), /lock is unavailable/);
  });
});

test("log plan and receipt write or fsync failures preserve portfolio bytes and explicit recovery barriers", async (context) => {
  const source = (await readGolden()).buy!;
  for (const kind of ["plans", "receipts"] as const) for (const phase of ["write", "sync"] as const) await fixture(context, source, async ({ path, paths, store, app }) => {
    const before = await fs.readFile(path), journal = await fs.readFile(`${path}.revisions.jsonl`);
    const original = fs.open, denied = Object.assign(new Error(`${kind} ${phase} failed`), { code: "EIO" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (String(args[0]).startsWith(`${path}.application-log-${kind}`) && args[1] === "wx") {
        const write = handle.writeFile.bind(handle);
        if (phase === "write") context.mock.method(handle, "writeFile", async () => { await write("{"); throw denied; });
        else context.mock.method(handle, "sync", async () => { throw denied; });
      }
      return handle;
    });
    syncBuiltinESMExports(); let effects = 0;
    try { await assert.rejects(store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async (application) => {
      effects++; await appendApplication(application, paths);
    }, paths), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(effects, kind === "plans" ? 0 : 1);
    assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(`${path}.revisions.jsonl`), journal);
    assert.equal((await fs.readdir(`${path}.lock`)).length, 1);
    assert.equal((await fs.readdir(`${path}.application-log-${kind}`)).length, 1);
    await assert.rejects(store.read(), /lock is unavailable/);
  });
});

test("v3 readers and every portfolio writer reject missing corrupt or redirected log completion records", async (context) => {
  await fixture(context, (await readGolden()).buy!, async ({ path, paths, store, app }) => {
    await store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, (value) => appendApplication(value, paths), paths);
    const snapshot = await store.readSnapshot(), head = await revision(path), receiptPath = paperApplicationLogReceiptPath(path, head.logReceiptHash);
    const receiptBytes = await fs.readFile(receiptPath), receipt = JSON.parse(receiptBytes.toString());
    const planPath = paperApplicationLogPlanPath(path, receipt.planHash), planBytes = await fs.readFile(planPath);
    const operations = [() => store.read(), () => store.readSnapshot(), () => store.write(app.portfolio),
      () => store.withExclusiveUpdate(app.portfolio, async () => assert.fail("must not execute")),
      () => store.withExclusiveSnapshotUpdate(snapshot, async () => assert.fail("must not execute")),
      () => store.withPreparedApplication(snapshot, () => assert.fail("must not prepare"), async () => undefined),
      () => store.withLoggedPreparedApplication(snapshot, () => assert.fail("must not prepare"), async () => undefined, paths)];
    for (const target of [receiptPath, planPath]) {
      const original = target === receiptPath ? receiptBytes : planBytes;
      for (const bytes of [Buffer.from([0xff]), Buffer.from("{"), Buffer.from('{"unexpected":true}\n')]) {
        await fs.writeFile(target, bytes);
        for (const operation of operations) await assert.rejects(operation());
        assert.deepEqual(await fs.readFile(target), bytes);
      }
      await fs.unlink(target);
      for (const operation of operations) await assert.rejects(operation());
      await fs.writeFile(target, original);
    }
    const otherPaths = { ...paths, trade: join(path, "not-the-configured-log") };
    await assert.rejects(store.withLoggedPreparedApplication(snapshot, () => assert.fail(), async () => undefined, otherPaths), /repository configuration/);
    assert.deepEqual(await store.read(), app.portfolio);
  });
});

test("independently rehashed completion and revision cannot endorse an altered trade suffix", async (context) => {
  await fixture(context, (await readGolden()).buy!, async ({ path, paths, store, app }) => {
    await store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, (value) => appendApplication(value, paths), paths);
    const head = await revision(path), receipt = await readPaperApplicationLogReceipt(path, head.logReceiptHash, paths);
    const trade = JSON.parse(await fs.readFile(paths.trade, "utf8")); trade.quantity += 1;
    const changed = Buffer.from(`${JSON.stringify(trade)}\n`); await fs.writeFile(paths.trade, changed);
    receipt.after.trade.byteLength = changed.length;
    receipt.after.trade.hash = `sha256:${createHash("sha256").update(changed).digest("hex")}`;
    const { receiptHash: _old, ...payload } = receipt; receipt.receiptHash = hashPreparedApplicationPayload(payload);
    await fs.writeFile(paperApplicationLogReceiptPath(path, receipt.receiptHash), `${JSON.stringify(receipt)}\n`);
    const lines = (await fs.readFile(`${path}.revisions.jsonl`, "utf8")).trimEnd().split("\n");
    head.logReceiptHash = receipt.receiptHash;
    const { revisionHash: _revision, ...revisionPayload } = head; head.revisionHash = hashPortfolioRevisionPayload(revisionPayload);
    lines[lines.length - 1] = JSON.stringify(head); await fs.writeFile(`${path}.revisions.jsonl`, `${lines.join("\n")}\n`);
    await assert.rejects(store.read(), /trade log suffix mismatch/);
    await assert.rejects(store.write(app.portfolio), /trade log suffix mismatch/);
  });
});

test("log prefix rewrite truncation removal and malformed prior bytes fail closed", async (context) => {
  for (const corrupt of [Buffer.from([0xff]), Buffer.from("{\n"), Buffer.from('{"torn":true}')]) {
    await fixture(context, (await readGolden()).buy!, async ({ path, paths, store, app }) => {
      await fs.writeFile(paths.audit, corrupt); let effects = 0;
      await assert.rejects(store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async () => { effects++; }, paths));
      assert.equal(effects, 0); assert.deepEqual(await fs.readFile(paths.audit), corrupt);
      assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), app.expectedSnapshot.portfolio);
    });
  }
  await fixture(context, (await readGolden()).buy!, async ({ path, paths, store, app }) => {
    await new FileAuditLog(paths.audit).append({ ...app.auditEvents[0]!, summary: "existing prefix" });
    await store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, (value) => appendApplication(value, paths), paths);
    const bytes = await fs.readFile(paths.audit);
    for (const changed of [bytes.subarray(0, bytes.length - 1), Buffer.from(bytes.toString().replace("existing prefix", "rewritten value"))]) {
      await fs.writeFile(paths.audit, changed); await assert.rejects(store.read(), /prefix mismatch/);
    }
    await fs.unlink(paths.audit); await assert.rejects(store.read(), /prefix mismatch/);
    await fs.writeFile(paths.audit, bytes); assert.deepEqual(await store.read(), app.portfolio);
    await assert.rejects(preparePaperApplicationLogPlan(path, app.applicationHash, paths), /requires an active batch/);
    await assert.rejects(completePaperApplicationLogs(path, "sha256:" + "a".repeat(64), paths), /requires an active batch/);
  });
});

test("log completion seals late append attempts and can be inspected before a failed portfolio rename", async (context) => {
  await fixture(context, (await readGolden()).buy!, async ({ path, paths, store, app }) => {
    const before = await fs.readFile(path), originalOpen = fs.open, originalRename = fs.rename;
    let release!: () => void, late!: Promise<void>, rejected!: Promise<void>;
    const gate = new Promise<void>((done) => { release = done; });
    const denied = new Error("portfolio rename failed");
    const openMock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).startsWith(`${path}.application-log-receipts`) && args[1] === "wx") { release(); await rejected; }
      return originalOpen(...args);
    });
    const renameMock = context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      if (args[1] === path) throw denied;
      return originalRename(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async (application) => {
      await appendApplication(application, paths);
      late = gate.then(() => new FileAuditLog(paths.audit).append(application.auditEvents[0]!));
      rejected = assert.rejects(late, /batch is sealed/);
    }, paths), (error) => error === denied); }
    finally { release(); openMock.mock.restore(); renameMock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(await fs.readFile(path), before);
    const head = await revision(path);
    assert.equal((await readPaperApplicationLogReceipt(path, head.logReceiptHash, paths)).applicationHash, app.applicationHash);
    assert.deepEqual((await new FileAuditLog(paths.audit).readAll()).records, app.auditEvents);
    await assert.rejects(store.read(), /lock is unavailable/);
    for (const logPath of Object.values(paths)) assert.equal((await fs.readdir(`${logPath}.paper-log.lock`)).length, 1);
  });
});

test("custom log sources require matching reader configuration and receipts never supply filesystem paths", async (context) => {
  await fixture(context, (await readGolden()).buy!, async ({ path, paths, app }) => {
    const custom = { audit: `${paths.audit}.custom`, decision: `${paths.decision}.custom`, trade: `${paths.trade}.custom` };
    const store = new FileVirtualPortfolioStore(path, { executionLogPaths: custom });
    await store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, (value) => appendApplication(value, custom), custom);
    assert.deepEqual(await new FileVirtualPortfolioStore(path, { executionLogPaths: custom }).read(), app.portfolio);
    await assert.rejects(new FileVirtualPortfolioStore(path).read(), /prefix mismatch/);
    const head = await revision(path), raw = await fs.readFile(paperApplicationLogReceiptPath(path, head.logReceiptHash), "utf8");
    for (const logPath of Object.values(custom)) assert.equal(raw.includes(logPath), false);
  });
});

test("durable source fsync errors propagate even when the error code is ENOENT", async (context) => {
  await fixture(context, (await readGolden()).buy!, async ({ path, paths, store, app }) => {
    await new FileAuditLog(paths.audit).append(app.auditEvents[0]!);
    const original = fs.open, denied = Object.assign(new Error("source fsync failed"), { code: "ENOENT" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === paths.audit && args[1] === "r+") context.mock.method(handle, "sync", async () => { throw denied; });
      return handle;
    });
    syncBuiltinESMExports(); let effects = 0;
    try { await assert.rejects(store.withLoggedPreparedApplication(app.expectedSnapshot, () => app, async () => { effects++; }, paths), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(effects, 0); assert.deepEqual(JSON.parse(await fs.readFile(path, "utf8")), app.expectedSnapshot.portfolio);
  });
});

async function appendApplication(app: PreparedPaperApplication, paths: PaperExecutionLogPaths) {
  await new FileVirtualDecisionStore(paths.decision).append(app.decision);
  for (const event of app.auditEvents) await new FileAuditLog(paths.audit).append(event);
  for (const step of app.steps) if (step.trade) await new FileVirtualTradeStore(paths.trade).append(step.trade);
}
async function readGolden(): Promise<Record<string, PreparedPaperApplication>> {
  const values = JSON.parse(await fs.readFile(new URL("../../src/paper/executionModels/v1/golden.json", import.meta.url), "utf8"));
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, verifyPreparedPaperApplication(value)]));
}
async function revision(path: string) { return JSON.parse((await fs.readFile(`${path}.revisions.jsonl`, "utf8")).trimEnd().split("\n").at(-1)!); }
async function fixture(context: TestContext, source: PreparedPaperApplication, run: (input: {
  path: string; paths: PaperExecutionLogPaths; store: FileVirtualPortfolioStore; app: PreparedPaperApplication;
}) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), "paper-log-receipts-")), path = join(root, "portfolio.json");
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = defaultPaperExecutionLogPaths(path), store = new FileVirtualPortfolioStore(path, { lockTimeoutMs: 60 });
  await store.write(source.packet.virtualPortfolio);
  const app = preparePaperApplication({ expectedSnapshot: await store.readSnapshot(), packet: source.packet,
    providerDecision: source.providerDecision, evaluatedAt: source.evaluatedAt, decisionSummary: source.decisionSummary });
  await run({ path, paths, store, app });
}
