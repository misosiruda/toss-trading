import {
  appendDefinition,
  clear
} from "./dom.js";
import { formatDateTime } from "./formatters.js";
import { registerSymbolMetadata } from "./metadata.js";
import { benchmarkPackets } from "./portfolioModel.js";
import { summarizeRecord } from "./reportViewHelpers.js";

export function rememberSymbolMetadata(data) {
  for (const packet of benchmarkPackets(data)) {
    for (const candidate of packet?.candidates ?? []) {
      registerSymbolMetadata(candidate);
    }
  }
  for (const position of data?.portfolio?.portfolio?.positions ?? []) {
    registerSymbolMetadata(position);
  }
  for (const position of data?.replayProgress?.progress?.currentPortfolio?.positions ?? []) {
    registerSymbolMetadata(position);
  }
  for (const trade of data?.trades?.trades ?? data?.replayProgress?.progress?.recentTrades ?? []) {
    registerSymbolMetadata(trade);
  }
}

export function renderSourceSummary(source, scheduler) {
  const list = document.getElementById("source-summary");
  clear(list);
  appendDefinition(list, "수집 건수", String(source.totalCount ?? 0));
  appendDefinition(list, "최근 수집", formatDateTime(source.lastCollectedAt));
  appendDefinition(list, "오류 라인", String(source.corruptLineCount ?? 0));
  appendDefinition(list, "명령", summarizeRecord(source.byCommandKey));
  appendDefinition(list, "스케줄러", scheduler?.stateStatus ?? "unknown");
}
