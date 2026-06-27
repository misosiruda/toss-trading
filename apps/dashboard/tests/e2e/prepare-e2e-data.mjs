import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(scriptDir, "../..");
const dataDir = resolve(dashboardRoot, ".e2e-data", "paper");

await rm(dataDir, { force: true, recursive: true });
await mkdir(dataDir, { recursive: true });

const candidatePrefix =
  "provider=deterministic_fixture|providerMetadata=sha256:provider|";
const aggregate = {
  mode: "paper_only",
  generatedAt: "2026-06-27T00:00:00.000Z",
  sourceRunsPath: "apps/dashboard/.e2e-data/paper/batch-replay-runs.jsonl",
  sourceSelectionTrialsPath:
    "apps/dashboard/.e2e-data/paper/batch-replay-selection-trials.jsonl",
  targetReturnThresholds: [0],
  summary: {
    runCount: 4,
    completedCount: 4,
    skippedCount: 0,
    failedCount: 0,
    returnSampleCount: 4,
    regimeCounts: { bull: 2, bear: 2 },
    regimeCountsByMarket: { US: { bull: 2, bear: 2 } },
    validationSplitRoleCounts: { train: 2, validation: 1, test: 1 }
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
