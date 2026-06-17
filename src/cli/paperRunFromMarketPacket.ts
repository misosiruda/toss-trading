import "../config/loadEnv.js";

import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { readCodexDecisionProviderConfig } from "./codexDecisionEnv.js";
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
  : new CodexCliDecisionProvider(readCodexDecisionProviderConfig());

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
