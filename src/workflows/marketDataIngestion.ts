import type { AuditEvent, VirtualPortfolio } from "../domain/schemas.js";
import {
  MarketPacketBuilder,
  type MarketPacketConstraints
} from "../market/packetBuilder.js";
import { normalizeTossInvestCollectorResults } from "../market/tossInvestMarketData.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileTossInvestSourceStore,
  FileVirtualPortfolioStore
} from "../storage/repositories.js";

export interface MarketDataIngestionOptions {
  storageBaseDir: string;
  now: Date;
  packetId?: string;
  sourceMaxAgeSeconds: number;
  candidateTtlSeconds: number;
  packetTtlSeconds: number;
  maxCandidates: number;
  constraints: MarketPacketConstraints;
  initialCashKrw?: number;
}

export interface MarketDataIngestionResult {
  status: "completed" | "failed";
  packetId: string | null;
  candidateCount: number;
  sourceCount: number;
  sourceCorruptLineCount: number;
  warnings: string[];
  auditEventIds: string[];
}

export async function ingestMarketDataFromStoredTossInvestSources(
  options: MarketDataIngestionOptions
): Promise<MarketDataIngestionResult> {
  const paths = createStoragePaths(options.storageBaseDir);
  const sourceStore = new FileTossInvestSourceStore(paths.tossInvestSourcesPath);
  const portfolioStore = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);
  const packetStore = new FileMarketPacketStore(paths.marketPacketsPath);
  const auditLog = new FileAuditLog(paths.auditLogPath);
  const auditEventIds: string[] = [];

  const sourceRead = await sourceStore.readAll();
  const normalized = normalizeTossInvestCollectorResults(sourceRead.records, {
    now: options.now,
    sourceMaxAgeSeconds: options.sourceMaxAgeSeconds,
    candidateTtlSeconds: options.candidateTtlSeconds,
    defaultMarket: "KR"
  });
  const warnings = [...normalized.warnings];
  if (sourceRead.corruptLineCount > 0) {
    warnings.push(`tossinvest source corrupt lines: ${sourceRead.corruptLineCount}`);
  }

  if (normalized.candidates.length === 0) {
    auditEventIds.push(
      await appendAudit(
        auditLog,
        "MARKET_INGESTION_FAILED",
        "No valid TossInvest candidates after source normalization",
        options.now
      )
    );
    for (const warning of warnings) {
      auditEventIds.push(
        await appendAudit(auditLog, "MARKET_PACKET_WARNING", warning, options.now)
      );
    }

    return {
      status: "failed",
      packetId: null,
      candidateCount: 0,
      sourceCount: sourceRead.records.length,
      sourceCorruptLineCount: sourceRead.corruptLineCount,
      warnings,
      auditEventIds
    };
  }

  const portfolio =
    (await portfolioStore.read()) ??
    createInitialPortfolio(options.initialCashKrw ?? 1_000_000, options.now);
  const packetId = options.packetId ?? `packet_tossinvest_${options.now.getTime()}`;
  const packetResult = new MarketPacketBuilder({
    packetId,
    generatedAt: options.now,
    expiresInSeconds: options.packetTtlSeconds,
    maxCandidates: options.maxCandidates,
    constraints: options.constraints
  }).build({
    portfolio,
    candidates: normalized.candidates
  });

  await packetStore.append(packetResult.packet);
  auditEventIds.push(
    await appendAudit(
      auditLog,
      "MARKET_PACKET_INGESTED",
      `Stored paper-only market packet ${packetResult.packet.packetId} from TossInvest read-only sources`,
      options.now
    )
  );

  for (const warning of [...warnings, ...packetResult.warnings]) {
    auditEventIds.push(
      await appendAudit(auditLog, "MARKET_PACKET_WARNING", warning, options.now)
    );
  }

  return {
    status: "completed",
    packetId: packetResult.packet.packetId,
    candidateCount: packetResult.packet.candidates.length,
    sourceCount: sourceRead.records.length,
    sourceCorruptLineCount: sourceRead.corruptLineCount,
    warnings: [...warnings, ...packetResult.warnings],
    auditEventIds
  };
}

function createInitialPortfolio(
  cashKrw: number,
  now: Date
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw,
    positions: [],
    updatedAt: now.toISOString()
  };
}

async function appendAudit(
  auditLog: FileAuditLog,
  eventType: string,
  summary: string,
  now: Date
): Promise<string> {
  const eventId = `audit_${eventType.toLowerCase()}_${now.getTime()}`;
  const event: AuditEvent = {
    eventId,
    eventType,
    actor: "system",
    summary,
    maskedRefs: [],
    createdAt: now.toISOString()
  };
  await auditLog.append(event);
  return eventId;
}
