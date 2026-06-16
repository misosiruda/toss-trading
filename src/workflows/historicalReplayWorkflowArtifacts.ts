import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HistoricalReplayReport } from "../reports/historicalReplayReport.js";

export async function writeHistoricalReplayReportArtifact(input: {
  reportPath: string;
  report: HistoricalReplayReport;
}): Promise<void> {
  await mkdir(dirname(input.reportPath), { recursive: true });
  await writeFile(
    input.reportPath,
    `${JSON.stringify(input.report, null, 2)}\n`,
    "utf8"
  );
}
