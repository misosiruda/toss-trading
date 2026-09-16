import assert from "node:assert/strict";
import test from "node:test";
import { createSourceFxEvidenceRecord, parseSourceFxEvidenceRecord } from "./sourceFxEvidence.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

const input = () => ({ schemaVersion: "source_fx_evidence.v1" as const, sourceContractId: "synthetic-usdkrw.v1",
  baseCurrency: "USD" as const, quoteCurrency: "KRW" as const, rate: 1380.25,
  observedAt: "2026-09-01T01:00:00.000Z", sourceRefs: ["synthetic-b", "synthetic-a"], createdAt: "2026-09-01T01:00:01.000Z" });
const record = () => createSourceFxEvidenceRecord(input());
const createUnknown = (value: unknown) => createSourceFxEvidenceRecord(value as Parameters<typeof createSourceFxEvidenceRecord>[0]);

test("source FX evidence hashes the complete semantic payload and survives JSON restart", () => {
  const value = record(), { evidenceRef, evidenceHash, createdAt, ...payload } = value;
  assert.equal(evidenceHash, hashCanonicalPayload(payload));
  assert.equal(evidenceRef, hashDerivedId("source_fx_evidence", evidenceHash));
  assert.equal(createdAt, input().createdAt);
  assert.deepEqual(value.sourceRefs, ["synthetic-a", "synthetic-b"]);
  assert.deepEqual(parseSourceFxEvidenceRecord(JSON.parse(JSON.stringify(value))), value);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.sourceRefs));
  assert.ok(Object.isFrozen(parseSourceFxEvidenceRecord(value)));
});

test("source FX evidence identity covers source pair direction rate observation and provenance", () => {
  const value = record();
  for (const change of [{ sourceContractId: "synthetic-usdkrw.v2" }, { rate: 1380.26 },
    { observedAt: "2026-09-01T00:59:59.000Z" }, { sourceRefs: ["synthetic-c"] }]) {
    const changed = createSourceFxEvidenceRecord({ ...input(), ...change });
    assert.notEqual(changed.evidenceHash, value.evidenceHash);
    assert.notEqual(changed.evidenceRef, value.evidenceRef);
    assert.throws(() => parseSourceFxEvidenceRecord({ ...value, ...change }));
  }
  for (const change of [{ baseCurrency: "KRW", quoteCurrency: "USD", rate: 1 / value.rate },
    { baseCurrency: "EUR" }, { quoteCurrency: "JPY" }, { schemaVersion: "source_fx_evidence.v2" }]) {
    assert.throws(() => createUnknown({ ...input(), ...change }));
    assert.throws(() => parseSourceFxEvidenceRecord({ ...value, ...change }));
  }
});

test("source FX evidence keeps ingestion time outside identity but validates chronology", () => {
  const value = record(), later = createSourceFxEvidenceRecord({ ...input(), createdAt: "2026-09-01T01:00:02.000Z" });
  assert.equal(later.evidenceHash, value.evidenceHash); assert.equal(later.evidenceRef, value.evidenceRef);
  assert.deepEqual(parseSourceFxEvidenceRecord(later), later);
  for (const createdAt of [input().observedAt, "2026-09-01T10:00:00+09:00"]) {
    assert.ok(createSourceFxEvidenceRecord({ ...input(), createdAt }));
  }
  assert.throws(() => createSourceFxEvidenceRecord({ ...input(), createdAt: "2026-09-01T00:59:59.999Z" }), /before observation/);
  assert.throws(() => parseSourceFxEvidenceRecord({ ...value, createdAt: "2026-09-01T00:59:59.999Z" }), /before observation/);
});

test("source FX evidence rejects missing forged or price-domain identity", () => {
  const value = record();
  for (const change of [{ evidenceHash: `sha256:${"a".repeat(64)}` }, { evidenceRef: "caller-fx-ref" },
    { evidenceRef: hashDerivedId("source_price_evidence", value.evidenceHash) }, { evidenceHash: undefined }, { evidenceRef: undefined }]) {
    assert.throws(() => parseSourceFxEvidenceRecord({ ...value, ...change }));
  }
});

test("source FX evidence canonicalizes only source order and rejects duplicate provenance", () => {
  const value = record();
  assert.deepEqual(createSourceFxEvidenceRecord({ ...input(), sourceRefs: [...input().sourceRefs].reverse() }), value);
  assert.throws(() => parseSourceFxEvidenceRecord({ ...value, sourceRefs: [...value.sourceRefs].reverse() }), /canonical order/);
  for (const sourceRefs of [[], ["same", "same"], ["same", "other", "same"], Array.from({ length: 129 }, (_, index) => `ref-${index}`)]) {
    assert.throws(() => createSourceFxEvidenceRecord({ ...input(), sourceRefs }));
    assert.throws(() => parseSourceFxEvidenceRecord({ ...value, sourceRefs }));
  }
});

test("source FX evidence rejects noncanonical identifiers and malformed Unicode", () => {
  for (const identifier of ["", " ", " padded", "padded ", "x".repeat(161), "\ud800", "\udc00", "a\ud800b"]) {
    assert.throws(() => createSourceFxEvidenceRecord({ ...input(), sourceContractId: identifier }));
    assert.throws(() => createSourceFxEvidenceRecord({ ...input(), sourceRefs: [identifier] }));
    assert.throws(() => parseSourceFxEvidenceRecord({ ...record(), sourceContractId: identifier }));
  }
  assert.ok(createSourceFxEvidenceRecord({ ...input(), sourceRefs: ["synthetic-😀"] }));
});

test("source FX evidence rejects nonpositive nonfinite and coerced rates", () => {
  for (const rate of [0, -0, -1, NaN, Infinity, -Infinity, "1380.25", null, undefined]) {
    assert.throws(() => createUnknown({ ...input(), rate }));
    assert.throws(() => parseSourceFxEvidenceRecord({ ...record(), rate }));
  }
});

test("source FX evidence requires real offset-qualified timestamps and exact fields", () => {
  for (const field of ["observedAt", "createdAt"]) {
    for (const time of ["2026-09-01T01:00:00", "2026-02-30T01:00:00Z", "not-a-time", null]) {
      assert.throws(() => createUnknown({ ...input(), [field]: time }));
      assert.throws(() => parseSourceFxEvidenceRecord({ ...record(), [field]: time }));
    }
  }
  for (const value of [null, [], { ...input(), extra: true }, { ...input(), extra: undefined }, { ...input(), evidenceRef: "injected" }]) {
    assert.throws(() => createUnknown(value));
  }
  for (const value of [null, [], { ...record(), extra: true }, { ...record(), extra: undefined }]) {
    assert.throws(() => parseSourceFxEvidenceRecord(value));
  }
});

test("source FX evidence does not mutate input or grant durable freshness or provider authority", () => {
  const source = input(), before = structuredClone(source), value = createSourceFxEvidenceRecord(source);
  assert.deepEqual(source, before); assert.equal(Object.isFrozen(source.sourceRefs), false);
  source.sourceRefs.push("later"); assert.deepEqual(value.sourceRefs, ["synthetic-a", "synthetic-b"]);
  assert.deepEqual(Object.keys(value).sort(), ["schemaVersion", "sourceContractId", "baseCurrency", "quoteCurrency", "rate",
    "observedAt", "sourceRefs", "createdAt", "evidenceRef", "evidenceHash"].sort());
  // A self-consistent synthetic record is structurally valid, not proof of an external observation.
  assert.ok(parseSourceFxEvidenceRecord(value));
});
