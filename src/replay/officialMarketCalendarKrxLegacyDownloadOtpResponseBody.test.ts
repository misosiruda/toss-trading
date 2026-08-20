import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_RESPONSE_BODY_VERSION,
  verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody
} from "./officialMarketCalendarKrxLegacyDownloadOtpResponseBody.js";

test("KRX legacy download OTP body accepts exact canonical base64 bytes", () => {
  const bytes = canonicalOtpBytes();
  const before = Uint8Array.from(bytes);

  const shape =
    verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(bytes);
  assert.deepEqual(shape, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DOWNLOAD_OTP_RESPONSE_BODY_VERSION,
    encoding: "base64",
    encodedByteLength: 300,
    decodedByteLength: 224,
    paddingCharacters: 1
  });
  assert.equal(Object.isFrozen(shape), true);
  assert.deepEqual(bytes, before);
  assert.equal("rawResponseBytes" in shape, false);
  assert.equal("decodedBytes" in shape, false);
  assert.equal("sha256" in shape, false);
});

test("KRX legacy download OTP body rejects every other byte length", () => {
  const bytes = canonicalOtpBytes();
  for (const invalid of [bytes.subarray(0, 299), padded(bytes, 301)]) {
    assert.throws(
      () =>
        verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(invalid),
      /must be exactly 300 bytes/
    );
  }
});

test("KRX legacy download OTP body rejects whitespace and non-base64 bytes", () => {
  for (const replacement of [0x20, 0x0a, 0x2d, 0x5f, 0x80]) {
    const bytes = canonicalOtpBytes();
    bytes[20] = replacement;
    assert.throws(
      () =>
        verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(bytes),
      /canonical base64 bytes/
    );
  }
});

test("KRX legacy download OTP body requires exact single padding", () => {
  const missingPadding = canonicalOtpBytes();
  missingPadding[299] = 0x41;
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(
        missingPadding
      ),
    /exact = padding/
  );

  const extraPadding = canonicalOtpBytes();
  extraPadding[298] = 0x3d;
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(
        extraPadding
      ),
    /canonical base64 bytes/
  );
});

test("KRX legacy download OTP body rejects non-zero unused padding bits", () => {
  const bytes = canonicalOtpBytes();
  const finalSextet = base64Sextet(bytes[298]!);
  bytes[298] = base64Byte((finalSextet & 0x3c) | 0x01);

  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(bytes),
    /zero canonical base64 padding bits/
  );
});

test("KRX legacy download OTP body rejects non-typed and detached inputs", () => {
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody({
        length: 300
      }),
    /must be a Uint8Array/
  );

  const detached = canonicalOtpBytes();
  void structuredClone(detached, { transfer: [detached.buffer] });
  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyDownloadOtpResponseBody(detached),
    /exactly 300 bytes|attached Uint8Array/
  );
});

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 224 },
    (_, index) => (index * 23 + 11) % 256
  );
  return Uint8Array.from(Buffer.from(decoded).toString("base64"), (character) =>
    character.charCodeAt(0)
  );
}

function padded(bytes: Uint8Array, length: number): Uint8Array {
  const result = new Uint8Array(length);
  result.set(bytes);
  return result;
}

function base64Sextet(byte: number): number {
  if (byte >= 0x41 && byte <= 0x5a) return byte - 0x41;
  if (byte >= 0x61 && byte <= 0x7a) return byte - 0x61 + 26;
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30 + 52;
  if (byte === 0x2b) return 62;
  if (byte === 0x2f) return 63;
  throw new Error("test fixture byte is not base64");
}

function base64Byte(sextet: number): number {
  if (sextet < 26) return 0x41 + sextet;
  if (sextet < 52) return 0x61 + sextet - 26;
  if (sextet < 62) return 0x30 + sextet - 52;
  return sextet === 62 ? 0x2b : 0x2f;
}
