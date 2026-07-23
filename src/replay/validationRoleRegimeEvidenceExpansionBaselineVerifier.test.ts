import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG } from "../analytics/marketRegimeClassifier.js";
import type { ValidationSplitRegimeFeasibilityArtifact } from "./validationSplitRegimeFeasibility.js";
import {
  createValidationRoleRegimeFeasibilityArtifactHash,
  createValidationRoleRegimeReplayPlanHash,
  type ValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import {
  buildValidationRoleRegimeStatisticalReadinessArtifact,
  type ValidationRoleRegimeStatisticalReadinessArtifact
} from "./validationRoleRegimeStatisticalReadiness.js";
import {
  createValidationRoleRegimeStatisticalReadinessArtifactHash,
  verifyValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";

test("baseline verifier accepts a consistent paper-only artifact chain", () => {
  const fixtures = baselineFixtures();
  const verified =
    verifyValidationRoleRegimeEvidenceExpansionBaseline(fixtures);

  assert.equal(verified.feasibility.status, "insufficient");
  assert.equal(verified.plan.status, "insufficient");
  assert.equal(verified.readiness.status, "inconclusive");
  assert.equal(
    verified.hashes.baselineFeasibilityArtifactHash,
    createValidationRoleRegimeFeasibilityArtifactHash(fixtures.feasibilityArtifact)
  );
  assert.equal(
    verified.hashes.baselinePlanHash,
    fixtures.planArtifact.planHash
  );
  assert.equal(
    verified.hashes.baselineReadinessArtifactHash,
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
});

test("baseline verifier rejects unknown result fields in strict sources", () => {
  const fixtures = baselineFixtures();

  assert.throws(() =>
    verifyValidationRoleRegimeEvidenceExpansionBaseline({
      ...fixtures,
      readinessArtifact: {
        ...fixtures.readinessArtifact,
        sharpe: 1.5
      }
    })
  );
});

test("baseline verifier rejects a plan linked to another feasibility artifact", () => {
  const fixtures = baselineFixtures();
  const changedPlan = withPlanHash({
    ...fixtures.planArtifact,
    source: {
      ...fixtures.planArtifact.source,
      feasibilityArtifactHash: hash("b")
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: changedPlan
      }),
    /baseline plan does not match feasibility identity/
  );
});

test("baseline verifier rejects feasibility provenance and config drift", () => {
  const fixtures = baselineFixtures();
  const provenanceDrift = withPlanHash({
    ...fixtures.planArtifact,
    source: {
      ...fixtures.planArtifact.source,
      coverageHash: hash("c")
    }
  });
  const configDrift = withPlanHash({
    ...fixtures.planArtifact,
    config: {
      ...fixtures.planArtifact.config,
      windowMonths: 2
    }
  });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: provenanceDrift
      }),
    /baseline plan provenance mismatch: coverageHash/
  );
  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        planArtifact: configDrift
      }),
    /baseline plan config does not match feasibility config/
  );
});

test("baseline verifier rejects readiness linked to another plan", () => {
  const fixtures = baselineFixtures();

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        readinessArtifact: {
          ...fixtures.readinessArtifact,
          source: { planHash: hash("d") }
        }
      }),
    /baseline readiness does not match plan identity/
  );
});

test("baseline verifier rejects readiness counts derived from another plan", () => {
  const fixtures = baselineFixtures();
  const readinessArtifact =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: fixtures.readinessArtifact.generatedAt,
      planHash: fixtures.planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: 1,
        globalUniqueEvidenceGroupCount: 1,
        crossRoleSharedEvidenceGroupCount: 0
      },
      evidenceRows: [
        {
          splitRole: "train",
          targetRegime: "bull",
          evidenceGroupHash: hash("e")
        }
      ]
    });

  assert.throws(
    () =>
      verifyValidationRoleRegimeEvidenceExpansionBaseline({
        ...fixtures,
        readinessArtifact
      }),
    /baseline readiness expected counts do not match plan/
  );
});

test("readiness hash ignores generation time but preserves semantic changes", () => {
  const fixtures = baselineFixtures();
  const changedTime = {
    ...fixtures.readinessArtifact,
    generatedAt: "2026-07-23T01:00:00.000Z"
  };
  const changedSource = {
    ...fixtures.readinessArtifact,
    source: {
      planHash: hash("f")
    }
  };

  assert.equal(
    createValidationRoleRegimeStatisticalReadinessArtifactHash(changedTime),
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
  assert.notEqual(
    createValidationRoleRegimeStatisticalReadinessArtifactHash(changedSource),
    createValidationRoleRegimeStatisticalReadinessArtifactHash(
      fixtures.readinessArtifact
    )
  );
});

function baselineFixtures(): {
  feasibilityArtifact: ValidationSplitRegimeFeasibilityArtifact;
  planArtifact: ValidationRoleRegimeReplayPlan;
  readinessArtifact: ValidationRoleRegimeStatisticalReadinessArtifact;
} {
  const feasibilityArtifact = feasibilityFixture();
  const planArtifact = planFixture(feasibilityArtifact);
  const readinessArtifact =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: "2026-07-23T00:00:00.000Z",
      planHash: planArtifact.planHash,
      expectedCounts: {
        plannedRunCount: 0,
        globalUniqueEvidenceGroupCount: 0,
        crossRoleSharedEvidenceGroupCount: 0
      },
      evidenceRows: []
    });
  return { feasibilityArtifact, planArtifact, readinessArtifact };
}

function feasibilityFixture(): ValidationSplitRegimeFeasibilityArtifact {
  const sourceHash = hash("a");
  return {
    schemaVersion: "validation_split_regime_feasibility.v1",
    mode: "paper_only",
    status: "insufficient",
    generatedAt: "2026-07-21T00:00:00.000Z",
    config: {
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      targetRegimes: ["bull", "bear", "sideways", "mixed"],
      candidateStrategyBucket: "short_term",
      minimumCandidatesPerRoleRegime: 1,
      calendarValidation: {
        rules: [
          { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" },
          {
            market: "US",
            exchange: "NYSE",
            timezone: "America/New_York"
          }
        ]
      },
      marketRegimeClassifier: {
        version: "market_regime_classifier.v1",
        ...DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG
      }
    },
    provenance: {
      dataSnapshotHash: sourceHash,
      universeHash: sourceHash,
      coverageHash: sourceHash,
      validationSplitHash: sourceHash,
      calendarHash: sourceHash,
      marketRegimeClassifierHash: sourceHash
    },
    summary: {
      assignmentCount: 0,
      roleCounts: { train: 0, validation: 0, test: 0 },
      candidateCount: 0,
      uniqueCandidateCount: 0,
      roleCapacityCounts: { train: 0, validation: 0, test: 0 },
      boundaryViolationCount: 0,
      embargoViolationCount: 0,
      unavailableRoleRegimeCount: 0
    },
    roles: [],
    assignments: [],
    warnings: []
  };
}

function planFixture(
  feasibility: ValidationSplitRegimeFeasibilityArtifact
): ValidationRoleRegimeReplayPlan {
  const planWithoutHash: Omit<ValidationRoleRegimeReplayPlan, "planHash"> = {
    schemaVersion: "validation_role_regime_replay_plan.v1",
    mode: "paper_only",
    purpose: "role_local_regime_diagnostic",
    status: "insufficient",
    generatedAt: "2026-07-22T00:00:00.000Z",
    source: {
      feasibilitySchemaVersion: feasibility.schemaVersion,
      feasibilityArtifactHash:
        createValidationRoleRegimeFeasibilityArtifactHash(feasibility),
      feasibilityStatus: feasibility.status,
      ...feasibility.provenance
    },
    config: {
      selectionPolicyVersion:
        "exhaustive_role_regime_candidates.v1",
      candidateStrategyBucket: "short_term",
      targetRegimes: [...feasibility.config.targetRegimes],
      windowMonths: feasibility.config.windowMonths,
      timezoneOffsetMinutes: feasibility.config.timezoneOffsetMinutes,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    summary: {
      requiredRoleRegimeCellCount: 12,
      coveredRoleRegimeCellCount: 0,
      plannedRunCount: 0,
      globalUniqueEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 0,
      nonTargetCandidateCount: 0,
      roleRunCounts: { train: 0, validation: 0, test: 0 },
      roleRegimeRunCounts: {}
    },
    runs: [],
    warnings: []
  };
  return {
    ...planWithoutHash,
    planHash: createValidationRoleRegimeReplayPlanHash(planWithoutHash)
  };
}

function withPlanHash(
  plan: ValidationRoleRegimeReplayPlan
): ValidationRoleRegimeReplayPlan {
  return {
    ...plan,
    planHash: createValidationRoleRegimeReplayPlanHash(plan)
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
