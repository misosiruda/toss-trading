import type { ProcessRunner } from "../ai/processRunner.js";
import type { AuditEvent } from "../domain/schemas.js";
import { maskObject } from "../security/masking.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileTossInvestSourceStore
} from "../storage/repositories.js";
import {
  isTossInvestReadOnlyCommandKey,
  TossInvestCliReadOnlyCollector,
  type TossInvestCliCollectInput,
  type TossInvestCliCollectResult,
  type TossInvestCliCollectorConfig
} from "./tossInvestCliCollector.js";

export interface TossInvestCollectionConfig extends TossInvestCliCollectorConfig {
  commands: TossInvestCliCollectInput[];
}

export interface TossInvestCollectionSummary {
  status: "completed" | "skipped";
  requestedCount: number;
  savedCount: number;
  okCount: number;
  degradedCount: number;
  blockedCount: number;
  skippedCommands: string[];
  auditEventId: string | null;
}

export interface TossInvestCollectionOptions {
  storageBaseDir: string;
  config: TossInvestCollectionConfig;
  runner?: ProcessRunner;
  now?: Date;
}

export async function collectTossInvestReadOnlySources(
  options: TossInvestCollectionOptions
): Promise<TossInvestCollectionSummary> {
  const now = options.now ?? new Date();
  const paths = createStoragePaths(options.storageBaseDir);
  const store = new FileTossInvestSourceStore(paths.tossInvestSourcesPath);
  const auditLog = new FileAuditLog(paths.auditLogPath);

  if (!options.config.enabled) {
    const auditEventId = await appendAudit(
      auditLog,
      "TOSSINVEST_COLLECTION_SKIPPED",
      "TossInvest read-only collection skipped because collector is disabled",
      now
    );
    return {
      status: "skipped",
      requestedCount: options.config.commands.length,
      savedCount: 0,
      okCount: 0,
      degradedCount: 0,
      blockedCount: 0,
      skippedCommands: options.config.commands.map((command) => command.commandKey),
      auditEventId
    };
  }

  const collector = new TossInvestCliReadOnlyCollector(
    options.config,
    options.runner ? { runner: options.runner } : {}
  );
  const summary: TossInvestCollectionSummary = {
    status: "completed",
    requestedCount: options.config.commands.length,
    savedCount: 0,
    okCount: 0,
    degradedCount: 0,
    blockedCount: 0,
    skippedCommands: [],
    auditEventId: null
  };

  for (const command of options.config.commands) {
    if (!isTossInvestReadOnlyCommandKey(command.commandKey)) {
      summary.skippedCommands.push(command.commandKey);
      summary.blockedCount += 1;
      continue;
    }

    const result = await collector.collect(command);
    const masked = maskObject(result) as TossInvestCliCollectResult;
    await store.append(masked);
    summary.savedCount += 1;
    incrementStatusCount(summary, result.status);
  }

  summary.auditEventId = await appendAudit(
    auditLog,
    "TOSSINVEST_COLLECTION_COMPLETED",
    `Collected TossInvest read-only sources: ok=${summary.okCount}, degraded=${summary.degradedCount}, blocked=${summary.blockedCount}, skipped=${summary.skippedCommands.length}`,
    now
  );
  return summary;
}

export function parseTossInvestCollectionConfig(input: {
  enabled?: string;
  tossctlPath?: string;
  timeoutSeconds?: string;
  commands?: string;
}): TossInvestCollectionConfig {
  const commandKeys = splitCsv(input.commands ?? "market.ranking,market.signals");
  return {
    enabled: input.enabled === "true",
    tossctlPath: input.tossctlPath ?? "tossctl",
    timeoutMs: Number(input.timeoutSeconds ?? 30) * 1000,
    commands: commandKeys.map((commandKey) => ({ commandKey }))
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function incrementStatusCount(
  summary: TossInvestCollectionSummary,
  status: TossInvestCliCollectResult["status"]
): void {
  if (status === "ok") {
    summary.okCount += 1;
  } else if (status === "degraded") {
    summary.degradedCount += 1;
  } else {
    summary.blockedCount += 1;
  }
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
