import assert from "node:assert/strict";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { assessStoredCandidateEvidenceRequirements } from "./storedCandidateEvidenceRequirements.js";
import { AT, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("candidate evidence requirements use actual policy request and source timestamps without granting eligibility", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir);
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(result.assessment.conditionsSatisfied, true);
  assert.equal(result.assessment.ageSeconds, 86400);
  assert.equal(result.assessment.latestObservationAt, "2026-09-03T00:00:00.000Z");
  assert.deepEqual(result.assessment.requirements[0]!.reasonCodes, []);
  assert.deepEqual(result.assessment.unevaluatedHardGateRuleIds, ["not-yet-evaluated"]);
  assert.equal(result.assessment.sourceTrust, "not_evaluated");
  assert.equal(result.assessment.historicalDiskAvailability, "not_proven");
  assert.equal("eligibility" in result.assessment, false);
  assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
  frozen(result);
  assert.deepEqual(await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
}));


test("candidate evidence freshness uses last raw observation rather than recent calculation or capture time", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86399 }] });
  const result = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(result.assessment.conditionsSatisfied, false);
  assert.deepEqual(result.assessment.requirements[0]!.reasonCodes, ["stale_observation"]);
  assert.ok(Date.parse(result.scoreReplay.evidenceOrigin.binding.evidence.createdAt) > Date.parse(AT));
}));


test("candidate evidence minimum count comes from policy rather than the calculator query", async () => {
  for (const minimumObservationCount of [2, 3]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400, minimumObservationCount }] });
    const result = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(result.assessment.conditionsSatisfied, minimumObservationCount === 2);
    assert.deepEqual(result.assessment.requirements[0]!.reasonCodes, minimumObservationCount === 2 ? [] : ["insufficient_observations"]);
  });
});


test("candidate evidence cannot substitute market features for fundamental portfolio or execution evidence", async () => temporary(async (baseDir) => {
  const requiredEvidence = ["market_technical", "fundamental_quality", "portfolio_fit", "execution_fit"].map((evidenceClass) => ({
    evidenceClass: evidenceClass as "market_technical" | "fundamental_quality" | "portfolio_fit" | "execution_fit",
    sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400 }));
  const { record } = await seed(baseDir, { requiredEvidence });
  const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.equal(assessment.conditionsSatisfied, false);
  for (const result of assessment.requirements) {
    const present = result.requirement.evidenceClass === "market_technical";
    assert.deepEqual(result.reasonCodes, present ? [] : ["required_evidence_missing"]);
    assert.equal(result.evidenceRefs.length, present ? 1 : 0);
  }
}));


test("candidate evidence source contracts match exactly and independent failures are all reported", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "different-source.v1", maximumAgeSeconds: 1, minimumObservationCount: 3 }] });
  const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.deepEqual(assessment.requirements[0]!.reasonCodes, ["insufficient_observations", "source_contract_mismatch", "stale_observation"]);
  assert.equal(assessment.conditionsSatisfied, false);
}));


test("candidate evidence rejects observations beyond request cutoff even when fresh at asOf", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { evidenceCutoffAt: "2026-09-02T00:00:00.000Z" });
  const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
  assert.deepEqual(assessment.requirements[0]!.reasonCodes, ["observation_after_cutoff", "source_materialized_after_cutoff"]);
  assert.equal(assessment.conditionsSatisfied, false);
}));


test("candidate evidence checks source materialization cutoff by instant including equality and offsets", async () => {
  for (const sourceCreatedAt of [AT, "2026-09-04T09:00:00.000+09:00", "2026-09-04T00:00:00.001Z"]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { sourceCreatedAt });
    const { assessment } = await assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    const allowed = Date.parse(sourceCreatedAt) === Date.parse(AT);
    assert.equal(assessment.conditionsSatisfied, allowed);
    assert.deepEqual(assessment.requirements[0]!.reasonCodes, allowed ? [] : ["source_materialized_after_cutoff"]);
  });
});


test("candidate evidence assessment rechecks the exact original request prefix after score replay", async (context) => {
  for (const change of ["append", "replace"] as const) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    const prototype = BucketSelectionRequestFileRepository.prototype, original = prototype.withDurableVerifiedHistory;
    const path = createBucketSelectionRequestPaths(baseDir).recordsPath;
    let reads = 0;
    const mock = context.mock.method(prototype, "withDurableVerifiedHistory", async function<T>(this: BucketSelectionRequestFileRepository,
      operation: Parameters<typeof original<T>>[0]) {
      if (++reads === 2) {
        const request = JSON.parse((await readFile(path, "utf8")).trim());
        if (change === "replace") await writeFile(path, `${JSON.stringify({ ...request, createdAt: "2026-09-04T00:00:00.001Z" })}\n`);
        else {
          const { requestId: ignoredId, requestHash: ignoredHash, ...payload } = request; void ignoredId; void ignoredHash;
          await appendFile(path, `${JSON.stringify(createBucketSelectionRequest({ ...payload, cycleId: "another-cycle" }))}\n`);
        }
      }
      return original.call(this, operation);
    });
    try {
      const promise = assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
      if (change === "replace") await assert.rejects(promise, /does not match durable source prefix/);
      else assert.equal((await promise).assessment.conditionsSatisfied, true);
      assert.equal(reads, 2);
    } finally { mock.mock.restore(); }
  });
});


test("candidate evidence assessment refuses corrupt original request prefixes and mismatched scores", async () => {
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    const path = createBucketSelectionRequestPaths(baseDir).recordsPath;
    await appendFile(path, "corrupt\n");
    await assert.rejects(assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId }));
    assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { patch: (input) => ({ ...input, selectionScore: 999 }) });
    await assert.rejects(assessStoredCandidateEvidenceRequirements({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
  });
});
