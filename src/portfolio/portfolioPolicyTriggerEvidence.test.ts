import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioPolicyTriggerEvidenceRecord,
  parsePortfolioPolicyTriggerEvidenceRecord,
  type CreatePortfolioPolicyTriggerEvidenceRecordInput
} from "./portfolioPolicyTriggerEvidence.js";
import {
  hashCanonicalPayload,
  hashDerivedId
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
type RegimeEvidenceInput = Extract<
  CreatePortfolioPolicyTriggerEvidenceRecordInput,
  { evidenceType: "regime_change" }
>;
type ThesisEvidenceInput = Extract<
  CreatePortfolioPolicyTriggerEvidenceRecordInput,
  { evidenceType: "thesis_evidence_change" }
>;

test("creates canonical hash-derived policy trigger evidence records", () => {
  for (const input of [regimeEvidenceInput(), thesisEvidenceInput()]) {
    const record = createPortfolioPolicyTriggerEvidenceRecord(input);
    const { evidenceRef, evidenceHash, createdAt: _createdAt, ...payload } =
      record;

    assert.equal(evidenceHash, hashCanonicalPayload(payload));
    assert.equal(
      evidenceRef,
      hashDerivedId("portfolio_policy_trigger_evidence", evidenceHash)
    );
    assert.deepEqual(parsePortfolioPolicyTriggerEvidenceRecord(record), record);
    assert.equal(Object.isFrozen(record), true);
  }
});

test("createdAt-only evidence retries keep semantic identity", () => {
  const first = createPortfolioPolicyTriggerEvidenceRecord(regimeEvidenceInput());
  const retry = createPortfolioPolicyTriggerEvidenceRecord({
    ...regimeEvidenceInput(),
    createdAt: "2026-09-03T00:02:00.000Z"
  });

  assert.equal(retry.evidenceRef, first.evidenceRef);
  assert.equal(retry.evidenceHash, first.evidenceHash);
  assert.notEqual(retry.createdAt, first.createdAt);
});

test("every source and event-scope field participates in evidence identity", () => {
  const baseline = createPortfolioPolicyTriggerEvidenceRecord(
    thesisEvidenceInput()
  );
  const variants: CreatePortfolioPolicyTriggerEvidenceRecordInput[] = [
    { ...thesisEvidenceInput(), portfolioId: "paper-portfolio-2" },
    { ...thesisEvidenceInput(), policyHash: HASH_B },
    { ...thesisEvidenceInput(), market: "US" },
    { ...thesisEvidenceInput(), mandateId: "mandate-2" },
    { ...thesisEvidenceInput(), symbol: "000660" },
    { ...thesisEvidenceInput(), previousThesisStatus: "unknown" },
    { ...thesisEvidenceInput(), currentThesisStatus: "invalidated" },
    { ...thesisEvidenceInput(), sourceContractId: "official-fundamental.v2" },
    { ...thesisEvidenceInput(), sourceArtifactId: "artifact-2" },
    { ...thesisEvidenceInput(), sourceArtifactHash: HASH_C },
    { ...thesisEvidenceInput(), observedAt: "2026-09-03T00:00:01.000Z" }
  ];

  for (const variant of variants) {
    const record = createPortfolioPolicyTriggerEvidenceRecord(variant);
    assert.notEqual(record.evidenceHash, baseline.evidenceHash);
    assert.notEqual(record.evidenceRef, baseline.evidenceRef);
  }
});

test("rejects identity drift, unknown fields, and noncanonical identifiers", () => {
  const record = createPortfolioPolicyTriggerEvidenceRecord(
    thesisEvidenceInput()
  );

  assert.throws(
    () =>
      parsePortfolioPolicyTriggerEvidenceRecord({
        ...record,
        evidenceHash: HASH_B
      }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      parsePortfolioPolicyTriggerEvidenceRecord({
        ...record,
        unexpected: true
      })
  );
  assert.throws(() =>
    createPortfolioPolicyTriggerEvidenceRecord({
      ...thesisEvidenceInput(),
      sourceArtifactId: " artifact-1 "
    })
  );
  assert.throws(() =>
    createPortfolioPolicyTriggerEvidenceRecord({
      ...thesisEvidenceInput(),
      sourceContractId: "official-fundamental.v1\ud800"
    })
  );
});

test("rejects invalid transition and chronology semantics", () => {
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvidenceRecord({
        ...regimeEvidenceInput(),
        currentRegime: "risk_on"
      }),
    /distinct regime values/
  );
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvidenceRecord({
        ...thesisEvidenceInput(),
        currentThesisStatus: "intact"
      }),
    /distinct thesis statuses/
  );
  assert.throws(
    () =>
      createPortfolioPolicyTriggerEvidenceRecord({
        ...regimeEvidenceInput(),
        observedAt: "2026-09-03T00:02:00.000Z"
      }),
    /cannot be created before observation/
  );
  assert.throws(() =>
    createPortfolioPolicyTriggerEvidenceRecord({
      ...regimeEvidenceInput(),
      observedAt: "2026-09-03T00:00:00"
    })
  );
});

function regimeEvidenceInput(): RegimeEvidenceInput {
  return {
    evidenceType: "regime_change",
    portfolioId: "paper-portfolio-1",
    policyHash: HASH_A,
    market: "KR",
    previousRegime: "risk_on",
    currentRegime: "risk_off",
    sourceContractId: "verified-regime-classification.v1",
    sourceArtifactId: "regime-artifact-1",
    sourceArtifactHash: HASH_B,
    observedAt: "2026-09-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:01:00.000Z"
  };
}

function thesisEvidenceInput(): ThesisEvidenceInput {
  return {
    evidenceType: "thesis_evidence_change",
    portfolioId: "paper-portfolio-1",
    policyHash: HASH_A,
    market: "KR",
    mandateId: "mandate-1",
    symbol: "005930",
    previousThesisStatus: "intact",
    currentThesisStatus: "watch",
    sourceContractId: "official-fundamental.v1",
    sourceArtifactId: "artifact-1",
    sourceArtifactHash: HASH_B,
    observedAt: "2026-09-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:01:00.000Z"
  };
}
