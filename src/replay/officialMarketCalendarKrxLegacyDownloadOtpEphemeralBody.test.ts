import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument,
  createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters,
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  type CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput,
  type OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters,
  type OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
} from "./officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.js";

test("KRX legacy OTP handle takes ownership and zeroizes the caller view", () => {
  const rawResponseBytes = canonicalOtpBytes();
  const handle =
    createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
      rawResponseBytes,
      requestedFileName: "E_Trading_Calendar2013.doc"
    });

  assertZeroed(rawResponseBytes);
  assertOpaqueHandle(handle);
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(handle);
});

test("KRX legacy OTP factory reads the transferred view once", () => {
  const rawResponseBytes = canonicalOtpBytes();
  const decoyBytes = canonicalOtpBytes();
  let readCount = 0;
  let fileNameReadCount = 0;
  const input = {
    get rawResponseBytes() {
      readCount += 1;
      return readCount === 1 ? rawResponseBytes : decoyBytes;
    },
    get requestedFileName() {
      fileNameReadCount += 1;
      return fileNameReadCount === 1
        ? "E_Trading_Calendar2013.doc"
        : "E_Trading_Calendar2014.doc";
    }
  } satisfies CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput;

  const handle =
    createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(input);
  assert.equal(readCount, 1);
  assert.equal(fileNameReadCount, 1);
  assertZeroed(rawResponseBytes);
  assert.equal(decoyBytes.some((byte) => byte !== 0), true);
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(handle);
});

test("KRX legacy OTP factory zeroizes bytes when file-name access throws", () => {
  const rawResponseBytes = canonicalOtpBytes();
  const input = {
    rawResponseBytes,
    get requestedFileName(): unknown {
      throw new Error("synthetic file-name accessor failure");
    }
  } satisfies CreateOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBodyInput;

  assert.throws(
    () =>
      createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(input),
    /synthetic file-name accessor failure/
  );
  assertZeroed(rawResponseBytes);
});

test("KRX legacy OTP factory zeroizes rejected transferred bytes", () => {
  for (const rawResponseBytes of [
    new Uint8Array(299),
    invalidCanonicalOtpBytes()
  ]) {
    assert.throws(() =>
      createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
        rawResponseBytes,
        requestedFileName: "E_Trading_Calendar2013.doc"
      })
    );
    assertZeroed(rawResponseBytes);
  }
});

test("KRX legacy OTP factory rejects detached and shared backing", () => {
  const detached = canonicalOtpBytes();
  void structuredClone(detached, { transfer: [detached.buffer] });
  assert.throws(() =>
    createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
      rawResponseBytes: detached,
      requestedFileName: "E_Trading_Calendar2013.doc"
    })
  );

  if (typeof SharedArrayBuffer !== "undefined") {
    const shared = new Uint8Array(new SharedArrayBuffer(300));
    shared.set(canonicalOtpBytes());
    assert.throws(
      () =>
        createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
          rawResponseBytes: shared,
          requestedFileName: "E_Trading_Calendar2013.doc"
        }),
      /must not use shared backing memory/
    );
    assertZeroed(shared);
  }
});

test("KRX legacy OTP handle rejects JSON export and disposes", () => {
  const handle = createOtpHandle();
  assert.throws(
    () => JSON.stringify(handle),
    /cannot be serialized or exported/
  );
  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
        handle
      ),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(handle);
});

test("KRX legacy OTP explicit disposal is idempotent", () => {
  const handle = createOtpHandle();
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(handle);
  disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(handle);
});

test("KRX legacy OTP handle rejects forged and invalid handles", () => {
  for (const handle of [
    {},
    Object.freeze(Object.create(null)),
    null,
    "handle"
  ]) {
    assert.throws(() =>
      disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(
        handle as OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
      )
    );
    assert.throws(() =>
      consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
        handle as OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody
      )
    );
  }
});

test("KRX legacy OTP consumer creates opaque parameters for each registered file", () => {
  for (const fileName of [
    "E_Trading_Calendar2013.doc",
    "E_Trading_Calendar2014.doc",
    "E_Trading_Calendar2015.doc"
  ]) {
    const otpHandle = createOtpHandle(fileName);
    const parameters =
      consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
        otpHandle
      );
    assertOpaqueHandle(parameters);
    disposeOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody(otpHandle);
    disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(
      parameters
    );
  }
});

test("KRX legacy OTP consumer rejects reuse after transfer", () => {
  const otpHandle = createOtpHandle();
  const parameters =
    consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
      otpHandle
    );
  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
        otpHandle
      ),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(parameters);
});

test("KRX legacy OTP factory rejects an unregistered request file", () => {
  const rawResponseBytes = canonicalOtpBytes();
  assert.throws(
    () =>
      createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
        rawResponseBytes,
        requestedFileName: "E_Trading_Calendar2016.doc"
      }),
    /registered document file name/
  );
  assertZeroed(rawResponseBytes);
});

test("KRX legacy download parameters reject JSON export and dispose", () => {
  const parameters = createParameters();
  assert.throws(
    () => JSON.stringify(parameters),
    /cannot be serialized or exported/
  );
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(parameters);
});

test("KRX legacy download parameter disposal is idempotent", () => {
  const parameters = createParameters();
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(parameters);
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(parameters);
});

test("KRX legacy download parameters reject forged handles", () => {
  for (const handle of [
    {},
    Object.freeze(Object.create(null)),
    null,
    "handle"
  ]) {
    assert.throws(() =>
      disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(
        handle as OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
      )
    );
  }
});

function createOtpHandle(
  requestedFileName: unknown = "E_Trading_Calendar2013.doc"
): OfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody {
  return createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes(),
    requestedFileName
  });
}

function createParameters(): OfficialMarketCalendarKrxLegacyDownloadEphemeralParameters {
  return consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
    createOtpHandle("E_Trading_Calendar2015.doc")
  );
}

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 224 },
    (_, index) => (index * 29 + 13) % 256
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

function assertZeroed(bytes: Uint8Array): void {
  assert.equal(bytes.every((byte) => byte === 0), true);
}

function assertOpaqueHandle(value: object): void {
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.getPrototypeOf(value), null);
  assert.deepEqual(Object.keys(value), []);
  assert.deepEqual(Object.getOwnPropertyNames(value), ["toJSON"]);
}
