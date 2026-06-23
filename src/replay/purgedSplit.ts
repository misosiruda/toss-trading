import { z } from "zod";

import { isoDateTimeSchema } from "../domain/schemas.js";

export const purgedKFoldValidationProtocolSchema = z.literal("purged_k_fold");

export const purgedKFoldSampleSchema = z
  .object({
    sampleId: z.string().trim().min(1),
    labelStart: isoDateTimeSchema,
    labelEnd: isoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.labelStart) > Date.parse(value.labelEnd)) {
      context.addIssue({
        code: "custom",
        message: "labelStart must be before or equal to labelEnd"
      });
    }
  });

export const purgedKFoldSplitSchema = z
  .object({
    validationProtocol: purgedKFoldValidationProtocolSchema,
    planId: z.string().trim().min(1),
    splitId: z.string().trim().min(1),
    splitIndex: z.number().int().nonnegative(),
    foldCount: z.number().int().min(2),
    sampleCount: z.number().int().nonnegative(),
    trainCandidateSampleCount: z.number().int().nonnegative(),
    includedTrainSampleCount: z.number().int().nonnegative(),
    testSampleCount: z.number().int().nonnegative(),
    excludedSampleCount: z.number().int().nonnegative(),
    purgeExcludedSampleCount: z.number().int().nonnegative(),
    embargoExcludedSampleCount: z.number().int().nonnegative(),
    purgeDurationDays: z.number().int().nonnegative(),
    embargoDurationDays: z.number().int().nonnegative(),
    testStart: isoDateTimeSchema,
    testEnd: isoDateTimeSchema,
    embargoStart: isoDateTimeSchema.nullable(),
    embargoEnd: isoDateTimeSchema.nullable(),
    trainSampleIds: z.array(z.string().trim().min(1)),
    testSampleIds: z.array(z.string().trim().min(1)),
    purgedSampleIds: z.array(z.string().trim().min(1)),
    embargoedSampleIds: z.array(z.string().trim().min(1))
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.includedTrainSampleCount + value.excludedSampleCount !==
      value.trainCandidateSampleCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "includedTrainSampleCount plus excludedSampleCount must equal trainCandidateSampleCount"
      });
    }
    if (
      value.purgeExcludedSampleCount + value.embargoExcludedSampleCount !==
      value.excludedSampleCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "purgeExcludedSampleCount plus embargoExcludedSampleCount must equal excludedSampleCount"
      });
    }
    if (
      value.testSampleCount + value.trainCandidateSampleCount !==
      value.sampleCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "testSampleCount plus trainCandidateSampleCount must equal sampleCount"
      });
    }
    if (Date.parse(value.testStart) > Date.parse(value.testEnd)) {
      context.addIssue({
        code: "custom",
        message: "testStart must be before or equal to testEnd"
      });
    }
    if (
      (value.embargoStart === null && value.embargoEnd !== null) ||
      (value.embargoStart !== null && value.embargoEnd === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "embargoStart and embargoEnd must both be null or both be present"
      });
      return;
    }
    if (
      value.embargoStart !== null &&
      value.embargoEnd !== null &&
      Date.parse(value.embargoStart) > Date.parse(value.embargoEnd)
    ) {
      context.addIssue({
        code: "custom",
        message: "embargoStart must be before or equal to embargoEnd"
      });
    }
    if (value.splitIndex >= value.foldCount) {
      context.addIssue({
        code: "custom",
        message: "splitIndex must be less than foldCount"
      });
    }
    validateArrayCount(
      context,
      value.testSampleIds,
      value.testSampleCount,
      "testSampleIds",
      "testSampleCount"
    );
    validateArrayCount(
      context,
      value.trainSampleIds,
      value.includedTrainSampleCount,
      "trainSampleIds",
      "includedTrainSampleCount"
    );
    validateArrayCount(
      context,
      value.purgedSampleIds,
      value.purgeExcludedSampleCount,
      "purgedSampleIds",
      "purgeExcludedSampleCount"
    );
    validateArrayCount(
      context,
      value.embargoedSampleIds,
      value.embargoExcludedSampleCount,
      "embargoedSampleIds",
      "embargoExcludedSampleCount"
    );
    validateSplitSampleIds(context, value);
  });

export const purgedKFoldPlanSchema = z
  .object({
    validationProtocol: purgedKFoldValidationProtocolSchema,
    planId: z.string().trim().min(1),
    foldCount: z.number().int().min(2),
    sampleCount: z.number().int().nonnegative(),
    embargoDurationDays: z.number().int().nonnegative(),
    splitCount: z.number().int().nonnegative(),
    splits: z.array(purgedKFoldSplitSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.splitCount !== value.splits.length) {
      context.addIssue({
        code: "custom",
        message: "splitCount must equal splits length"
      });
    }
    for (const split of value.splits) {
      if (split.planId !== value.planId) {
        context.addIssue({
          code: "custom",
          message: "split planId must match parent planId"
        });
      }
      if (split.foldCount !== value.foldCount) {
        context.addIssue({
          code: "custom",
          message: "split foldCount must match parent foldCount"
        });
      }
    }
  });

export type PurgedKFoldSample = z.infer<typeof purgedKFoldSampleSchema>;
export type PurgedKFoldSplit = z.infer<typeof purgedKFoldSplitSchema>;
export type PurgedKFoldPlan = z.infer<typeof purgedKFoldPlanSchema>;

export interface BuildPurgedKFoldPlanOptions {
  samples: readonly PurgedKFoldSample[];
  foldCount: number;
  embargoDurationDays?: number;
  planId?: string;
}

interface NormalizedPurgedKFoldSample extends PurgedKFoldSample {
  labelStartMs: number;
  labelEndMs: number;
}

const DEFAULT_EMBARGO_DURATION_DAYS = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildPurgedKFoldPlan(
  options: BuildPurgedKFoldPlanOptions
): PurgedKFoldPlan {
  validateOptions(options);

  const planId = normalizePlanId(options.planId);
  const embargoDurationDays =
    options.embargoDurationDays ?? DEFAULT_EMBARGO_DURATION_DAYS;
  const samples = normalizeSamples(options.samples);
  const foldRanges = contiguousFoldRanges(samples.length, options.foldCount);
  const splits = foldRanges.map((range, splitIndex) =>
    buildPurgedKFoldSplit({
      planId,
      splitIndex,
      foldCount: options.foldCount,
      samples,
      testStartIndex: range.startIndex,
      testEndIndexExclusive: range.endIndexExclusive,
      embargoDurationDays
    })
  );

  return purgedKFoldPlanSchema.parse({
    validationProtocol: "purged_k_fold",
    planId,
    foldCount: options.foldCount,
    sampleCount: samples.length,
    embargoDurationDays,
    splitCount: splits.length,
    splits
  });
}

function buildPurgedKFoldSplit(input: {
  planId: string;
  splitIndex: number;
  foldCount: number;
  samples: readonly NormalizedPurgedKFoldSample[];
  testStartIndex: number;
  testEndIndexExclusive: number;
  embargoDurationDays: number;
}): PurgedKFoldSplit {
  const testSamples = input.samples.slice(
    input.testStartIndex,
    input.testEndIndexExclusive
  );
  const testSampleIds = new Set(testSamples.map((sample) => sample.sampleId));
  const testStartMs = Math.min(
    ...testSamples.map((sample) => sample.labelStartMs)
  );
  const testEndMs = Math.max(...testSamples.map((sample) => sample.labelEndMs));
  const embargoWindow = buildEmbargoWindow({
    testEndMs,
    embargoDurationDays: input.embargoDurationDays
  });
  const trainSampleIds: string[] = [];
  const purgedSampleIds: string[] = [];
  const embargoedSampleIds: string[] = [];

  for (const sample of input.samples) {
    if (testSampleIds.has(sample.sampleId)) {
      continue;
    }
    if (testSamples.some((testSample) => labelsOverlap(sample, testSample))) {
      purgedSampleIds.push(sample.sampleId);
      continue;
    }
    if (embargoWindow !== null && isInsideEmbargoWindow(sample, embargoWindow)) {
      embargoedSampleIds.push(sample.sampleId);
      continue;
    }
    trainSampleIds.push(sample.sampleId);
  }

  return purgedKFoldSplitSchema.parse({
    validationProtocol: "purged_k_fold",
    planId: input.planId,
    splitId: `${input.planId}_fold_${String(input.splitIndex + 1).padStart(3, "0")}`,
    splitIndex: input.splitIndex,
    foldCount: input.foldCount,
    sampleCount: input.samples.length,
    trainCandidateSampleCount: input.samples.length - testSamples.length,
    includedTrainSampleCount: trainSampleIds.length,
    testSampleCount: testSamples.length,
    excludedSampleCount: purgedSampleIds.length + embargoedSampleIds.length,
    purgeExcludedSampleCount: purgedSampleIds.length,
    embargoExcludedSampleCount: embargoedSampleIds.length,
    purgeDurationDays: 0,
    embargoDurationDays: input.embargoDurationDays,
    testStart: new Date(testStartMs).toISOString(),
    testEnd: new Date(testEndMs).toISOString(),
    embargoStart: embargoWindow?.startIso ?? null,
    embargoEnd: embargoWindow?.endIso ?? null,
    trainSampleIds,
    testSampleIds: testSamples.map((sample) => sample.sampleId),
    purgedSampleIds,
    embargoedSampleIds
  });
}

function validateOptions(options: BuildPurgedKFoldPlanOptions): void {
  if (!Number.isInteger(options.foldCount) || options.foldCount < 2) {
    throw new Error("foldCount must be an integer greater than or equal to 2");
  }
  if (options.samples.length < options.foldCount) {
    throw new Error("sample count must be greater than or equal to foldCount");
  }
  validateNonNegativeInteger(
    options.embargoDurationDays ?? DEFAULT_EMBARGO_DURATION_DAYS,
    "embargoDurationDays"
  );
}

function normalizePlanId(planId: string | undefined): string {
  const normalized = (planId ?? "purged_kfold").trim();
  if (normalized.length === 0) {
    throw new Error("planId must not be empty");
  }
  return normalized;
}

function normalizeSamples(
  samples: readonly PurgedKFoldSample[]
): NormalizedPurgedKFoldSample[] {
  const sampleIds = new Set<string>();
  const normalized = samples.map((sample) => {
    const parsed = purgedKFoldSampleSchema.parse(sample);
    if (sampleIds.has(parsed.sampleId)) {
      throw new Error(`duplicate sampleId: ${parsed.sampleId}`);
    }
    sampleIds.add(parsed.sampleId);
    return {
      ...parsed,
      labelStartMs: Date.parse(parsed.labelStart),
      labelEndMs: Date.parse(parsed.labelEnd)
    };
  });

  return normalized.sort((left, right) => {
    const startDelta = left.labelStartMs - right.labelStartMs;
    if (startDelta !== 0) {
      return startDelta;
    }
    const endDelta = left.labelEndMs - right.labelEndMs;
    return endDelta !== 0
      ? endDelta
      : left.sampleId.localeCompare(right.sampleId);
  });
}

function contiguousFoldRanges(
  sampleCount: number,
  foldCount: number
): Array<{ startIndex: number; endIndexExclusive: number }> {
  const baseFoldSize = Math.floor(sampleCount / foldCount);
  const remainder = sampleCount % foldCount;
  const ranges: Array<{ startIndex: number; endIndexExclusive: number }> = [];
  let startIndex = 0;

  for (let foldIndex = 0; foldIndex < foldCount; foldIndex += 1) {
    const foldSize = baseFoldSize + (foldIndex < remainder ? 1 : 0);
    const endIndexExclusive = startIndex + foldSize;
    ranges.push({ startIndex, endIndexExclusive });
    startIndex = endIndexExclusive;
  }

  return ranges;
}

function buildEmbargoWindow(input: {
  testEndMs: number;
  embargoDurationDays: number;
}): { startMs: number; endMs: number; startIso: string; endIso: string } | null {
  if (input.embargoDurationDays === 0) {
    return null;
  }

  const startMs = input.testEndMs + 1;
  const endMs = input.testEndMs + input.embargoDurationDays * DAY_MS;
  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString()
  };
}

function labelsOverlap(
  left: NormalizedPurgedKFoldSample,
  right: NormalizedPurgedKFoldSample
): boolean {
  return (
    left.labelStartMs <= right.labelEndMs &&
    left.labelEndMs >= right.labelStartMs
  );
}

function isInsideEmbargoWindow(
  sample: NormalizedPurgedKFoldSample,
  embargoWindow: { startMs: number; endMs: number }
): boolean {
  return (
    sample.labelStartMs >= embargoWindow.startMs &&
    sample.labelStartMs <= embargoWindow.endMs
  );
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validateArrayCount(
  context: z.RefinementCtx,
  values: readonly string[],
  expectedCount: number,
  arrayLabel: string,
  countLabel: string
): void {
  if (values.length !== expectedCount) {
    context.addIssue({
      code: "custom",
      message: `${arrayLabel} length must equal ${countLabel}`
    });
  }
}

function validateSplitSampleIds(
  context: z.RefinementCtx,
  value: {
    sampleCount: number;
    trainSampleIds: readonly string[];
    testSampleIds: readonly string[];
    purgedSampleIds: readonly string[];
    embargoedSampleIds: readonly string[];
  }
): void {
  const sampleIds = [
    ...value.trainSampleIds,
    ...value.testSampleIds,
    ...value.purgedSampleIds,
    ...value.embargoedSampleIds
  ];
  const uniqueSampleIds = new Set(sampleIds);

  if (uniqueSampleIds.size !== sampleIds.length) {
    context.addIssue({
      code: "custom",
      message: "split sample id arrays must be unique and disjoint"
    });
  }
  if (sampleIds.length !== value.sampleCount) {
    context.addIssue({
      code: "custom",
      message:
        "combined train, test, purged, and embargoed sample ids must equal sampleCount"
    });
  }
}
