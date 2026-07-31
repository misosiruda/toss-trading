import assert from "node:assert/strict";
import test from "node:test";

import type {
  ValidationSplitAssignment
} from "./validationProtocol.js";
import {
  assertCompatibleEvidenceExpansionValidationSplits
} from "./validationRoleRegimeEvidenceExpansionSplitCompatibility.js";
import {
  createEvidenceExpansionSourceVerifierTestAssignments
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

test("split compatibility accepts distinct identities with one policy", () => {
  assert.doesNotThrow(() =>
    assertCompatibleEvidenceExpansionValidationSplits({
      baselineAssignments: assignments(),
      expansionAssignments: assignments({
        splitId: "split-1",
        splitIndex: 1,
        trainStart: "2025-01-01T00:00:00+09:00",
        trainEnd: "2025-06-30T23:59:59.999+09:00",
        validationStart: "2025-07-01T00:00:00+09:00",
        validationEnd: "2025-09-30T23:59:59.999+09:00",
        testStart: "2025-10-01T00:00:00+09:00",
        testEnd: "2025-12-31T23:59:59.999+09:00"
      })
    })
  );
});

test("split compatibility rejects purge and embargo policy drift", () => {
  for (const drift of [
    { purgeDurationDays: 1 },
    { embargoDurationDays: 1 }
  ]) {
    assert.throws(
      () =>
        assertCompatibleEvidenceExpansionValidationSplits({
          baselineAssignments: assignments(),
          expansionAssignments: assignments(drift)
        }),
      new RegExp(
        "purgeDurationDays" in drift ? "purge policies" : "embargo policies"
      )
    );
  }
});

test("split compatibility rejects mixed policies within one source", () => {
  const expansion = [
    ...assignments(),
    ...assignments({
      splitId: "split-1",
      splitIndex: 1,
      embargoDurationDays: 1
    })
  ];

  assert.throws(
    () =>
      assertCompatibleEvidenceExpansionValidationSplits({
        baselineAssignments: assignments(),
        expansionAssignments: expansion
      }),
    /expansion validation split assignments must use one compatibility policy/
  );
});

test("split compatibility rejects conflicting boundaries for one identity", () => {
  assert.throws(
    () =>
      assertCompatibleEvidenceExpansionValidationSplits({
        baselineAssignments: assignments(),
        expansionAssignments: assignments({
          trainStart: "2023-01-01T00:00:00+09:00"
        })
      }),
    /validation split identity maps to conflicting boundaries: 0:split-0/
  );
});

test("split compatibility rejects malformed role boundaries", () => {
  assert.throws(
    () =>
      assertCompatibleEvidenceExpansionValidationSplits({
        baselineAssignments: assignments(),
        expansionAssignments: assignments({
          trainEnd: "2024-07-01T00:00:00+09:00"
        })
      }),
    /trainEnd must be before validationStart/
  );
});

test("split compatibility rejects empty and unknown inputs", () => {
  assert.throws(
    () =>
      assertCompatibleEvidenceExpansionValidationSplits({
        baselineAssignments: [],
        expansionAssignments: assignments()
      }),
    /baseline validation split assignments must not be empty/
  );
  assert.throws(
    () =>
      assertCompatibleEvidenceExpansionValidationSplits({
        baselineAssignments: assignments(),
        expansionAssignments: assignments(),
        resultMetrics: {}
      } as unknown as Parameters<
        typeof assertCompatibleEvidenceExpansionValidationSplits
      >[0]),
    /unknown fields/
  );
});

function assignments(
  overrides: Partial<ValidationSplitAssignment> = {}
): ValidationSplitAssignment[] {
  return createEvidenceExpansionSourceVerifierTestAssignments().map(
    (assignment) => ({
      ...assignment,
      ...overrides,
      splitRole: assignment.splitRole
    })
  );
}
