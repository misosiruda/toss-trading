import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";

test("target matrix preserves an undefined role-regime minimum", () => {
  const matrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: null
  });

  for (const role of ["train", "validation", "test"] as const) {
    assert.equal(matrix.byRole[role].roleLocalUniqueMinimum, 30);
    assert.equal(matrix.byRole[role].roleExclusiveMinimum, 30);
    assert.deepEqual(matrix.byRole[role].byRegime, {
      bull: null,
      bear: null,
      sideways: null,
      mixed: null
    });
  }
});

test("target matrix applies a fixed role-regime minimum to every cell", () => {
  const matrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: 6
  });

  for (const role of ["train", "validation", "test"] as const) {
    assert.deepEqual(matrix.byRole[role].byRegime, {
      bull: 6,
      bear: 6,
      sideways: 6,
      mixed: 6
    });
  }
});

test("target matrix rejects a changed role minimum", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionTargetMatrix({
        roleSampleMinimum: 29,
        roleRegimeSampleMinimum: null
      }),
    { name: "ZodError" }
  );
});

test("target matrix rejects invalid role-regime minimums", () => {
  for (const roleRegimeSampleMinimum of [0, -1, 1.5]) {
    assert.throws(
      () =>
        buildEvidenceExpansionTargetMatrix({
          roleSampleMinimum: 30,
          roleRegimeSampleMinimum
        }),
      { name: "ZodError" }
    );
  }
});

test("target matrix rejects unrecognized input fields", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionTargetMatrix({
        roleSampleMinimum: 30,
        roleRegimeSampleMinimum: null,
        currentCandidateCount: 30
      }),
    { name: "ZodError" }
  );
});
