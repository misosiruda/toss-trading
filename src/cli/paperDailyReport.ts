import {
  buildPaperDailyReport,
  renderPaperDailyReport
} from "../reports/paperDailyReport.js";

const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const dataDir = readArgValue("--data-dir") ?? positionalArgs[0] ?? "data/paper";
const now = new Date();
const date = readArgValue("--date") ?? now.toISOString().slice(0, 10);

const report = await buildPaperDailyReport({
  storageBaseDir: dataDir,
  date,
  generatedAt: now
});

console.log(renderPaperDailyReport(report));

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}
