import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEvidenceExpansionPreflightBundleTestFixture } from "../replay/validationRoleRegimeEvidenceExpansionPreflightBundleVerifierTestFixture.js";
import type { ValidationRoleRegimeEvidenceExpansionInput } from "../replay/validationRoleRegimeEvidenceExpansionInputBoundary.js";
import { createEvidenceExpansionSourceVerifierTestAssignments } from "../replay/validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";
import { parseValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "../replay/validationRoleRegimeEvidenceExpansionPreflightHash.js";
import {
  readAndVerifyValidationRoleRegimeEvidenceExpansionPreflightBundle,
  readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact,
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
      {
        generatedAt: "2026-07-30T00:00:00.000Z"
      }
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
  assert.equal(
    state.artifact.generatedAt,
    "2026-07-30T00:00:00.000Z"
  );
  assert.equal(state.artifact.status, state.status);
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

test("preflight source reader rejects conflicting split boundaries without output mutation", async (t) => {
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
      {
        generatedAt: "2026-07-30T00:00:00.000Z"
      }
    ),
    /validation split identity maps to conflicting boundaries/
  );
  assert.deepEqual(await readdir(fixture.directory), ["input.json"]);
});

test("preflight source workflow writes one verified artifact", async (t) => {
  const fixture = await createFixture(t);
  const source = createEvidenceExpansionPreflightBundleTestFixture();
  await writeFile(
    fixture.inputPath,
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8"
  );

  const state =
    await readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      fixture.inputPath,
      {
        generatedAt: "2026-07-30T00:00:00.000Z",
        outputPath: fixture.outputPath
      }
    );
  const written = JSON.parse(
    await readFile(fixture.outputPath, "utf8")
  );

  assert.deepEqual(
    parseValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      written
    ),
    state.artifact
  );
  assert.deepEqual(
    await readdir(fixture.outputDirectory),
    ["preflight.json"]
  );
});

test("preflight source workflow rejects conflicting split boundaries before output mutation", async (t) => {
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
    readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      fixture.inputPath,
      {
        generatedAt: "2026-07-30T00:00:00.000Z",
        outputPath: fixture.outputPath
      }
    ),
    /validation split identity maps to conflicting boundaries/
  );
  await assert.rejects(access(fixture.outputDirectory));
});

test("preflight source workflow preserves an existing output", async (t) => {
  const fixture = await createFixture(t);
  const source = createEvidenceExpansionPreflightBundleTestFixture();
  const existing = "existing preflight must remain unchanged\n";
  await writeFile(
    fixture.inputPath,
    `${JSON.stringify(source, null, 2)}\n`,
    "utf8"
  );
  await mkdir(fixture.outputDirectory);
  await writeFile(fixture.outputPath, existing, "utf8");

  await assert.rejects(
    readVerifyAndWriteValidationRoleRegimeEvidenceExpansionPreflightArtifact(
      fixture.inputPath,
      {
        generatedAt: "2026-07-30T00:00:00.000Z",
        outputPath: fixture.outputPath
      }
    ),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST"
  );
  assert.equal(await readFile(fixture.outputPath, "utf8"), existing);
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
  outputDirectory: string;
  outputPath: string;
}> {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-source-")
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    inputPath: join(directory, "input.json"),
    outputDirectory: join(directory, "output"),
    outputPath: join(directory, "output", "preflight.json")
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
