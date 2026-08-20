import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_OTP_RESPONSE_BODY_VERSION,
  verifyOfficialMarketCalendarKrxOtpResponseBody
} from "./officialMarketCalendarKrxOtpResponseBody.js";

test("KRX OTP response body accepts exact canonical base64 bytes", () => {
  const bytes = canonicalOtpBytes();
  const before = Uint8Array.from(bytes);

  assert.deepEqual(verifyOfficialMarketCalendarKrxOtpResponseBody(bytes), {
    schemaVersion: OFFICIAL_MARKET_CALENDAR_KRX_OTP_RESPONSE_BODY_VERSION,
    encoding: "base64",
    encodedByteLength: 216,
    decodedByteLength: 160,
    paddingCharacters: 2
  });
  assert.deepEqual(bytes, before);
});

test("KRX OTP response body rejects every other byte length", () => {
  const bytes = canonicalOtpBytes();
  for (const invalid of [bytes.subarray(0, 215), padded(bytes, 217)]) {
    assert.throws(
      () => verifyOfficialMarketCalendarKrxOtpResponseBody(invalid),
      /must be exactly 216 bytes/
    );
  }
});

test("KRX OTP response body rejects whitespace and non-base64 bytes", () => {
  for (const replacement of [0x20, 0x0a, 0x2d, 0x5f, 0x80]) {
    const bytes = canonicalOtpBytes();
    bytes[20] = replacement;
    assert.throws(
      () => verifyOfficialMarketCalendarKrxOtpResponseBody(bytes),
      /canonical base64 bytes/
    );
  }
});

test("KRX OTP response body requires exact padding", () => {
  for (const index of [214, 215]) {
    const bytes = canonicalOtpBytes();
    bytes[index] = 0x41;
    assert.throws(
      () => verifyOfficialMarketCalendarKrxOtpResponseBody(bytes),
      /exact == padding/
    );
  }
});

test("KRX OTP response body rejects non-zero unused padding bits", () => {
  const bytes = canonicalOtpBytes();
  const finalSextet = base64Sextet(bytes[213]!);
  bytes[213] = base64Byte((finalSextet & 0x30) | 0x01);

  assert.throws(
    () => verifyOfficialMarketCalendarKrxOtpResponseBody(bytes),
    /zero canonical base64 padding bits/
  );
});

test("KRX OTP response body rejects non-typed and detached inputs", () => {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxOtpResponseBody({ length: 216 }),
    /must be a Uint8Array/
  );

  const detached = canonicalOtpBytes();
  void structuredClone(detached, { transfer: [detached.buffer] });
  assert.throws(
    () => verifyOfficialMarketCalendarKrxOtpResponseBody(detached),
    /exactly 216 bytes|attached Uint8Array/
  );
});

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 160 },
    (_, index) => (index * 17 + 3) % 256
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
