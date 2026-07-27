import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  assertEvidenceExpansionBaselineSourceMatches
} from "./validationRoleRegimeEvidenceExpansionBaselineSourceMatch.js";

const baselineProvenance = {
  dataSnapshotHash: hash("1"),
  universeHash: hash("2"),
  coverageHash: hash("3"),
  validationSplitHash: hash("4")
};

const verifiedSourceProvenance = {
  dataSnapshotHash: hash("1"),
  universeHash: hash("2"),
  coverageHash: hash("3"),
  validationSplitHash: hash("4")
};

test("baseline source match accepts the verified baseline provenance", () => {
  assert.doesNotThrow(() =>
    assertEvidenceExpansionBaselineSourceMatches({
      baselineProvenance,
      verifiedSourceProvenance
    })
  );
});

for (const scenario of [
  "dataSnapshotHash",
  "universeHash",
  "coverageHash",
  "validationSplitHash"
] as const) {
  test(`baseline source match rejects ${scenario} drift`, () => {
    assert.throws(
      () =>
        assertEvidenceExpansionBaselineSourceMatches({
          baselineProvenance,
          verifiedSourceProvenance: {
            ...verifiedSourceProvenance,
            [scenario]: hash("f")
          }
        }),
      new RegExp(
        `baseline raw source hash mismatch: ${scenario}`
      )
    );
  });
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
