import assert from "node:assert/strict";
import test from "node:test";
import { candidatePacketClassificationRef, CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION,
  deriveCandidatePacketClassification, parseCandidatePacketClassification } from "./candidatePacketClassification.js";
import { classificationPacket } from "./candidatePacketClassificationTestFixtures.js";
import { createBucketSelectionPolicyRecord, hashCanonicalPayload, parseBucketSelectionPolicyRecord } from "./runtimePolicyContracts.js";

function input() { return { modelVersion: CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION, packet: classificationPacket(), market: "KR", symbol: "SYNTH" }; }

test("packet classification derives exact declared region and market currency without granting observed bucket authority", () => {
  for (const market of ["KR", "US"] as const) for (const region of ["KR", "US", "GLOBAL"] as const) {
    const result = deriveCandidatePacketClassification({ ...input(), market, packet: classificationPacket(market, { region }) });
    assert.deepEqual(result.exposureKeys, { sector: "Synthetic", country: region, currency: market === "KR" ? "KRW" : "USD",
      classificationEvidenceRef: result.evidenceRef });
    assert.equal(result.observedStrategyBucket, "long_term");
    assert.equal(result.classificationSemantics, "declared_sector_region_and_market_settlement_currency");
    assert.equal(result.evidenceRef, candidatePacketClassificationRef(result.packetHash, market, "SYNTH"));
  }
});

test("packet classification rejects missing ambiguous noncanonical and unsafe metadata", () => {
  for (const field of ["sector", "region"] as const) {
    const value = input(); delete value.packet.candidates[0]![field];
    assert.throws(() => deriveCandidatePacketClassification(value));
  }
  for (const sector of ["", " ", " Synthetic", "7", "__proto__", "constructor", "prototype", "bad\ud800", "x".repeat(161)]) {
    assert.throws(() => deriveCandidatePacketClassification({ ...input(), packet: classificationPacket("KR", { sector }) }));
  }
  const duplicate = input(); duplicate.packet.candidates.push({ ...duplicate.packet.candidates[0]! });
  assert.throws(() => deriveCandidatePacketClassification(duplicate), /exactly once/);
  assert.throws(() => deriveCandidatePacketClassification({ ...input(), symbol: "MISSING" }), /exactly once/);
  assert.throws(() => deriveCandidatePacketClassification({ ...input(), modelVersion: "unknown" }));
  assert.throws(() => deriveCandidatePacketClassification({ ...input(), packet: classificationPacket("KR", { sourceRefs: ["same", "same"] }) }), /unique/);
  const normalized = input(); delete (normalized.packet.candidates[0] as unknown as Record<string, unknown>).reasonCodes;
  assert.throws(() => deriveCandidatePacketClassification(normalized), /not canonical/);
  assert.throws(() => deriveCandidatePacketClassification({ ...input(), extra: true }));
});

test("packet classification preserves the upstream candidate symbol contract for projection reference and replay", () => {
  for (const length of [1, 160, 161, 240]) {
    const symbol = "S".repeat(length);
    const result = deriveCandidatePacketClassification({ ...input(), symbol, packet: classificationPacket("KR", { symbol }) });
    assert.equal(result.input.symbol, symbol);
    assert.equal(result.evidenceRef, candidatePacketClassificationRef(result.packetHash, "KR", symbol));
    assert.deepEqual(parseCandidatePacketClassification(JSON.parse(JSON.stringify(result))), result);
  }
  for (const symbol of ["", " S", "S ", "bad\ud800", "S".repeat(241)]) {
    assert.throws(() => deriveCandidatePacketClassification({ ...input(), symbol, packet: classificationPacket("KR", { symbol }) }));
    assert.throws(() => candidatePacketClassificationRef(hashCanonicalPayload("packet"), "KR", symbol));
  }
});

test("packet classification rejects every inherited plain-object exposure key", () => {
  for (const sector of [...Object.getOwnPropertyNames(Object.prototype), "prototype"]) {
    assert.throws(() => deriveCandidatePacketClassification({ ...input(), packet: classificationPacket("KR", { sector }) }), /safe non-index key/);
  }
});

test("packet classification refuses invalid source chronology including exact expiry boundaries", () => {
  for (const patch of [{ collectedAt: "2026-09-04T00:00:00.000Z" }, { staleAfter: "2026-09-03T12:00:00.000Z" }]) {
    assert.throws(() => deriveCandidatePacketClassification({ ...input(), packet: classificationPacket("KR", patch) }), /chronology/);
  }
  const value = input(); value.packet.expiresAt = value.packet.generatedAt;
  assert.throws(() => deriveCandidatePacketClassification(value), /chronology/);
});

test("packet classification independently replays all output fields despite recomputed hashes and freezes caller-independent content", () => {
  const value = input(), before = structuredClone(value), result = deriveCandidatePacketClassification(value);
  assert.deepEqual(value, before);
  const { evidenceHash, ...payload } = result;
  assert.equal(evidenceHash, hashCanonicalPayload(payload));
  assert.equal(result.inputHash, hashCanonicalPayload(result.input));
  for (const patch of [{ exposureKeys: { ...result.exposureKeys, sector: "Other" } }, { observedStrategyBucket: "swing" },
    { sourceRefs: ["different"] }, { packetHash: hashCanonicalPayload("different") }, { evidenceRef: "different" }, { extra: true }]) {
    const wrong = { ...payload, ...patch };
    assert.throws(() => parseCandidatePacketClassification({ ...wrong, evidenceHash: hashCanonicalPayload(wrong) }), /replay mismatch/);
  }
  assert.deepEqual(parseCandidatePacketClassification(JSON.parse(JSON.stringify(result))), result);
  value.packet.candidates[0]!.sector = "Changed";
  assert.equal(result.input.packet.candidates[0]!.sector, "Synthetic");
  const frozen = (item: unknown) => { if (item !== null && typeof item === "object") { assert.ok(Object.isFrozen(item)); Object.values(item).forEach(frozen); } };
  frozen(result);
});

test("classification model selection changes policy hash identity and lineage without rewriting legacy records", () => {
  const value = { bucket: "swing" as const, version: "synthetic.v1", createdAt: "2026-09-01T00:00:00.000Z",
    requiredEvidence: [{ evidenceClass: "market_technical" as const, sourceContractId: "synthetic", maximumAgeSeconds: 60 }],
    hardGateRuleIds: ["synthetic"], scoringModelVersion: "synthetic.v1", featureDefinitionRefs: ["synthetic"] };
  const legacy = createBucketSelectionPolicyRecord(value);
  const selected = createBucketSelectionPolicyRecord({ ...value, classificationModelVersion: CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION });
  assert.equal("classificationModelVersion" in legacy, false);
  assert.equal(JSON.stringify(parseBucketSelectionPolicyRecord(legacy)), JSON.stringify(legacy));
  assert.notEqual(selected.hash, legacy.hash); assert.notEqual(selected.selectionPolicyRecordId, legacy.selectionPolicyRecordId);
  assert.notEqual(selected.lineageHash, legacy.lineageHash);
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...selected, classificationModelVersion: "other.v1" }), /hash mismatch/);
  for (const classificationModelVersion of ["", " ", "x".repeat(81), null]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...value, classificationModelVersion } as never));
  }
});
