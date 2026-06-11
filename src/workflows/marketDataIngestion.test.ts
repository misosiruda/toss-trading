import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { TossInvestCliCollectResult } from "../collectors/tossInvestCliCollector.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileTossInvestSourceStore
} from "../storage/repositories.js";
import { ingestMarketDataFromStoredTossInvestSources } from "./marketDataIngestion.js";
import type { MarketDataIngestionOptions } from "./marketDataIngestion.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "toss-trading-market-ingest-"));
}

function source(
  commandKey: string,
  data: unknown,
  collectedAt = "2026-06-11T08:59:00+09:00"
): TossInvestCliCollectResult {
  return {
    status: "ok",
    commandKey,
    data,
    metadata: {
      source: "tossinvest_cli",
      sourceKind: "unofficial_read_only",
      official: false,
      commandKey,
      collectedAt
    },
    error: null
  };
}

function ingestionOptions(storageBaseDir: string): MarketDataIngestionOptions {
  return {
    storageBaseDir,
    now,
    packetId: "packet_ingest_test_001",
    sourceMaxAgeSeconds: 300,
    candidateTtlSeconds: 180,
    packetTtlSeconds: 300,
    maxCandidates: 2,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

test("market ingestion builds and stores packet from saved TossInvest sources", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  const sourceStore = new FileTossInvestSourceStore(paths.tossInvestSourcesPath);
  await sourceStore.append(
    source("market.ranking", {
      items: [
        { symbol: "005930", name: "Samsung", rank: 1, price: 71_000 },
        { symbol: "000660", name: "SK hynix", rank: 2, price: 120_000 },
        { symbol: "000001", name: "Trimmed", rank: 3, price: 10_000 }
      ]
    })
  );
  await sourceStore.append(
    source("market.signals", {
      signals: [{ symbol: "005930", signal: "momentum" }]
    })
  );

  const result = await ingestMarketDataFromStoredTossInvestSources(
    ingestionOptions(dir)
  );
  const packets = await new FileMarketPacketStore(paths.marketPacketsPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "completed");
  assert.equal(result.packetId, "packet_ingest_test_001");
  assert.equal(result.candidateCount, 2);
  assert.equal(packets.records.length, 1);
  assert.deepEqual(
    packets.records[0]?.candidates.map((candidate) => candidate.symbol),
    ["005930", "000660"]
  );
  assert.equal(audit.records[0]?.eventType, "MARKET_PACKET_INGESTED");
});

test("market ingestion fails closed when all sources are stale", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await new FileTossInvestSourceStore(paths.tossInvestSourcesPath).append(
    source(
      "market.ranking",
      { items: [{ symbol: "005930", rank: 1, price: 71_000 }] },
      "2026-06-11T08:00:00+09:00"
    )
  );

  const result = await ingestMarketDataFromStoredTossInvestSources(
    ingestionOptions(dir)
  );
  const packets = await new FileMarketPacketStore(paths.marketPacketsPath).readAll();
  const audit = await new FileAuditLog(paths.auditLogPath).readAll();

  assert.equal(result.status, "failed");
  assert.equal(result.packetId, null);
  assert.equal(result.candidateCount, 0);
  assert.equal(packets.records.length, 0);
  assert.match(result.warnings.join("\n"), /stale source/);
  assert.equal(audit.records[0]?.eventType, "MARKET_INGESTION_FAILED");
});

test("market ingestion reports corrupt source lines without creating empty packet", async () => {
  const dir = await tempDir();
  const paths = createStoragePaths(dir);
  await writeFile(paths.tossInvestSourcesPath, "not-json\n", "utf8");

  const result = await ingestMarketDataFromStoredTossInvestSources(
    ingestionOptions(dir)
  );

  assert.equal(result.status, "failed");
  assert.equal(result.sourceCorruptLineCount, 1);
  assert.match(result.warnings.join("\n"), /corrupt lines/);
});
