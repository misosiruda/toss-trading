import assert from "node:assert/strict";
import test from "node:test";

import {
  createSourcePriceEvidenceRecord,
  parseSourcePriceEvidenceRecord
} from "./sourcePriceEvidence.js";
import {
  hashCanonicalPayload,
  hashDerivedId
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;

test("source price evidence derives identity from the complete canonical payload", () => {
  const record = sourcePriceEvidence();
  const { evidenceRef, evidenceHash, createdAt, ...payload } = record;

  assert.equal(evidenceHash, hashCanonicalPayload(payload));
  assert.equal(
    evidenceRef,
    hashDerivedId("source_price_evidence", evidenceHash)
  );
  assert.equal(createdAt, "2026-09-01T01:00:01.000Z");
  assert.deepEqual(record.sourceRefs, ["raw-contract-a", "raw-contract-b"]);
  assert.deepEqual(parseSourcePriceEvidenceRecord(record), record);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.sourceRefs));
});

test("source price evidence identity covers contract, scope, price, time, and provenance", () => {
  const baseline = sourcePriceEvidence();
  const variants = [
    sourcePriceEvidence({ sourceContractId: "contract-v2" }),
    sourcePriceEvidence({ market: "US", symbol: "AAPL" }),
    sourcePriceEvidence({ priceKrw: 101 }),
    sourcePriceEvidence({ observedAt: "2026-09-01T01:00:00+09:00" }),
    sourcePriceEvidence({ sourceRefs: ["raw-contract-c"] })
  ];

  for (const variant of variants) {
    assert.notEqual(variant.evidenceHash, baseline.evidenceHash);
    assert.notEqual(variant.evidenceRef, baseline.evidenceRef);
  }
});

test("source price evidence rejects stored identity and canonical-form drift", () => {
  const record = sourcePriceEvidence();
  assert.throws(
    () =>
      parseSourcePriceEvidenceRecord({
        ...record,
        evidenceHash: HASH_A
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      parseSourcePriceEvidenceRecord({
        ...record,
        sourceRefs: [...record.sourceRefs].reverse()
      }),
    /canonical order/
  );
  assert.throws(
    () =>
      parseSourcePriceEvidenceRecord({
        ...record,
        sourceContractId: " contract-v1 "
      }),
    /must already be canonical/
  );
});

test("source price evidence rejects duplicate or unsupported provenance", () => {
  assert.throws(
    () => sourcePriceEvidence({ sourceRefs: ["same", "same"] }),
    /must not contain duplicates/
  );
  assert.throws(
    () =>
      createSourcePriceEvidenceRecord({
        ...evidenceInput(),
        priceField: "close_price" as "last_price"
      }),
    /Invalid input/
  );
  assert.throws(
    () =>
      createSourcePriceEvidenceRecord({
        ...evidenceInput(),
        extra: true
      } as Parameters<typeof createSourcePriceEvidenceRecord>[0]),
    /unrecognized key/i
  );
});

test("source price evidence rejects invalid price and creation chronology", () => {
  for (const priceKrw of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sourcePriceEvidence({ priceKrw }));
  }
  assert.throws(
    () => sourcePriceEvidence({ priceKrw: -0 }),
    /greater than 0|negative zero/
  );
  assert.throws(
    () =>
      sourcePriceEvidence({
        createdAt: "2026-09-01T00:59:59.999Z"
      }),
    /cannot be created before observation/
  );
});

function sourcePriceEvidence(
  overrides: Partial<{
    sourceContractId: string;
    market: "KR" | "US";
    symbol: string;
    priceField: "last_price";
    priceKrw: number;
    observedAt: string;
    sourceRefs: string[];
    createdAt: string;
  }> = {}
) {
  return createSourcePriceEvidenceRecord({
    ...evidenceInput(),
    ...overrides
  });
}

function evidenceInput() {
  return {
    sourceContractId: "contract-v1",
    market: "KR" as const,
    symbol: "005930",
    priceField: "last_price" as const,
    priceKrw: 100,
    observedAt: "2026-09-01T01:00:00.000Z",
    sourceRefs: ["raw-contract-b", "raw-contract-a"],
    createdAt: "2026-09-01T01:00:01.000Z"
  };
}
