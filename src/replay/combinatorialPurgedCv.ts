import { z } from "zod";

import {
  purgedKFoldSampleSchema,
  type PurgedKFoldSample
} from "./purgedSplit.js";

export const cpcvValidationProtocolSchema = z.literal(
  "combinatorial_purged_cv"
);

export const cpcvCombinationModeSchema = z.enum(["exhaustive", "sampled"]);

export const cpcvSplitCombinationSchema = z
  .object({
    combinationId: z.string().trim().min(1),
    combinationIndex: z.number().int().nonnegative(),
    trainFoldIds: z.array(z.string().trim().min(1)),
    testFoldIds: z.array(z.string().trim().min(1)),
    trainSampleIds: z.array(z.string().trim().min(1)),
    testSampleIds: z.array(z.string().trim().min(1)),
    purgedSampleIds: z.array(z.string().trim().min(1)),
    embargoedSampleIds: z.array(z.string().trim().min(1))
  })
  .strict()
  .superRefine((value, context) => {
    if (value.testFoldIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "testFoldIds must include at least one fold"
      });
    }
    if (value.trainFoldIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "trainFoldIds must include at least one fold"
      });
    }
    validateUniqueDisjointIds(context, "fold ids", [
      ...value.trainFoldIds,
      ...value.testFoldIds
    ]);
    validateUniqueDisjointIds(context, "sample ids", [
      ...value.trainSampleIds,
      ...value.testSampleIds,
      ...value.purgedSampleIds,
      ...value.embargoedSampleIds
    ]);
  });

export const cpcvSplitPlanSchema = z
  .object({
    validationProtocol: cpcvValidationProtocolSchema,
    planId: z.string().trim().min(1),
    foldCount: z.number().int().min(2),
    testFoldCount: z.number().int().min(1),
    sampleCount: z.number().int().nonnegative(),
    purgeDurationDays: z.number().int().nonnegative(),
    embargoDurationDays: z.number().int().nonnegative(),
    combinationMode: cpcvCombinationModeSchema,
    randomSeed: z.string().trim().min(1).nullable(),
    maxCombinationCount: z.number().int().min(1),
    requestedCombinationCount: z.number().int().nonnegative(),
    emittedCombinationCount: z.number().int().nonnegative(),
    skippedCombinationCount: z.number().int().nonnegative(),
    combinations: z.array(cpcvSplitCombinationSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.testFoldCount >= value.foldCount) {
      context.addIssue({
        code: "custom",
        message: "testFoldCount must be less than foldCount"
      });
    }
    if (value.sampleCount < value.foldCount) {
      context.addIssue({
        code: "custom",
        message: "sampleCount must be greater than or equal to foldCount"
      });
    }
    if (value.emittedCombinationCount !== value.combinations.length) {
      context.addIssue({
        code: "custom",
        message: "emittedCombinationCount must equal combinations length"
      });
    }
    if (
      value.emittedCombinationCount + value.skippedCombinationCount !==
      value.requestedCombinationCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "emittedCombinationCount plus skippedCombinationCount must equal requestedCombinationCount"
      });
    }
    if (value.emittedCombinationCount > value.maxCombinationCount) {
      context.addIssue({
        code: "custom",
        message: "emittedCombinationCount must not exceed maxCombinationCount"
      });
    }
    if (value.combinationMode === "exhaustive" && value.randomSeed !== null) {
      context.addIssue({
        code: "custom",
        message: "randomSeed must be null for exhaustive mode"
      });
    }
    if (value.combinationMode === "sampled" && value.randomSeed === null) {
      context.addIssue({
        code: "custom",
        message: "randomSeed is required for sampled mode"
      });
    }
    validatePlanCombinationCoverage(context, value);
  });

export type CpcvCombinationMode = z.infer<typeof cpcvCombinationModeSchema>;
export type CpcvSplitCombination = z.infer<typeof cpcvSplitCombinationSchema>;
export type CpcvSplitPlan = z.infer<typeof cpcvSplitPlanSchema>;

export interface BuildCombinatorialPurgedCvPlanOptions {
  samples: readonly PurgedKFoldSample[];
  foldCount: number;
  testFoldCount: number;
  maxCombinationCount: number;
  combinationMode?: CpcvCombinationMode;
  randomSeed?: string | null;
  purgeDurationDays?: number;
  embargoDurationDays?: number;
  planId?: string;
}

interface NormalizedCpcvSample extends PurgedKFoldSample {
  labelStartMs: number;
  labelEndMs: number;
}

interface CpcvFold {
  foldId: string;
  foldIndex: number;
  samples: NormalizedCpcvSample[];
}

const DEFAULT_PLAN_ID = "cpcv";
const DEFAULT_PURGE_DURATION_DAYS = 0;
const DEFAULT_EMBARGO_DURATION_DAYS = 0;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SAFE_COMBINATION_COUNT = Number.MAX_SAFE_INTEGER;

export function buildCombinatorialPurgedCvPlan(
  options: BuildCombinatorialPurgedCvPlanOptions
): CpcvSplitPlan {
  validateOptions(options);

  const planId = normalizePlanId(options.planId);
  const combinationMode = options.combinationMode ?? "exhaustive";
  const randomSeed = normalizeRandomSeed(options.randomSeed, combinationMode);
  const purgeDurationDays =
    options.purgeDurationDays ?? DEFAULT_PURGE_DURATION_DAYS;
  const embargoDurationDays =
    options.embargoDurationDays ?? DEFAULT_EMBARGO_DURATION_DAYS;
  const samples = normalizeSamples(options.samples);
  const requestedCombinationCount = combinationCount(
    options.foldCount,
    options.testFoldCount
  );

  if (
    combinationMode === "exhaustive" &&
    requestedCombinationCount > options.maxCombinationCount
  ) {
    throw new Error(
      "requestedCombinationCount exceeds maxCombinationCount in exhaustive mode"
    );
  }

  const folds = buildFolds(samples, options.foldCount);
  const combinationIndexes = selectCombinationIndexes({
    foldCount: options.foldCount,
    testFoldCount: options.testFoldCount,
    requestedCombinationCount,
    maxCombinationCount: options.maxCombinationCount,
    combinationMode,
    randomSeed
  });
  const combinations = combinationIndexes.map((combinationIndex) =>
    buildCombination({
      planId,
      combinationIndex,
      folds,
      testFoldIndexes: unrankCombination(
        options.foldCount,
        options.testFoldCount,
        combinationIndex
      ),
      purgeDurationDays,
      embargoDurationDays
    })
  );

  return cpcvSplitPlanSchema.parse({
    validationProtocol: "combinatorial_purged_cv",
    planId,
    foldCount: options.foldCount,
    testFoldCount: options.testFoldCount,
    sampleCount: samples.length,
    purgeDurationDays,
    embargoDurationDays,
    combinationMode,
    randomSeed,
    maxCombinationCount: options.maxCombinationCount,
    requestedCombinationCount,
    emittedCombinationCount: combinations.length,
    skippedCombinationCount: requestedCombinationCount - combinations.length,
    combinations
  });
}

function buildCombination(input: {
  planId: string;
  combinationIndex: number;
  folds: readonly CpcvFold[];
  testFoldIndexes: readonly number[];
  purgeDurationDays: number;
  embargoDurationDays: number;
}): CpcvSplitCombination {
  const testFoldIndexSet = new Set(input.testFoldIndexes);
  const testFolds = input.folds.filter((fold) =>
    testFoldIndexSet.has(fold.foldIndex)
  );
  const trainCandidateFolds = input.folds.filter(
    (fold) => !testFoldIndexSet.has(fold.foldIndex)
  );
  const testSamples = testFolds.flatMap((fold) => fold.samples);
  const trainCandidateSamples = trainCandidateFolds.flatMap(
    (fold) => fold.samples
  );
  const testEndMs = Math.max(...testSamples.map((sample) => sample.labelEndMs));
  const embargoWindow = buildEmbargoWindow({
    testEndMs,
    embargoDurationDays: input.embargoDurationDays
  });
  const purgeWindows = testSamples.map((sample) =>
    buildPurgeWindow(sample, input.purgeDurationDays)
  );
  const trainSampleIds: string[] = [];
  const purgedSampleIds: string[] = [];
  const embargoedSampleIds: string[] = [];

  for (const sample of trainCandidateSamples) {
    if (purgeWindows.some((window) => labelsOverlapWindow(sample, window))) {
      purgedSampleIds.push(sample.sampleId);
      continue;
    }
    if (embargoWindow !== null && isInsideEmbargoWindow(sample, embargoWindow)) {
      embargoedSampleIds.push(sample.sampleId);
      continue;
    }
    trainSampleIds.push(sample.sampleId);
  }

  return cpcvSplitCombinationSchema.parse({
    combinationId: `${input.planId}_combo_${String(input.combinationIndex + 1).padStart(6, "0")}`,
    combinationIndex: input.combinationIndex,
    trainFoldIds: trainCandidateFolds.map((fold) => fold.foldId),
    testFoldIds: testFolds.map((fold) => fold.foldId),
    trainSampleIds,
    testSampleIds: testSamples.map((sample) => sample.sampleId),
    purgedSampleIds,
    embargoedSampleIds
  });
}

function validateOptions(options: BuildCombinatorialPurgedCvPlanOptions): void {
  validatePositiveInteger(options.foldCount, "foldCount");
  if (options.foldCount < 2) {
    throw new Error("foldCount must be greater than or equal to 2");
  }
  validatePositiveInteger(options.testFoldCount, "testFoldCount");
  if (options.testFoldCount >= options.foldCount) {
    throw new Error("testFoldCount must be less than foldCount");
  }
  validatePositiveInteger(options.maxCombinationCount, "maxCombinationCount");
  validateNonNegativeInteger(
    options.purgeDurationDays ?? DEFAULT_PURGE_DURATION_DAYS,
    "purgeDurationDays"
  );
  validateNonNegativeInteger(
    options.embargoDurationDays ?? DEFAULT_EMBARGO_DURATION_DAYS,
    "embargoDurationDays"
  );
  if (options.samples.length < options.foldCount) {
    throw new Error("sample count must be greater than or equal to foldCount");
  }
  if (
    options.combinationMode !== undefined &&
    options.combinationMode !== "exhaustive" &&
    options.combinationMode !== "sampled"
  ) {
    throw new Error("combinationMode must be exhaustive or sampled");
  }
}

function normalizePlanId(planId: string | undefined): string {
  const normalized = (planId ?? DEFAULT_PLAN_ID).trim();
  if (normalized.length === 0) {
    throw new Error("planId must not be empty");
  }
  return normalized;
}

function normalizeRandomSeed(
  randomSeed: string | null | undefined,
  combinationMode: CpcvCombinationMode
): string | null {
  if (combinationMode === "exhaustive") {
    if (randomSeed !== undefined && randomSeed !== null) {
      throw new Error("randomSeed must be null for exhaustive mode");
    }
    return null;
  }

  const normalized = (randomSeed ?? "").trim();
  if (normalized.length === 0) {
    throw new Error("randomSeed is required for sampled mode");
  }
  return normalized;
}

function normalizeSamples(
  samples: readonly PurgedKFoldSample[]
): NormalizedCpcvSample[] {
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

function buildFolds(
  samples: readonly NormalizedCpcvSample[],
  foldCount: number
): CpcvFold[] {
  const ranges = contiguousFoldRanges(samples.length, foldCount);
  return ranges.map((range, foldIndex) => ({
    foldId: `fold_${String(foldIndex + 1).padStart(3, "0")}`,
    foldIndex,
    samples: samples.slice(range.startIndex, range.endIndexExclusive)
  }));
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

function selectCombinationIndexes(input: {
  foldCount: number;
  testFoldCount: number;
  requestedCombinationCount: number;
  maxCombinationCount: number;
  combinationMode: CpcvCombinationMode;
  randomSeed: string | null;
}): number[] {
  if (
    input.combinationMode === "exhaustive" ||
    input.requestedCombinationCount <= input.maxCombinationCount
  ) {
    return Array.from(
      { length: input.requestedCombinationCount },
      (_, index) => index
    );
  }

  const random = seededRandom(input.randomSeed ?? "");
  const selectedIndexes = new Set<number>();
  while (selectedIndexes.size < input.maxCombinationCount) {
    selectedIndexes.add(
      Math.floor(random() * input.requestedCombinationCount)
    );
  }

  return Array.from(selectedIndexes).sort((left, right) => left - right);
}

function unrankCombination(
  itemCount: number,
  selectionCount: number,
  rank: number
): number[] {
  const combination: number[] = [];
  let remainingRank = rank;
  let nextMinimum = 0;
  let remainingSelections = selectionCount;

  while (remainingSelections > 0) {
    let selectedCandidate = false;
    for (
      let candidate = nextMinimum;
      candidate <= itemCount - remainingSelections;
      candidate += 1
    ) {
      const countWithCandidate = combinationCount(
        itemCount - candidate - 1,
        remainingSelections - 1
      );
      if (remainingRank < countWithCandidate) {
        combination.push(candidate);
        nextMinimum = candidate + 1;
        remainingSelections -= 1;
        selectedCandidate = true;
        break;
      }
      remainingRank -= countWithCandidate;
    }
    if (!selectedCandidate) {
      throw new Error("combination rank is out of range");
    }
  }

  return combination;
}

function combinationCount(itemCount: number, selectionCount: number): number {
  if (selectionCount < 0 || selectionCount > itemCount) {
    return 0;
  }
  const optimizedSelectionCount = Math.min(
    selectionCount,
    itemCount - selectionCount
  );
  let result = 1;

  for (let index = 1; index <= optimizedSelectionCount; index += 1) {
    result = (result * (itemCount - optimizedSelectionCount + index)) / index;
    if (result > MAX_SAFE_COMBINATION_COUNT) {
      throw new Error("requestedCombinationCount exceeds safe integer range");
    }
  }

  return Math.round(result);
}

function buildPurgeWindow(
  sample: NormalizedCpcvSample,
  purgeDurationDays: number
): { startMs: number; endMs: number } {
  const purgeDurationMs = purgeDurationDays * DAY_MS;
  return {
    startMs: sample.labelStartMs - purgeDurationMs,
    endMs: sample.labelEndMs + purgeDurationMs
  };
}

function buildEmbargoWindow(input: {
  testEndMs: number;
  embargoDurationDays: number;
}): { startMs: number; endMs: number } | null {
  if (input.embargoDurationDays === 0) {
    return null;
  }

  return {
    startMs: input.testEndMs + 1,
    endMs: input.testEndMs + input.embargoDurationDays * DAY_MS
  };
}

function labelsOverlapWindow(
  sample: NormalizedCpcvSample,
  window: { startMs: number; endMs: number }
): boolean {
  return sample.labelStartMs <= window.endMs && sample.labelEndMs >= window.startMs;
}

function isInsideEmbargoWindow(
  sample: NormalizedCpcvSample,
  embargoWindow: { startMs: number; endMs: number }
): boolean {
  return (
    sample.labelStartMs >= embargoWindow.startMs &&
    sample.labelStartMs <= embargoWindow.endMs
  );
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validateUniqueDisjointIds(
  context: z.RefinementCtx,
  label: string,
  ids: readonly string[]
): void {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      message: `${label} must be unique and disjoint`
    });
  }
}

function validatePlanCombinationCoverage(
  context: z.RefinementCtx,
  value: {
    foldCount: number;
    testFoldCount: number;
    sampleCount: number;
    combinations: readonly CpcvSplitCombination[];
  }
): void {
  const combinationIndexes = new Set<number>();
  for (const combination of value.combinations) {
    combinationIndexes.add(combination.combinationIndex);
    if (combination.testFoldIds.length !== value.testFoldCount) {
      context.addIssue({
        code: "custom",
        message: "combination testFoldIds length must equal testFoldCount"
      });
    }
    if (
      combination.trainFoldIds.length + combination.testFoldIds.length !==
      value.foldCount
    ) {
      context.addIssue({
        code: "custom",
        message: "combination train/test fold ids must cover foldCount"
      });
    }
    const sampleIdCount =
      combination.trainSampleIds.length +
      combination.testSampleIds.length +
      combination.purgedSampleIds.length +
      combination.embargoedSampleIds.length;
    if (sampleIdCount !== value.sampleCount) {
      context.addIssue({
        code: "custom",
        message:
          "combination train, test, purged, and embargoed sample ids must equal sampleCount"
      });
    }
  }
  if (combinationIndexes.size !== value.combinations.length) {
    context.addIssue({
      code: "custom",
      message: "combinationIndex values must be unique"
    });
  }
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  }

  return () => {
    state = Math.imul(state + 0x6d2b79f5, 1);
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
