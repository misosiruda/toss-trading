import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier,
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOCUMENT_IDENTITY_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyDocumentIdentityError,
  verifyOfficialMarketCalendarKrxLegacyDocumentIdentity
} from "./officialMarketCalendarKrxLegacyDocumentIdentity.js";

const FILE_NAME = "E_Trading_Calendar2013.doc";
const TARGET_YEAR = "2013";
const OLE_SIGNATURE = "d0cf11e0a1b11ae1";

test("KRX legacy document identity verifies exact synthetic bytes with test-only expectation", () => {
  const bytes = syntheticOleDocument();
  const verifier = syntheticVerifier(bytes);

  const identity = verifier.verify({
    fileName: FILE_NAME,
    rawDocumentBytes: bytes
  });

  assert.deepEqual(identity, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOCUMENT_IDENTITY_SCHEMA_VERSION,
    fileName: FILE_NAME,
    targetYear: TARGET_YEAR,
    contentLength: bytes.byteLength,
    sourceDocumentHash: `sha256:${hashBytes(bytes)}`,
    containerFormat: "ole_compound_file_signature_only",
    oleCompoundFileSignature: OLE_SIGNATURE,
    identityVerified: true,
    identityVerificationAuthority: "test_only_expectation",
    parserStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
  assert.equal(Object.isFrozen(identity), true);
});

test("KRX legacy document identity fails closed for length, signature and hash mismatch", () => {
  const bytes = syntheticOleDocument();
  const verifier = syntheticVerifier(bytes);

  assert.throws(
    () =>
      verifier.verify({
        fileName: FILE_NAME,
        rawDocumentBytes: bytes.slice(0, -1)
      }),
    (error: unknown) => hasCode(error, "KRX_LEGACY_DOCUMENT_IDENTITY_LENGTH_MISMATCH")
  );

  const wrongSignature = bytes.slice();
  wrongSignature[0] = wrongSignature[0]! ^ 0xff;
  assert.throws(
    () =>
      verifier.verify({
        fileName: FILE_NAME,
        rawDocumentBytes: wrongSignature
      }),
    (error: unknown) => hasCode(error, "KRX_LEGACY_DOCUMENT_IDENTITY_CONTAINER_MISMATCH")
  );

  const wrongHash = bytes.slice();
  wrongHash[wrongHash.byteLength - 1] =
    wrongHash[wrongHash.byteLength - 1]! ^ 0xff;
  assert.throws(
    () =>
      verifier.verify({
        fileName: FILE_NAME,
        rawDocumentBytes: wrongHash
      }),
    (error: unknown) => hasCode(error, "KRX_LEGACY_DOCUMENT_IDENTITY_HASH_MISMATCH")
  );
});

test("KRX legacy production verifier is fixed to the registered document identity", () => {
  const bytes = syntheticOleDocument();
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyDocumentIdentity({
        fileName: FILE_NAME,
        rawDocumentBytes: bytes
      }),
    (error: unknown) => hasCode(error, "KRX_LEGACY_DOCUMENT_IDENTITY_LENGTH_MISMATCH")
  );
  assert.equal(verifyOfficialMarketCalendarKrxLegacyDocumentIdentity.length, 1);
});

test("KRX legacy document identity rejects malformed inputs and test configuration", () => {
  const bytes = syntheticOleDocument();
  const verifier = syntheticVerifier(bytes);
  const detachedBytes = new Uint8Array(8);
  structuredClone(null, { transfer: [detachedBytes.buffer] });
  const sharedBytes =
    typeof SharedArrayBuffer === "undefined"
      ? undefined
      : new Uint8Array(new SharedArrayBuffer(8));
  const throwingInput = Object.defineProperty({}, "fileName", {
    enumerable: true,
    get() {
      throw new Error("must not escape");
    }
  });
  Object.defineProperty(throwingInput, "rawDocumentBytes", {
    enumerable: true,
    value: bytes
  });

  for (const input of [
    null,
    {},
    { fileName: FILE_NAME, rawDocumentBytes: bytes, extra: true },
    { fileName: "E_Trading_Calendar2012.doc", rawDocumentBytes: bytes },
    { fileName: FILE_NAME, rawDocumentBytes: Buffer.from(bytes) },
    { fileName: FILE_NAME, rawDocumentBytes: detachedBytes },
    ...(sharedBytes === undefined
      ? []
      : [{ fileName: FILE_NAME, rawDocumentBytes: sharedBytes }]),
    throwingInput
  ]) {
    assert.throws(
      () => verifier.verify(input as never),
      (error: unknown) => hasCode(error, "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_INPUT")
    );
  }

  assert.throws(
    () =>
      createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
        fileName: FILE_NAME,
        targetYear: TARGET_YEAR,
        contentLength: bytes.byteLength,
        sha256: "f".repeat(64),
        oleCompoundFileSignature: "0000000000000000" as never
      }),
    (error: unknown) => hasCode(error, "KRX_LEGACY_DOCUMENT_IDENTITY_INVALID_CONFIG")
  );
});

test("KRX legacy test-only expectation is snapshotted at verifier creation", () => {
  const bytes = syntheticOleDocument();
  const expectation = {
    fileName: FILE_NAME,
    targetYear: TARGET_YEAR,
    contentLength: bytes.byteLength,
    sha256: hashBytes(bytes),
    oleCompoundFileSignature: OLE_SIGNATURE
  } as const;
  const verifier =
    createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier(
      expectation
    );
  (expectation as { sha256: string }).sha256 = "f".repeat(64);

  assert.equal(
    verifier.verify({ fileName: FILE_NAME, rawDocumentBytes: bytes })
      .identityVerified,
    true
  );
});

function syntheticVerifier(bytes: Uint8Array) {
  return createTestOnlyOfficialMarketCalendarKrxLegacyDocumentIdentityVerifier({
    fileName: FILE_NAME,
    targetYear: TARGET_YEAR,
    contentLength: bytes.byteLength,
    sha256: hashBytes(bytes),
    oleCompoundFileSignature: OLE_SIGNATURE
  });
}

function syntheticOleDocument(): Uint8Array {
  const bytes = Uint8Array.from({ length: 512 }, (_, index) => (index * 37 + 11) % 256);
  bytes.set(Buffer.from(OLE_SIGNATURE, "hex"), 0);
  return bytes;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarKrxLegacyDocumentIdentityError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarKrxLegacyDocumentIdentityError &&
    error.code === code
  );
}
