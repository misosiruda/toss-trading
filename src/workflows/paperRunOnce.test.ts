import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  createStoragePaths,
  FileAuditLog,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import {
  FailingDecisionProvider,
  runPaperDecisionOnce,
  StaticDecisionProvider
} from "./paperRunOnce.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-workflow-"));
}

test("runPaperDecisionOnce completes with mocked Codex decision provider", async () => {
  const dir = await tempDir();
  const result = await runPaperDecisionOnce({
    storageBaseDir: dir,
    provider: new StaticDecisionProvider(validDecision()),
    now
  });

  assert.equal(result.status, "completed");
  assert.equal(result.tradeCount, 1);
  assert.match(result.report, /Paper trading report/);
  assert.match(result.report, /not financial advice/);

  const paths = createStoragePaths(dir);
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  assert.equal(trades.records.length, 1);
  assert.equal(trades.records[0]?.status, "VIRTUAL_FILLED");
});

test("failed decision provider leaves existing portfolio unchanged", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  const portfolioStore = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);
  await portfolioStore.write({
    portfolioId: "virtual_default",
    cashKrw: 500_000,
    positions: [],
    updatedAt: "2026-06-11T08:59:00+09:00"
  });

  const result = await runPaperDecisionOnce({
    storageBaseDir: dir,
    provider: new FailingDecisionProvider({
      code: "AI_DECISION_FAILED",
      reason: "invalid_json"
    }),
    now
  });

  assert.equal(result.status, "failed");
  assert.equal(result.tradeCount, 0);
  assert.equal((await portfolioStore.read())?.cashKrw, 500_000);
});

test("successful run writes virtual trade and audit event chain", async () => {
  const dir = await tempDir();
  const result = await runPaperDecisionOnce({
    storageBaseDir: dir,
    provider: new StaticDecisionProvider(validDecision()),
    now
  });
  const paths = createStoragePaths(dir);
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.ok(result.auditEventIds.length >= 4);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    [
      "MARKET_PACKET_CREATED",
      "VIRTUAL_DECISION_RECORDED",
      "VIRTUAL_RISK_APPROVED",
      "PAPER_ORDER_FILLED"
    ]
  );
});

test("runPaperDecisionOnce rejects semantic-invalid decisions before storage", async () => {
  const dir = await tempDir();
  const result = await runPaperDecisionOnce({
    storageBaseDir: dir,
    provider: new StaticDecisionProvider({
      ...validDecision(),
      decisions: [
        {
          ...validDecision().decisions[0]!,
          dataRefs: ["mock_source_missing"]
        }
      ]
    }),
    now
  });
  const paths = createStoragePaths(dir);
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.tradeCount, 0);
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    ["MARKET_PACKET_CREATED", "VIRTUAL_DECISION_REJECTED"]
  );
});

test("runPaperDecisionOnce rejects hold decisions without hold reason before storage", async () => {
  const dir = await tempDir();
  const result = await runPaperDecisionOnce({
    storageBaseDir: dir,
    provider: new StaticDecisionProvider({
      ...validDecision(),
      decisions: [
        {
          ...validDecision().decisions[0]!,
          action: "VIRTUAL_HOLD",
          budgetKrw: 0,
          riskFactors: []
        }
      ]
    }),
    now
  });
  const paths = createStoragePaths(dir);
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.tradeCount, 0);
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    ["MARKET_PACKET_CREATED", "VIRTUAL_DECISION_REJECTED"]
  );
});

test("runPaperDecisionOnce rejects packet hash mismatches before storage", async () => {
  const dir = await tempDir();
  const result = await runPaperDecisionOnce({
    storageBaseDir: dir,
    provider: new StaticDecisionProvider({
      ...validDecision(),
      packetHash:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    }),
    now
  });
  const paths = createStoragePaths(dir);
  const decisions = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();
  const trades = await new FileVirtualTradeStore(paths.virtualTradesPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.tradeCount, 0);
  assert.equal(decisions.records.length, 0);
  assert.equal(trades.records.length, 0);
  assert.deepEqual(
    audit.records.map((event) => event.eventType),
    ["MARKET_PACKET_CREATED", "VIRTUAL_DECISION_REJECTED"]
  );
});

function validDecision() {
  return {
    packetId: "packet_mock_001",
    summary: "Paper-only mocked Codex decision.",
    decisions: [
      {
        market: "KR" as const,
        symbol: "005930",
        action: "VIRTUAL_BUY" as const,
        confidence: 0.7,
        budgetKrw: 70_000,
        thesis: "Mock packet supports a paper-only virtual buy.",
        riskFactors: ["Paper trading risk."],
        dataRefs: ["mock_source_001"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}
