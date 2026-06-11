import "../config/loadEnv.js";

import {
  collectTossInvestReadOnlySources,
  parseTossInvestCollectionConfig
} from "../collectors/tossInvestCollectionWorkflow.js";

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const commands = readArgValue("--commands") ?? process.env.TOSSINVEST_CLI_COLLECTION_COMMANDS;

const configInput: {
  enabled?: string;
  tossctlPath?: string;
  timeoutSeconds?: string;
  commands?: string;
} = {};
if (process.env.TOSSINVEST_CLI_ENABLED !== undefined) {
  configInput.enabled = process.env.TOSSINVEST_CLI_ENABLED;
}
if (process.env.TOSSINVEST_CLI_PATH !== undefined) {
  configInput.tossctlPath = process.env.TOSSINVEST_CLI_PATH;
}
if (process.env.TOSSINVEST_CLI_TIMEOUT_SECONDS !== undefined) {
  configInput.timeoutSeconds = process.env.TOSSINVEST_CLI_TIMEOUT_SECONDS;
}
if (commands !== undefined) {
  configInput.commands = commands;
}

const summary = await collectTossInvestReadOnlySources({
  storageBaseDir: dataDir,
  config: parseTossInvestCollectionConfig(configInput)
});

console.log(
  [
    "TossInvest read-only collection summary",
    `status=${summary.status}`,
    `requested=${summary.requestedCount}`,
    `saved=${summary.savedCount}`,
    `ok=${summary.okCount}`,
    `degraded=${summary.degradedCount}`,
    `blocked=${summary.blockedCount}`,
    `skipped=${summary.skippedCommands.join(",") || "none"}`,
    `audit_event_id=${summary.auditEventId ?? "none"}`
  ].join("\n")
);

process.exitCode = 0;

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
