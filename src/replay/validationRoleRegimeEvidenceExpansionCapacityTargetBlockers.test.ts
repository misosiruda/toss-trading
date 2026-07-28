import assert from "node:assert/strict";
import test from "node:test";

import type {
  EvidenceExpansionCapacitySummary
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  buildEvidenceExpansionCapacityTargetBlockers
} from "./validationRoleRegimeEvidenceExpansionCapacityTargetBlockers.js";
import {
  buildEvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";

test("capacity target blockers are empty when every target is met", () => {
  const blockers = buildEvidenceExpansionCapacityTargetBlockers({
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 7
    }),
    capacity: capacitySummary()
  });

  assert.deepEqual(blockers, []);
});

test("capacity target blockers preserve an undefined regime target", () => {
  const blockers = buildEvidenceExpansionCapacityTargetBlockers({
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null
    }),
    capacity: capacitySummary()
  });

  assert.deepEqual(blockers, [
    {
      code: "ROLE_REGIME_TARGET_UNDEFINED",
      splitRole: null,
      targetRegime: null,
      message: "role-regime sample minimum is undefined"
    }
  ]);
});

test("capacity target blockers report scoped role capacity gaps", () => {
  const capacity = capacitySummary();
  const validation = capacity.combined.byRole.validation;
  validation.roleLocalUniqueEvidenceGroupCount = 29;
  validation.roleExclusiveEvidenceGroupCount = 29;
  validation.byRegime.mixed = 6;
  capacity.combined.globalUniqueEvidenceGroupCount = 89;
  capacity.baseline = structuredClone(capacity.combined);
  capacity.expansion = structuredClone(capacity.combined);

  const blockers = buildEvidenceExpansionCapacityTargetBlockers({
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 7
    }),
    capacity
  });

  assert.deepEqual(
    blockers.map(({ code, splitRole, targetRegime }) => ({
      code,
      splitRole,
      targetRegime
    })),
    [
      {
        code: "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET",
        splitRole: "validation",
        targetRegime: null
      },
      {
        code: "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
        splitRole: "validation",
        targetRegime: null
      },
      {
        code: "ROLE_REGIME_CAPACITY_BELOW_TARGET",
        splitRole: "validation",
        targetRegime: "mixed"
      }
    ]
  );
});

test("capacity target blockers use canonical blocker key ordering", () => {
  const blockers = buildEvidenceExpansionCapacityTargetBlockers({
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: 8
    }),
    capacity: capacitySummary()
  });

  assert.deepEqual(
    blockers.map(
      (blocker) => `${blocker.splitRole}/${blocker.targetRegime}`
    ),
    [
      "test/mixed",
      "test/sideways",
      "train/mixed",
      "train/sideways",
      "validation/mixed",
      "validation/sideways"
    ]
  );
});

test("capacity target blockers reject invalid capacity summaries", () => {
  const capacity = capacitySummary();
  capacity.combined.globalUniqueEvidenceGroupCount = 1;

  assert.throws(
    () =>
      buildEvidenceExpansionCapacityTargetBlockers({
        targetMatrix: buildEvidenceExpansionTargetMatrix({
          roleSampleMinimum: 30,
          roleRegimeSampleMinimum: 7
        }),
        capacity
      }),
    { name: "ZodError" }
  );
});

test("capacity target blockers reject unrecognized root fields", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionCapacityTargetBlockers({
        targetMatrix: buildEvidenceExpansionTargetMatrix({
          roleSampleMinimum: 30,
          roleRegimeSampleMinimum: 7
        }),
        capacity: capacitySummary(),
        currentCandidateCount: 90
      }),
    { name: "ZodError" }
  );
});

function capacitySummary(): EvidenceExpansionCapacitySummary {
  const view = {
    globalUniqueEvidenceGroupCount: 90,
    crossRoleSharedEvidenceGroupCount: 0,
    byRole: {
      train: capacityRole(),
      validation: capacityRole(),
      test: capacityRole()
    }
  };
  return {
    baseline: structuredClone(view),
    expansion: structuredClone(view),
    combined: structuredClone(view),
    incremental: {
      globalUniqueEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 0,
      byRole: {
        train: emptyCapacityRole(),
        validation: emptyCapacityRole(),
        test: emptyCapacityRole()
      }
    }
  };
}

function capacityRole() {
  return {
    roleLocalUniqueEvidenceGroupCount: 30,
    roleExclusiveEvidenceGroupCount: 30,
    byRegime: {
      bull: 8,
      bear: 8,
      sideways: 7,
      mixed: 7
    }
  };
}

function emptyCapacityRole() {
  return {
    roleLocalUniqueEvidenceGroupCount: 0,
    roleExclusiveEvidenceGroupCount: 0,
    byRegime: {
      bull: 0,
      bear: 0,
      sideways: 0,
      mixed: 0
    }
  };
}
