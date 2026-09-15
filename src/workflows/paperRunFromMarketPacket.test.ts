import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

import type { MarketPacket, VirtualDecision } from "../domain/schemas.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import type { DecisionProvider } from "./paperDecisionPipeline.js";
import { readPreparedPaperApplication } from "../storage/preparedPaperApplicationFiles.js";
import { defaultPaperExecutionLogPaths, readPaperApplicationLogPlan, readPaperApplicationLogReceipt } from "../storage/paperApplicationLogReceipts.js";
import { withPaperExecutionLogAppend } from "../storage/paperExecutionLogLocks.js";
import {
  FailingMarketPacketDecisionProvider,
  MarketPacketDryRunDecisionProvider,
  runPaperDecisionFromLatestMarketPacket,
  StaticMarketPacketDecisionProvider
} from "./paperRunFromMarketPacket.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-market-packet-run-"));
}

test("market packet paper run records decision, trade, portfolio, and audit chain", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider(virtualDecision()),
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const portfolio = await new FileVirtualPortfolioStore(
    paths.virtualPortfolioPath
  ).read();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.packetId, "packet_market_run_001");
  assert.equal(result.tradeCount, 1);
  assert.equal(result.rejectedCount, 0);
  assert.equal(decisions.records.length, 1);
  assert.equal(
    decisions.records[0]?.decisions[0]?.confidenceBreakdown?.modelConfidence,
    0.7
  );
  assert.match(
    decisions.records[0]?.decisions[0]?.confidenceBreakdown?.reasonCodes.join(
      ","
    ) ?? "",
    /MODEL_CONFIDENCE_HIGH/
  );
  assert.equal(trades.records.length, 1);
  assert.equal(portfolio?.cashKrw, 930_000);
  const [intentFile] = await readdir(`${paths.virtualPortfolioPath}.applications`);
  const intent = await readPreparedPaperApplication(paths.virtualPortfolioPath, `sha256:${intentFile!.slice(0, -5)}`);
  assert.deepEqual(intent.decision, decisions.records[0]);
  assert.deepEqual(intent.steps.flatMap((step) => step.trade ? [step.trade] : []), trades.records);
  assert.deepEqual(intent.portfolio, portfolio);
  assert.deepEqual(intent.auditEvents, audit.records.slice(1));
  const revision = JSON.parse((await readFile(`${paths.virtualPortfolioPath}.revisions.jsonl`, "utf8")).trimEnd().split("\n").at(-1)!);
  assert.equal(revision.schemaVersion, "paper_portfolio_revision.v3");
  const receipt = await readPaperApplicationLogReceipt(paths.virtualPortfolioPath, revision.logReceiptHash, defaultPaperExecutionLogPaths(paths.virtualPortfolioPath));
  const logPlan = await readPaperApplicationLogPlan(paths.virtualPortfolioPath, receipt.planHash);
  assert.equal(receipt.applicationHash, intent.applicationHash);
  assert.equal(logPlan.before.audit.byteLength, Buffer.byteLength(`${JSON.stringify(audit.records[0])}\n`));
  assert.equal(receipt.after.trade.byteLength, Buffer.byteLength(await readFile(paths.virtualTradesPath)));
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    [
      "MARKET_PACKET_SELECTED",
      "VIRTUAL_DECISION_RECORDED",
      "VIRTUAL_RISK_APPROVED",
      "PAPER_ORDER_FILLED"
    ]
  );
});

test("market packet paper run fails closed for stale packet before provider call", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  const provider = new CountingDecisionProvider();
  await new FileMarketPacketStore(paths.marketPacketsPath).append(
    marketPacket({ expiresAt: "2026-06-11T08:59:00+09:00" })
  );

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider,
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "stale_market_packet");
  assert.equal(provider.calls, 0);
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
});

test("market packet paper run rejects a packet with an obsolete portfolio before provider or trade writes", async () => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  const current = { ...packet.virtualPortfolio, cashKrw: 800_000, updatedAt: now.toISOString() };
  const store = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);
  await store.write(current);
  const provider = { calls: 0, async decide(input: MarketPacket) {
    this.calls++; return new StaticMarketPacketDecisionProvider(virtualDecision()).decide(input);
  } };
  const result = await runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir, provider, now });
  assert.equal(result.status, "failed"); assert.equal(result.failureReason, "portfolio_state_changed");
  assert.equal(provider.calls, 0); assert.deepEqual(await store.read(), current);
  assert.equal((await new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll()).records.length, 0);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 0);
});

test("market packet paper run rejects a portfolio change during provider execution without overwriting it", async () => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  const store = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);
  await store.write(packet.virtualPortfolio);
  const current = { ...packet.virtualPortfolio, cashKrw: 600_000, updatedAt: now.toISOString() };
  const provider: DecisionProvider = { async decide(input) {
    await store.write(current);
    return new StaticMarketPacketDecisionProvider(virtualDecision()).decide(input);
  } };
  const result = await runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir, provider, now });
  assert.equal(result.status, "failed"); assert.equal(result.failureReason, "portfolio_state_changed");
  assert.deepEqual(await store.read(), current);
  assert.equal((await new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll()).records.length, 0);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 0);
});

test("market packet paper run rejects portfolio ABA during provider execution", async (context) => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  context.after(() => rm(dir, { recursive: true, force: true }));
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  const store = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);
  await store.write(packet.virtualPortfolio);
  const provider: DecisionProvider = { async decide(input) {
    await store.write({ ...packet.virtualPortfolio, cashKrw: 600_000 });
    await store.write(packet.virtualPortfolio);
    return new StaticMarketPacketDecisionProvider(virtualDecision()).decide(input);
  } };
  const result = await runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir, provider, now });
  assert.equal(result.status, "failed"); assert.equal(result.failureReason, "portfolio_state_changed");
  assert.deepEqual(await store.read(), packet.virtualPortfolio);
  assert.equal((await new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll()).records.length, 0);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 0);
});

test("concurrent unchanged HOLD runs reject the obsolete portfolio revision", async (context) => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  context.after(() => rm(dir, { recursive: true, force: true }));
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(packet.virtualPortfolio);
  let arrived = 0, release!: () => void;
  const both = new Promise<void>((done) => { release = done; });
  const provider: DecisionProvider = { async decide(input) {
    if (++arrived === 2) release();
    await both;
    return new StaticMarketPacketDecisionProvider({ ...virtualDecision(), decisions: [] }).decide(input);
  } };
  const results = await Promise.all([1, 2].map(() => runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir, provider, now })));
  assert.equal(results.filter((result) => result.status === "completed").length, 1);
  assert.equal(results.find((result) => result.status === "failed")!.failureReason, "portfolio_state_changed");
  assert.equal((await new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll()).records.length, 1);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 0);
});

test("concurrent market packet paper runs apply only one result from the same starting portfolio", async () => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  let arrived = 0, release!: () => void;
  const both = new Promise<void>((done) => { release = done; });
  const provider: DecisionProvider = { async decide(input) {
    if (++arrived === 2) release();
    await both;
    return new StaticMarketPacketDecisionProvider(virtualDecision()).decide(input);
  } };
  const results = await Promise.all([1, 2].map(() => runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir, provider, now })));
  assert.equal(arrived, 2);
  assert.equal(results.filter((result) => result.status === "completed").length, 1);
  assert.equal(results.find((result) => result.status === "failed")!.failureReason, "portfolio_state_changed");
  assert.equal((await new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll()).records.length, 1);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 1);
  assert.equal((await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).read())!.cashKrw, 930_000);
});

test("paper application failure after a trade write retains a recovery barrier and blocks a new run", async (context) => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  context.after(() => rm(dir, { recursive: true, force: true }));
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(packet.virtualPortfolio);
  const original = FileVirtualTradeStore.prototype.append, denied = new Error("after trade append failure");
  const mock = context.mock.method(FileVirtualTradeStore.prototype, "append", async function (this: FileVirtualTradeStore, ...args: Parameters<typeof original>) {
    const [intentFile] = await readdir(`${paths.virtualPortfolioPath}.applications`);
    const intent = await readPreparedPaperApplication(paths.virtualPortfolioPath, `sha256:${intentFile!.slice(0, -5)}`);
    assert.deepEqual(intent.steps[0]!.trade, args[0]);
    assert.equal(intent.auditEvents.at(-1)!.eventType, "PAPER_ORDER_FILLED");
    await original.apply(this, args); throw denied;
  });
  try {
    await assert.rejects(runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir,
      provider: new StaticMarketPacketDecisionProvider(virtualDecision()), now }), (error) => error === denied);
  } finally { mock.mock.restore(); }
  assert.deepEqual(JSON.parse(await readFile(paths.virtualPortfolioPath, "utf8")), packet.virtualPortfolio);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 1);
  const provider = new CountingDecisionProvider();
  await assert.rejects(runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir, provider, now }), /paper execution log lock is unavailable/);
  assert.equal(provider.calls, 0);
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 1);
});

test("paper application keeps all log writers locked through portfolio commit", async (context) => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  context.after(() => rm(dir, { recursive: true, force: true }));
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(packet.virtualPortfolio);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => { enter = done; }), gate = new Promise<void>((done) => { release = done; });
  const original = fs.rename;
  const mock = context.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] === paths.virtualPortfolioPath) { enter(); await gate; }
    return original(...args);
  });
  syncBuiltinESMExports();
  const pending = runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider(virtualDecision()), now });
  const settled = pending.catch(() => undefined);
  try {
    await Promise.race([entered, pending.then(() => { throw new Error("portfolio commit boundary was not reached"); })]);
    for (const path of [paths.auditLogPath, paths.virtualDecisionsPath, paths.virtualTradesPath]) {
      await assert.rejects(withPaperExecutionLogAppend(path, async () => assert.fail("must stay locked"), { lockTimeoutMs: 60 }), /log lock is unavailable/);
    }
    assert.deepEqual(JSON.parse(await readFile(paths.virtualPortfolioPath, "utf8")), packet.virtualPortfolio);
  } finally { release(); await settled; mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal((await pending).status, "completed");
  for (const path of [paths.auditLogPath, paths.virtualDecisionsPath, paths.virtualTradesPath]) {
    await assert.rejects(readdir(`${path}.paper-log.lock`), { code: "ENOENT" });
  }
});

test("paper application refuses portfolio commit when a trade log fsync fails", async (context) => {
  const dir = await tempDir(), paths = createStoragePaths(dir), packet = marketPacket();
  context.after(() => rm(dir, { recursive: true, force: true }));
  await new FileMarketPacketStore(paths.marketPacketsPath).append(packet);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(packet.virtualPortfolio);
  const before = await readFile(paths.virtualPortfolioPath), revisions = await readFile(`${paths.virtualPortfolioPath}.revisions.jsonl`);
  const originalOpen = fs.open, denied = Object.assign(new Error("trade log fsync failure"), { code: "EIO" });
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === paths.virtualTradesPath) context.mock.method(handle, "sync", async () => { throw denied; });
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(runPaperDecisionFromLatestMarketPacket({ storageBaseDir: dir,
      provider: new StaticMarketPacketDecisionProvider(virtualDecision()), now }), (error) => error === denied);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(await readFile(paths.virtualPortfolioPath), before);
  assert.deepEqual(await readFile(`${paths.virtualPortfolioPath}.revisions.jsonl`), revisions);
  const [intentFile] = await readdir(`${paths.virtualPortfolioPath}.applications`);
  const intent = await readPreparedPaperApplication(paths.virtualPortfolioPath, `sha256:${intentFile!.slice(0, -5)}`);
  assert.equal(intent.steps[0]!.trade!.action, "VIRTUAL_BUY");
  assert.equal((await new FileVirtualTradeStore(paths.virtualTradesPath).readAll()).records.length, 1);
  assert.equal((await readdir(`${paths.virtualPortfolioPath}.lock`)).length, 1);
  await assert.rejects(new FileVirtualPortfolioStore(paths.virtualPortfolioPath, { lockTimeoutMs: 60 }).read(), /lock is unavailable/);
});

test("market packet paper run rejects decision packet mismatch without saving decision", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider({
      ...virtualDecision(),
      packetId: "packet_other_001"
    }),
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "decision_packet_mismatch");
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
});

test("market packet paper run rejects hallucinated data refs before saving decision", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider({
      ...virtualDecision(),
      decisions: [
        {
          ...virtualDecision().decisions[0]!,
          dataRefs: ["tossinvest_cli:market.ranking:missing"]
        }
      ]
    }),
    now
  });
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "virtual_decision_semantic_invalid");
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    ["MARKET_PACKET_SELECTED", "VIRTUAL_DECISION_REJECTED"]
  );
});

test("market packet dry-run provider builds a paper decision from stored candidates", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new MarketPacketDryRunDecisionProvider(),
    now
  });
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.tradeCount, 1);
  assert.equal(trades.records[0]?.symbol, "005930");
  assert.match(result.report, /stored_market_packet/);
  assert.match(result.report, /not financial advice/);
});

test("market packet paper run records provider failures without paper order", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new FailingMarketPacketDecisionProvider({
      code: "AI_DECISION_DISABLED",
      reason: "disabled in test"
    }),
    now
  });
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "AI_DECISION_DISABLED");
  assert.equal(trades.records.length, 0);
});

test("market packet paper run records risk rejection without paper order", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileMarketPacketStore(paths.marketPacketsPath).append(
    marketPacket({
      virtualPortfolio: {
        portfolioId: "virtual_default",
        cashKrw: 1_000,
        positions: [],
        updatedAt: "2026-06-11T08:59:00+09:00"
      }
    })
  );

  const result = await runPaperDecisionFromLatestMarketPacket({
    storageBaseDir: dir,
    provider: new StaticMarketPacketDecisionProvider(virtualDecision()),
    now
  });
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const portfolio = await new FileVirtualPortfolioStore(
    paths.virtualPortfolioPath
  ).read();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.tradeCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(trades.records.length, 0);
  assert.equal(portfolio?.cashKrw, 1_000);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    [
      "MARKET_PACKET_SELECTED",
      "VIRTUAL_DECISION_RECORDED",
      "VIRTUAL_RISK_REJECTED"
    ]
  );
});

class CountingDecisionProvider implements DecisionProvider {
  calls = 0;

  async decide() {
    this.calls += 1;
    return {
      attempted: false,
      decision: virtualDecision(),
      failure: null,
      command: null
    };
  }
}

function marketPacket(overrides: Partial<MarketPacket> = {}): MarketPacket {
  return {
    packetId: "packet_market_run_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T08:59:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-06-11T08:59:00+09:00"
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Samsung",
        lastPriceKrw: 70_000,
        ranking: 1,
        score: 90,
        reasonCodes: ["ranking"],
        sourceRefs: ["tossinvest_cli:market.ranking:0:0"],
        collectedAt: "2026-06-11T08:59:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    },
    ...overrides
  };
}

function virtualDecision(): VirtualDecision {
  return {
    packetId: "packet_market_run_001",
    summary: "Paper-only market packet decision.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.7,
        budgetKrw: 70_000,
        thesis: "Stored market packet supports a paper-only virtual buy.",
        riskFactors: ["Paper-only simulation risk."],
        dataRefs: ["tossinvest_cli:market.ranking:0:0"],
        claimSupport: [
          {
            claim: "Stored market packet supports a paper-only virtual buy.",
            dataRefs: ["tossinvest_cli:market.ranking:0:0"]
          }
        ],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}
