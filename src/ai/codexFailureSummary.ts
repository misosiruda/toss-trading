import type { CodexCliDecisionFailure } from "./codexCliDecisionProvider.js";

const MAX_FAILURE_SUMMARY_LENGTH = 800;
const MAX_STDERR_SUMMARY_LENGTH = 650;

export function summarizeCodexCliDecisionFailure(
  failure: CodexCliDecisionFailure | null | undefined
): string {
  if (failure === null || failure === undefined) {
    return "provider returned no decision";
  }

  const stderrSummary = summarizeCodexStderr(failure.stderr);
  return truncate(
    stderrSummary === null
      ? failure.reason
      : `${failure.reason}; stderr=${stderrSummary}`,
    MAX_FAILURE_SUMMARY_LENGTH
  );
}

function summarizeCodexStderr(stderr: string | undefined): string | null {
  if (stderr === undefined || stderr.trim().length === 0) {
    return null;
  }

  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const relevant = codexErrorLinesWithContext(lines);
  const selected = relevant.length > 0 ? relevant.slice(-12) : lines.slice(-5);
  return truncate(selected.join(" | "), MAX_STDERR_SUMMARY_LENGTH);
}

function codexErrorLinesWithContext(lines: string[]): string[] {
  const errorLineIndexes = lines
    .map((line, index) => (isCodexErrorLine(line) ? index : -1))
    .filter((index) => index >= 0)
    .slice(-3);
  const selected: string[] = [];
  for (const index of errorLineIndexes) {
    for (let offset = 0; offset < 6 && index + offset < lines.length; offset += 1) {
      const line = lines[index + offset];
      if (line !== undefined && !selected.includes(line)) {
        selected.push(line);
      }
    }
  }
  return selected.slice(-12);
}

function isCodexErrorLine(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    line.startsWith("ERROR") ||
    normalized.includes("failed to connect") ||
    normalized.includes("stream disconnected") ||
    normalized.includes("readonly database") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("api.openai.com") ||
    normalized.includes("output schema")
  );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
