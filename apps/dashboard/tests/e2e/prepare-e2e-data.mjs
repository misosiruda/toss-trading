import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(scriptDir, "../..");
const e2eRoot = resolve(dashboardRoot, ".e2e-data");
const dataDir = resolve(e2eRoot, "paper");
const batchReplayRootDir = resolve(e2eRoot, "batch-replay");
const batchReplayDir = resolve(batchReplayRootDir, "paper_sim_single");
const runDir = resolve(batchReplayDir, "runs", "paper_sim_single_run_000000");
const sourceDataDir = resolve(dataDir, "source-data");
const runsPath = resolve(batchReplayDir, "batch-replay-runs.jsonl");
const reportPath = resolve(runDir, "historical-replay-report.json");

await rm(dataDir, { force: true, recursive: true });
await rm(batchReplayRootDir, { force: true, recursive: true });
await mkdir(dataDir, { recursive: true });
await mkdir(runDir, { recursive: true });
await mkdir(sourceDataDir, { recursive: true });

await writeFile(
  resolve(dataDir, "virtual-portfolio.json"),
  `${JSON.stringify(
    {
      portfolioId: "virtual_e2e",
      cashKrw: 850_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          assetType: "STOCK",
          assetClass: "equity",
          strategyBucket: "long_term",
          quantity: 2,
          averagePriceKrw: 70_000,
          marketValueKrw: 150_000,
          updatedAt: "2026-06-27T00:00:00.000Z"
        }
      ],
      updatedAt: "2026-06-27T00:00:00.000Z"
    },
    null,
    2
  )}\n`,
  "utf8"
);

const candidatePrefix =
  "provider=deterministic_fixture|providerMetadata=sha256:provider|";
const aggregate = {
  mode: "paper_only",
  generatedAt: "2026-06-27T00:00:00.000Z",
  sourceRunsPath: "apps/dashboard/.e2e-data/paper/batch-replay-runs.jsonl",
  sourceSelectionTrialsPath:
    "apps/dashboard/.e2e-data/paper/batch-replay-selection-trials.jsonl",
  sourceUniverseCoveragePath:
    "apps/dashboard/.e2e-data/paper/source-data/historical-universe-coverage.json",
  targetReturnThresholds: [0],
  summary: {
    runCount: 4,
    completedCount: 4,
    skippedCount: 0,
    failedCount: 0,
    returnSampleCount: 4,
    regimeCounts: { bull: 2, bear: 2 },
    regimeCountsByMarket: { US: { bull: 2, bear: 2 } },
    validationSplitRoleCounts: { train: 2, validation: 1, test: 1 },
    dataAvailabilityIssues: [
      {
        code: "VIRTUAL_FX_STALE",
        count: 1,
        runIds: ["run_fx_stale"]
      }
    ]
  },
  trialSummary: {
    trialCount: 2,
    selectedCount: 1,
    unselectedCount: 1,
    statusCounts: { completed: 2 },
    decisionProviderModes: [
      {
        key: "deterministic_fixture",
        count: 2,
        runIds: ["run_0", "run_1"]
      }
    ],
    promptHashes: [
      {
        key: "sha256:prompt-alpha-differentiator",
        count: 1,
        runIds: ["run_0"]
      },
      {
        key: "sha256:prompt-beta-differentiator",
        count: 1,
        runIds: ["run_1"]
      }
    ],
    configHashes: [
      {
        key: "sha256:config-alpha",
        count: 1,
        runIds: ["run_0"]
      },
      {
        key: "sha256:config-beta",
        count: 1,
        runIds: ["run_1"]
      }
    ],
    riskPolicyHashes: [],
    exitPolicyHashes: [],
    riskProfiles: [
      {
        key: "balanced",
        count: 2,
        runIds: ["run_0", "run_1"]
      }
    ],
    aiDecisionFailureTrialCount: 0,
    rejectedTrialCount: 0,
    noTradeTrialCount: 0,
    runIds: ["run_0", "run_1"]
  },
  overfittingDiagnostics: {
    validationProtocol: "sampled_cpcv_pbo_like",
    selectionMetric: "total_return_ratio",
    expectedSampledCpcvSplitCount: 4,
    sampledCpcvSplitCount: 4,
    sampledCpcvSplitCountMatchesExpected: true,
    joinedTrialCount: 4,
    candidateCount: 2,
    returnSampleCount: 4,
    splitRoleCounts: {
      train: 2,
      validation: 1,
      test: 1
    },
    splitMetricMatrix: [
      {
        candidateKey: `${candidatePrefix}promptHash=sha256:prompt-alpha-differentiator|riskProfile=balanced|allocation=alpha`,
        decisionProviderMode: "deterministic_fixture",
        decisionProviderMetadataHash: "sha256:provider",
        promptHash: "sha256:prompt-alpha-differentiator",
        configHashes: ["sha256:config-alpha"],
        riskPolicyHash: "sha256:risk",
        allocationPolicyHash: "sha256:allocation-alpha",
        marketRegimeAllocationPolicyHash: "sha256:regime-allocation",
        exitPolicyHash: "sha256:exit",
        riskProfile: "balanced",
        roleMetrics: {
          train: {
            runCount: 1,
            returnSampleCount: 1,
            averageTotalReturnRatio: 0.02,
            medianTotalReturnRatio: 0.02,
            runIds: ["run_0"]
          },
          validation: {
            runCount: 1,
            returnSampleCount: 1,
            averageTotalReturnRatio: 0.01,
            medianTotalReturnRatio: 0.01,
            runIds: ["run_1"]
          },
          test: {
            runCount: 1,
            returnSampleCount: 1,
            averageTotalReturnRatio: 0.005,
            medianTotalReturnRatio: 0.005,
            runIds: ["run_2"]
          }
        },
        splitMetrics: []
      },
      {
        candidateKey: `${candidatePrefix}promptHash=sha256:prompt-beta-differentiator|riskProfile=balanced|allocation=beta`,
        decisionProviderMode: "deterministic_fixture",
        decisionProviderMetadataHash: "sha256:provider",
        promptHash: "sha256:prompt-beta-differentiator",
        configHashes: ["sha256:config-beta"],
        riskPolicyHash: "sha256:risk",
        allocationPolicyHash: "sha256:allocation-beta",
        marketRegimeAllocationPolicyHash: "sha256:regime-allocation",
        exitPolicyHash: "sha256:exit",
        riskProfile: "balanced",
        roleMetrics: {
          train: {
            runCount: 1,
            returnSampleCount: 1,
            averageTotalReturnRatio: 0.01,
            medianTotalReturnRatio: 0.01,
            runIds: ["run_3"]
          }
        },
        splitMetrics: []
      }
    ],
    selectedCandidateKey: `${candidatePrefix}promptHash=sha256:prompt-alpha-differentiator|riskProfile=balanced|allocation=alpha`,
    selectedTrainAverageTotalReturnRatio: 0.02,
    pboLikeScore: 0.25,
    holdoutDegradation: [
      {
        splitId: "split-validation-001",
        splitRole: "validation",
        selectedCandidateKey: `${candidatePrefix}promptHash=sha256:prompt-alpha-differentiator|riskProfile=balanced|allocation=alpha`,
        selectedAverageTotalReturnRatio: 0.01,
        selectedRank: 1,
        candidateCount: 2,
        medianCandidateAverageTotalReturnRatio: 0.0075,
        bestAverageTotalReturnRatio: 0.01,
        degradationFromTrainRatio: -0.01,
        selectedBelowMedian: false,
        runIds: ["run_1"]
      }
    ],
    warnings: ["selection bias warning"]
  },
  cpcvPboValidation: {
    schemaVersion: "cpcv_pbo_validation.v1",
    status: "sampled",
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: {
      validationProtocol: "combinatorial_purged_cv",
      foldCount: 4,
      testFoldCount: 1,
      purgeDurationDays: 0,
      embargoDurationDays: 0,
      selectionMetric: "total_return_ratio",
      tieBreaker: "candidate_key_asc",
      maxCombinationCount: 2,
      combinationMode: "sampled",
      randomSeed: "dashboard_e2e_sampled_matrix"
    },
    splitPlan: null,
    performanceMatrix: [
      {
        candidateKey: `${candidatePrefix}promptHash=sha256:prompt-alpha-differentiator|riskProfile=balanced|allocation=alpha`,
        promptHash: "sha256:prompt-alpha-differentiator",
        configHash: "sha256:config-alpha",
        riskPolicyHash: "sha256:risk",
        exitPolicyHash: "sha256:exit",
        splitMetrics: [
          {
            combinationId: "dashboard-e2e-validation",
            trainMetric: 0.02,
            testMetric: 0.01,
            trainReturnSampleCount: 1,
            testReturnSampleCount: 1
          },
          {
            combinationId: "dashboard-e2e-test",
            trainMetric: 0.02,
            testMetric: 0.005,
            trainReturnSampleCount: 1,
            testReturnSampleCount: 1
          }
        ]
      },
      {
        candidateKey: `${candidatePrefix}promptHash=sha256:prompt-beta-differentiator|riskProfile=balanced|allocation=beta`,
        promptHash: "sha256:prompt-beta-differentiator",
        configHash: "sha256:config-beta",
        riskPolicyHash: "sha256:risk",
        exitPolicyHash: "sha256:exit",
        splitMetrics: [
          {
            combinationId: "dashboard-e2e-validation",
            trainMetric: 0.01,
            testMetric: 0.02,
            trainReturnSampleCount: 1,
            testReturnSampleCount: 1
          },
          {
            combinationId: "dashboard-e2e-test",
            trainMetric: 0.01,
            testMetric: 0.015,
            trainReturnSampleCount: 1,
            testReturnSampleCount: 1
          }
        ]
      }
    ],
    selectionLog: [
      {
        combinationId: "dashboard-e2e-validation",
        selectedCandidateKey: `${candidatePrefix}promptHash=sha256:prompt-alpha-differentiator|riskProfile=balanced|allocation=alpha`,
        selectedTrainMetric: 0.02,
        selectedTestMetric: 0.01,
        testRankPercentile: 0.25,
        tieBreakApplied: false
      },
      {
        combinationId: "dashboard-e2e-test",
        selectedCandidateKey: `${candidatePrefix}promptHash=sha256:prompt-alpha-differentiator|riskProfile=balanced|allocation=alpha`,
        selectedTrainMetric: 0.02,
        selectedTestMetric: 0.005,
        testRankPercentile: 0.25,
        tieBreakApplied: false
      }
    ],
    pbo: {
      status: "computed",
      probability: 1,
      evaluatedCombinationCount: 2,
      selectedBelowMedianCount: 2,
      lambdaLogitValues: [-1.0986122886681098, -1.0986122886681098],
      methodNotes: [
        "PBO is computed from sampled batch aggregate split matrix."
      ]
    },
    warnings: [
      {
        code: "CPCV_SAMPLED_MODE_USED",
        severity: "warning",
        message:
          "Dashboard shows sampled CPCV/PBO validation; use as read-only validation warning only."
      },
      {
        code: "CPCV_SPLIT_PLAN_UNAVAILABLE",
        severity: "warning",
        message:
          "Stored batch aggregate does not include a standalone CPCV split plan."
      }
    ]
  },
  metaLabelEvaluation: {
    schemaVersion: "meta_label_evaluation.v1",
    generatedAt: "2026-07-06T00:00:00.000Z",
    candidates: [
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_dashboard_positive",
        sideDecision: "long",
        outcome: "correct_side",
        sizingDirective: null
      },
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_dashboard_negative",
        sideDecision: "long",
        outcome: "wrong_side",
        sizingDirective: null
      },
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_dashboard_unavailable",
        sideDecision: "hold",
        outcome: "not_actionable",
        sizingDirective: null
      }
    ],
    summary: {
      totalCandidateCount: 3,
      actionableCandidateCount: 2,
      correctSideCount: 1,
      wrongSideCount: 1,
      notActionableCount: 1,
      accuracyRatio: 0.5
    }
  },
  universeCoverage: {
    sourcePath:
      "apps/dashboard/.e2e-data/paper/source-data/historical-universe-coverage.json",
    universeId: "dashboard-e2e-universe",
    status: "insufficient",
    rangeStart: "2026-06-01T00:00:00.000Z",
    rangeEnd: "2026-06-30T14:59:59.999Z",
    universeSymbolCount: 2,
    requiredSymbolCount: 2,
    optionalSymbolCount: 0,
    availableSymbolCount: 1,
    availableRequiredSymbolCount: 1,
    availableOptionalSymbolCount: 0,
    missingRequiredSymbolCount: 1,
    missingOptionalSymbolCount: 0,
    insufficientRequiredSymbolCount: 0,
    insufficientOptionalSymbolCount: 0,
    missingRequiredMarketCount: 0,
    missingRequiredAssetTypeCount: 0,
    missingRequiredStrategyBucketCount: 0,
    insufficientAvailableMarketSymbolCount: 1,
    insufficientAvailableAssetTypeSymbolCount: 1,
    insufficientAvailableStrategyBucketSymbolCount: 0,
    corruptLineCount: 0,
    availableMarketSymbolCounts: { KR: 1 },
    availableAssetTypeSymbolCounts: { STOCK: 1 },
    availableStrategyBucketSymbolCounts: { long_term: 1 },
    issues: ["REQUIRED_UNIVERSE_SYMBOL_MISSING"],
    warnings: [
      "universe selection bias warning: coverage status is insufficient for dashboard-e2e-universe; available_required_symbols=1/2; available_symbols=1/2"
    ]
  },
  overall: {
    key: "overall",
    runCount: 4,
    completedCount: 4,
    skippedCount: 0,
    failedCount: 0,
    returnSampleCount: 4,
    averageTotalReturnRatio: 0.015,
    medianTotalReturnRatio: 0.01,
    minTotalReturnRatio: 0.005,
    maxTotalReturnRatio: 0.02,
    winRate: 1,
    averageExposureRatio: 0.55,
    averageCashRatio: 0.45,
    averageTimeInMarketRatio: 0.8,
    averageFinalCashRatio: 0.35,
    averageFinalPositionRatio: 0.65,
    averageTargetExposureRatio: 0.75,
    averageTargetExposureGapRatio: 0.08,
    averageFinalTargetExposureGapRatio: 0.05,
    averageFinalExposureByMarketKrw: { US: 650000 },
    averageFinalExposureByAssetTypeKrw: { equity: 650000 },
    totalAiDecisionFailureCount: 0,
    totalRejectedCount: 0,
    totalMeaningfulRejectCount: 0,
    totalDustRejectCount: 0,
    totalTradeCount: 4,
    averageTradeCount: 1,
    sharpeValidation: {
      schemaVersion: "sharpe_validation.v1",
      status: "unavailable",
      sample: {
        returnSampleCount: 4,
        minimumSampleCount: 30,
        returnFrequency: "per_sample",
        annualizationStatus: "not_annualized",
        annualizationFactor: null,
        riskFreeRateRatio: null
      },
      distribution: {
        meanReturnRatio: 0.015,
        volatilityRatio: 0.007071,
        skewness: 0,
        excessKurtosis: null,
        autocorrelation: {
          maxLag: 0,
          lagCount: 0,
          coefficients: [],
          adjustmentStatus: "not_required"
        }
      },
      metrics: {
        sampleSharpe: {
          metric: "sample_sharpe",
          status: "insufficient_sample",
          value: null,
          standardError: null,
          confidenceInterval95: null,
          benchmarkSharpeRatio: null,
          methodNotes: ["sample_sharpe requires at least 30 return samples"]
        },
        loAdjustedSharpe: {
          metric: "lo_adjusted_sharpe",
          status: "insufficient_sample",
          value: null,
          standardError: null,
          confidenceInterval95: null,
          benchmarkSharpeRatio: null,
          methodNotes: ["lo_adjusted_sharpe requires sample_sharpe first"]
        },
        probabilisticSharpeRatio: {
          metric: "probabilistic_sharpe_ratio",
          status: "insufficient_sample",
          probability: null,
          benchmarkSharpeRatio: null,
          methodNotes: [
            "probabilistic_sharpe_ratio requires at least 30 return samples"
          ]
        },
        deflatedSharpeRatio: {
          metric: "deflated_sharpe_ratio",
          status: "insufficient_sample",
          value: null,
          standardError: null,
          confidenceInterval95: null,
          benchmarkSharpeRatio: null,
          methodNotes: [
            "deflated_sharpe_ratio requires at least 30 return samples"
          ]
        }
      },
      selectionContext: {
        candidateCount: 2,
        trialCount: 4,
        trialSharpeRatioStandardDeviation: null,
        selectedByMetric: "total_return_ratio",
        multipleTestingAdjustment: "trial_log"
      },
      warnings: [
        {
          code: "INSUFFICIENT_RETURN_SAMPLES",
          severity: "warning",
          message:
            "Sharpe validation unavailable: at least 30 return samples are required"
        }
      ]
    },
    costSummary: {
      sampleCount: 2,
      tradeCount: 3,
      feeKrw: 11,
      taxKrw: 2,
      slippageKrw: 4,
      spreadCostKrw: 6,
      impactCostKrw: 7,
      totalCostKrw: 30,
      averageCostPerRunKrw: 15,
      averageCostPerTradeKrw: 10,
      filledCount: 2,
      partialFillCount: 1,
      notModeledLiquidityCount: 0,
      averageRunParticipationRate: 0.15,
      maxParticipationRate: 0.25,
      costModelVersions: ["paper_cost_model.v4"],
      byStrategyBucket: [
        {
          strategyBucket: "short_term",
          sampleCount: 2,
          tradeCount: 3,
          feeKrw: 11,
          taxKrw: 2,
          slippageKrw: 4,
          spreadCostKrw: 6,
          impactCostKrw: 7,
          totalCostKrw: 30,
          averageCostPerRunKrw: 15,
          averageCostPerTradeKrw: 10,
          filledCount: 2,
          partialFillCount: 1,
          notModeledLiquidityCount: 0,
          averageRunParticipationRate: 0.15,
          maxParticipationRate: 0.25,
          costModelVersions: ["paper_cost_model.v4"],
          runIds: [
            "run_0",
            "run_1",
            "run_2",
            "run_3",
            "run_4",
            "run_5",
            "run_6"
          ]
        }
      ],
      missingStrategyBucketBreakdownCount: 7,
      missingStrategyBucketBreakdownRunIds: [
        "run_legacy_bucketless_0",
        "run_legacy_bucketless_1",
        "run_legacy_bucketless_2",
        "run_legacy_bucketless_3",
        "run_legacy_bucketless_4",
        "run_legacy_bucketless_5",
        "run_legacy_bucketless_6"
      ],
      runIds: ["run_0", "run_1"]
    },
    runIds: ["run_0", "run_1", "run_2", "run_3"]
  },
  byRegime: {},
  byValidationSplitRole: {}
};

await writeFile(
  resolve(dataDir, "batch-replay-aggregate-report.json"),
  `${JSON.stringify(aggregate, null, 2)}\n`,
  "utf8"
);

await writeFile(
  resolve(sourceDataDir, "historical-market-snapshots.jsonl"),
  `${JSON.stringify({
    snapshotId: "hist_e2e_kr_035420_20260627",
    market: "KR",
    symbol: "035420",
    name: "NAVER",
    observedAt: "2026-06-27T09:00:00+09:00",
    interval: "1d",
    lastPriceKrw: 180000,
    sourceRefs: ["e2e:source:035420"],
    createdAt: "2026-06-27T09:00:00+09:00"
  })}\n`,
  "utf8"
);

const historicalReplayDecision = {
  packetId: "packet_replay_001",
  summary: "Historical replay decision",
  decisions: [
    {
      market: "KR",
      symbol: "035420",
      action: "VIRTUAL_BUY",
      confidence: 0.7,
      budgetKrw: 80000,
      thesis: "Historical replay thesis for risk gate E2E",
      riskFactors: ["Replay risk factor"],
      dataRefs: ["historical_replay:packet:packet_replay_001"],
      expiresAt: "2026-06-27T00:05:00.000Z"
    }
  ]
};

const batchRunRecord = {
  mode: "paper_only",
  batchId: "paper_sim_single",
  runId: "paper_sim_single_run_000000",
  runIndex: 0,
  runSeed: "policy-e2e-seed",
  status: "completed",
  startedAt: "2026-06-27T00:01:00.000Z",
  completedAt: "2026-06-27T00:05:00.000Z",
  skippedAt: null,
  failedAt: null,
  storageBaseDir: runDir,
  reportPath,
  window: {
    startAt: "2024-01-01T00:00:00.000Z",
    endAt: "2024-02-01T00:00:00.000Z",
    seed: "policy-e2e-seed",
    index: 0
  },
  windowSampling: {
    mode: "balanced_regime",
    targetRegime: "bull",
    targetCandidateCount: 2,
    fallbackReason: null
  },
  marketRegime: {
    label: "bull",
    score: 0.42,
    confidence: 0.8,
    evidence: []
  },
  marketRegimesByMarket: {},
  dataAvailability: {
    status: "available",
    totalSnapshotCount: 4,
    windowSnapshotCount: 4,
    corruptLineCount: 0,
    requiredSymbolCount: 0,
    availableRequiredSymbolCount: 0,
    issues: []
  },
  summary: {
    finalVirtualNetWorthKrw: 1025000,
    totalReturnRatio: 0.025,
    tradeCount: 1,
    decisionProviderCallCount: 2,
    aiDecisionFailureCount: 0,
    rejectedCount: 1,
    meaningfulRejectCount: 1,
    dustRejectCount: 0,
    avgExposureRatio: 0.55,
    avgCashRatio: 0.45,
    maxExposureRatio: 0.7,
    minExposureRatio: 0.2,
    timeInMarketRatio: 0.8,
    finalCashRatio: 0.3,
    finalPositionRatio: 0.7,
    targetExposureRatio: 0.75,
    averageTargetExposureGapRatio: 0.08,
    finalTargetExposureGapRatio: 0.05
  },
  error: null,
  skipReason: null
};

await writeFile(
  resolve(batchReplayDir, "batch-replay-manifest.json"),
  `${JSON.stringify(
    {
      mode: "paper_only",
      batchId: "paper_sim_single",
      status: "completed",
      startedAt: "2026-06-27T00:01:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
      completedAt: "2026-06-27T00:05:00.000Z",
      sourceDataDir,
      runCount: 1,
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      runsPath
    },
    null,
    2
  )}\n`,
  "utf8"
);

await writeFile(runsPath, `${JSON.stringify(batchRunRecord)}\n`, "utf8");

await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      title: "Historical Replay Paper Report",
      mode: "paper_only",
      generatedAt: "2026-06-27T00:05:00.000Z",
      disclaimer:
        "Paper-only historical replay report. Not investment advice.",
      summary: {
        finalVirtualNetWorthKrw: 1025000,
        totalReturnRatio: 0.025,
        tradeCount: 1,
        rejectedCount: 1
      }
    },
    null,
    2
  )}\n`,
  "utf8"
);

await writeFile(
  resolve(runDir, "historical-replay-progress.json"),
  `${JSON.stringify(
    {
      mode: "paper_only",
      status: "completed",
      startedAt: "2026-06-27T00:01:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
      completedAt: "2026-06-27T00:05:00.000Z",
      failedAt: null,
      simulatedAt: "2026-06-27T00:05:00.000Z",
      completedTickCount: 2,
      tickCount: 3,
      packetCount: 1,
      decisionProviderCallCount: 2,
      tradeCount: 1,
      riskDecisionCount: 1,
      riskApprovedCount: 0,
      rejectedCount: 1,
      currentPortfolio: {
        cashKrw: 930000,
        virtualNetWorthKrw: 1000000,
        positionCount: 1,
        positions: [
          {
            market: "KR",
            symbol: "035420",
            quantity: 1,
            marketValueKrw: 70000
          }
        ]
      },
      recentEvents: []
    },
    null,
    2
  )}\n`,
  "utf8"
);

await writeFile(
  resolve(runDir, "historical-replay-decisions.jsonl"),
  `${JSON.stringify(historicalReplayDecision)}\n`,
  "utf8"
);

await writeFile(
  resolve(runDir, "historical-replay-packets.jsonl"),
  `${JSON.stringify({
    packetId: "packet_replay_001",
    observedAt: "2026-06-27T00:01:00.000Z",
    candidates: [
      {
        market: "KR",
        symbol: "035420",
        name: null,
        lastPriceKrw: 180000
      }
    ]
  })}\n`,
  "utf8"
);

await writeFile(
  resolve(runDir, "historical-replay-risk-decisions.jsonl"),
  `${JSON.stringify({
    riskDecisionId: "risk_replay_e2e_001",
    packetId: "packet_replay_001",
    market: "KR",
    symbol: "035420",
    action: "VIRTUAL_BUY",
    approved: false,
    rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
    checkedRules: ["cash_available"],
    createdAt: "2026-06-27T00:01:00.000Z"
  })}\n`,
  "utf8"
);

await writeFile(
  resolve(runDir, "historical-replay-trades.jsonl"),
  `${JSON.stringify({
    tradeId: "trade_replay_e2e_001",
    packetId: "packet_replay_001",
    decisionId: "decision_replay_e2e_001",
    market: "KR",
    symbol: "035420",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 80000,
    amountKrw: 80000,
    status: "VIRTUAL_REJECTED",
    executedAt: "2026-06-27T00:01:00.000Z"
  })}\n`,
  "utf8"
);

const strategyBucketTestRecords = [
  {
    mode: "paper_only",
    recordType: "strategy_bucket_test_record",
    testId: "strategy_bucket_test_e2e_completed_swing",
    requestId: "e2e-completed-swing",
    bucket: "swing",
    status: "completed",
    createdAt: "2026-06-27T00:00:00.000Z",
    startedAt: "2026-06-27T00:01:00.000Z",
    completedAt: "2026-06-27T00:05:00.000Z",
    runId: "strategy_bucket_run_e2e_swing",
    policyId: "paper_policy_e2e",
    policyHash: "sha256:policy-e2e",
    configHash:
      "sha256:strategy-bucket-completed-swing-config-0000000000000000000",
    sourceDataDir: "data/replay-2023-01-2026-05-global-yahoo-daily",
    validationSplitRole: "test",
    decisionProviderMode: "dry_run_fixture",
    progress: {
      phase: "completed",
      progressRatio: 1,
      completedPacketCount: 12,
      totalPacketCount: 12,
      decisionCount: 12,
      riskApprovedCount: 10,
      riskRejectedCount: 2,
      simulatedTradeCount: 4,
      providerFailureCount: 0,
      latestMessage: "Strategy bucket test completed.",
      latestAuditEventRef: "audit_strategy_bucket_e2e_completed",
      updatedAt: "2026-06-27T00:05:00.000Z"
    },
    heartbeat: {
      status: "fresh",
      lastSeenAt: "2026-06-27T00:05:00.000Z",
      staleAfterSeconds: 120
    },
    result: {
      totalReturnRatio: 0.024,
      maxDrawdownRatio: 0.018,
      turnoverRatio: 0.42,
      costDragRatio: 0.003,
      riskRejectRate: 0.1667,
      providerFailureRate: 0,
      warnings: ["bucket result is compared against full portfolio baseline"]
    }
  }
];

await writeFile(
  resolve(dataDir, "strategy-bucket-test-records.jsonl"),
  `${strategyBucketTestRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  "utf8"
);

await writeFile(
  resolve(dataDir, "historical-replay-decisions.jsonl"),
  `${JSON.stringify(historicalReplayDecision)}\n`,
  "utf8"
);

await writeFile(
  resolve(dataDir, "historical-replay-risk-decisions.jsonl"),
  `${JSON.stringify({
    riskDecisionId: "risk_replay_e2e_001",
    packetId: "packet_replay_001",
    market: "KR",
    symbol: "035420",
    action: "VIRTUAL_BUY",
    approved: false,
    rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
    checkedRules: ["cash_available"],
    createdAt: "2026-06-27T00:01:00.000Z"
  })}\n`,
  "utf8"
);

await writeFile(
  resolve(dataDir, "historical-replay-trades.jsonl"),
  `${JSON.stringify({
    tradeId: "trade_replay_e2e_001",
    packetId: "packet_replay_001",
    decisionId: "decision_replay_e2e_001",
    market: "KR",
    symbol: "035420",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 80_000,
    amountKrw: 80_000,
    status: "VIRTUAL_REJECTED",
    executedAt: "2026-06-27T00:01:00.000Z"
  })}\n`,
  "utf8"
);

const auditEvents = [
  {
    eventId: "audit_e2e_001",
    eventType: "VIRTUAL_RISK_REJECTED",
    actor: "risk-engine",
    summary:
      "packet_e2e_001 005930 rejected account 1234-5678-901234 order ord_abcdef123456",
    maskedRefs: [],
    createdAt: "2026-06-27T00:01:00.000Z"
  },
  {
    eventId: "audit_replay_e2e_001",
    eventType: "VIRTUAL_RISK_REJECTED",
    actor: "risk-engine",
    summary:
      "packet_replay_001 035420 rejected account 1234-5678-901234 order ord_abcdef123456",
    maskedRefs: [],
    createdAt: "2026-06-27T00:01:30.000Z"
  },
  {
    eventId: "audit_e2e_002",
    eventType: "AI_PROVIDER_FAILURE",
    actor: "decision-provider",
    summary: "provider timeout during paper-only replay",
    maskedRefs: ["packet_e2e_002"],
    createdAt: "2026-06-27T00:02:00.000Z"
  }
];

await writeFile(
  resolve(dataDir, "audit-events.jsonl"),
  `${auditEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
  "utf8"
);
