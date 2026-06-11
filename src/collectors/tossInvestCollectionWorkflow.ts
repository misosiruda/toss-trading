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
  const commandSpecs = splitCommandSpecs(
    input.commands ?? "market.ranking,market.signals"
  );
  return {
    enabled: input.enabled === "true",
    tossctlPath: input.tossctlPath ?? "tossctl",
    timeoutMs: Number(input.timeoutSeconds ?? 30) * 1000,
    commands: commandSpecs.map(parseCommandSpec)
  };
}

function splitCommandSpecs(value: string): string[] {
  const delimiter = value.includes(";") ? ";" : ",";
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseCommandSpec(spec: string): TossInvestCliCollectInput {
  const separatorIndex = findCommandArgSeparator(spec);
  if (separatorIndex === -1) {
    return { commandKey: spec };
  }

  const commandKey = spec.slice(0, separatorIndex).trim();
  const rawArgs = spec.slice(separatorIndex + 1);
  const args = rawArgs
    .split(/[|,]/)
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);

  return args.length > 0 ? { commandKey, args } : { commandKey };
}

function findCommandArgSeparator(spec: string): number {
  const colon = spec.indexOf(":");
  const equals = spec.indexOf("=");
  if (colon === -1) {
    return equals;
  }
  if (equals === -1) {
    return colon;
  }
  return Math.min(colon, equals);
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
