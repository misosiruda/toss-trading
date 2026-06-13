export interface HistoricalCodexDecisionEnv {
  maxRunsPerDay: number;
  allowWebSearch: boolean;
  outputSchemaPath?: string;
}

export function readHistoricalCodexDecisionEnv(
  env: NodeJS.ProcessEnv = process.env
): HistoricalCodexDecisionEnv {
  const outputSchemaPath = readFirstEnvValue(env, [
    "AI_DECISION_OUTPUT_SCHEMA_PATH",
    "CODEX_OUTPUT_SCHEMA_PATH"
  ]);

  return {
    maxRunsPerDay: Number(
      readFirstEnvValue(env, [
        "AI_DECISION_MAX_RUNS_PER_DAY",
        "CODEX_DECISION_MAX_RUNS_PER_DAY"
      ]) ?? 5
    ),
    allowWebSearch: readFirstEnvValue(env, [
      "CODEX_ALLOW_WEB_SEARCH",
      "CODEX_DECISION_ALLOW_WEB_SEARCH"
    ]) === "true",
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
