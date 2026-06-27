import { join } from "node:path";

import {
  auditEventSchema,
  type AuditEvent,
  historicalMarketSnapshotSchema,
  type HistoricalMarketSnapshot,
  type Market,
  marketPacketSchema,
  type MarketPacket,
  virtualDecisionSchema,
  type VirtualDecision,
  virtualPortfolioSchema,
  type VirtualPortfolio,
  virtualTradeSchema,
  type VirtualTrade
} from "../domain/schemas.js";
import {
  tossInvestCliCollectResultSchema,
  type TossInvestCliCollectResult
} from "../collectors/tossInvestCliCollector.js";
import { bindVirtualDecisionHash } from "../paper/decisionHash.js";
import {
  AUDIT_EVENTS_FILE_NAME,
  BATCH_REPLAY_AGGREGATE_REPORT_FILE_NAME,
  HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME,
  HISTORICAL_REPLAY_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_PACKETS_FILE_NAME,
  HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME,
  HISTORICAL_REPLAY_PROGRESS_FILE_NAME,
  HISTORICAL_REPLAY_REPORT_FILE_NAME,
  HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME,
  HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME,
  HISTORICAL_REPLAY_TRADES_FILE_NAME,
  MARKET_PACKETS_FILE_NAME,
  PORTFOLIO_POLICY_RECORDS_FILE_NAME,
  STRATEGY_BUCKET_TEST_RECORDS_FILE_NAME,
  TOSSINVEST_SOURCES_FILE_NAME,
  VIRTUAL_DECISIONS_FILE_NAME,
  VIRTUAL_PORTFOLIO_FILE_NAME,
  VIRTUAL_TRADES_FILE_NAME
} from "./artifactPaths.js";
import { JsonFileStore } from "./fileStore.js";
import { JsonlStore, type JsonlReadResult } from "./jsonlStore.js";

export interface StoragePaths {
  baseDir: string;
  auditLogPath: string;
  virtualPortfolioPath: string;
  virtualDecisionsPath: string;
  virtualTradesPath: string;
  tossInvestSourcesPath: string;
  marketPacketsPath: string;
  historicalMarketSnapshotsPath: string;
  historicalReplayReportPath: string;
  historicalReplayProgressPath: string;
  historicalReplayRunMetadataPath: string;
  historicalReplayResearchManifestPath: string;
  historicalReplayPacketLogPath: string;
  historicalReplayDecisionLogPath: string;
  historicalReplayRiskDecisionLogPath: string;
  historicalReplayTradeLogPath: string;
  historicalReplayPortfolioTimelinePath: string;
  batchReplayAggregateReportPath: string;
  strategyBucketTestRecordsPath: string;
  portfolioPolicyRecordsPath: string;
}

export function createStoragePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    auditLogPath: join(baseDir, AUDIT_EVENTS_FILE_NAME),
    virtualPortfolioPath: join(baseDir, VIRTUAL_PORTFOLIO_FILE_NAME),
    virtualDecisionsPath: join(baseDir, VIRTUAL_DECISIONS_FILE_NAME),
    virtualTradesPath: join(baseDir, VIRTUAL_TRADES_FILE_NAME),
    tossInvestSourcesPath: join(baseDir, TOSSINVEST_SOURCES_FILE_NAME),
    marketPacketsPath: join(baseDir, MARKET_PACKETS_FILE_NAME),
    historicalMarketSnapshotsPath: join(
      baseDir,
      HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME
    ),
    historicalReplayReportPath: join(
      baseDir,
      HISTORICAL_REPLAY_REPORT_FILE_NAME
    ),
    historicalReplayProgressPath: join(
      baseDir,
      HISTORICAL_REPLAY_PROGRESS_FILE_NAME
    ),
    historicalReplayRunMetadataPath: join(
      baseDir,
      HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME
    ),
    historicalReplayResearchManifestPath: join(
      baseDir,
      HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME
    ),
    historicalReplayPacketLogPath: join(
      baseDir,
      HISTORICAL_REPLAY_PACKETS_FILE_NAME
    ),
    historicalReplayDecisionLogPath: join(
      baseDir,
      HISTORICAL_REPLAY_DECISIONS_FILE_NAME
    ),
    historicalReplayRiskDecisionLogPath: join(
      baseDir,
      HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME
    ),
    historicalReplayTradeLogPath: join(
      baseDir,
      HISTORICAL_REPLAY_TRADES_FILE_NAME
    ),
    historicalReplayPortfolioTimelinePath: join(
      baseDir,
      HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME
    ),
    batchReplayAggregateReportPath: join(
      baseDir,
      BATCH_REPLAY_AGGREGATE_REPORT_FILE_NAME
    ),
    strategyBucketTestRecordsPath: join(
      baseDir,
      STRATEGY_BUCKET_TEST_RECORDS_FILE_NAME
    ),
    portfolioPolicyRecordsPath: join(
      baseDir,
      PORTFOLIO_POLICY_RECORDS_FILE_NAME
    )
  };
}

export interface HistoricalSnapshotQuery {
  asOf: Date;
  from?: Date;
  market?: Market;
  symbols?: string[];
  limit?: number;
}

export interface HistoricalSnapshotQueryResult
  extends JsonlReadResult<HistoricalMarketSnapshot> {
  totalStoredCount: number;
  excludedFutureCount: number;
}

export class FileAuditLog {
  private readonly store: JsonlStore<AuditEvent>;

  constructor(filePath: string) {
    this.store = new JsonlStore(filePath, auditEventSchema, "auditEvent");
  }

  append(event: AuditEvent): Promise<void> {
    return this.store.append(event);
  }

  readAll(): Promise<JsonlReadResult<AuditEvent>> {
    return this.store.readAll();
  }
}

export class FileVirtualPortfolioStore {
  private readonly store: JsonFileStore<VirtualPortfolio>;

  constructor(filePath: string) {
    this.store = new JsonFileStore(
      filePath,
      virtualPortfolioSchema,
      "virtualPortfolio"
    );
  }

  read(): Promise<VirtualPortfolio | null> {
    return this.store.read();
  }

  write(portfolio: VirtualPortfolio): Promise<void> {
    return this.store.write(portfolio);
  }
}

export class FileVirtualDecisionStore {
  private readonly store: JsonlStore<VirtualDecision>;

  constructor(filePath: string) {
    this.store = new JsonlStore(
      filePath,
      virtualDecisionSchema,
      "virtualDecision"
    );
  }

  append(decision: VirtualDecision): Promise<void> {
    return this.store.append(bindVirtualDecisionHash(decision));
  }

  readAll(): Promise<JsonlReadResult<VirtualDecision>> {
    return this.store.readAll();
  }
}

export class FileVirtualTradeStore {
  private readonly store: JsonlStore<VirtualTrade>;

  constructor(filePath: string) {
    this.store = new JsonlStore(filePath, virtualTradeSchema, "virtualTrade");
  }

  append(trade: VirtualTrade): Promise<void> {
    return this.store.append(trade);
  }

  readAll(): Promise<JsonlReadResult<VirtualTrade>> {
    return this.store.readAll();
  }
}

export class FileTossInvestSourceStore {
  private readonly store: JsonlStore<TossInvestCliCollectResult>;

  constructor(filePath: string) {
    this.store = new JsonlStore(
      filePath,
      tossInvestCliCollectResultSchema,
      "tossInvestCliCollectResult"
    );
  }

  append(result: TossInvestCliCollectResult): Promise<void> {
    return this.store.append(result);
  }

  readAll(): Promise<JsonlReadResult<TossInvestCliCollectResult>> {
    return this.store.readAll();
  }
}

export class FileMarketPacketStore {
  private readonly store: JsonlStore<MarketPacket>;

  constructor(filePath: string) {
    this.store = new JsonlStore(filePath, marketPacketSchema, "marketPacket");
  }

  append(packet: MarketPacket): Promise<void> {
    return this.store.append(packet);
  }

  readAll(): Promise<JsonlReadResult<MarketPacket>> {
    return this.store.readAll();
  }
}

export class FileHistoricalMarketSnapshotStore {
  private readonly store: JsonlStore<HistoricalMarketSnapshot>;

  constructor(filePath: string) {
    this.store = new JsonlStore(
      filePath,
      historicalMarketSnapshotSchema,
      "historicalMarketSnapshot"
    );
  }

  append(snapshot: HistoricalMarketSnapshot): Promise<void> {
    return this.store.append(snapshot);
  }

  readAll(): Promise<JsonlReadResult<HistoricalMarketSnapshot>> {
    return this.store.readAll();
  }

  async readUpTo(
    query: HistoricalSnapshotQuery
  ): Promise<HistoricalSnapshotQueryResult> {
    const result = await this.store.readAll();
    const matchingRecords = result.records.filter((snapshot) =>
      matchesHistoricalSnapshotQuery(snapshot, query)
    );
    const records = matchingRecords
      .filter((snapshot) => Date.parse(snapshot.observedAt) <= query.asOf.getTime())
      .sort(compareHistoricalSnapshots);
    const limitedRecords =
      query.limit === undefined ? records : records.slice(-query.limit);

    return {
      records: limitedRecords,
      corruptLineCount: result.corruptLineCount,
      totalStoredCount: result.records.length,
      excludedFutureCount: matchingRecords.length - records.length
    };
  }
}

function matchesHistoricalSnapshotQuery(
  snapshot: HistoricalMarketSnapshot,
  query: HistoricalSnapshotQuery
): boolean {
  if (query.market !== undefined && snapshot.market !== query.market) {
    return false;
  }
  if (query.symbols !== undefined && !query.symbols.includes(snapshot.symbol)) {
    return false;
  }
  if (
    query.from !== undefined &&
    Date.parse(snapshot.observedAt) < query.from.getTime()
  ) {
    return false;
  }
  return true;
}

function compareHistoricalSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  const observedDiff = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (observedDiff !== 0) {
    return observedDiff;
  }
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  const symbolDiff = left.symbol.localeCompare(right.symbol);
  if (symbolDiff !== 0) {
    return symbolDiff;
  }
  return left.snapshotId.localeCompare(right.snapshotId);
}
