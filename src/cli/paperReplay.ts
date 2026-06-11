import { PAPER_DECISION_PROMPT_VERSION } from "../ai/decisionPrompt.js";
import { runStoredPaperReplay } from "../replay/paperReplay.js";

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const now = new Date();

const result = await runStoredPaperReplay({
  storageBaseDir: dataDir,
  now,
  promptVersion: process.env.CODEX_PROMPT_VERSION ?? PAPER_DECISION_PROMPT_VERSION
});

console.log(
  [
    "Paper replay summary",
    `status=${result.status}`,
    `packet_id=${result.packetId ?? "none"}`,
    `prompt_version=${result.promptVersion}`,
    `decision_items=${result.decisionItemCount}`,
    `paper_trade_count=${result.tradeCount}`,
    `rejected_count=${result.rejectedCount}`,
    `failure_reason=${result.failureReason ?? "none"}`,
    `packet_records=${result.packetRecordCount}`,
    `decision_records=${result.decisionRecordCount}`,
    `corrupt_packet_lines=${result.packetCorruptLineCount}`,
    `corrupt_decision_lines=${result.decisionCorruptLineCount}`
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
