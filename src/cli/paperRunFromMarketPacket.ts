import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import {
  MarketPacketDryRunDecisionProvider,
  runPaperDecisionFromLatestMarketPacket
} from "../workflows/paperRunFromMarketPacket.js";

const args = new Set(process.argv.slice(2));
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const dryRun = args.has("--dry-run");
const now = new Date();

const provider = dryRun
  ? new MarketPacketDryRunDecisionProvider()
  : new CodexCliDecisionProvider({
      enabled: process.env.AI_DECISION_ENABLED === "true",
      codexPath: process.env.CODEX_EXEC_PATH ?? "codex",
      sandbox: "read-only",
      timeoutMs: Number(process.env.CODEX_EXEC_TIMEOUT_SECONDS ?? 300) * 1000,
      maxRunsPerDay: Number(process.env.CODEX_DECISION_MAX_RUNS_PER_DAY ?? 3),
      allowWebSearch: process.env.CODEX_DECISION_ALLOW_WEB_SEARCH === "true",
      ...(process.env.CODEX_OUTPUT_SCHEMA_PATH
        ? { outputSchemaPath: process.env.CODEX_OUTPUT_SCHEMA_PATH }
        : {})
    });

const result = await runPaperDecisionFromLatestMarketPacket({
  storageBaseDir: dataDir,
  provider,
  now
});

console.log(result.report);
process.exitCode = result.status === "completed" ? 0 : 1;

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
