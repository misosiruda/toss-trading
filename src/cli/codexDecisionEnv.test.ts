import assert from "node:assert/strict";
import test from "node:test";

import {
  readCodexDecisionProviderConfig,
  readHistoricalCodexDecisionEnv
} from "./codexDecisionEnv.js";

test("Codex decision provider env keeps safe paper defaults", () => {
  const config = readCodexDecisionProviderConfig({});

  assert.deepEqual(config, {
    enabled: false,
    codexPath: "codex",
    sandbox: "read-only",
    timeoutMs: 300_000,
    maxRunsPerDay: 3,
    allowWebSearch: false
  });
});

test("Codex decision provider env prefers AI decision aliases", () => {
  const config = readCodexDecisionProviderConfig({
    AI_DECISION_ENABLED: "true",
    CODEX_EXEC_PATH: "C:\\Codex\\codex.exe",
    CODEX_EXEC_TIMEOUT_SECONDS: "120",
    AI_DECISION_MODEL_ID: "gpt-5.3-codex-spark",
    CODEX_MODEL: "gpt-5.5",
    AI_DECISION_OUTPUT_SCHEMA_PATH: "schemas/ai-schema.json",
    CODEX_OUTPUT_SCHEMA_PATH: "schemas/codex-schema.json",
    AI_DECISION_MAX_RUNS_PER_DAY: "40",
    CODEX_DECISION_MAX_RUNS_PER_DAY: "3",
    CODEX_ALLOW_WEB_SEARCH: "true",
    CODEX_DECISION_ALLOW_WEB_SEARCH: "false"
  });

  assert.deepEqual(config, {
    enabled: true,
    codexPath: "C:\\Codex\\codex.exe",
    sandbox: "read-only",
    timeoutMs: 120_000,
    maxRunsPerDay: 40,
    allowWebSearch: true,
    modelId: "gpt-5.3-codex-spark",
    outputSchemaPath: "schemas/ai-schema.json"
  });
});

test("Codex decision provider env supports per-run overrides", () => {
  const config = readCodexDecisionProviderConfig(
    {
      AI_DECISION_ENABLED: "false",
      CODEX_DECISION_MAX_RUNS_PER_DAY: "20"
    },
    {
      enabled: true,
      maxRunsPerDay: 5,
      ephemeral: true
    }
  );

  assert.deepEqual(config, {
    enabled: true,
    codexPath: "codex",
    sandbox: "read-only",
    timeoutMs: 300_000,
    maxRunsPerDay: 5,
    allowWebSearch: false,
    ephemeral: true
  });
});

test("historical Codex decision env accepts CODEX_* aliases", () => {
  const config = readHistoricalCodexDecisionEnv({
    CODEX_OUTPUT_SCHEMA_PATH: "schemas/virtual-decision.schema.json",
    CODEX_DECISION_MAX_RUNS_PER_DAY: "12",
    CODEX_DECISION_ALLOW_WEB_SEARCH: "true"
  });

  assert.deepEqual(config, {
    outputSchemaPath: "schemas/virtual-decision.schema.json",
    maxRunsPerDay: 12,
    allowWebSearch: true
  });
});

test("historical Codex decision env prefers AI_DECISION_* values", () => {
  const config = readHistoricalCodexDecisionEnv({
    AI_DECISION_OUTPUT_SCHEMA_PATH: "schemas/ai-schema.json",
    CODEX_OUTPUT_SCHEMA_PATH: "schemas/codex-schema.json",
    AI_DECISION_MAX_RUNS_PER_DAY: "40",
    CODEX_DECISION_MAX_RUNS_PER_DAY: "3",
    CODEX_ALLOW_WEB_SEARCH: "false",
    CODEX_DECISION_ALLOW_WEB_SEARCH: "true"
  });

  assert.deepEqual(config, {
    outputSchemaPath: "schemas/ai-schema.json",
    maxRunsPerDay: 40,
    allowWebSearch: false
  });
});

test("historical Codex decision env falls back to safe defaults", () => {
  const config = readHistoricalCodexDecisionEnv({});

  assert.deepEqual(config, {
    maxRunsPerDay: 5,
    allowWebSearch: false
  });
});
