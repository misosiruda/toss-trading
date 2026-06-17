import "../config/loadEnv.js";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readCodexDecisionProviderConfig } from "./codexDecisionEnv.js";
import {
  runPaperDecisionOnce,
  StaticDecisionProvider
} from "../workflows/paperRunOnce.js";

const args = new Set(process.argv.slice(2));
const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const dryRun = args.has("--dry-run");
const now = new Date();

const provider = dryRun
  ? new StaticDecisionProvider({
      packetId: "packet_mock_001",
      summary: "Dry-run mocked Codex decision.",
      decisions: [
        {
          market: "KR",
          symbol: "005930",
          action: "VIRTUAL_BUY",
          confidence: 0.7,
          budgetKrw: 70_000,
          thesis: "Dry-run paper-only virtual buy.",
          riskFactors: ["Dry-run paper trading risk."],
          dataRefs: ["mock_source_001"],
          claimSupport: [
            {
              claim: "Dry-run paper-only virtual buy.",
              dataRefs: ["mock_source_001"]
            }
          ],
          expiresAt: new Date(now.getTime() + 300_000).toISOString()
        }
      ]
    })
  : new CodexCliDecisionProvider(readCodexDecisionProviderConfig());

const result = await runPaperDecisionOnce({
  storageBaseDir: dataDir,
  provider,
  now,
  initialCashKrw: Number(process.env.VIRTUAL_INITIAL_CASH_KRW ?? 1_000_000)
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
