import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { buildPurgedKFoldPlan } from "./purgedSplit.js";
import {
  buildMetaLabelCandidate,
  buildMetaLabelEvaluationReport,
  buildTripleBarrierLabelArtifact,
  buildTripleBarrierPurgedKFoldSamples,
  metaLabelCandidateSchema,
  metaLabelEvaluationReportSchema,
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
      snapshot("CCC", "2026-01-02T00:00:00.000Z", 101),
      snapshot("CCC", "2026-01-03T00:00:00.000Z", 101),
      snapshot("CCC", "2026-01-04T00:00:00.000Z", 102),
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

test("triple barrier label fails closed when horizon coverage ends early", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event("sample_stale_terminal", "MMM", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("MMM", "2026-01-01T00:00:00.000Z", 100),
      snapshot("MMM", "2026-01-02T00:00:00.000Z", 102)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
  );
});

test("triple barrier label fails closed when horizon coverage has interior gaps", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_gap_terminal", "OOO", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("OOO", "2026-01-01T00:00:00.000Z", 100),
      snapshot("OOO", "2026-01-04T00:00:00.000Z", 102)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
  );
});

test("triple barrier label fails closed when barrier range is partial", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event("sample_partial_range", "PPP", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("PPP", "2026-01-01T00:00:00.000Z", 100),
      snapshot("PPP", "2026-01-02T00:00:00.000Z", 105, {
        highPriceKrw: 111
      }),
      snapshot("PPP", "2026-01-03T00:00:00.000Z", 105),
      snapshot("PPP", "2026-01-04T00:00:00.000Z", 105)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
  );
});

test("triple barrier label fails closed when barrier touch range is missing", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: {
      ...config(),
      referencePriceField: "close" as const
    },
    events: [
      event("sample_missing_touch_range", "QQQ", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("QQQ", "2026-01-01T00:00:00.000Z", 100, {
        closePriceKrw: 100
      }),
      snapshot("QQQ", "2026-01-02T00:00:00.000Z", 105),
      snapshot("QQQ", "2026-01-03T00:00:00.000Z", 105, {
        closePriceKrw: 105
      }),
      snapshot("QQQ", "2026-01-04T00:00:00.000Z", 105, {
        closePriceKrw: 105
      })
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
  );
});

test("triple barrier label fails closed when full horizon touch range is missing", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: {
      ...config(),
      referencePriceField: "close" as const
    },
    events: [
      event("sample_later_missing_range", "RRR", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("RRR", "2026-01-01T00:00:00.000Z", 100, {
        closePriceKrw: 100
      }),
      snapshot("RRR", "2026-01-02T00:00:00.000Z", 101, {
        closePriceKrw: 101
      }),
      snapshot("RRR", "2026-01-03T12:00:00.000Z", 102, {
        closePriceKrw: 102
      }),
      snapshot("RRR", "2026-01-03T18:00:00.000Z", 102)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
  );
});

test("triple barrier label fails closed when latest terminal reference price is missing", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: {
      ...config(),
      referencePriceField: "close" as const
    },
    events: [
      event("sample_stale_terminal_close", "SSS", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("SSS", "2026-01-01T00:00:00.000Z", 100, {
        closePriceKrw: 100
      }),
      snapshot("SSS", "2026-01-02T00:00:00.000Z", 101, {
        closePriceKrw: 101
      }),
      snapshot("SSS", "2026-01-03T00:00:00.000Z", 101, {
        highPriceKrw: 104,
        lowPriceKrw: 99
      })
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
  );
});

test("triple barrier label accepts terminal price within snapshot interval", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event(
        "sample_interval_terminal",
        "NNN",
        "2026-01-01T12:00:00.000Z"
      )
    ],
    priceSnapshots: [
      snapshot("NNN", "2026-01-01T12:00:00.000Z", 100),
      snapshot("NNN", "2026-01-02T00:00:00.000Z", 101),
      snapshot("NNN", "2026-01-03T00:00:00.000Z", 101),
      snapshot("NNN", "2026-01-04T00:00:00.000Z", 102)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "available");
  assert.equal(label.touchedBarrier, "time");
  assert.equal(label.directionLabel, "positive");
  assert.equal(label.realizedReturnRatio, 0.02);
  assert.equal(label.labelEnd, "2026-01-04T12:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
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

test("triple barrier label applies stop-loss policy across duplicate timestamps", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event(
        "sample_duplicate_timestamp_touch",
        "TTT",
        "2026-01-01T00:00:00.000Z"
      )
    ],
    priceSnapshots: [
      snapshot("TTT", "2026-01-01T00:00:00.000Z", 100),
      snapshot("TTT", "2026-01-02T00:00:00.000Z", 100, {
        snapshotId: "snapshot_TTT_2026-01-02T00:00:00.000Z_profit",
        highPriceKrw: 111,
        lowPriceKrw: 100
      }),
      snapshot("TTT", "2026-01-02T00:00:00.000Z", 100, {
        snapshotId: "snapshot_TTT_2026-01-02T00:00:00.000Z_stop",
        highPriceKrw: 100,
        lowPriceKrw: 94
      })
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "available");
  assert.equal(label.touchedBarrier, "stop_loss");
  assert.equal(label.directionLabel, "negative");
  assert.equal(label.realizedReturnRatio, -0.05);
  assert.equal(label.labelEnd, "2026-01-02T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_AMBIGUOUS_TOUCH"]
  );
});

test("triple barrier purged samples feed generated horizons into purged k-fold", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: {
      ...config(),
      timeBarrierDurationDays: 2
    },
    events: [
      event("sample_pkf_1", "PKF", "2026-01-01T00:00:00.000Z"),
      event("sample_pkf_2", "PKF", "2026-01-02T00:00:00.000Z"),
      event("sample_pkf_3", "PKF", "2026-01-03T00:00:00.000Z"),
      event("sample_pkf_4", "PKF", "2026-01-06T00:00:00.000Z")
    ],
    priceSnapshots: Array.from({ length: 8 }, (_, index) =>
      snapshot(
        "PKF",
        `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        100
      )
    )
  });
  const samples = buildTripleBarrierPurgedKFoldSamples(artifact);
  const plan = buildPurgedKFoldPlan({
    planId: "triple_barrier_pkf",
    foldCount: 2,
    samples
  });
  const firstSplit = plan.splits[0]!;

  assert.deepEqual(samples, [
    {
      sampleId: "sample_pkf_1",
      labelStart: "2026-01-01T00:00:00.000Z",
      labelEnd: "2026-01-03T00:00:00.000Z"
    },
    {
      sampleId: "sample_pkf_2",
      labelStart: "2026-01-02T00:00:00.000Z",
      labelEnd: "2026-01-04T00:00:00.000Z"
    },
    {
      sampleId: "sample_pkf_3",
      labelStart: "2026-01-03T00:00:00.000Z",
      labelEnd: "2026-01-05T00:00:00.000Z"
    },
    {
      sampleId: "sample_pkf_4",
      labelStart: "2026-01-06T00:00:00.000Z",
      labelEnd: "2026-01-08T00:00:00.000Z"
    }
  ]);
  assert.deepEqual(firstSplit.testSampleIds, [
    "sample_pkf_1",
    "sample_pkf_2"
  ]);
  assert.deepEqual(firstSplit.purgedSampleIds, ["sample_pkf_3"]);
  assert.deepEqual(firstSplit.trainSampleIds, ["sample_pkf_4"]);
  assert.equal(firstSplit.purgeExcludedSampleCount, 1);
});

test("meta label candidate evaluates side decisions without sizing directives", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event("sample_meta_profit", "META", "2026-01-01T00:00:00.000Z"),
      event("sample_meta_stop", "LOSS", "2026-01-01T00:00:00.000Z"),
      event("sample_meta_missing", "MISS", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("META", "2026-01-01T00:00:00.000Z", 100),
      snapshot("META", "2026-01-02T00:00:00.000Z", 105, {
        highPriceKrw: 111,
        lowPriceKrw: 104
      }),
      snapshot("LOSS", "2026-01-01T00:00:00.000Z", 100),
      snapshot("LOSS", "2026-01-02T00:00:00.000Z", 97, {
        highPriceKrw: 98,
        lowPriceKrw: 94
      })
    ]
  });
  const positiveLabel = artifact.labels.find(
    (label) => label.sampleId === "sample_meta_profit"
  )!;
  const negativeLabel = artifact.labels.find(
    (label) => label.sampleId === "sample_meta_stop"
  )!;
  const unavailableLabel = artifact.labels.find(
    (label) => label.sampleId === "sample_meta_missing"
  )!;

  const longPositive = buildMetaLabelCandidate({
    sourceLabel: positiveLabel,
    sideDecision: "long"
  });
  const longNegative = buildMetaLabelCandidate({
    sourceLabel: negativeLabel,
    sideDecision: "long"
  });
  const shortNegative = buildMetaLabelCandidate({
    sourceLabel: negativeLabel,
    sideDecision: "short"
  });
  const holdPositive = buildMetaLabelCandidate({
    sourceLabel: positiveLabel,
    sideDecision: "hold"
  });
  const longUnavailable = buildMetaLabelCandidate({
    sourceLabel: unavailableLabel,
    sideDecision: "long"
  });

  assert.equal(metaLabelCandidateSchema.safeParse(longPositive).success, true);
  assert.deepEqual(
    [
      longPositive.outcome,
      longNegative.outcome,
      shortNegative.outcome,
      holdPositive.outcome,
      longUnavailable.outcome
    ],
    [
      "correct_side",
      "wrong_side",
      "correct_side",
      "not_actionable",
      "not_actionable"
    ]
  );
  assert.equal(longPositive.schemaVersion, "meta_label_candidate.v1");
  assert.equal(longPositive.sourceLabelId, positiveLabel.labelId);
  assert.equal(longPositive.sizingDirective, null);
});

test("meta label candidate rejects sizing directives", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_meta_sizing", "MSZ", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("MSZ", "2026-01-01T00:00:00.000Z", 100),
      snapshot("MSZ", "2026-01-02T00:00:00.000Z", 105, {
        highPriceKrw: 111,
        lowPriceKrw: 104
      })
    ]
  });

  assert.throws(
    () =>
      buildMetaLabelCandidate({
        sourceLabel: artifact.labels[0]!,
        sideDecision: "long",
        sizingDirective: {
          targetWeight: 0.1
        }
      }),
    /META_LABEL_SIZING_DIRECTIVE_REJECTED/
  );
  assert.equal(
    metaLabelCandidateSchema.safeParse({
      schemaVersion: "meta_label_candidate.v1",
      sourceLabelId: artifact.labels[0]!.labelId,
      sideDecision: "long",
      outcome: "correct_side",
      sizingDirective: {
        targetWeight: 0.1
      }
    }).success,
    false
  );
});

test("meta label evaluation report summarizes candidate outcomes", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event("sample_eval_profit", "EVA", "2026-01-01T00:00:00.000Z"),
      event("sample_eval_stop", "EVB", "2026-01-01T00:00:00.000Z"),
      event("sample_eval_missing", "EVC", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("EVA", "2026-01-01T00:00:00.000Z", 100),
      snapshot("EVA", "2026-01-02T00:00:00.000Z", 105, {
        highPriceKrw: 111,
        lowPriceKrw: 104
      }),
      snapshot("EVB", "2026-01-01T00:00:00.000Z", 100),
      snapshot("EVB", "2026-01-02T00:00:00.000Z", 97, {
        highPriceKrw: 98,
        lowPriceKrw: 94
      })
    ]
  });
  const positiveLabel = artifact.labels.find(
    (label) => label.sampleId === "sample_eval_profit"
  )!;
  const negativeLabel = artifact.labels.find(
    (label) => label.sampleId === "sample_eval_stop"
  )!;
  const unavailableLabel = artifact.labels.find(
    (label) => label.sampleId === "sample_eval_missing"
  )!;
  const report = buildMetaLabelEvaluationReport({
    generatedAt: "2026-01-10T00:00:00.000Z",
    candidates: [
      buildMetaLabelCandidate({
        sourceLabel: negativeLabel,
        sideDecision: "short"
      }),
      buildMetaLabelCandidate({
        sourceLabel: positiveLabel,
        sideDecision: "long"
      }),
      buildMetaLabelCandidate({
        sourceLabel: unavailableLabel,
        sideDecision: "long"
      })
    ]
  });

  assert.equal(metaLabelEvaluationReportSchema.safeParse(report).success, true);
  assert.equal(report.schemaVersion, "meta_label_evaluation.v1");
  assert.deepEqual(report.summary, {
    totalCandidateCount: 3,
    actionableCandidateCount: 2,
    correctSideCount: 2,
    wrongSideCount: 0,
    notActionableCount: 1,
    accuracyRatio: 1
  });
  assert.deepEqual(
    report.candidates.map((candidate) => candidate.sourceLabelId),
    [
      "triple_barrier_sample_eval_missing",
      "triple_barrier_sample_eval_profit",
      "triple_barrier_sample_eval_stop"
    ]
  );
});

test("meta label evaluation report rejects duplicate source labels", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_eval_duplicate", "EVD", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("EVD", "2026-01-01T00:00:00.000Z", 100),
      snapshot("EVD", "2026-01-02T00:00:00.000Z", 105, {
        highPriceKrw: 111,
        lowPriceKrw: 104
      })
    ]
  });
  const candidate = buildMetaLabelCandidate({
    sourceLabel: artifact.labels[0]!,
    sideDecision: "long"
  });

  assert.throws(
    () =>
      buildMetaLabelEvaluationReport({
        candidates: [candidate, candidate]
      }),
    /duplicate meta-label sourceLabelId/
  );
});

test("triple barrier label ignores entry candle range for barrier touch", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_entry_range", "III", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("III", "2026-01-01T00:00:00.000Z", 100, {
        highPriceKrw: 120,
        lowPriceKrw: 90
      }),
      snapshot("III", "2026-01-02T00:00:00.000Z", 101),
      snapshot("III", "2026-01-03T00:00:00.000Z", 101),
      snapshot("III", "2026-01-04T00:00:00.000Z", 102)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "available");
  assert.equal(label.touchedBarrier, "time");
  assert.equal(label.directionLabel, "positive");
  assert.equal(label.realizedReturnRatio, 0.02);
  assert.equal(label.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_TIME_BARRIER_ONLY"]
  );
});

test("triple barrier label treats exact profit barrier touch as hit", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [
      event("sample_exact_profit", "KKK", "2026-01-01T00:00:00.000Z")
    ],
    priceSnapshots: [
      snapshot("KKK", "2026-01-01T00:00:00.000Z", 100),
      snapshot("KKK", "2026-01-02T00:00:00.000Z", 109, {
        highPriceKrw: 110,
        lowPriceKrw: 109
      })
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "available");
  assert.equal(label.touchedBarrier, "profit_taking");
  assert.equal(label.directionLabel, "positive");
  assert.equal(label.realizedReturnRatio, 0.1);
  assert.equal(label.labelEnd, "2026-01-02T00:00:00.000Z");
});

test("triple barrier label treats exact stop barrier touch as hit", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: {
      ...config(),
      stopLossReturnRatio: 0.8
    },
    events: [event("sample_exact_stop", "LLL", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("LLL", "2026-01-01T00:00:00.000Z", 5),
      snapshot("LLL", "2026-01-02T00:00:00.000Z", 4, {
        highPriceKrw: 4,
        lowPriceKrw: 1
      })
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "available");
  assert.equal(label.touchedBarrier, "stop_loss");
  assert.equal(label.directionLabel, "negative");
  assert.equal(label.realizedReturnRatio, -0.8);
  assert.equal(label.labelEnd, "2026-01-02T00:00:00.000Z");
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

test("triple barrier label fails closed when entry price is zero", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_zero_entry", "JJJ", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("JJJ", "2026-01-01T00:00:00.000Z", 0),
      snapshot("JJJ", "2026-01-02T00:00:00.000Z", 100)
    ]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, null);
  assert.equal(label.upperBarrierPrice, null);
  assert.equal(label.lowerBarrierPrice, null);
  assert.equal(label.realizedReturnRatio, null);
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_ENTRY_PRICE_MISSING"]
  );
});

test("triple barrier label fails closed without post-entry price path", () => {
  const artifact = buildTripleBarrierLabelArtifact({
    generatedAt: "2026-01-10T00:00:00.000Z",
    config: config(),
    events: [event("sample_entry_only", "FFF", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [snapshot("FFF", "2026-01-01T00:00:00.000Z", 100)]
  });
  const label = artifact.labels[0]!;

  assert.equal(label.status, "unavailable");
  assert.equal(label.touchedBarrier, "unavailable");
  assert.equal(label.entryPrice, 100);
  assert.equal(label.realizedReturnRatio, null);
  assert.equal(label.purgedSample.labelEnd, "2026-01-04T00:00:00.000Z");
  assert.deepEqual(
    label.warnings.map((warning) => warning.code),
    ["TRIPLE_BARRIER_PRICE_PATH_MISSING"]
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

  const validArtifact = buildTripleBarrierLabelArtifact({
    config: config(),
    events: [event("sample_mismatch", "ZZZ", "2026-01-01T00:00:00.000Z")],
    priceSnapshots: [
      snapshot("ZZZ", "2026-01-01T00:00:00.000Z", 100),
      snapshot("ZZZ", "2026-01-02T00:00:00.000Z", 101),
      snapshot("ZZZ", "2026-01-03T00:00:00.000Z", 101),
      snapshot("ZZZ", "2026-01-04T00:00:00.000Z", 102)
    ]
  });

  assert.equal(
    tripleBarrierLabelArtifactSchema.safeParse({
      ...validArtifact,
      labels: [
        {
          ...validArtifact.labels[0]!,
          purgedSample: {
            ...validArtifact.labels[0]!.purgedSample,
            labelEnd: "2026-01-05T00:00:00.000Z"
          }
        }
      ]
    }).success,
    false
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
    snapshotId?: string;
    highPriceKrw?: number;
    lowPriceKrw?: number;
    closePriceKrw?: number;
  } = {}
): HistoricalMarketSnapshot {
  return {
    snapshotId: options.snapshotId ?? `snapshot_${symbol}_${observedAt}`,
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
