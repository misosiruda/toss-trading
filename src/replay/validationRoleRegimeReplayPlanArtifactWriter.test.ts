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

import { writeExclusiveJsonArtifact } from "./exclusiveJsonArtifactWriter.js";
import {
  createValidationRoleRegimeReplayPlanHash,
  parseValidationRoleRegimeReplayPlan,
  type ValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import { writeValidationRoleRegimeReplayPlanArtifact } from "./validationRoleRegimeReplayPlanArtifactWriter.js";

test("plan artifact writer creates a strict-parser-valid JSON artifact", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "role-regime-plan-"));
  const outputDirectory = join(directory, "nested", "deeper");
  const outputPath = join(outputDirectory, "plan.json");
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeValidationRoleRegimeReplayPlanArtifact({
    outputPath,
    plan: plan()
  });

  const written = await readFile(outputPath, "utf8");
  assert.equal(written.endsWith("\n"), true);
  assert.deepEqual(
    parseValidationRoleRegimeReplayPlan(JSON.parse(written)),
    plan()
  );
  assert.deepEqual(await readdir(outputDirectory), ["plan.json"]);
});

test("plan artifact writer preserves an existing output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "role-regime-plan-"));
  const outputPath = join(directory, "plan.json");
  const existing = "existing plan must remain unchanged\n";
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(outputPath, existing, "utf8");

  await assert.rejects(
    writeValidationRoleRegimeReplayPlanArtifact({
      outputPath,
      plan: plan()
    }),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST"
  );
  assert.equal(await readFile(outputPath, "utf8"), existing);
  assert.deepEqual(await readdir(directory), ["plan.json"]);
});

test("plan artifact writer validates before filesystem mutation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "role-regime-plan-"));
  const outputDirectory = join(directory, "nested");
  const outputPath = join(outputDirectory, "plan.json");
  const invalid = { ...plan(), planHash: hash("f") };
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    writeValidationRoleRegimeReplayPlanArtifact({
      outputPath,
      plan: invalid
    }),
    /plan hash mismatch/
  );
  await assert.rejects(access(outputDirectory));
});

test("exclusive JSON writer rejects non-JSON roots before filesystem mutation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "exclusive-json-"));
  const invalidValues = [undefined, () => undefined, Symbol("invalid")];
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const [index, value] of invalidValues.entries()) {
    const outputDirectory = join(directory, `invalid-${index}`);
    await assert.rejects(
      writeExclusiveJsonArtifact({
        outputPath: join(outputDirectory, "artifact.json"),
        value
      }),
      /artifact value must serialize to JSON/
    );
    await assert.rejects(access(outputDirectory));
  }
});

function plan(): ValidationRoleRegimeReplayPlan {
  const value = hash("0");
  const planWithoutHash: Omit<
    ValidationRoleRegimeReplayPlan,
    "planHash"
  > = {
    schemaVersion: "validation_role_regime_replay_plan.v1",
    mode: "paper_only",
    purpose: "role_local_regime_diagnostic",
    status: "insufficient",
    generatedAt: "2026-07-22T00:00:00.000Z",
    source: {
      feasibilitySchemaVersion: "validation_split_regime_feasibility.v1",
      feasibilityArtifactHash: value,
      feasibilityStatus: "insufficient",
      dataSnapshotHash: value,
      universeHash: value,
      coverageHash: value,
      validationSplitHash: value,
      calendarHash: value,
      marketRegimeClassifierHash: value
    },
    config: {
      selectionPolicyVersion: "exhaustive_role_regime_candidates.v1",
      candidateStrategyBucket: "short_term",
      targetRegimes: ["bull", "bear"],
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      roleOrder: ["train", "validation", "test"],
      regimeOrder: ["bull", "bear", "sideways", "mixed"]
    },
    summary: {
      requiredRoleRegimeCellCount: 6,
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

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
