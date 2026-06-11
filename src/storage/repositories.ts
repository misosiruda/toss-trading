import { join } from "node:path";

import {
  auditEventSchema,
  type AuditEvent,
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
}

export function createStoragePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    auditLogPath: join(baseDir, "audit-events.jsonl"),
    virtualPortfolioPath: join(baseDir, "virtual-portfolio.json"),
    virtualDecisionsPath: join(baseDir, "virtual-decisions.jsonl"),
    virtualTradesPath: join(baseDir, "virtual-trades.jsonl"),
    tossInvestSourcesPath: join(baseDir, "tossinvest-sources.jsonl"),
    marketPacketsPath: join(baseDir, "market-packets.jsonl")
  };
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
    return this.store.append(decision);
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
