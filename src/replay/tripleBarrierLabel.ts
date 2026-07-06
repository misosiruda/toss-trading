import { z } from "zod";

import {
  historicalMarketSnapshotSchema,
  isoDateTimeSchema,
  parseWithSchema,
  sha256HashSchema,
  type HistoricalMarketSnapshot
} from "../domain/schemas.js";
import {
  purgedKFoldSampleSchema,
  type PurgedKFoldSample
} from "./purgedSplit.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const TRIPLE_BARRIER_LABEL_SCHEMA_VERSION =
  "triple_barrier_label.v1";
export const META_LABEL_CANDIDATE_SCHEMA_VERSION = "meta_label_candidate.v1";

export const tripleBarrierMarketSchema = z.enum(["KR", "US", "UNKNOWN"]);
export const tripleBarrierTouchedBarrierSchema = z.enum([
  "profit_taking",
  "stop_loss",
  "time",
  "unavailable"
]);
export const tripleBarrierDirectionLabelSchema = z.enum([
  "positive",
  "negative",
  "neutral",
  "unavailable"
]);
export const tripleBarrierLabelStatusSchema = z.enum([
  "available",
  "unavailable"
]);
export const tripleBarrierLabelWarningCodeSchema = z.enum([
  "TRIPLE_BARRIER_CONFIG_INVALID",
  "TRIPLE_BARRIER_ENTRY_PRICE_MISSING",
  "TRIPLE_BARRIER_PRICE_PATH_MISSING",
  "TRIPLE_BARRIER_AMBIGUOUS_TOUCH",
  "TRIPLE_BARRIER_TIME_BARRIER_ONLY",
  "TRIPLE_BARRIER_PURGED_SAMPLE_MISSING",
  "META_LABEL_SIZING_DIRECTIVE_REJECTED"
]);
export const tripleBarrierLabelWarningSeveritySchema = z.enum([
  "info",
  "warning"
]);
export const metaLabelSideDecisionSchema = z.enum([
  "long",
  "short",
  "hold",
  "unknown"
]);
export const metaLabelOutcomeSchema = z.enum([
  "correct_side",
  "wrong_side",
  "not_actionable"
]);

export const tripleBarrierLabelConfigInputSchema = z
  .object({
    labelProtocol: z.literal("triple_barrier").default("triple_barrier"),
    priceSource: z
      .literal("historical_market_snapshot")
      .default("historical_market_snapshot"),
    referencePriceField: z.enum(["last", "close"]),
    profitTakingReturnRatio: z.number().finite().positive(),
    stopLossReturnRatio: z.number().finite().gt(0).lt(1),
    timeBarrierDurationDays: z.number().int().positive(),
    barrierTouchPolicy: z.literal("first_touch").default("first_touch"),
    ambiguousTouchPolicy: z
      .literal("earliest_timestamp_then_stop_loss")
      .default("earliest_timestamp_then_stop_loss")
  })
  .strict();

export const tripleBarrierLabelConfigSchema =
  tripleBarrierLabelConfigInputSchema.extend({
    configHash: sha256HashSchema
  });

export const tripleBarrierLabelEventSchema = z
  .object({
    sampleId: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    market: tripleBarrierMarketSchema,
    observationAt: isoDateTimeSchema,
    labelStart: isoDateTimeSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.labelStart) < Date.parse(value.observationAt)) {
      context.addIssue({
        code: "custom",
        message: "labelStart must be after or equal to observationAt"
      });
    }
  });

export const tripleBarrierPurgedSampleSchema = z
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

export const tripleBarrierLabelWarningSchema = z
  .object({
    code: tripleBarrierLabelWarningCodeSchema,
    severity: tripleBarrierLabelWarningSeveritySchema,
    message: z.string().trim().min(1),
    labelId: z.string().trim().min(1).nullable(),
    sampleId: z.string().trim().min(1).nullable()
  })
  .strict();

export const tripleBarrierLabelSchema = z
  .object({
    labelId: z.string().trim().min(1),
    sampleId: z.string().trim().min(1),
    symbol: z.string().trim().min(1),
    market: tripleBarrierMarketSchema,
    observationAt: isoDateTimeSchema,
    labelStart: isoDateTimeSchema,
    labelEnd: isoDateTimeSchema,
    entryPrice: z.number().finite().positive().nullable(),
    upperBarrierPrice: z.number().finite().positive().nullable(),
    lowerBarrierPrice: z.number().finite().positive().nullable(),
    touchedBarrier: tripleBarrierTouchedBarrierSchema,
    touchedAt: isoDateTimeSchema.nullable(),
    realizedReturnRatio: z.number().finite().nullable(),
    directionLabel: tripleBarrierDirectionLabelSchema,
    status: tripleBarrierLabelStatusSchema,
    purgedSample: tripleBarrierPurgedSampleSchema,
    warnings: z.array(tripleBarrierLabelWarningSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "available" &&
      value.directionLabel === "unavailable"
    ) {
      context.addIssue({
        code: "custom",
        message: "available label must include a directionLabel"
      });
    }
    if (
      value.status === "unavailable" &&
      value.directionLabel !== "unavailable"
    ) {
      context.addIssue({
        code: "custom",
        message: "unavailable label must not include a directionLabel"
      });
    }
    if (Date.parse(value.labelStart) > Date.parse(value.labelEnd)) {
      context.addIssue({
        code: "custom",
        message: "labelStart must be before or equal to labelEnd"
      });
    }
    if (value.purgedSample.sampleId !== value.sampleId) {
      context.addIssue({
        code: "custom",
        message: "purgedSample.sampleId must match sampleId"
      });
    }
    if (value.purgedSample.labelStart !== value.labelStart) {
      context.addIssue({
        code: "custom",
        message: "purgedSample.labelStart must match labelStart"
      });
    }
    if (value.purgedSample.labelEnd !== value.labelEnd) {
      context.addIssue({
        code: "custom",
        message: "purgedSample.labelEnd must match labelEnd"
      });
    }
  });

export const tripleBarrierLabelSummarySchema = z
  .object({
    totalLabelCount: z.number().int().nonnegative(),
    availableLabelCount: z.number().int().nonnegative(),
    unavailableLabelCount: z.number().int().nonnegative(),
    positiveCount: z.number().int().nonnegative(),
    negativeCount: z.number().int().nonnegative(),
    neutralCount: z.number().int().nonnegative(),
    profitTakingCount: z.number().int().nonnegative(),
    stopLossCount: z.number().int().nonnegative(),
    timeBarrierCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  })
  .strict();

export const tripleBarrierLabelArtifactSchema = z
  .object({
    schemaVersion: z.literal(TRIPLE_BARRIER_LABEL_SCHEMA_VERSION),
    generatedAt: isoDateTimeSchema,
    config: tripleBarrierLabelConfigSchema,
    labels: z.array(tripleBarrierLabelSchema),
    summary: tripleBarrierLabelSummarySchema,
    warnings: z.array(tripleBarrierLabelWarningSchema)
  })
  .strict();
export const metaLabelCandidateSchema = z
  .object({
    schemaVersion: z.literal(META_LABEL_CANDIDATE_SCHEMA_VERSION),
    sourceLabelId: z.string().trim().min(1),
    sideDecision: metaLabelSideDecisionSchema,
    outcome: metaLabelOutcomeSchema,
    sizingDirective: z.null()
  })
  .strict();

export type TripleBarrierMarket = z.infer<typeof tripleBarrierMarketSchema>;
export type TripleBarrierTouchedBarrier = z.infer<
  typeof tripleBarrierTouchedBarrierSchema
>;
export type TripleBarrierDirectionLabel = z.infer<
  typeof tripleBarrierDirectionLabelSchema
>;
export type TripleBarrierLabelStatus = z.infer<
  typeof tripleBarrierLabelStatusSchema
>;
export type TripleBarrierLabelWarningCode = z.infer<
  typeof tripleBarrierLabelWarningCodeSchema
>;
export type TripleBarrierLabelConfigInput = z.input<
  typeof tripleBarrierLabelConfigInputSchema
>;
export type TripleBarrierLabelConfig = z.infer<
  typeof tripleBarrierLabelConfigSchema
>;
export type TripleBarrierLabelEvent = z.infer<
  typeof tripleBarrierLabelEventSchema
>;
export type TripleBarrierPurgedSample = z.infer<
  typeof tripleBarrierPurgedSampleSchema
>;
export type TripleBarrierLabelWarning = z.infer<
  typeof tripleBarrierLabelWarningSchema
>;
export type TripleBarrierLabel = z.infer<typeof tripleBarrierLabelSchema>;
export type TripleBarrierLabelSummary = z.infer<
  typeof tripleBarrierLabelSummarySchema
>;
export type TripleBarrierLabelArtifact = z.infer<
  typeof tripleBarrierLabelArtifactSchema
>;
export type MetaLabelSideDecision = z.infer<typeof metaLabelSideDecisionSchema>;
export type MetaLabelOutcome = z.infer<typeof metaLabelOutcomeSchema>;
export type MetaLabelCandidate = z.infer<typeof metaLabelCandidateSchema>;

export interface BuildTripleBarrierLabelArtifactOptions {
  generatedAt?: Date | string;
  config: TripleBarrierLabelConfigInput;
  events: readonly TripleBarrierLabelEvent[];
  priceSnapshots: readonly HistoricalMarketSnapshot[];
}

export interface BuildMetaLabelCandidateOptions {
  sourceLabel: TripleBarrierLabel;
  sideDecision: MetaLabelSideDecision;
  sizingDirective?: unknown;
}

interface NormalizedTripleBarrierLabelEvent extends TripleBarrierLabelEvent {
  labelStartMs: number;
  timeBarrierDeadlineMs: number;
  labelId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_DURATION_MS: Record<
  HistoricalMarketSnapshot["interval"],
  number
> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": DAY_MS
};
const MIN_PRICE_COMPARISON_EPSILON = 1e-9;
const PRICE_COMPARISON_EPSILON_MULTIPLIER = 16;

export function buildTripleBarrierLabelArtifact(
  options: BuildTripleBarrierLabelArtifactOptions
): TripleBarrierLabelArtifact {
  const generatedAt = normalizeGeneratedAt(options.generatedAt);
  const config = normalizeConfig(options.config);
  const events = normalizeEvents(options.events, config);
  const priceSnapshots = normalizePriceSnapshots(options.priceSnapshots);
  const labels = events.map((event) =>
    buildTripleBarrierLabel({
      event,
      config,
      priceSnapshots
    })
  );
  const warnings = labels.flatMap((label) => label.warnings);

  return parseWithSchema(
    tripleBarrierLabelArtifactSchema,
    {
      schemaVersion: TRIPLE_BARRIER_LABEL_SCHEMA_VERSION,
      generatedAt,
      config,
      labels,
      summary: summarizeLabels(labels, warnings),
      warnings
    },
    "tripleBarrierLabelArtifact"
  );
}

export function buildTripleBarrierPurgedKFoldSamples(
  artifact: TripleBarrierLabelArtifact
): PurgedKFoldSample[] {
  const parsedArtifact = parseWithSchema(
    tripleBarrierLabelArtifactSchema,
    artifact,
    "tripleBarrierLabelArtifact"
  );
  const sampleIds = new Set<string>();
  const samples = parsedArtifact.labels.map((label) => {
    const sample = parseWithSchema(
      purgedKFoldSampleSchema,
      label.purgedSample,
      "tripleBarrierPurgedSample"
    );
    if (sampleIds.has(sample.sampleId)) {
      throw new Error(`duplicate purged sampleId: ${sample.sampleId}`);
    }
    sampleIds.add(sample.sampleId);
    return sample;
  });

  return samples.sort((left, right) => {
    const startDelta = Date.parse(left.labelStart) - Date.parse(right.labelStart);
    if (startDelta !== 0) {
      return startDelta;
    }
    const endDelta = Date.parse(left.labelEnd) - Date.parse(right.labelEnd);
    return endDelta !== 0
      ? endDelta
      : left.sampleId.localeCompare(right.sampleId);
  });
}

export function buildMetaLabelCandidate(
  options: BuildMetaLabelCandidateOptions
): MetaLabelCandidate {
  const sourceLabel = parseWithSchema(
    tripleBarrierLabelSchema,
    options.sourceLabel,
    "tripleBarrierLabel"
  );
  const sideDecision = parseWithSchema(
    metaLabelSideDecisionSchema,
    options.sideDecision,
    "metaLabelSideDecision"
  );

  if (
    options.sizingDirective !== undefined &&
    options.sizingDirective !== null
  ) {
    throw new Error(
      "META_LABEL_SIZING_DIRECTIVE_REJECTED: meta-label candidates must not carry sizing directives"
    );
  }

  return parseWithSchema(
    metaLabelCandidateSchema,
    {
      schemaVersion: META_LABEL_CANDIDATE_SCHEMA_VERSION,
      sourceLabelId: sourceLabel.labelId,
      sideDecision,
      outcome: metaLabelOutcomeFor(sourceLabel, sideDecision),
      sizingDirective: null
    },
    "metaLabelCandidate"
  );
}

function buildTripleBarrierLabel(input: {
  event: NormalizedTripleBarrierLabelEvent;
  config: TripleBarrierLabelConfig;
  priceSnapshots: readonly HistoricalMarketSnapshot[];
}): TripleBarrierLabel {
  const labelStart = new Date(input.event.labelStartMs).toISOString();
  const timeBarrierDeadline = new Date(
    input.event.timeBarrierDeadlineMs
  ).toISOString();
  const labelBase = {
    labelId: input.event.labelId,
    sampleId: input.event.sampleId,
    symbol: input.event.symbol,
    market: input.event.market,
    observationAt: input.event.observationAt,
    labelStart
  };
  const purgedSample = {
    sampleId: input.event.sampleId,
    labelStart,
    labelEnd: timeBarrierDeadline
  };
  const path = matchingPricePath({
    event: input.event,
    priceSnapshots: input.priceSnapshots
  });
  const entrySnapshot = path.find(
    (snapshot) => Date.parse(snapshot.observedAt) === input.event.labelStartMs
  );
  const entryPrice =
    entrySnapshot === undefined
      ? null
      : referencePrice(entrySnapshot, input.config.referencePriceField);

  if (entrySnapshot === undefined || entryPrice === null || entryPrice <= 0) {
    const warnings = [
      warning({
        code: "TRIPLE_BARRIER_ENTRY_PRICE_MISSING",
        severity: "warning",
        message:
          "Triple barrier label could not find a positive entry price at labelStart",
        labelId: input.event.labelId,
        sampleId: input.event.sampleId
      })
    ];
    return parseWithSchema(
      tripleBarrierLabelSchema,
      {
        ...labelBase,
        labelEnd: timeBarrierDeadline,
        entryPrice: null,
        upperBarrierPrice: null,
        lowerBarrierPrice: null,
        touchedBarrier: "unavailable",
        touchedAt: null,
        realizedReturnRatio: null,
        directionLabel: "unavailable",
        status: "unavailable",
        purgedSample,
        warnings
      },
      "tripleBarrierLabel"
    );
  }

  const upperBarrierPrice =
    entryPrice * (1 + input.config.profitTakingReturnRatio);
  const lowerBarrierPrice =
    entryPrice * (1 - input.config.stopLossReturnRatio);
  const touch = firstBarrierTouch({
    path: path.filter(
      (snapshot) => Date.parse(snapshot.observedAt) > input.event.labelStartMs
    ),
    config: input.config,
    upperBarrierPrice,
    lowerBarrierPrice,
    labelId: input.event.labelId,
    sampleId: input.event.sampleId
  });

  if (touch !== null) {
    const touchPathCoverageIssue = firstPricePathCoverageIssue(
      path.filter(
        (snapshot) =>
          Date.parse(snapshot.observedAt) <= Date.parse(touch.touchedAt)
      ),
      Date.parse(touch.touchedAt),
      input.config.referencePriceField
    );
    if (touchPathCoverageIssue !== null) {
      return unavailablePricePathLabel({
        labelBase,
        timeBarrierDeadline,
        entryPrice,
        upperBarrierPrice,
        lowerBarrierPrice,
        purgedSample,
        labelId: input.event.labelId,
        sampleId: input.event.sampleId
      });
    }

    return parseWithSchema(
      tripleBarrierLabelSchema,
      {
        ...labelBase,
        labelEnd: touch.touchedAt,
        entryPrice,
        upperBarrierPrice,
        lowerBarrierPrice,
        touchedBarrier: touch.touchedBarrier,
        touchedAt: touch.touchedAt,
        realizedReturnRatio: touch.realizedReturnRatio,
        directionLabel:
          touch.touchedBarrier === "profit_taking" ? "positive" : "negative",
        status: "available",
        purgedSample: {
          ...purgedSample,
          labelEnd: touch.touchedAt
        },
        warnings: touch.warnings
      },
      "tripleBarrierLabel"
    );
  }

  const terminalSnapshot = latestSnapshot(
    path.filter(
      (snapshot) => Date.parse(snapshot.observedAt) > input.event.labelStartMs
    )
  );
  const terminalPathCoverageIssue =
    terminalSnapshot === null
      ? null
      : firstPricePathCoverageIssue(
          path,
          input.event.timeBarrierDeadlineMs,
          input.config.referencePriceField
        );
  const terminalPrice =
    terminalSnapshot === null
      ? null
      : referencePrice(terminalSnapshot, input.config.referencePriceField);
  if (
    terminalSnapshot === null ||
    terminalPathCoverageIssue !== null ||
    terminalPrice === null
  ) {
    return unavailablePricePathLabel({
      labelBase,
      timeBarrierDeadline,
      entryPrice,
      upperBarrierPrice,
      lowerBarrierPrice,
      purgedSample,
      labelId: input.event.labelId,
      sampleId: input.event.sampleId
    });
  }

  const realizedReturnRatio = roundRatio((terminalPrice - entryPrice) / entryPrice);
  const warnings = [
    warning({
      code: "TRIPLE_BARRIER_TIME_BARRIER_ONLY",
      severity: "info",
      message: "Triple barrier label reached the time barrier without price touch",
      labelId: input.event.labelId,
      sampleId: input.event.sampleId
    })
  ];

  return parseWithSchema(
    tripleBarrierLabelSchema,
    {
      ...labelBase,
      labelEnd: timeBarrierDeadline,
      entryPrice,
      upperBarrierPrice,
      lowerBarrierPrice,
      touchedBarrier: "time",
      touchedAt: timeBarrierDeadline,
      realizedReturnRatio,
      directionLabel: directionLabelFor(realizedReturnRatio),
      status: "available",
      purgedSample,
      warnings
    },
    "tripleBarrierLabel"
  );
}

function unavailablePricePathLabel(input: {
  labelBase: {
    labelId: string;
    sampleId: string;
    symbol: string;
    market: TripleBarrierMarket;
    observationAt: string;
    labelStart: string;
  };
  timeBarrierDeadline: string;
  entryPrice: number;
  upperBarrierPrice: number;
  lowerBarrierPrice: number;
  purgedSample: TripleBarrierPurgedSample;
  labelId: string;
  sampleId: string;
}): TripleBarrierLabel {
  const warnings = [
    warning({
      code: "TRIPLE_BARRIER_PRICE_PATH_MISSING",
      severity: "warning",
      message:
        "Triple barrier label could not find complete price path coverage through the label horizon",
      labelId: input.labelId,
      sampleId: input.sampleId
    })
  ];
  return parseWithSchema(
    tripleBarrierLabelSchema,
    {
      ...input.labelBase,
      labelEnd: input.timeBarrierDeadline,
      entryPrice: input.entryPrice,
      upperBarrierPrice: input.upperBarrierPrice,
      lowerBarrierPrice: input.lowerBarrierPrice,
      touchedBarrier: "unavailable",
      touchedAt: null,
      realizedReturnRatio: null,
      directionLabel: "unavailable",
      status: "unavailable",
      purgedSample: input.purgedSample,
      warnings
    },
    "tripleBarrierLabel"
  );
}

function normalizeGeneratedAt(value: Date | string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("generatedAt must be a valid date");
    }
    return value.toISOString();
  }
  return value;
}

function normalizeConfig(
  input: TripleBarrierLabelConfigInput
): TripleBarrierLabelConfig {
  const parsed = tripleBarrierLabelConfigInputSchema.parse(input);
  const configHash = createReplayResearchHash(parsed);
  return tripleBarrierLabelConfigSchema.parse({
    ...parsed,
    configHash
  });
}

function normalizeEvents(
  events: readonly TripleBarrierLabelEvent[],
  config: TripleBarrierLabelConfig
): NormalizedTripleBarrierLabelEvent[] {
  const seenSampleIds = new Set<string>();
  return z
    .array(tripleBarrierLabelEventSchema)
    .parse(events)
    .map((event) => {
      if (seenSampleIds.has(event.sampleId)) {
        throw new Error(`duplicate sampleId: ${event.sampleId}`);
      }
      seenSampleIds.add(event.sampleId);
      const labelStartMs = Date.parse(event.labelStart);
      return {
        ...event,
        labelStartMs,
        timeBarrierDeadlineMs:
          labelStartMs + config.timeBarrierDurationDays * DAY_MS,
        labelId: `triple_barrier_${event.sampleId}`
      };
    })
    .sort((left, right) => {
      const startDelta = left.labelStartMs - right.labelStartMs;
      return startDelta !== 0
        ? startDelta
        : left.sampleId.localeCompare(right.sampleId);
    });
}

function normalizePriceSnapshots(
  priceSnapshots: readonly HistoricalMarketSnapshot[]
): HistoricalMarketSnapshot[] {
  return z
    .array(historicalMarketSnapshotSchema)
    .parse(priceSnapshots)
    .sort((left, right) => {
      const observedAtDelta =
        Date.parse(left.observedAt) - Date.parse(right.observedAt);
      if (observedAtDelta !== 0) {
        return observedAtDelta;
      }
      return left.snapshotId.localeCompare(right.snapshotId);
    });
}

function matchingPricePath(input: {
  event: NormalizedTripleBarrierLabelEvent;
  priceSnapshots: readonly HistoricalMarketSnapshot[];
}): HistoricalMarketSnapshot[] {
  if (input.event.market === "UNKNOWN") {
    return [];
  }
  return input.priceSnapshots.filter((snapshot) => {
    const observedAtMs = Date.parse(snapshot.observedAt);
    return (
      snapshot.market === input.event.market &&
      snapshot.symbol === input.event.symbol &&
      observedAtMs >= input.event.labelStartMs &&
      observedAtMs <= input.event.timeBarrierDeadlineMs
    );
  });
}

function firstBarrierTouch(input: {
  path: readonly HistoricalMarketSnapshot[];
  config: TripleBarrierLabelConfig;
  upperBarrierPrice: number;
  lowerBarrierPrice: number;
  labelId: string;
  sampleId: string;
}): {
  touchedBarrier: "profit_taking" | "stop_loss";
  touchedAt: string;
  realizedReturnRatio: number;
  warnings: TripleBarrierLabelWarning[];
} | null {
  for (let index = 0; index < input.path.length; ) {
    const touchedAt = input.path[index]!.observedAt;
    let upperTouched = false;
    let lowerTouched = false;

    while (
      index < input.path.length &&
      input.path[index]!.observedAt === touchedAt
    ) {
      const snapshot = input.path[index]!;
      const touchRange = touchRangeForSnapshot(
        snapshot,
        input.config.referencePriceField
      );
      index += 1;
      if (touchRange === null) {
        continue;
      }

      upperTouched =
        upperTouched ||
        priceGreaterThanOrEqual(touchRange.highPrice, input.upperBarrierPrice);
      lowerTouched =
        lowerTouched ||
        priceLessThanOrEqual(touchRange.lowPrice, input.lowerBarrierPrice);
    }

    if (!upperTouched && !lowerTouched) {
      continue;
    }
    if (upperTouched && lowerTouched) {
      return {
        touchedBarrier: "stop_loss",
        touchedAt,
        realizedReturnRatio: roundRatio(-input.config.stopLossReturnRatio),
        warnings: [
          warning({
            code: "TRIPLE_BARRIER_AMBIGUOUS_TOUCH",
            severity: "warning",
            message:
              "Triple barrier label touched upper and lower barriers at the same timestamp; stop-loss policy was applied",
            labelId: input.labelId,
            sampleId: input.sampleId
          })
        ]
      };
    }
    if (lowerTouched) {
      return {
        touchedBarrier: "stop_loss",
        touchedAt,
        realizedReturnRatio: roundRatio(-input.config.stopLossReturnRatio),
        warnings: []
      };
    }
    return {
      touchedBarrier: "profit_taking",
      touchedAt,
      realizedReturnRatio: roundRatio(input.config.profitTakingReturnRatio),
      warnings: []
    };
  }

  return null;
}

function touchRangeForSnapshot(
  snapshot: HistoricalMarketSnapshot,
  referencePriceField: TripleBarrierLabelConfig["referencePriceField"]
): { highPrice: number; lowPrice: number } | null {
  const fallbackPrice = referencePrice(snapshot, referencePriceField);
  const highPrice = snapshot.highPriceKrw ?? fallbackPrice;
  const lowPrice = snapshot.lowPriceKrw ?? fallbackPrice;
  if (highPrice === null || lowPrice === null) {
    return null;
  }
  return {
    highPrice,
    lowPrice
  };
}

function latestSnapshot(
  path: readonly HistoricalMarketSnapshot[]
): HistoricalMarketSnapshot | null {
  return path[path.length - 1] ?? null;
}

function firstPricePathCoverageIssue(
  path: readonly HistoricalMarketSnapshot[],
  deadlineMs: number,
  referencePriceField: TripleBarrierLabelConfig["referencePriceField"]
): { issueStartAt: string; issueEndAt: string } | null {
  if (path.length === 0) {
    return {
      issueStartAt: new Date(deadlineMs).toISOString(),
      issueEndAt: new Date(deadlineMs).toISOString()
    };
  }

  for (let index = 1; index < path.length; index += 1) {
    const snapshot = path[index]!;
    if (hasTouchRangeCoverageIssue(snapshot, referencePriceField)) {
      return {
        issueStartAt: snapshot.observedAt,
        issueEndAt: snapshot.observedAt
      };
    }
  }

  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index]!;
    const next = path[index + 1]!;
    if (!snapshotCoversTimestamp(current, Date.parse(next.observedAt))) {
      return {
        issueStartAt: current.observedAt,
        issueEndAt: next.observedAt
      };
    }
  }

  const terminal = path[path.length - 1]!;
  if (!snapshotCoversTimestamp(terminal, deadlineMs)) {
    return {
      issueStartAt: terminal.observedAt,
      issueEndAt: new Date(deadlineMs).toISOString()
    };
  }

  return null;
}

function hasPartialTouchRange(snapshot: HistoricalMarketSnapshot): boolean {
  return (
    (snapshot.highPriceKrw === undefined) !==
    (snapshot.lowPriceKrw === undefined)
  );
}

function hasTouchRangeCoverageIssue(
  snapshot: HistoricalMarketSnapshot,
  referencePriceField: TripleBarrierLabelConfig["referencePriceField"]
): boolean {
  return (
    hasPartialTouchRange(snapshot) ||
    touchRangeForSnapshot(snapshot, referencePriceField) === null
  );
}

function snapshotCoversTimestamp(
  snapshot: HistoricalMarketSnapshot,
  targetMs: number
): boolean {
  const observedAtMs = Date.parse(snapshot.observedAt);
  return (
    observedAtMs <= targetMs &&
    targetMs - observedAtMs <= SNAPSHOT_INTERVAL_DURATION_MS[snapshot.interval]
  );
}

function referencePrice(
  snapshot: HistoricalMarketSnapshot,
  referencePriceField: TripleBarrierLabelConfig["referencePriceField"]
): number | null {
  return referencePriceField === "last"
    ? snapshot.lastPriceKrw
    : (snapshot.closePriceKrw ?? null);
}

function summarizeLabels(
  labels: readonly TripleBarrierLabel[],
  warnings: readonly TripleBarrierLabelWarning[]
): TripleBarrierLabelSummary {
  return {
    totalLabelCount: labels.length,
    availableLabelCount: labels.filter((label) => label.status === "available")
      .length,
    unavailableLabelCount: labels.filter(
      (label) => label.status === "unavailable"
    ).length,
    positiveCount: labels.filter((label) => label.directionLabel === "positive")
      .length,
    negativeCount: labels.filter((label) => label.directionLabel === "negative")
      .length,
    neutralCount: labels.filter((label) => label.directionLabel === "neutral")
      .length,
    profitTakingCount: labels.filter(
      (label) => label.touchedBarrier === "profit_taking"
    ).length,
    stopLossCount: labels.filter((label) => label.touchedBarrier === "stop_loss")
      .length,
    timeBarrierCount: labels.filter((label) => label.touchedBarrier === "time")
      .length,
    warningCount: warnings.length
  };
}

function warning(input: {
  code: TripleBarrierLabelWarningCode;
  severity: "info" | "warning";
  message: string;
  labelId: string | null;
  sampleId: string | null;
}): TripleBarrierLabelWarning {
  return tripleBarrierLabelWarningSchema.parse(input);
}

function directionLabelFor(
  realizedReturnRatio: number
): TripleBarrierDirectionLabel {
  if (realizedReturnRatio > 0) {
    return "positive";
  }
  if (realizedReturnRatio < 0) {
    return "negative";
  }
  return "neutral";
}

function metaLabelOutcomeFor(
  label: TripleBarrierLabel,
  sideDecision: MetaLabelSideDecision
): MetaLabelOutcome {
  if (
    sideDecision === "hold" ||
    sideDecision === "unknown" ||
    label.status !== "available" ||
    label.directionLabel === "neutral" ||
    label.directionLabel === "unavailable"
  ) {
    return "not_actionable";
  }

  if (sideDecision === "long") {
    return label.directionLabel === "positive" ? "correct_side" : "wrong_side";
  }

  return label.directionLabel === "negative" ? "correct_side" : "wrong_side";
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function priceComparisonEpsilon(left: number, right: number): number {
  return Math.max(
    MIN_PRICE_COMPARISON_EPSILON,
    Math.max(Math.abs(left), Math.abs(right)) *
      Number.EPSILON *
      PRICE_COMPARISON_EPSILON_MULTIPLIER
  );
}

function priceGreaterThanOrEqual(left: number, right: number): boolean {
  return left + priceComparisonEpsilon(left, right) >= right;
}

function priceLessThanOrEqual(left: number, right: number): boolean {
  return left - priceComparisonEpsilon(left, right) <= right;
}
