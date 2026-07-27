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

const sourceHashes = {
  expansionDataSnapshotHash: hash("1"),
  expansionUniverseHash: hash("2"),
  expansionCoverageHash: hash("3"),
  validationSplitHash: hash("4")
};

test("baseline source match accepts the verified baseline provenance", () => {
  assert.doesNotThrow(() =>
    assertEvidenceExpansionBaselineSourceMatches({
      baselineProvenance,
      sourceHashes
    })
  );
});

for (const scenario of [
  {
    field: "dataSnapshotHash",
    sourceField: "expansionDataSnapshotHash"
  },
  {
    field: "universeHash",
    sourceField: "expansionUniverseHash"
  },
  {
    field: "coverageHash",
    sourceField: "expansionCoverageHash"
  },
  {
    field: "validationSplitHash",
    sourceField: "validationSplitHash"
  }
] as const) {
  test(`baseline source match rejects ${scenario.field} drift`, () => {
    assert.throws(
      () =>
        assertEvidenceExpansionBaselineSourceMatches({
          baselineProvenance,
          sourceHashes: {
            ...sourceHashes,
            [scenario.sourceField]: hash("f")
          }
        }),
      new RegExp(
        `baseline raw source hash mismatch: ${scenario.field}`
      )
    );
  });
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
