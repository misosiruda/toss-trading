import type { CodexCliDecisionProviderConfig } from "../ai/codexCliDecisionProvider.js";

export interface HistoricalCodexDecisionEnv {
  maxRunsPerDay: number;
  allowWebSearch: boolean;
  outputSchemaPath?: string;
}

export interface CodexDecisionProviderEnvOptions {
  defaultMaxRunsPerDay?: number;
  enabled?: boolean;
  maxRunsPerDay?: number;
  ephemeral?: boolean;
}

export function readCodexDecisionProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: CodexDecisionProviderEnvOptions = {}
): CodexCliDecisionProviderConfig {
  const outputSchemaPath = readFirstEnvValue(env, [
    "AI_DECISION_OUTPUT_SCHEMA_PATH",
    "CODEX_OUTPUT_SCHEMA_PATH"
  ]);
  return {
    enabled: options.enabled ?? env.AI_DECISION_ENABLED === "true",
    codexPath: readFirstEnvValue(env, ["CODEX_EXEC_PATH"]) ?? "codex",
    sandbox: "read-only",
    timeoutMs:
      Number(readFirstEnvValue(env, ["CODEX_EXEC_TIMEOUT_SECONDS"]) ?? 300) *
      1000,
    maxRunsPerDay:
      options.maxRunsPerDay ??
      Number(
        readFirstEnvValue(env, [
          "AI_DECISION_MAX_RUNS_PER_DAY",
          "CODEX_DECISION_MAX_RUNS_PER_DAY"
        ]) ??
          options.defaultMaxRunsPerDay ??
          3
      ),
    allowWebSearch:
      readFirstEnvValue(env, [
        "CODEX_ALLOW_WEB_SEARCH",
        "CODEX_DECISION_ALLOW_WEB_SEARCH"
      ]) === "true",
    ...(outputSchemaPath === undefined ? {} : { outputSchemaPath }),
    ...(options.ephemeral === true ? { ephemeral: true } : {})
  };
}

export function readHistoricalCodexDecisionEnv(
  env: NodeJS.ProcessEnv = process.env
): HistoricalCodexDecisionEnv {
  const config = readCodexDecisionProviderConfig(env, {
    defaultMaxRunsPerDay: 5
  });
  const { maxRunsPerDay, allowWebSearch, outputSchemaPath } = config;
  return {
    maxRunsPerDay,
    allowWebSearch,
    ...(outputSchemaPath === undefined ? {} : { outputSchemaPath })
  };
}

function readFirstEnvValue(
  env: NodeJS.ProcessEnv,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}
