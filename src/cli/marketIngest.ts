import "../config/loadEnv.js";

import { ingestMarketDataFromStoredTossInvestSources } from "../workflows/marketDataIngestion.js";

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const now = new Date();

const result = await ingestMarketDataFromStoredTossInvestSources({
  storageBaseDir: dataDir,
  now,
  sourceMaxAgeSeconds: Number(process.env.MARKET_SOURCE_MAX_AGE_SECONDS ?? 900),
  candidateTtlSeconds: Number(process.env.MARKET_CANDIDATE_TTL_SECONDS ?? 300),
  packetTtlSeconds: Number(process.env.MARKET_PACKET_TTL_SECONDS ?? 300),
  maxCandidates: Number(process.env.MARKET_PACKET_MAX_CANDIDATES ?? 10),
  initialCashKrw: Number(process.env.VIRTUAL_INITIAL_CASH_KRW ?? 1_000_000),
  constraints: {
    maxNewPositions: Number(process.env.PAPER_MAX_NEW_POSITIONS ?? 3),
    maxBudgetPerSymbolKrw: Number(process.env.MAX_ORDER_AMOUNT_KRW ?? 100_000),
    allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
  }
});

console.log(
  [
    "Market ingestion summary",
    `status=${result.status}`,
    `packet_id=${result.packetId ?? "none"}`,
    `candidate_count=${result.candidateCount}`,
    `source_count=${result.sourceCount}`,
    `source_corrupt_line_count=${result.sourceCorruptLineCount}`,
    `warning_count=${result.warnings.length}`,
    `audit_events=${result.auditEventIds.length}`
  ].join("\n")
);

process.exitCode = result.status === "completed" ? 0 : 1;

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
