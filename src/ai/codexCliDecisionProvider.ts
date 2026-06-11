import {
  parseWithSchema,
  virtualDecisionSchema,
  type MarketPacket,
  type VirtualDecision
} from "../domain/schemas.js";
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

export interface CodexCliDecisionProviderConfig {
  enabled: boolean;
  codexPath: string;
  sandbox: "read-only";
  timeoutMs: number;
  maxRunsPerDay: number;
  allowWebSearch: boolean;
  outputSchemaPath?: string;
  prompt?: string;
  promptVersion?: string;
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

    const result = await this.runner.run(command.command, command.args, {
      stdin: `${JSON.stringify(packet)}\n`,
      timeoutMs: this.config.timeoutMs
    });

    if (result.timedOut) {
      return failure(command, "timeout", result.stderr);
    }

    if (result.exitCode !== 0) {
      return failure(command, `exit_code_${result.exitCode}`, result.stderr);
    }

    try {
      const decision = parseWithSchema(
        virtualDecisionSchema,
        JSON.parse(result.stdout.trim()),
        "virtualDecision"
      );
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

  private optionalWebSearchArgs(): string[] {
    return this.config.allowWebSearch ? ["--search"] : [];
  }
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
