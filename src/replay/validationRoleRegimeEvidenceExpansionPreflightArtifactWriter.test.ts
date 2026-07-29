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

import { writeValidationRoleRegimeEvidenceExpansionPreflightArtifact } from "./validationRoleRegimeEvidenceExpansionPreflightArtifactWriter.js";
import {
  parseValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflightHash.js";
import { createEvidenceExpansionPreflightTestArtifact } from "./validationRoleRegimeEvidenceExpansionPreflightTestFixture.js";

test("preflight writer creates a strict-parser-valid JSON artifact", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "evidence-expansion-preflight-")
  );
  const outputDirectory = join(directory, "nested", "deeper");
  const outputPath = join(outputDirectory, "preflight.json");
  const artifact = createEvidenceExpansionPreflightTestArtifact();
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
      artifact: createEvidenceExpansionPreflightTestArtifact()
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
    ...createEvidenceExpansionPreflightTestArtifact(),
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
