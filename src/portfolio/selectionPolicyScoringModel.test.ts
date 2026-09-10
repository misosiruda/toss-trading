import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { candidateScoringModelRefFor, CANDIDATE_SCORING_ALGORITHM, createCandidateScoringModel } from "./candidateScoringModel.js";
import { createBucketSelectionPolicyRecord, parseBucketSelectionPolicyRecord, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords } from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths, ImmutablePolicyDependencyFileLoader, loadConsistentImmutablePolicyDependencies,
  type ImmutablePolicyDependencyRawGeneration } from "./runtimePolicyDependencyFiles.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";

const AT = "2026-09-01T00:00:00.000Z";
function model(version = "synthetic-score.v1", createdAt = AT) {
  return createCandidateScoringModel({ algorithm: CANDIDATE_SCORING_ALGORITHM, version, createdAt,
    terms: [{ featureDefinitionRef: "momentum.v1", weight: 1, lowerBound: -1, upperBound: 1, direction: "higher_is_better" }] });
}
function policy(scoringModel = model(), overrides: Record<string, unknown> = {}) {
  return createBucketSelectionPolicyRecord({ bucket: "swing", version: "selection.v1", createdAt: AT,
    requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic-market.v1", maximumAgeSeconds: 60 }],
    hardGateRuleIds: ["liquidity"], scoringModelVersion: scoringModel.version,
    scoringModelRef: candidateScoringModelRefFor(scoringModel), featureDefinitionRefs: ["momentum.v1"], ...overrides });
}
function records(selection = policy(), scoringModels: ReturnType<typeof model>[] = [model()]): ImmutablePolicyDependencyRecords {
  return { scoringModels, selectionPolicies: [selection], riskParameters: [], riskRuleSets: [], drawdownSemantics: [], sessionCalendars: [], scheduleBoundaries: [] };
}
function raw(data: ImmutablePolicyDependencyRecords): ImmutablePolicyDependencyRawGeneration {
  return Object.fromEntries(Object.entries(data).map(([key, items]) => [key, { records: [...items], corruptLineCount: 0 }])) as unknown as ImmutablePolicyDependencyRawGeneration;
}

test("selection policy model reference binds exact ID hash version and preserves model-less legacy payload", () => {
  const actualModel = model(), selection = policy(actualModel);
  assert.deepEqual(parseBucketSelectionPolicyRecord(JSON.parse(JSON.stringify(selection))), selection);
  const repository = new ImmutablePolicyDependencyRepository(records(selection, [actualModel]));
  assert.deepEqual(repository.resolveSelectionScoringModel(selection), actualModel);
  assert.deepEqual(repository.resolveScoringModel(candidateScoringModelRefFor(actualModel)), actualModel);
  const { selectionPolicyRecordId: ignoredId, hash: ignoredHash, lineageHash: ignoredLineage, scoringModelRef: ignoredRef, ...payload } = selection;
  void ignoredId; void ignoredHash; void ignoredLineage; void ignoredRef;
  const legacy = createBucketSelectionPolicyRecord(payload);
  assert.equal("scoringModelRef" in legacy, false);
  assert.notEqual(legacy.hash, selection.hash);
  const { scoringModels: ignoredModels, ...legacyRecords } = records(legacy); void ignoredModels;
  const legacyRepository = new ImmutablePolicyDependencyRepository(legacyRecords);
  assert.deepEqual(legacyRepository.resolveSelectionPolicy(selectionPolicyRefFor(legacy)), legacy);
  assert.throws(() => legacyRepository.resolveSelectionScoringModel(legacy), /lacks an exact/);
  assert.throws(() => repository.resolveSelectionScoringModel(legacy), /repository record/);
});

test("selection policy rejects inconsistent model labels refs feature sets and dependency chronology", () => {
  const actualModel = model();
  assert.throws(() => policy(actualModel, { scoringModelVersion: "wrong.v1" }), /version mismatch/);
  for (const patch of [{ scoringModelRecordId: "missing" }, { hash: `sha256:${"f".repeat(64)}` }, { version: "wrong.v1" }]) {
    const ref = { ...candidateScoringModelRefFor(actualModel), ...patch };
    const selection = policy(actualModel, { scoringModelRef: ref, scoringModelVersion: ref.version });
    assert.throws(() => new ImmutablePolicyDependencyRepository(records(selection)), /ref does not resolve|version\/hash mismatch/);
  }
  assert.throws(() => new ImmutablePolicyDependencyRepository(records(policy(), [])), /ref does not resolve/);
  assert.throws(() => new ImmutablePolicyDependencyRepository(records(policy(actualModel, { featureDefinitionRefs: ["other"] }))), /feature set mismatch/);
  const future = model("future.v1", "2026-09-02T00:00:00.000Z");
  assert.throws(() => new ImmutablePolicyDependencyRepository(records(policy(future), [future])), /created after/);
  const sameInstant = model("offset.v1", "2026-09-01T09:00:00.000+09:00");
  assert.deepEqual(new ImmutablePolicyDependencyRepository(records(policy(sameInstant), [sameInstant])).resolveSelectionScoringModel(policy(sameInstant)), sameInstant);
  const repository = new ImmutablePolicyDependencyRepository(records());
  assert.throws(() => repository.resolveScoringModel({ ...candidateScoringModelRefFor(actualModel), extra: true } as never));
  assert.throws(() => repository.resolveScoringModel({ ...candidateScoringModelRefFor(actualModel), version: " synthetic-score.v1 " }), /canonical/);
});

test("model registry rejects corrupt unused models duplicate IDs and ambiguous versions before policy resolution", () => {
  const first = model();
  for (const models of [[first, first], [first, { ...first, scoringModelHash: `sha256:${"f".repeat(64)}` }],
    [first, model(first.version, "2026-09-02T00:00:00.000Z")]]) {
    assert.throws(() => new ImmutablePolicyDependencyRepository(records(policy(), models as never)));
  }
  const second = model("synthetic-score.v2");
  assert.deepEqual(new ImmutablePolicyDependencyRepository(records(policy(), [first, second])).resolveScoringModel(candidateScoringModelRefFor(second)), second);
  assert.throws(() => candidateScoringModelRefFor(model("x".repeat(81))));
});

test("scoring model reference rejects malformed fields and rehashed model-less compatibility is never automatic", () => {
  const selection = policy();
  for (const ref of [{}, { ...selection.scoringModelRef, hash: "bad" }, { ...selection.scoringModelRef, extra: true }]) {
    assert.throws(() => policy(model(), { scoringModelRef: ref }));
  }
  const { scoringModelRef: ignored, ...withoutRef } = selection; void ignored;
  assert.throws(() => parseBucketSelectionPolicyRecord(withoutRef));
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...selection, scoringModelRef: { ...selection.scoringModelRef, hash: `sha256:${"b".repeat(64)}` } }));
});

test("dependency file loader reads actual scoring model records without rewriting legacy or creating missing files", async () => temporary(async (dir) => {
  const paths = createImmutablePolicyDependencyPaths(dir), loader = new ImmutablePolicyDependencyFileLoader(dir);
  const empty = await loader.load();
  assert.equal("scoringModels" in empty.records, false);
  await assert.rejects(readFile(paths.scoringModels), { code: "ENOENT" });
  const actualModel = model(), selection = policy(actualModel);
  await appendFile(paths.selectionPolicies, `${JSON.stringify(selection)}\n`);
  await assert.rejects(loader.load(), /ref does not resolve/);
  await appendFile(paths.scoringModels, `${JSON.stringify(actualModel)}\n`);
  const before = await readFile(paths.scoringModels, "utf8");
  const loaded = await loader.load();
  assert.deepEqual(loaded.repository.resolveSelectionScoringModel(selection), actualModel);
  assert.deepEqual(loaded.records.scoringModels, [actualModel]);
  assert.equal(await readFile(paths.scoringModels, "utf8"), before);
  assert.ok(Object.isFrozen(loaded.records.scoringModels));
  assert.ok(Object.isFrozen(loaded.records.scoringModels![0]!.terms));
}));

test("dependency file loader refuses corrupt duplicate and tampered model lines without partial acceptance", async () => temporary(async (dir) => {
  const paths = createImmutablePolicyDependencyPaths(dir), loader = new ImmutablePolicyDependencyFileLoader(dir);
  const actualModel = model(), selection = policy(actualModel), valid = `${JSON.stringify(actualModel)}\n`;
  await appendFile(paths.selectionPolicies, `${JSON.stringify(selection)}\n`);
  for (const content of [valid + "bad-json\n", valid + valid, `${JSON.stringify({ ...actualModel, version: "forged.v1" })}\n`,
    valid + `${JSON.stringify(model(actualModel.version, "2026-09-02T00:00:00.000Z"))}\n`]) {
    await writeFile(paths.scoringModels, content);
    await assert.rejects(loader.load());
    assert.equal(await readFile(paths.scoringModels, "utf8"), content);
  }
}));

test("dependency generation retry accepts appended missing model but rejects replacement and persistent corruption", async () => {
  const complete = raw(records()), missing = raw(records(policy(), []));
  let reads = 0;
  const loaded = await loadConsistentImmutablePolicyDependencies({ readGeneration: async () => ++reads === 1 ? missing : complete });
  assert.equal(reads, 2);
  assert.deepEqual(loaded.repository.resolveSelectionScoringModel(policy()), model());
  const previous = raw(records(policy(), [model("unrelated.v1")]));
  reads = 0;
  await assert.rejects(loadConsistentImmutablePolicyDependencies({ readGeneration: async () => ++reads === 1 ? previous : complete }), /append-only extensions/);
  const corrupt = raw(records()); corrupt.scoringModels!.corruptLineCount = 1;
  reads = 0;
  await assert.rejects(loadConsistentImmutablePolicyDependencies({ readGeneration: async () => { reads += 1; return corrupt; } }), /corrupt lines/);
  assert.equal(reads, 2);
});

async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "selection-scoring-model-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
