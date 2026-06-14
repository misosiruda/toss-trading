import {
  parseWithSchema,
  virtualDecisionSchema,
  type MarketPacket,
  type VirtualDecision
} from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  InMemoryDailyRunBudget
} from "./runBudget.js";
import {
  NodeProcessRunner,
  type ProcessRunner
} from "./processRunner.js";
import {
  buildPaperDecisionPrompt,
  PAPER_DECISION_PROMPT_VERSION
} from "./decisionPrompt.js";
import {
  createDecisionIdentityMetadata,
  type VirtualDecisionIdentityMetadata
} from "../paper/decisionIdentity.js";

export interface CodexCliDecisionProviderConfig {
  enabled: boolean;
  codexPath: string;
  sandbox: "read-only";
  timeoutMs: number;
  maxRunsPerDay: number;
  allowWebSearch: boolean;
  outputSchemaPath?: string;
  modelId?: string;
  schemaVersion?: string;
  policyVersion?: string;
  prompt?: string;
  promptVersion?: string;
  ephemeral?: boolean;
  now?: () => Date;
}

export interface CodexCliDecisionResult {
  attempted: boolean;
  decision: VirtualDecision | null;
  failure: CodexCliDecisionFailure | null;
  command: CodexCliCommandPreview | null;
}

export interface CodexCliDecisionFailure {
  code: "AI_DECISION_DISABLED" | "AI_DECISION_FAILED" | "RUN_BUDGET_EXCEEDED";
  reason: string;
  stderr?: string;
}

export interface CodexCliCommandPreview {
  command: string;
  args: string[];
  promptVersion: string;
}

export class CodexCliDecisionProvider {
  private readonly runner: ProcessRunner;
  private readonly budget: InMemoryDailyRunBudget;

  constructor(
    private readonly config: CodexCliDecisionProviderConfig,
    dependencies: {
      runner?: ProcessRunner;
      budget?: InMemoryDailyRunBudget;
    } = {}
  ) {
    this.runner = dependencies.runner ?? new NodeProcessRunner();
    this.budget =
      dependencies.budget ?? new InMemoryDailyRunBudget(config.maxRunsPerDay);
  }

  async decide(packet: MarketPacket): Promise<CodexCliDecisionResult> {
    const now = this.config.now?.() ?? new Date();
    const command = this.buildCommand();

    if (!this.config.enabled) {
      return {
        attempted: false,
        decision: null,
        failure: {
          code: "AI_DECISION_DISABLED",
          reason: "Codex CLI decision provider is disabled"
        },
        command
      };
    }

    if (!this.budget.canConsume(now)) {
      return {
        attempted: false,
        decision: null,
        failure: {
          code: "RUN_BUDGET_EXCEEDED",
          reason: "Daily Codex CLI decision budget is exhausted"
        },
        command
      };
    }

    this.budget.consume(now);

    const result = await this.runner.run(
      command.command,
      command.args,
      {
        stdin: `${JSON.stringify(
          createDecisionInput(
            packet,
            createDecisionIdentityMetadata(
              decisionIdentityInput(command.promptVersion, this.config)
            )
          )
        )}\n`,
        timeoutMs: this.config.timeoutMs
      }
    );

    if (result.timedOut) {
      return failure(command, "timeout", result.stderr);
    }

    if (result.exitCode !== 0) {
      return failure(command, `exit_code_${result.exitCode}`, result.stderr);
    }

    try {
      const decision = parseVirtualDecisionFromStdout(result.stdout);
      return { attempted: true, decision, failure: null, command };
    } catch (error) {
      return failure(
        command,
        error instanceof Error ? error.message : "invalid_json",
        result.stderr
      );
    }
  }

  buildCommand(): CodexCliCommandPreview {
    const args = [
      "exec",
      "--sandbox",
      this.config.sandbox,
      ...this.optionalEphemeralArgs(),
      ...this.optionalOutputSchemaArgs(),
      ...this.optionalWebSearchArgs(),
      this.config.prompt ?? buildPaperDecisionPrompt()
    ];

    return {
      command: this.config.codexPath,
      args,
      promptVersion: this.config.promptVersion ?? PAPER_DECISION_PROMPT_VERSION
    };
  }

  private optionalOutputSchemaArgs(): string[] {
    return this.config.outputSchemaPath
      ? ["--output-schema", this.config.outputSchemaPath]
      : [];
  }

  private optionalEphemeralArgs(): string[] {
    return this.config.ephemeral === true ? ["--ephemeral"] : [];
  }

  private optionalWebSearchArgs(): string[] {
    return this.config.allowWebSearch ? ["--search"] : [];
  }
}

function decisionIdentityInput(
  promptVersion: string,
  config: Pick<
    CodexCliDecisionProviderConfig,
    "modelId" | "schemaVersion" | "policyVersion"
  >
): Parameters<typeof createDecisionIdentityMetadata>[0] {
  return {
    promptVersion,
    ...(config.modelId ? { modelId: config.modelId } : {}),
    ...(config.schemaVersion ? { schemaVersion: config.schemaVersion } : {}),
    ...(config.policyVersion ? { policyVersion: config.policyVersion } : {})
  };
}

function createDecisionInput(
  packet: MarketPacket,
  metadata: VirtualDecisionIdentityMetadata
): {
  packetHash: string;
  promptVersion: string;
  modelId: string;
  schemaVersion: string;
  policyVersion: string;
  marketPacket: MarketPacket;
} {
  return {
    packetHash: createMarketPacketHash(packet),
    promptVersion: metadata.promptVersion,
    modelId: metadata.modelId,
    schemaVersion: metadata.schemaVersion,
    policyVersion: metadata.policyVersion,
    marketPacket: packet
  };
}

function failure(
  command: CodexCliCommandPreview,
  reason: string,
  stderr?: string
): CodexCliDecisionResult {
  const base = {
    attempted: true,
    decision: null,
    failure: {
      code: "AI_DECISION_FAILED" as const,
      reason
    },
    command
  };

  if (stderr) {
    return {
      ...base,
      failure: {
        ...base.failure,
        stderr
      }
    };
  }

  return base;
}

function parseVirtualDecisionFromStdout(stdout: string): VirtualDecision {
  const direct = tryParseVirtualDecision(stdout.trim());
  if (direct !== null) {
    return direct;
  }

  for (const candidate of extractJsonObjectCandidates(stdout)) {
    const decision = tryParseVirtualDecision(candidate);
    if (decision !== null) {
      return decision;
    }
  }

  throw new Error("stdout did not contain a valid virtualDecision JSON object");
}

function tryParseVirtualDecision(value: string): VirtualDecision | null {
  if (!value) {
    return null;
  }

  try {
    return parseWithSchema(
      virtualDecisionSchema,
      JSON.parse(value),
      "virtualDecision"
    );
  } catch {
    return null;
  }
}

function extractJsonObjectCandidates(stdout: string): string[] {
  const candidates: string[] = [];

  for (let start = 0; start < stdout.length; start += 1) {
    if (stdout[start] !== "{") {
      continue;
    }

    const end = findJsonObjectEnd(stdout, start);
    if (end !== -1) {
      candidates.push(stdout.slice(start, end + 1));
      start = end;
    }
  }

  return candidates;
}

function findJsonObjectEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
