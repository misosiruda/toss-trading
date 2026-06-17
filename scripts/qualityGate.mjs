#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import {
  LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS,
  LOCAL_OPERATIONS_API_ROUTES,
  READ_ONLY_HTTP_METHODS
} from "../dist/api/localOperationsSurface.js";
import {
  readCodexDecisionProviderConfig,
  readHistoricalCodexDecisionEnv
} from "../dist/cli/codexDecisionEnv.js";
import { disabledByDefaultMcpToolNames } from "../dist/mcp/toolSurfacePolicy.js";
import { virtualPortfolioToolNames } from "../dist/mcp/virtualPortfolioTools.js";

const repoRoot = new URL("../", import.meta.url);
const failures = [];

function readText(path) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function assertDeepEqual(actual, expected, label) {
  assert(
    isDeepStrictEqual(actual, expected),
    `${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
}

function assertBacktickedName(text, name, label) {
  assertIncludes(text, `\`${name}\``, label);
}

const packageJson = readJson("package.json");
const dashboardScript = readText("dashboard/app.js");
const dashboardModuleImports = readDashboardModuleImportGraph("app.js");
const dashboardApiClientScript = readText("dashboard/apiClient.js");
const localOperationsServerSource = readText("src/api/localOperationsServer.ts");
const mcpToolsDoc = readText("docs/mcp-tools.md");
const llmBoundaryDoc = readText("docs/llm-boundary.md");
const dashboardEndpointPaths = readDashboardEndpointPaths(
  dashboardApiClientScript
);

assert(
  JSON.stringify(READ_ONLY_HTTP_METHODS) === JSON.stringify(["GET", "HEAD"]),
  "READ_ONLY_HTTP_METHODS must stay exactly GET/HEAD"
);

assertDeepEqual(
  readCodexDecisionProviderConfig({}),
  {
    enabled: false,
    codexPath: "codex",
    sandbox: "read-only",
    timeoutMs: 300_000,
    maxRunsPerDay: 3,
    allowWebSearch: false
  },
  "default Codex decision provider config"
);
assertDeepEqual(
  readHistoricalCodexDecisionEnv({}),
  {
    maxRunsPerDay: 5,
    allowWebSearch: false
  },
  "default historical Codex decision env"
);
assertDeepEqual(
  readCodexDecisionProviderConfig({
    AI_DECISION_OUTPUT_SCHEMA_PATH: "schemas/ai-schema.json",
    CODEX_OUTPUT_SCHEMA_PATH: "schemas/codex-schema.json",
    AI_DECISION_MAX_RUNS_PER_DAY: "40",
    CODEX_DECISION_MAX_RUNS_PER_DAY: "3",
    CODEX_ALLOW_WEB_SEARCH: "false",
    CODEX_DECISION_ALLOW_WEB_SEARCH: "true"
  }),
  {
    enabled: false,
    codexPath: "codex",
    sandbox: "read-only",
    timeoutMs: 300_000,
    maxRunsPerDay: 40,
    allowWebSearch: false,
    outputSchemaPath: "schemas/ai-schema.json"
  },
  "Codex decision provider AI_* alias precedence"
);

for (const route of LOCAL_OPERATIONS_API_ROUTES) {
  assert(
    dashboardEndpointPaths.has(route),
    `dashboard endpoints must include exact route ${route}`
  );
}

for (const fileName of dashboardModuleImports) {
  assert(
    LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS.includes(`/dashboard/${fileName}`),
    `dashboard asset allowlist must include /dashboard/${fileName}`
  );
  assert(
    LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS.includes(`/${fileName}`),
    `dashboard asset allowlist must include /${fileName}`
  );
}

assertIncludes(
  localOperationsServerSource,
  "routeRequest",
  "src/api/localOperationsServer.ts"
);
assertIncludes(
  localOperationsServerSource,
  "readDashboardAsset",
  "src/api/localOperationsServer.ts"
);
for (const forbiddenImport of [
  "../reports/",
  "../scheduler/",
  "../security/",
  "../storage/"
]) {
  assert(
    !localOperationsServerSource.includes(forbiddenImport),
    `src/api/localOperationsServer.ts must delegate ${forbiddenImport} imports`
  );
}

for (const toolName of virtualPortfolioToolNames) {
  assertBacktickedName(mcpToolsDoc, toolName, "docs/mcp-tools.md");
  assertBacktickedName(llmBoundaryDoc, toolName, "docs/llm-boundary.md");
}

for (const disabledToolName of disabledByDefaultMcpToolNames) {
  assert(
    !virtualPortfolioToolNames.includes(disabledToolName),
    `${disabledToolName} must not be an enabled MCP tool`
  );
  assertBacktickedName(mcpToolsDoc, disabledToolName, "docs/mcp-tools.md");
  assertBacktickedName(llmBoundaryDoc, disabledToolName, "docs/llm-boundary.md");
}

assert(
  packageJson.scripts?.build === "tsc -p tsconfig.json",
  "package.json scripts.build must stay tsc -p tsconfig.json"
);
assert(
  typeof packageJson.scripts?.test === "string" &&
    packageJson.scripts.test.includes("npm run build") &&
    packageJson.scripts.test.includes("node --test"),
  "package.json scripts.test must build before running node --test"
);
assert(
  typeof packageJson.scripts?.["quality:gate"] === "string" &&
    packageJson.scripts["quality:gate"].includes("npm run build") &&
    packageJson.scripts["quality:gate"].includes("scripts/qualityGate.mjs"),
  "package.json scripts.quality:gate must build before running qualityGate.mjs"
);
assert(
  typeof packageJson.scripts?.check === "string" &&
    packageJson.scripts.check.includes("npm run quality:gate") &&
    packageJson.scripts.check.includes("node --test"),
  "package.json scripts.check must run quality:gate and node --test"
);

if (failures.length > 0) {
  console.error("[quality:gate] failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("[quality:gate] ok");
}

function readDashboardEndpointPaths(source) {
  const endpointBlockMatch = source.match(
    /const endpoints = \{(?<body>[\s\S]*?)\};/
  );
  assert(
    endpointBlockMatch?.groups?.body !== undefined,
    "dashboard endpoints object must be present"
  );

  const paths = new Set();
  const body = endpointBlockMatch?.groups?.body ?? "";
  for (const match of body.matchAll(/:\s*"(?<endpoint>[^"]+)"/g)) {
    const endpoint = match.groups?.endpoint;
    if (endpoint === undefined) {
      continue;
    }
    paths.add(new URL(endpoint, "http://127.0.0.1").pathname);
  }
  return paths;
}

function readDashboardModuleImportGraph(entryFileName, visited = new Set()) {
  const source = readText(`dashboard/${entryFileName}`);
  for (const fileName of readDashboardModuleImports(source)) {
    if (visited.has(fileName)) {
      continue;
    }
    visited.add(fileName);
    readDashboardModuleImportGraph(fileName, visited);
  }
  return visited;
}

function readDashboardModuleImports(source) {
  const imports = new Set();
  for (const match of source.matchAll(/from\s+"\.\/(?<fileName>[^"]+\.js)"/g)) {
    const fileName = match.groups?.fileName;
    if (fileName !== undefined) {
      imports.add(fileName);
    }
  }
  return imports;
}
