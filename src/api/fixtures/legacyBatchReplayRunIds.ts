// 공개 producer의 ID 함수만 추출한 테스트 fixture입니다. 전체 과거 workflow 실행을 뜻하지 않습니다.
import { safeArtifactPathPart } from "../../storage/artifactPaths.js";
type ReplayWindowSelection = { selectedMonth: string };

// 정본: 48f94577
export function legacy48RunId(
  batchId: string,
  runIndex: number,
  window: ReplayWindowSelection
): string {
  const paddedIndex = String(runIndex).padStart(6, "0");
  return `${safePathPart(batchId)}_run_${paddedIndex}_${window.selectedMonth.replace(
    "-",
    ""
  )}`;
}


function safePathPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length === 0 ? "batch" : sanitized;
}


// 정본: 1b9f5544
export function legacy1bRunId(
  batchId: string,
  runIndex: number,
  window: ReplayWindowSelection
): string {
  const paddedIndex = String(runIndex).padStart(6, "0");
  return `${safeArtifactPathPart(
    batchId,
    "batch"
  )}_run_${paddedIndex}_${window.selectedMonth.replace("-", "")}`;
}


// 정본: 8b10b6c6
export function legacy8bRunId(
  batchId: string,
  runIndex: number,
  window: ReplayWindowSelection
): string {
  const paddedIndex = String(runIndex).padStart(6, "0");
  return `${safeArtifactPathPart(
    batchId,
    "batch"
  )}_run_${paddedIndex}_${window.selectedMonth.replace("-", "")}`;
}


export const legacyProducerIdFunctions = [{ version: "48f94577", create: legacy48RunId }, { version: "1b9f5544", create: legacy1bRunId }, { version: "8b10b6c6", create: legacy8bRunId }];

