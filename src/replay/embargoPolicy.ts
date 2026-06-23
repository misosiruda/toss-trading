import {
  validationSplitExclusionSummarySchema,
  validationSplitSchema,
  type ValidationSplit,
  type ValidationSplitExclusionSummary
} from "./validationProtocol.js";

export type ValidationSampleExclusionReason = "embargo";

export interface ValidationEmbargoPolicyInput<TSample> {
  split: ValidationSplit;
  samples: readonly TSample[];
  getSampleTimestamp: (sample: TSample) => Date | string;
}

export interface ValidationExcludedSample<TSample> {
  sample: TSample;
  observedAt: string;
  reason: ValidationSampleExclusionReason;
}

export interface ValidationEmbargoPolicyResult<TSample> {
  includedTrainSamples: TSample[];
  excludedTrainSamples: ValidationExcludedSample<TSample>[];
  summary: ValidationSplitExclusionSummary;
}

interface EmbargoWindow {
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function applyValidationEmbargoPolicy<TSample>(
  input: ValidationEmbargoPolicyInput<TSample>
): ValidationEmbargoPolicyResult<TSample> {
  const split = validationSplitSchema.parse(input.split);
  const trainStartMs = Date.parse(split.trainStart);
  const trainEndMs = Date.parse(split.trainEnd);
  const embargoWindow = buildEmbargoWindow(split);
  const includedTrainSamples: TSample[] = [];
  const excludedTrainSamples: ValidationExcludedSample<TSample>[] = [];
  let trainCandidateSampleCount = 0;

  for (const sample of input.samples) {
    const observedAt = normalizeSampleTimestamp(
      input.getSampleTimestamp(sample)
    );
    const observedMs = Date.parse(observedAt);

    if (observedMs < trainStartMs || observedMs > trainEndMs) {
      continue;
    }

    trainCandidateSampleCount += 1;
    if (
      embargoWindow !== null &&
      observedMs >= embargoWindow.startMs &&
      observedMs <= embargoWindow.endMs
    ) {
      excludedTrainSamples.push({
        sample,
        observedAt,
        reason: "embargo"
      });
      continue;
    }

    includedTrainSamples.push(sample);
  }

  const summary = validationSplitExclusionSummarySchema.parse({
    validationProtocol: split.validationProtocol,
    splitId: split.splitId,
    splitIndex: split.splitIndex,
    sampleCount: input.samples.length,
    trainCandidateSampleCount,
    includedTrainSampleCount: includedTrainSamples.length,
    excludedSampleCount: excludedTrainSamples.length,
    purgeExcludedSampleCount: 0,
    embargoExcludedSampleCount: excludedTrainSamples.length,
    purgeDurationDays: split.purgeDurationDays,
    embargoDurationDays: split.embargoDurationDays,
    embargoStart: embargoWindow?.startIso ?? null,
    embargoEnd: embargoWindow?.endIso ?? null
  });

  return {
    includedTrainSamples,
    excludedTrainSamples,
    summary
  };
}

function buildEmbargoWindow(split: ValidationSplit): EmbargoWindow | null {
  if (split.embargoDurationDays === 0) {
    return null;
  }

  const validationStartMs = Date.parse(split.validationStart);
  const startMs = validationStartMs - split.embargoDurationDays * DAY_MS;
  const endMs = validationStartMs - 1;

  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString()
  };
}

function normalizeSampleTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const timestampMs = date.getTime();

  if (!Number.isFinite(timestampMs)) {
    throw new Error("sample timestamp must be a valid date");
  }

  return new Date(timestampMs).toISOString();
}
