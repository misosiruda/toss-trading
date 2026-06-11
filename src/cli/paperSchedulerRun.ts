import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import {
  createPaperSchedulerPaths,
  PaperRunOnceSchedulerJob,
  PaperRunScheduler,
  type PaperRunTrigger
} from "../scheduler/paperRunScheduler.js";
import { StaticDecisionProvider } from "../workflows/paperRunOnce.js";

const args = new Set(process.argv.slice(2));
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const dryRun = args.has("--dry-run");
const trigger: PaperRunTrigger = args.has("--scheduled") ? "scheduled" : "manual";
const now = new Date();

const provider = dryRun
  ? new StaticDecisionProvider({
      packetId: "packet_mock_001",
      summary: "Scheduler dry-run mocked Codex decision.",
      decisions: [
        {
          market: "KR",
          symbol: "005930",
          action: "VIRTUAL_BUY",
          confidence: 0.7,
          budgetKrw: 70_000,
          thesis: "Scheduler dry-run paper-only virtual buy.",
          riskFactors: ["Dry-run paper trading risk."],
          dataRefs: ["mock_source_001"],
          expiresAt: new Date(now.getTime() + 300_000).toISOString()
        }
      ]
    })
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

const paths = createPaperSchedulerPaths(dataDir);
const scheduler = new PaperRunScheduler(
  {
    enabled: trigger === "manual" || process.env.PAPER_SCHEDULER_ENABLED === "true",
    storageBaseDir: dataDir,
    statePath: paths.statePath,
    lockPath: paths.lockPath,
    maxRunsPerDay: Number(process.env.PAPER_SCHEDULER_MAX_RUNS_PER_DAY ?? 1),
    scheduledTimeKst: process.env.PAPER_SCHEDULER_MARKET_CLOSE_KST ?? "15:40",
    failureBackoffSeconds: Number(
      process.env.PAPER_SCHEDULER_FAILURE_BACKOFF_SECONDS ?? 900
    ),
    lockTtlSeconds: Number(process.env.PAPER_SCHEDULER_LOCK_TTL_SECONDS ?? 900)
  },
  new PaperRunOnceSchedulerJob({
    storageBaseDir: dataDir,
    provider,
    initialCashKrw: Number(process.env.VIRTUAL_INITIAL_CASH_KRW ?? 1_000_000)
  })
);

const result = await scheduler.run({ trigger, now });

if (result.jobResult) {
  console.log(result.jobResult.report);
} else {
  console.log(`Paper scheduler ${result.status}: ${result.reason ?? "ok"}`);
}

process.exitCode = result.status === "completed" ? 0 : 1;

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
