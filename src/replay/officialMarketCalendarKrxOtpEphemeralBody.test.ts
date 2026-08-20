import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarKrxOtpEphemeralBody,
  disposeOfficialMarketCalendarKrxOtpEphemeralBody,
  type CreateOfficialMarketCalendarKrxOtpEphemeralBodyInput,
  type OfficialMarketCalendarKrxOtpEphemeralBody
} from "./officialMarketCalendarKrxOtpEphemeralBody.js";

test("KRX OTP ephemeral body takes ownership and zeroizes the caller view", () => {
  const rawResponseBytes = canonicalOtpBytes();
  const handle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes
  });

  assertZeroed(rawResponseBytes);
  assert.equal(Object.isFrozen(handle), true);
  assert.deepEqual(Object.keys(handle), []);
  assert.deepEqual(Object.getOwnPropertyNames(handle), ["toJSON"]);
  disposeOfficialMarketCalendarKrxOtpEphemeralBody(handle);
});

test("KRX OTP ephemeral body reads the transferred view once", () => {
  const rawResponseBytes = canonicalOtpBytes();
  const decoyBytes = canonicalOtpBytes();
  let readCount = 0;
  const input = {
    get rawResponseBytes() {
      readCount += 1;
      return readCount === 1 ? rawResponseBytes : decoyBytes;
    }
  } satisfies CreateOfficialMarketCalendarKrxOtpEphemeralBodyInput;

  const handle = createOfficialMarketCalendarKrxOtpEphemeralBody(input);

  assert.equal(readCount, 1);
  assertZeroed(rawResponseBytes);
  assert.equal(decoyBytes.some((byte) => byte !== 0), true);
  disposeOfficialMarketCalendarKrxOtpEphemeralBody(handle);
});

test("KRX OTP ephemeral body zeroizes rejected transferred bytes", () => {
  for (const rawResponseBytes of [
    new Uint8Array(215),
    invalidCanonicalOtpBytes()
  ]) {
    assert.throws(() =>
      createOfficialMarketCalendarKrxOtpEphemeralBody({ rawResponseBytes })
    );
    assertZeroed(rawResponseBytes);
  }
});

test("KRX OTP ephemeral body rejects JSON export and disposes", () => {
  const handle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });

  assert.throws(
    () => JSON.stringify(handle),
    /cannot be serialized or exported/
  );
  disposeOfficialMarketCalendarKrxOtpEphemeralBody(handle);
});

test("KRX OTP ephemeral body explicit disposal is idempotent", () => {
  const handle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });

  disposeOfficialMarketCalendarKrxOtpEphemeralBody(handle);
  disposeOfficialMarketCalendarKrxOtpEphemeralBody(handle);
});

test("KRX OTP ephemeral body rejects forged and invalid handles", () => {
  for (const handle of [
    {},
    Object.freeze(Object.create(null)),
    null,
    "handle"
  ]) {
    assert.throws(() =>
      disposeOfficialMarketCalendarKrxOtpEphemeralBody(
        handle as OfficialMarketCalendarKrxOtpEphemeralBody
      )
    );
  }
});

test("KRX OTP ephemeral body rejects non-typed and detached inputs", () => {
  assert.throws(() =>
    createOfficialMarketCalendarKrxOtpEphemeralBody({
      rawResponseBytes: { length: 216 } as Uint8Array
    })
  );

  const detached = canonicalOtpBytes();
  void structuredClone(detached, { transfer: [detached.buffer] });
  assert.throws(() =>
    createOfficialMarketCalendarKrxOtpEphemeralBody({
      rawResponseBytes: detached
    })
  );
});

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 160 },
    (_, index) => (index * 19 + 7) % 256
  );
  return Uint8Array.from(Buffer.from(decoded).toString("base64"), (character) =>
    character.charCodeAt(0)
  );
}

function invalidCanonicalOtpBytes(): Uint8Array {
  const bytes = canonicalOtpBytes();
  bytes[20] = 0x20;
  return bytes;
}

function assertZeroed(value: Uint8Array): void {
  assert.equal(value.every((byte) => byte === 0), true);
}
