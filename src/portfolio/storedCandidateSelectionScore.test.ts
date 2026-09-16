import assert from "node:assert/strict";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { createMarketTechnicalEvidencePaths } from "./marketTechnicalEvidenceFiles.js";
import { createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { createRuntimePortfolioPolicyPaths } from "./runtimePortfolioPolicyFiles.js";
import { resolveStoredCandidateSelectionScore } from "./storedCandidateSelectionScore.js";
import { AT, type Payload, model, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored candidate score replays actual policy model and committed features without granting eligibility", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir);
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  assert.equal(result.verificationScope, "stored_score_replay_only");
  assert.deepEqual(result.score, fixture.score);
  assert.deepEqual(result.activePolicy.policy, fixture.policy);
  assert.deepEqual(result.selectionPolicy, fixture.selection);
  assert.deepEqual(result.sizingInputOrigin.record, fixture.record);
  assert.deepEqual(result.evidenceOrigin, fixture.evidence);
  assert.equal("eligibility" in result, false); assert.equal("sizingRange" in result, false); assert.equal("approved" in result, false);
  frozen(result);
  assert.deepEqual(await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }), result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
  assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
}));


test("stored candidate score rejects a rehashed committed score with any numeric mismatch", async () => {
  for (const selectionScore of [-1, 999, 0, 0.75]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { patch: (input) => ({ ...input, selectionScore }) });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
    assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
  });
});


test("stored candidate score rejects an unselected model even when that model exists and reproduces the claimed score", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, scoringModelVersion: "alternate.v1" }) });
  await appendFile(createImmutablePolicyDependencyPaths(baseDir).scoringModels, `${JSON.stringify(model("alternate.v1"))}\n`);
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /policy-selected model version/);
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId, model: model() } as never));
}));


test("stored candidate score cannot consume forged extra features or a model requiring unverified features", async () => {
  for (const options of [
    { patch: (input: Payload): Payload => ({ ...input, featureInputs: [...input.featureInputs, { featureDefinitionRef: "extra.v1", value: 1, evidenceRefs: ["unverified"] }] }) },
    { extraModelFeature: true }
  ]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, options);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /exact verified market feature set|exact model feature set/);
  });
});


test("stored candidate score rejects changed real feature values despite valid candidate hashes", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, featureInputs: input.featureInputs.map((feature, index) =>
    index === 0 ? { ...feature, value: Number(feature.value) + 1 } : feature) }) });
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /value or evidence reference mismatch/);
}));


test("stored candidate score uses the exact policy parameters instead of a matching version label", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { upperBound: 20000 }); // Candidate still declares the score computed with 10000.
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
}));


test("stored candidate score fails closed for legacy policies missing models and unavailable candidate IDs", async () => {
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { legacy: true });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /lacks an exact/);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: "missing" }), /stored candidate sizing input is missing/);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: " " }));
    await writeFile(createImmutablePolicyDependencyPaths(baseDir).scoringModels, "");
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /ref does not resolve/);
  });
});


test("stored candidate score resolves policy at candidate asOf rather than using latest or a declared hash", async () => {
  for (const retiredAt of ["2026-09-03T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]) await temporary(async (baseDir) => {
    const { record, policy, dependencies, activation } = await seed(baseDir);
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [policy], dependencies).appendRetired({
      portfolioId: policy.portfolioId, retiredActivationId: activation.activationId, reasonCode: "synthetic_retirement", createdAt: retiredAt });
    const result = resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    if (retiredAt < AT) await assert.rejects(result, /active runtime portfolio policy is required/);
    else assert.deepEqual((await result).activePolicy.activation, activation);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { policyHash: `sha256:${"f".repeat(64)}` });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /active policy hash mismatch/);
  });
});


test("stored candidate score rejects another portfolio and a market disabled by the active bucket", async () => {
  for (const options of [{ portfolioId: "other-portfolio" }, { market: "US" as const }]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, options);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /active runtime portfolio policy is required|enabled market mismatch/);
  });
});


test("stored candidate score rejects corruption in every actual source instead of trusting its cached score", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir);
  const paths = [...Object.values(createImmutablePolicyDependencyPaths(baseDir)), createRuntimePortfolioPolicyPaths(baseDir).recordsPath,
    createRuntimePortfolioPolicyActivationPaths(baseDir).eventsPath, createBucketSelectionRequestPaths(baseDir).recordsPath,
    createPortfolioSizingSnapshotPaths(baseDir).recordsPath, createCandidateSizingInputPaths(baseDir).recordsPath,
    createMarketTechnicalEvidencePaths(baseDir).recordsPath, join(baseDir, "historical-market-snapshots.jsonl")];
  for (const path of paths) {
    const before = await readFile(path);
    await appendFile(path, "corrupt\n");
    try { await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId })); }
    finally { await writeFile(path, before); }
  }
  await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
}));
