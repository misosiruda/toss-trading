import assert from "node:assert/strict";
import test from "node:test";

import {
  createReplayResearchHash,
  missingReplayResearchManifestReference
} from "./replayRunManifest.js";
import { createSelectionTrialRecord } from "./selectionTrialLog.js";

test("selection trial hashes prompt metadata for partial manifest trials", () => {
  const base = createSelectionTrialRecord({
    ...trialInput(),
    decisionProviderMetadata: {
      mode: "codex_cli",
      promptPolicy: "default",
      promptVersion: "paper-v1",
      promptText: "base prompt"
    }
  });
  const changedPrompt = createSelectionTrialRecord({
    ...trialInput(),
    decisionProviderMetadata: {
      mode: "codex_cli",
      promptPolicy: "default",
      promptVersion: "paper-v1",
      promptText: "changed prompt"
    }
  });

  assert.equal(base.decisionProvider.promptVersion, "paper-v1");
  assert.notEqual(
    base.decisionProvider.promptHash,
    changedPrompt.decisionProvider.promptHash
  );
  assert.notEqual(
    base.decisionProvider.metadataHash,
    changedPrompt.decisionProvider.metadataHash
  );
  assert.equal(base.selection.selected, false);
  assert.equal(base.selection.selectedBy, null);
});

test("selection trial hashes risk and exit policy separately", () => {
  const base = createSelectionTrialRecord(trialInput());
  const changedRisk = createSelectionTrialRecord({
    ...trialInput(),
    riskPolicy: {
      maxBudgetPerDecisionKrw: 200_000
    }
  });
  const changedExit = createSelectionTrialRecord({
    ...trialInput(),
    paperExitPolicy: {
      takeProfitMode: "full_exit",
      takeProfitRatio: 0.15,
      stopLossRatio: 0.08
    }
  });

  assert.notEqual(base.config.riskPolicyHash, changedRisk.config.riskPolicyHash);
  assert.notEqual(base.config.exitPolicyHash, changedExit.config.exitPolicyHash);
});

test("selection trial records candidate strategy bucket identity", () => {
  const scoped = createSelectionTrialRecord({
    ...trialInput(),
    candidateStrategyBucket: "short_term"
  });
  const broad = createSelectionTrialRecord(trialInput());

  assert.equal(scoped.config.candidateStrategyBucket, "short_term");
  assert.equal(broad.config.candidateStrategyBucket, null);
});

test("selection trial aligns skipped custom-provider prompt hash with manifest fallback", () => {
  const decisionProviderMetadata = {
    mode: "unknown_provider",
    maxCallsPerRun: null,
    sandbox: null,
    allowWebSearch: false,
    promptPolicy: null,
    promptVersion: null
  };
  const trial = createSelectionTrialRecord({
    ...trialInput(),
    decisionProviderMetadata
  });

  assert.equal(
    trial.decisionProvider.promptHash,
    createReplayResearchHash({
      mode: "unknown_provider",
      promptPolicy: null,
      promptVersion: null
    })
  );
  assert.equal(
    trial.decisionProvider.metadataHash,
    createReplayResearchHash(decisionProviderMetadata)
  );
  assert.notEqual(
    trial.decisionProvider.promptHash,
    trial.decisionProvider.metadataHash
  );
});

function trialInput() {
  return {
    batchId: "batch-smoke",
    runId: "batch-smoke-run-000001",
    runIndex: 1,
    runSeed: "seed:1",
    status: "skipped" as const,
    startedAt: "2026-06-12T01:00:00.000Z",
    completedAt: null,
    skippedAt: "2026-06-12T01:00:00.001Z",
    failedAt: null,
    window: {
      seed: "seed:1",
      rangeStart: "2025-02-01T00:00:00.000Z",
      rangeEnd: "2025-02-28T14:59:59.999Z",
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      candidateCount: 1,
      selectedCandidateIndex: 0,
      selectedMonth: "2025-02",
      localStartDate: "2025-02-01",
      localEndDate: "2025-02-28",
      startAt: "2025-02-01T00:00:00.000Z",
      endAt: "2025-02-28T14:59:59.999Z"
    },
    marketRegime: {
      label: "sideways" as const,
      windowStart: "2025-02-01T00:00:00.000Z",
      windowEnd: "2025-02-28T14:59:59.999Z",
      symbolCount: 1,
      classifiedSymbolCount: 1,
      averageReturnRatio: 0.001429,
      medianReturnRatio: 0.001429,
      advancingSymbolRatio: 1,
      decliningSymbolRatio: 0,
      flatSymbolRatio: 0,
      minSymbols: 1,
      minSnapshotsPerSymbol: 2,
      thresholds: {
        bullReturnThreshold: 0.03,
        bearReturnThreshold: -0.03,
        sidewaysAbsReturnThreshold: 0.01,
        breadthThreshold: 0.6
      },
      reasons: ["LOW_ABSOLUTE_AVERAGE_RETURN"],
      symbolReturns: [
        {
          market: "US" as const,
          symbol: "TEST",
          snapshotCount: 2,
          firstObservedAt: "2025-02-01T00:00:00.000Z",
          lastObservedAt: "2025-02-28T14:59:59.999Z",
          firstPriceKrw: 70_000,
          lastPriceKrw: 70_100,
          returnRatio: 0.001429
        }
      ]
    },
    decisionProviderMetadata: {
      mode: "deterministic_fixture",
      promptPolicy: null,
      promptVersion: null
    },
    riskProfile: "balanced" as const,
    riskPolicy: {
      maxBudgetPerDecisionKrw: 100_000
    },
    allocationPolicy: null,
    marketRegimeAllocationPolicy: null,
    paperExitPolicy: null,
    researchManifest: missingReplayResearchManifestReference(
      "RESEARCH_MANIFEST_NOT_CREATED"
    ),
    totalReturnRatio: null,
    finalVirtualNetWorthKrw: null,
    tradeCount: 0,
    aiDecisionFailureCount: 0,
    rejectedCount: 0,
    skipReason: "DATA_INSUFFICIENT",
    error: null,
    reportPath: null
  };
}
