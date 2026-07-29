import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ValidationRoleRegimeEvidenceExpansionInput } from "../replay/validationRoleRegimeEvidenceExpansionInputBoundary.js";
import { readValidationRoleRegimeEvidenceExpansionPreflightInput } from "./validationRoleRegimeEvidenceExpansionPreflightSources.js";

test("preflight source reader accepts one allowlisted JSON bundle", async (t) => {
  const fixture = await createFixture(t);
  const source = preflightInput();
  await writeFile(
    fixture.inputPath,
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8"
  );

  const input =
    await readValidationRoleRegimeEvidenceExpansionPreflightInput(
      fixture.inputPath
    );

  assert.deepEqual(input, source);
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

test("preflight source reader rejects invalid JSON", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(fixture.inputPath, "not-json\n", "utf8");

  await assert.rejects(
    readValidationRoleRegimeEvidenceExpansionPreflightInput(
      fixture.inputPath
    ),
    /preflight input must contain valid JSON/
  );
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

test("preflight source reader rejects result metrics without output mutation", async (t) => {
  const fixture = await createFixture(t);
  const source = preflightInput();
  source.baseline.planArtifact = {
    totalReturnRatio: 0.1
  };
  await writeFile(
    fixture.inputPath,
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8"
  );

  await assert.rejects(
    readValidationRoleRegimeEvidenceExpansionPreflightInput(
      fixture.inputPath
    ),
    /preflight input rejected: \$\.baseline\.planArtifact\.totalReturnRatio/
  );
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

async function createFixture(t: test.TestContext): Promise<{
  directory: string;
  inputPath: string;
}> {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-source-")
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    inputPath: join(directory, "input.json")
  };
}

function preflightInput(): ValidationRoleRegimeEvidenceExpansionInput {
  return {
    baseline: {
      feasibilityArtifact: { fixture: "baseline-feasibility" },
      planArtifact: { fixture: "baseline-plan" },
      readinessArtifact: { fixture: "baseline-readiness" },
      snapshots: [{ fixture: "baseline-snapshot" }],
      universe: { fixture: "baseline-universe" },
      coverage: { fixture: "baseline-coverage" },
      validationSplitSource: { fixture: "baseline-split" }
    },
    expansion: {
      snapshots: [{ fixture: "expansion-snapshot" }],
      universe: { fixture: "expansion-universe" },
      coverage: { fixture: "expansion-coverage" },
      validationSplitSource: { fixture: "expansion-split" }
    },
    calendarValidation: { fixture: "calendar-validation" },
    marketRegimeClassifier: { fixture: "market-regime-classifier" },
    targetMatrix: { fixture: "target-matrix" },
    dependencyDiagnosticPolicy: { fixture: "dependency-policy" }
  };
}
