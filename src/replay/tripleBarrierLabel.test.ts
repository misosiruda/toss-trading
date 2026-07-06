import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  buildTripleBarrierLabelArtifact,
  tripleBarrierLabelArtifactSchema,
  type TripleBarrierLabelEvent
} from "./tripleBarrierLabel.js";

test("triple barrier label artifact emits deterministic profit stop and time labels", () => {
  const events: TripleBarrierLabelEvent[] = [
    event("sample_profit", "AAA", "2026-01-01T00:00:00.000Z"),
    event("sample_stop", "BBB", "2026-01-01T00:00:00.000Z"),
    event("sample_time", "CCC", "2026-01-01T00:00:00.000Z")
  ];
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events,
    priceSnapshots: [
      snapshot("AAA", "2026-01-01T00:00:00.000Z", 100),
      snapshot("AAA", "2026-01-02T00:00:00.000Z", 105, {
        highPriceKrw: 111,
        lowPriceKrw: 104
      }),
      snapshot("BBB", "2026-01-01T00:00:00.000Z", 100),
      snapshot("BBB", "2026-01-02T00:00:00.000Z", 97, {
        highPriceKrw: 98,
        lowPriceKrw: 94
      }),
      snapshot("CCC", "2026-01-01T00:00:00.000Z", 100),
      snapshot("CCC", "2026-01-03T00:00:00.000Z", 102),
      snapshot("CCC", "2026-01-05T00:00:00.000Z", 130)
    ]
  });
  const artifactWithReorderedConfig = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: {
      timeBarrierDurationDays: 3,
      stopLossReturnRatio: 0.05,
      profitTakingReturnRatio: 0.1,
      referencePriceField: "last"
    },
    events,
    priceSnapshots: []
  });

  assert.equal(tripleBarrierLabelArtifactSchema.safeParse(artifact).success, true);
  assert.equal(artifact.schemaVersion, "triple_barrier_label.v1");
  assert.match(artifact.config.configHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    artifact.config.configHash,
    artifactWithReorderedConfig.config.configHash
  );
  assert.deepEqual(
    artifact.labels.map((label) => [
      label.sampleId,
      label.touchedBarrier,
      label.directionLabel,
      label.realizedReturnRatio,
      label.labelEnd
    ]),
    [
      [
        "sample_profit",
        "profit_taking",
        "positive",
        0.1,
        "2026-01-02T00:00:00.000Z"
      ],
      [
        "sample_stop",
        "stop_loss",
        "negative",
        -0.05,
        "2026-01-02T00:00:00.000Z"
      ],
      [
        "sample_time",
        "time",
        "positive",
        0.02,
        "2026-01-04T00:00:00.000Z"
      ]
    ]
  );
  assert.deepEqual(artifact.summary, {
    totalLabelCount: 3,
    availableLabelCount: 3,
    unavailableLabelCount: 0,
    positiveCount: 2,
    negativeCount: 1,
    neutralCount: 0,
    profitTakingCount: 1,
    stopLossCount: 1,
    timeBarrierCount: 1,
    warningCount: 1
  });
  assert.deepEqual(
    artifact.labels.map((label) => label.purgedSample),
    [
      {
        sampleId: "sample_profit",
        labelStart: "2026-01-01T00:00:00.000Z",
        labelEnd: "2026-01-02T00:00:00.000Z"
      },
      {
        sampleId: "sample_stop",
        labelStart: "2026-01-01T00:00:00.000Z",
        labelEnd: "2026-01-02T00:00:00.000Z"
      },
      {
        sampleId: "sample_time",
        labelStart: "2026-01-01T00:00:00.000Z",
        labelEnd: "2026-01-04T00:00:00.000Z"
      }
    ]
  );
  assert.deepEqual(
    artifact.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_TIME_BARRIER_ONLY"]
  );
});

test("triple barrier label uses stop-loss policy for ambiguous same-bar touch", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_ambiguous", "DDD", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("DDD", "2026-01-01T00:00:00.000Z", 100),
      snapshot("DDD", "2026-01-02T00:00:00.000Z", 100, {
        highPriceKrw: 112,
        lowPriceKrw: 94
      })
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.touchedBarrier, "stop_loss");
  assert.equal(label.directionLabel, "negative");
  assert.equal(label.realizedReturnRatio, -0.05);
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_AMBIGUOUS_TOUCH"]
  );
  assert.deepEqual(
    artifact.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_AMBIGUOUS_TOUCH"]
  );
});

test("triple barrier label fails closed when entry price is missing", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_missing", "EEE", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [snapshot("EEE", "2026-01-02T00:00:00.000Z", 100)]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, null);
  assert.equal(label.realizedReturnRatio, null);
  assert.deepEqual(artifact.summary, {
    totalLabelCount: 1,
    availableLabelCount: 0,
    unavailableLabelCount: 1,
    positiveCount: 0,
    negativeCount: 0,
    neutralCount: 0,
    profitTakingCount: 0,
    stopLossCount: 0,
    timeBarrierCount: 0,
    warningCount: 1
  });
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_ENTRY_PRICE_MISSING"]
  );
});

test("triple barrier label generator rejects invalid config or event input", () => {
  assert.throws(
    () =>
      buildTripleBarrierLabelArtifact({
        config: {
          ...config(),
          profitTakingReturnRatio: 0
        },
        events: [],
        priceSnapshots: []
      }),
    /profitTakingReturnRatio/
  );

  assert.throws(
    () =>
      buildTripleBarrierLabelArtifact({
        config: config(),
        events: [
          {
            ...event("sample_invalid", "FFF", "2026-01-01T00:00:00.000Z"),
            observationAt: "2026-01-02T00:00:00.000Z"
          }
        ],
        priceSnapshots: []
      }),
    /labelStart/
  );

  assert.throws(
    () =>
      buildTripleBarrierLabelArtifact({
        config: config(),
        events: [
          event("sample_duplicate", "GGG", "2026-01-01T00:00:00.000Z"),
          event("sample_duplicate", "HHH", "2026-01-01T00:00:00.000Z")
        ],
        priceSnapshots: []
      }),
    /duplicate sampleId/
  );
});

function config() {
  return {
    referencePriceField: "last" as const,
    profitTakingReturnRatio: 0.1,
    stopLossReturnRatio: 0.05,
    timeBarrierDurationDays: 3
  };
}

function event(
  sampleId: string,
  symbol: string,
  labelStart: string
): TripleBarrierLabelEvent {
  return {
    sampleId,
    symbol,
    market: "KR",
    observationAt: labelStart,
    labelStart
  };
}

function snapshot(
  symbol: string,
  observedAt: string,
  lastPriceKrw: number,
  options: {
    highPriceKrw?: number;
    lowPriceKrw?: number;
    closePriceKrw?: number;
  } = {}
): HistoricalMarketSnapshot {
  return {
    snapshotId: `snapshot_${symbol}_${observedAt}`,
    market: "KR",
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    ...(options.highPriceKrw === undefined
      ? {}
      : { highPriceKrw: options.highPriceKrw }),
    ...(options.lowPriceKrw === undefined
      ? {}
      : { lowPriceKrw: options.lowPriceKrw }),
    ...(options.closePriceKrw === undefined
      ? {}
      : { closePriceKrw: options.closePriceKrw }),
    sourceRefs: [`fixture:${symbol}:${observedAt}`],
    createdAt: observedAt
  };
}
