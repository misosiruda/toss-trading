import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditEvent,
  HistoricalMarketSnapshot,
  VirtualDecision,
  VirtualPortfolio
} from "../domain/schemas.js";
import { createVirtualDecisionHash } from "../paper/decisionHash.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileHistoricalMarketSnapshotStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore
} from "./repositories.js";

async function createTempStoragePaths() {
  const dir = await mkdtemp(join(tmpdir(), "toss-trading-test-"));
  return createStoragePaths(dir);
}

function auditEvent(id: string): AuditEvent {
  return {
    eventId: id,
    eventType: "TEST_EVENT",
    actor: "system",
    summary: "Test event",
    maskedRefs: [],
    createdAt: "2026-06-11T09:00:00+09:00"
  };
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T09:00:00+09:00"
  };
}

function virtualDecision(): VirtualDecision {
  return {
    packetId: "packet_001",
    packetHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    promptVersion: "paper-v10",
    modelId: "codex-cli-static",
    schemaVersion: "virtual-decision.v1",
    policyVersion: "paper-policy.v1",
    summary: "Paper-only decision hash storage fixture.",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.7,
        budgetKrw: 70_000,
        thesis: "Packet source supports a paper-only virtual buy.",
        riskFactors: ["Paper-only fixture risk."],
        dataRefs: ["source_005930"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}

function historicalSnapshot(input: {
  snapshotId: string;
  symbol?: string;
  observedAt: string;
  lastPriceKrw?: number;
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: input.symbol ?? "005930",
    observedAt: input.observedAt,
    interval: "1m",
    lastPriceKrw: input.lastPriceKrw ?? 70_000,
    volume: 100_000,
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-11T09:00:00+09:00"
  };
}

test("audit log appends and reads events", async () => {
  const paths = await createTempStoragePaths();
  const auditLog = new FileAuditLog(paths.auditLogPath);

  await auditLog.append(auditEvent("audit_001"));
  await auditLog.append(auditEvent("audit_002"));

  const result = await auditLog.readAll();
  assert.equal(result.corruptLineCount, 0);
  assert.deepEqual(
    result.records.map((event) => event.eventId),
    ["audit_001", "audit_002"]
  );
});

test("virtual portfolio store writes and reads current portfolio", async () => {
  const paths = await createTempStoragePaths();
  const store = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);

  await store.write(portfolio());

  const loaded = await store.read();
  assert.equal(loaded?.portfolioId, "virtual_default");
  assert.equal(loaded?.cashKrw, 1_000_000);
});

test("virtual decision store appends backend generated decision hash", async () => {
  const paths = await createTempStoragePaths();
  const store = new FileVirtualDecisionStore(paths.virtualDecisionsPath);
  const decision = virtualDecision();

  await store.append(decision);

  const result = await store.readAll();
  assert.equal(decision.decisionHash, undefined);
  assert.equal(result.corruptLineCount, 0);
  assert.equal(result.records.length, 1);
  const stored = result.records[0];
  assert.ok(stored);
  assert.equal(stored.packetId, "packet_001");
  assert.match(stored.decisionHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(stored.decisionHash, createVirtualDecisionHash(stored));
});

test("jsonl store reports corrupted lines without dropping valid records", async () => {
  const paths = await createTempStoragePaths();
  await writeFile(
    paths.auditLogPath,
    `${JSON.stringify(auditEvent("audit_valid_001"))}\nnot-json\n${JSON.stringify(auditEvent("audit_valid_002"))}\n`,
    "utf8"
  );

  const result = await new FileAuditLog(paths.auditLogPath).readAll();
  assert.equal(result.corruptLineCount, 1);
  assert.deepEqual(
    result.records.map((event) => event.eventId),
    ["audit_valid_001", "audit_valid_002"]
  );
});

test("historical market snapshot store reads records up to as-of time in order", async () => {
  const paths = await createTempStoragePaths();
  const store = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );

  await store.append(
    historicalSnapshot({
      snapshotId: "hist_003",
      observedAt: "2025-01-02T09:02:00+09:00",
      lastPriceKrw: 70_200
    })
  );
  await store.append(
    historicalSnapshot({
      snapshotId: "hist_001",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000
    })
  );
  await store.append(
    historicalSnapshot({
      snapshotId: "hist_future",
      observedAt: "2025-01-02T09:03:00+09:00",
      lastPriceKrw: 70_300
    })
  );
  await store.append(
    historicalSnapshot({
      snapshotId: "hist_002",
      observedAt: "2025-01-02T09:01:00+09:00",
      lastPriceKrw: 70_100
    })
  );

  const result = await store.readUpTo({
    asOf: new Date("2025-01-02T09:02:00+09:00")
  });

  assert.deepEqual(
    result.records.map((snapshot) => snapshot.snapshotId),
    ["hist_001", "hist_002", "hist_003"]
  );
  assert.equal(result.excludedFutureCount, 1);
  assert.equal(result.totalStoredCount, 4);
});

test("historical market snapshot store filters by from time and symbols", async () => {
  const paths = await createTempStoragePaths();
  const store = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );

  await store.append(
    historicalSnapshot({
      snapshotId: "hist_005930_old",
      symbol: "005930",
      observedAt: "2025-01-02T08:59:00+09:00"
    })
  );
  await store.append(
    historicalSnapshot({
      snapshotId: "hist_005930_current",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00"
    })
  );
  await store.append(
    historicalSnapshot({
      snapshotId: "hist_000660_current",
      symbol: "000660",
      observedAt: "2025-01-02T09:00:00+09:00"
    })
  );

  const result = await store.readUpTo({
    asOf: new Date("2025-01-02T09:01:00+09:00"),
    from: new Date("2025-01-02T09:00:00+09:00"),
    symbols: ["005930"]
  });

  assert.deepEqual(
    result.records.map((snapshot) => snapshot.snapshotId),
    ["hist_005930_current"]
  );
});

test("historical market snapshot store reports corrupt historical lines", async () => {
  const paths = await createTempStoragePaths();
  await writeFile(
    paths.historicalMarketSnapshotsPath,
    `${JSON.stringify(
      historicalSnapshot({
        snapshotId: "hist_valid_001",
        observedAt: "2025-01-02T09:00:00+09:00"
      })
    )}\nnot-json\n`,
    "utf8"
  );

  const result = await new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  ).readUpTo({
    asOf: new Date("2025-01-02T09:00:00+09:00")
  });

  assert.equal(result.corruptLineCount, 1);
  assert.deepEqual(
    result.records.map((snapshot) => snapshot.snapshotId),
    ["hist_valid_001"]
  );
});
