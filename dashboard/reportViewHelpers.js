import { formatDateTime } from "./formatters.js";

export function regimeLabel(label) {
  return {
    bull: "상승장",
    bear: "하락장",
    sideways: "횡보장",
    mixed: "혼합장",
    insufficient_data: "데이터 부족"
  }[label] ?? String(label ?? "-");
}

export function replayRangeText(range) {
  if (!range?.startAt && !range?.endAt) {
    return "-";
  }
  return `${formatDateTime(range.startAt)} - ${formatDateTime(range.endAt)} · ${range.tickCount ?? 0} ticks`;
}

export function summarizeRecord(value) {
  if (!value || typeof value !== "object") {
    return "none";
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    return "none";
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}
