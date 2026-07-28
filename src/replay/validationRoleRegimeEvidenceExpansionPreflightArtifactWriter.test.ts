import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { writeValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "./validationRoleRegimeEvidenceExpansionPreflightArtifactWriter.js";
import type {
  EvidenceExpansionPreflightBlocker,
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  bindValidationRoleRegimeEvidenceExpansionPreflightHash,
  parseValidationRoleRegimeEvidenceExpansionPreflightArtifact,
  type ValidationRoleRegimeEvidenceExpansionPreflightPayload
} from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";

test("preflight writer creates a strict-parser-valid JSON artifact", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-")
  );
  const outputDirectory = join(directory, "nested", "deeper");
  const outputPath = join(outputDirectory, "preflight.json");
  const artifact = preflightArtifact();
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeValidationRoleRegimeEvidenceExpansionPreflightArtifact({
    outputPath,
    artifact
  });

  const written = await readFile(outputPath, "utf8");
  assert.equal(written.endsWith("\n"), true);
  assert.deepEqual(
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      JSON.parse(written)
    ),
    artifact
  );
  assert.deepEqual(await readdir(outputDirectory), ["preflight.json"]);
});

test("preflight writer preserves an existing output", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-")
  );
  const outputPath = join(directory, "preflight.json");
  const existing = "existing preflight must remain unchanged\n";
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(outputPath, existing, "utf8");

  await assert.rejects(
    writeValidationRoleRegimeEvidenceExpansionPreflightArtifact({
      outputPath,
      artifact: preflightArtifact()
    }),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST"
  );
  assert.equal(await readFile(outputPath, "utf8"), existing);
  assert.deepEqual(await readdir(directory), ["preflight.json"]);
});

test("preflight writer validates hash before filesystem mutation", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-")
  );
  const outputDirectory = join(directory, "nested");
  const outputPath = join(outputDirectory, "preflight.json");
  const invalid = {
    ...preflightArtifact(),
    generatedAt: "2026-07-29T00:00:00.000Z"
  };
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    writeValidationRoleRegimeEvidenceExpansionPreflightArtifact({
      outputPath,
      artifact: invalid
    }),
    /preflight hash mismatch/
  );
  await assert.rejects(access(outputDirectory));
});

function preflightArtifact(): ValidationRoleRegimeEvidenceExpansionPreflightArtifact {
  const emptyRoleCapacity = {
    roleLocalUniqueEvidenceGroupCount: 0,
    roleExclusiveEvidenceGroupCount: 0,
    byRegime: {
      bull: 0,
      bear: 0,
      sideways: 0,
      mixed: 0
    }
  };
  const emptyCapacity = {
    globalUniqueEvidenceGroupCount: 0,
    crossRoleSharedEvidenceGroupCount: 0,
    byRole: {
      train: structuredClone(emptyRoleCapacity),
      validation: structuredClone(emptyRoleCapacity),
      test: structuredClone(emptyRoleCapacity)
    }
  };
  const roleTarget = {
    roleLocalUniqueMinimum: 30 as const,
    roleExclusiveMinimum: 30 as const,
    byRegime: {
      bull: null,
      bear: null,
      sideways: null,
      mixed: null
    }
  };
  const payload: ValidationRoleRegimeEvidenceExpansionPreflightPayload = {
    schemaVersion:
      "validation_role_regime_evidence_expansion_preflight.v1",
    mode: "paper_only",
    purpose: "evidence_expansion_preflight",
    status: "inconclusive",
    generatedAt: "2026-07-28T00:00:00.000Z",
    source: {
      baselineFeasibilityArtifactHash: hash("1"),
      baselinePlanHash: hash("2"),
      baselineReadinessArtifactHash: hash("3"),
      expansionDataSnapshotHash: hash("4"),
      expansionUniverseHash: hash("5"),
      expansionCoverageHash: hash("6"),
      validationSplitHash: hash("7"),
      calendarHash: hash("8"),
      officialCalendarArtifactHash: null,
      marketRegimeClassifierHash: hash("9")
    },
    config: {
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull", "bear", "sideways", "mixed"],
      windowMonths: 12,
      timezoneOffsetMinutes: 540,
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null,
      inputPolicyVersion: "result_blind_capacity_scan.v1",
      dependencyDiagnosticPolicyVersion: "overlap_adjacency_inputs.v1"
    },
    targetMatrix: {
      byRole: {
        train: structuredClone(roleTarget),
        validation: structuredClone(roleTarget),
        test: structuredClone(roleTarget)
      }
    },
    capacity: {
      baseline: structuredClone(emptyCapacity),
      expansion: structuredClone(emptyCapacity),
      combined: structuredClone(emptyCapacity),
      incremental: structuredClone(emptyCapacity)
    },
    dependencyInputs: {
      candidateIntervals: [],
      pairwise: []
    },
    exclusions: [],
    blockers: [
      blocker("DEPENDENCY_INPUT_INCOMPLETE"),
      blocker("OFFICIAL_CALENDAR_EVIDENCE_MISSING"),
      blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "train"),
      blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "validation"),
      blocker("ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET", "test"),
      blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "train"),
      blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "validation"),
      blocker("ROLE_LOCAL_CAPACITY_BELOW_TARGET", "test"),
      blocker("ROLE_REGIME_TARGET_UNDEFINED")
    ]
  };
  return bindValidationRoleRegimeEvidenceExpansionPreflightHash(payload);
}

function blocker(
  code: EvidenceExpansionPreflightBlocker["code"],
  splitRole: EvidenceExpansionPreflightBlocker["splitRole"] = null
): EvidenceExpansionPreflightBlocker {
  return {
    code,
    splitRole,
    targetRegime: null,
    message: `${code} fixture`
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
