import assert from "node:assert/strict";
import test from "node:test";

import { verifyEvidenceExpansionSourcePair } from "./validationRoleRegimeEvidenceExpansionSourcePairVerifier.js";
import type { VerifyValidationRoleRegimeEvidenceExpansionSourceOptions } from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  createEvidenceExpansionSourceVerifierTestAssignments,
  createEvidenceExpansionSourceVerifierTestFixture
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

test("source pair verifier binds baseline provenance to verified expansion", () => {
  const baseline = sourceOptions();
  const expansionFixture =
    createEvidenceExpansionSourceVerifierTestFixture();
  expansionFixture.universe = {
    ...expansionFixture.universe,
    disclaimer: "Synthetic expanded paper-only fixture."
  };
  const expansion = sourceOptions(expansionFixture);

  const pair = verifyEvidenceExpansionSourcePair({
    baseline,
    expansion
  });

  assert.deepEqual(
    pair.expansion.baselineProvenanceHashes,
    pair.baseline.baselineProvenanceHashes
  );
  assert.notEqual(
    pair.expansion.hashes.expansionUniverseHash,
    pair.baseline.hashes.expansionUniverseHash
  );
  assert.equal(
    pair.expansion.hashes.validationSplitHash,
    pair.baseline.hashes.validationSplitHash
  );
});

test("source pair verifier accepts compatible split provenance drift", () => {
  const baseline = sourceOptions();
  const expansion = {
    ...sourceOptions(),
    validationSplitSource: {
      sourceVersion: "expanded-split-source",
      assignments:
        createEvidenceExpansionSourceVerifierTestAssignments()
    }
  };

  const pair = verifyEvidenceExpansionSourcePair({
    baseline,
    expansion
  });

  assert.notEqual(
    pair.baseline.hashes.validationSplitHash,
    pair.expansion.hashes.validationSplitHash
  );
});

test("source pair verifier rejects incompatible split policy", () => {
  const baseline = sourceOptions();
  const expansion = sourceOptions();
  expansion.validationSplitSource =
    createEvidenceExpansionSourceVerifierTestAssignments().map(
      (assignment) => ({
        ...assignment,
        embargoDurationDays: 1
      })
    );

  assert.throws(
    () =>
      verifyEvidenceExpansionSourcePair({
        baseline,
        expansion
      }),
    /embargo policies must match/
  );
});

test("source pair verifier rejects unknown source fields", () => {
  const baseline = {
    ...sourceOptions(),
    resultReport: { status: "completed" }
  };
  const expansion = sourceOptions();

  assert.throws(
    () =>
      verifyEvidenceExpansionSourcePair({
        baseline,
        expansion
      }),
    /baseline source contains unknown fields/
  );
});

function sourceOptions(
  fixture = createEvidenceExpansionSourceVerifierTestFixture()
): VerifyValidationRoleRegimeEvidenceExpansionSourceOptions {
  const {
    assignments: _assignments,
    ...source
  } = fixture;
  return source;
}
