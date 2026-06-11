import {
  NodeProcessRunner,
  type ProcessRunner
} from "../ai/processRunner.js";
import { z } from "zod";

export const tossInvestReadOnlyCommandKeys = [
  "market.index",
  "market.ranking",
  "market.signals",
  "market.screener",
  "market.hours",
  "market.fx",
  "quote.get",
  "quote.batch",
  "quote.chart",
  "quote.trades",
  "quote.orderbook",
  "quote.limits",
  "quote.warnings",
  "quote.flows",
  "quote.commission",
  "push.listen"
] as const;

export type TossInvestReadOnlyCommandKey =
  (typeof tossInvestReadOnlyCommandKeys)[number];

export interface TossInvestCliCollectorConfig {
  enabled: boolean;
  tossctlPath: string;
  timeoutMs: number;
}

export interface TossInvestCliCollectInput {
  commandKey: string;
  args?: string[];
}

export interface TossInvestCliCollectResult {
  status: "ok" | "blocked" | "degraded";
  commandKey: string;
  data: unknown | null;
  metadata: TossInvestCliSourceMetadata;
  error: TossInvestCliCollectorError | null;
}

export interface TossInvestCliSourceMetadata {
  source: "tossinvest_cli";
  sourceKind: "unofficial_read_only";
  official: false;
  commandKey: string;
  collectedAt: string;
}

export interface TossInvestCliCollectorError {
  code:
    | "COLLECTOR_DISABLED"
    | "COMMAND_NOT_ALLOWED"
    | "MUTATION_BLOCKED"
    | "COMMAND_TIMEOUT"
    | "COMMAND_FAILED"
    | "INVALID_JSON";
  message: string;
  stderr?: string | undefined;
}

export const tossInvestCliCollectorErrorSchema = z
  .object({
    code: z.enum([
      "COLLECTOR_DISABLED",
      "COMMAND_NOT_ALLOWED",
      "MUTATION_BLOCKED",
      "COMMAND_TIMEOUT",
      "COMMAND_FAILED",
      "INVALID_JSON"
    ]),
    message: z.string().min(1),
    stderr: z.string().optional()
  })
  .strict();

export const tossInvestCliSourceMetadataSchema = z
  .object({
    source: z.literal("tossinvest_cli"),
    sourceKind: z.literal("unofficial_read_only"),
    official: z.literal(false),
    commandKey: z.string().min(1),
    collectedAt: z.string().min(1)
  })
  .strict();

export const tossInvestCliCollectResultSchema = z
  .object({
    status: z.enum(["ok", "blocked", "degraded"]),
    commandKey: z.string().min(1),
    data: z.unknown().nullable(),
    metadata: tossInvestCliSourceMetadataSchema,
    error: tossInvestCliCollectorErrorSchema.nullable()
  })
  .strict();

export function isTossInvestReadOnlyCommandKey(
  commandKey: string
): commandKey is TossInvestReadOnlyCommandKey {
  return allowedCommandKeys.has(commandKey);
}

const allowedCommandKeys = new Set<string>(tossInvestReadOnlyCommandKeys);
const blockedCommandGroups = new Set([
  "order",
  "auth",
  "config",
  "watchlist",
  "transactions",
  "account",
  "portfolio",
  "orders"
]);

export class TossInvestCliReadOnlyCollector {
  private readonly runner: ProcessRunner;

  constructor(
    private readonly config: TossInvestCliCollectorConfig,
    dependencies: { runner?: ProcessRunner } = {}
  ) {
    this.runner = dependencies.runner ?? new NodeProcessRunner();
  }

  async collect(
    input: TossInvestCliCollectInput
  ): Promise<TossInvestCliCollectResult> {
    const metadata = createMetadata(input.commandKey);

    if (!this.config.enabled) {
      return blocked(input.commandKey, metadata, {
        code: "COLLECTOR_DISABLED",
        message: "TossInvest CLI collector is disabled"
      });
    }

    const validationError = validateInput(input);
    if (validationError) {
      return blocked(input.commandKey, metadata, validationError);
    }

    const args = [...commandKeyToArgs(input.commandKey), ...(input.args ?? []), "--output", "json"];
    const result = await this.runner.run(this.config.tossctlPath, args, {
      timeoutMs: this.config.timeoutMs
    });

    if (result.timedOut) {
      return degraded(input.commandKey, metadata, {
        code: "COMMAND_TIMEOUT",
        message: "tossctl command timed out",
        stderr: result.stderr
      });
    }

    if (result.exitCode !== 0) {
      return degraded(input.commandKey, metadata, {
        code: "COMMAND_FAILED",
        message: `tossctl exited with code ${result.exitCode}`,
        stderr: result.stderr
      });
    }

    try {
      return {
        status: "ok",
        commandKey: input.commandKey,
        data: JSON.parse(result.stdout),
        metadata,
        error: null
      };
    } catch {
      return degraded(input.commandKey, metadata, {
        code: "INVALID_JSON",
        message: "tossctl output was not valid JSON",
        stderr: result.stderr
      });
    }
  }
}

function validateInput(
  input: TossInvestCliCollectInput
): TossInvestCliCollectorError | null {
  if (!allowedCommandKeys.has(input.commandKey)) {
    return {
      code: "COMMAND_NOT_ALLOWED",
      message: `command key is not allowlisted: ${input.commandKey}`
    };
  }

  const group = input.commandKey.split(".")[0] ?? "";
  if (blockedCommandGroups.has(group)) {
    return {
      code: "MUTATION_BLOCKED",
      message: `command group is blocked: ${group}`
    };
  }

  if ((input.args ?? []).some((arg) => arg === "--execute")) {
    return {
      code: "MUTATION_BLOCKED",
      message: "`--execute` is not allowed for read-only collection"
    };
  }

  return null;
}

function commandKeyToArgs(commandKey: string): string[] {
  return commandKey.split(".");
}

function createMetadata(commandKey: string): TossInvestCliSourceMetadata {
  return {
    source: "tossinvest_cli",
    sourceKind: "unofficial_read_only",
    official: false,
    commandKey,
    collectedAt: new Date().toISOString()
  };
}

function blocked(
  commandKey: string,
  metadata: TossInvestCliSourceMetadata,
  error: TossInvestCliCollectorError
): TossInvestCliCollectResult {
  return {
    status: "blocked",
    commandKey,
    data: null,
    metadata,
    error
  };
}

function degraded(
  commandKey: string,
  metadata: TossInvestCliSourceMetadata,
  error: TossInvestCliCollectorError
): TossInvestCliCollectResult {
  return {
    status: "degraded",
    commandKey,
    data: null,
    metadata,
    error
  };
}
