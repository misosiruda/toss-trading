import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import test from "node:test";
import { createStoragePaths, FileMarketPacketStore } from "../storage/repositories.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateCashCapacity } from "./storedCandidateCashCapacity.js";
import { candidatePacketClassificationRef } from "./candidatePacketClassification.js";
import { classificationPacket } from "./candidatePacketClassificationTestFixtures.js";
import { resolveStoredCandidateClassification } from "./storedCandidateClassification.js";
import { AT, CREATED, classificationOptions, cashOptions, seed, frozen, temporary } from "./storedCandidateEvidenceTestFixtures.js";

test("stored classification binds exact packet metadata without using observed bucket as assignment", async () => {
  for (const market of ["KR", "US"] as const) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, classificationOptions(classificationPacket(market, { region: "GLOBAL" })));
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    const result = await resolveStoredCandidateClassification(input);
    assert.deepEqual(result.classification.exposureKeys, record.exposureKeys);
    assert.equal(result.classification.exposureKeys.country, "GLOBAL");
    assert.equal(result.classification.exposureKeys.currency, market === "KR" ? "KRW" : "USD");
    assert.equal(result.classification.observedStrategyBucket, "long_term");
    assert.equal(record.bucket, "swing");
    assert.equal(result.assessment.observedBucketAuthority, "metadata_only");
    assert.equal(result.assessment.sourceTrust, "not_evaluated");
    assert.equal(result.assessment.historicalDiskAvailability, "not_proven");
    assert.equal(result.assessment.portfolioFitEvidence, "not_evaluated");
    assert.equal(result.assessment.cashConditionSatisfied, result.cashReplay.assessment.cashConditionSatisfied);
    assert.equal(result.assessment.evidenceAndHardGateConditionsSatisfied, result.cashReplay.assessment.evidenceAndHardGateConditionsSatisfied);
    assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
    assert.deepEqual(await resolveStoredCandidateClassification(input), result); frozen(result);
  });
});


test("stored classification replays valid long symbols through actual historical and packet sources", async () => {
  for (const length of [161, 240]) await temporary(async (baseDir) => {
    const symbol = "S".repeat(length);
    const { record } = await seed(baseDir, classificationOptions(classificationPacket("KR", { symbol })));
    assert.equal(record.symbol, symbol);
    const result = await resolveStoredCandidateClassification({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    assert.equal(result.classification.input.symbol, symbol);
    assert.deepEqual(result.classification.exposureKeys, record.exposureKeys);
  });
});


test("stored classification rejects forged sector region currency and evidence references", async () => {
  for (const patch of [{ sector: "Other" }, { country: "US" }, { currency: "USD" }, { classificationEvidenceRef: "unverified" }]) {
    await temporary(async (baseDir) => {
      const options = classificationOptions(), originalPatch = options.patch!;
      const { record } = await seed(baseDir, { ...options, patch: (input) => {
        const original = originalPatch(input); return { ...original, exposureKeys: { ...original.exposureKeys, ...patch } };
      } });
      const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
      await resolveStoredCandidateCashCapacity(input);
      await assert.rejects(resolveStoredCandidateClassification(input), /keys differ|exactly once/);
    });
  }
});


test("stored classification rejects inherited exposure-map keys present in actual packets", async () => {
  for (const sector of ["toString", "valueOf", "hasOwnProperty"]) await temporary(async (baseDir) => {
    const options = classificationOptions(classificationPacket("KR", { sector })), packet = options.classificationPacket!;
    options.patch = (input) => ({ ...cashOptions(850).patch!(input), exposureKeys: { sector, country: "KR", currency: "KRW",
      classificationEvidenceRef: candidatePacketClassificationRef(createMarketPacketHash(packet), "KR", input.symbol) } });
    const { record } = await seed(baseDir, options), lookup = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateCashCapacity(lookup);
    await assert.rejects(resolveStoredCandidateClassification(lookup), /safe non-index key/);
  });
});


test("stored classification requires an explicit supported as-of policy model", async () => {
  for (const classificationModelVersion of [undefined, "unknown.v1"]) await temporary(async (baseDir) => {
    const options = classificationOptions(); delete options.classificationModelVersion;
    const { record } = await seed(baseDir, { ...options, ...(classificationModelVersion === undefined ? {} : { classificationModelVersion }) });
    const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
    await resolveStoredCandidateCashCapacity(input);
    await assert.rejects(resolveStoredCandidateClassification(input), /model is not selected/);
  });
});


test("stored classification refuses missing duplicate and reused packet identities", async () => {
  for (const kind of ["missing", "duplicate", "reused"] as const) await temporary(async (baseDir) => {
    const options = classificationOptions(), packet = options.classificationPacket!;
    if (kind === "missing") delete options.classificationPacket;
    const { record } = await seed(baseDir, options);
    if (kind !== "missing") await new FileMarketPacketStore(createStoragePaths(baseDir).marketPacketsPath).append(kind === "duplicate" ? packet :
      { ...packet, virtualPortfolio: { ...packet.virtualPortfolio, cashKrw: 900 } });
    await assert.rejects(resolveStoredCandidateClassification({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /exactly once|ID was reused/);
  });
});


test("stored classification enforces request cutoff and strict packet candidate expiry", async () => {
  for (const kind of ["cutoff", "packet-expiry", "candidate-expiry"] as const) await temporary(async (baseDir) => {
    const packet = classificationPacket();
    if (kind === "packet-expiry") packet.expiresAt = AT;
    if (kind === "candidate-expiry") packet.candidates[0]!.staleAfter = AT;
    const options = classificationOptions(packet);
    const { record } = await seed(baseDir, { ...options, ...(kind === "cutoff" ? { evidenceCutoffAt: CREATED } : {}) });
    await assert.rejects(resolveStoredCandidateClassification({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /after cutoff or stale/);
  });
});


test("stored classification refuses foreign portfolios and caller injection", async () => temporary(async (baseDir) => {
  const options = classificationOptions(); options.classificationPacket!.virtualPortfolio.portfolioId = "foreign";
  const { record } = await seed(baseDir, options);
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  await assert.rejects(resolveStoredCandidateClassification(input), /portfolio mismatch/);
  await assert.rejects(resolveStoredCandidateClassification({ ...input, sector: "Injected" } as never));
}));


test("stored classification preserves exact evidence after append and rejects unrelated corrupt suffix without repair", async () => temporary(async (baseDir) => {
  const options = classificationOptions(), { record } = await seed(baseDir, options);
  const input = { baseDir, sizingInputRecordId: record.sizingInputRecordId };
  const original = await resolveStoredCandidateClassification(input), path = createStoragePaths(baseDir).marketPacketsPath;
  await new FileMarketPacketStore(path).append({ ...options.classificationPacket!, packetId: "other-packet" });
  const appended = await resolveStoredCandidateClassification(input);
  assert.deepEqual(appended.classification, original.classification);
  assert.notEqual(appended.assessment.sourceHistoryHash, original.assessment.sourceHistoryHash);
  await appendFile(path, '{"corrupt":true}\n'); const before = await readFile(path, "utf8");
  await assert.rejects(resolveStoredCandidateClassification(input), /history is corrupt/);
  assert.equal(await readFile(path, "utf8"), before);
}));
