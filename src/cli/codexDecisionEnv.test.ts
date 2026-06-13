import assert from "node:assert/strict";
import test from "node:test";

import { readHistoricalCodexDecisionEnv } from "./codexDecisionEnv.js";

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
