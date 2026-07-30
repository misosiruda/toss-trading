import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEvidenceExpansionPreflightBundleTestFixture } from "../replay/validationRoleRegimeEvidenceExpansionPreflightBundleVerifierTestFixture.js";
import type { ValidationRoleRegimeEvidenceExpansionInput } from "../replay/validationRoleRegimeEvidenceExpansionInputBoundary.js";
import { createEvidenceExpansionSourceVerifierTestAssignments } from "../replay/validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";
import {
  readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle,
  readValidationRoleRegimeEvidenceExpansionPreflightInput
} from "./validationRoleRegimeEvidenceExpansionPreflightSources.js";

test("preflight source reader returns partial verified bundle state", async (t) => {
  const fixture = await createFixture(t);
  const source = createEvidenceExpansionPreflightBundleTestFixture();
  await writeFile(
    fixture.inputPath,
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8"
  );

  const state =
    await readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle(
      fixture.inputPath,
      { asOf: "2026-07-23T00:00:00.000Z" }
    );

  assert.equal(
    state.verifiedDeclaredPolicy.roleRegimeSampleMinimum,
    null
  );
  assert.deepEqual(
    state.verifiedSourcePair.expansion.baselineProvenanceHashes,
    state.verifiedSourcePair.baseline.baselineProvenanceHashes
  );
  assert.equal(
    state.verifiedCalendarClassifier.hashes.calendarHash,
    state.verifiedBaseline.plan.source.calendarHash
  );
  assert.equal(
    state.coreState.source.expansionDataSnapshotHash,
    state.verifiedSourcePair.expansion.hashes
      .expansionDataSnapshotHash
  );
  assert.equal(state.status, "inconclusive");
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

test("preflight source reader rejects split drift without output mutation", async (t) => {
  const fixture = await createFixture(t);
  const source = createEvidenceExpansionPreflightBundleTestFixture();
  source.expansion = {
    ...source.expansion,
    validationSplitSource: {
      sourceVersion: "expanded-split-source",
      assignments:
        createEvidenceExpansionSourceVerifierTestAssignments()
    }
  };
  await writeFile(
    fixture.inputPath,
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8"
  );

  await assert.rejects(
    readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle(
      fixture.inputPath,
      { asOf: "2026-07-23T00:00:00.000Z" }
    ),
    /baseline and expansion validation split sources must match/
  );
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

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
