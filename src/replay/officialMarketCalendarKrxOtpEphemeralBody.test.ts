import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody,
  consumeOfficialMarketCalendarKrxOtpForHolidayDataPost,
  createOfficialMarketCalendarKrxOtpEphemeralBody,
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters,
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody,
  disposeOfficialMarketCalendarKrxOtpEphemeralBody,
  type CreateOfficialMarketCalendarKrxOtpEphemeralBodyInput,
  type OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters,
  type OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody,
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

test("KRX OTP fixed consumer creates opaque holiday data POST parameters", () => {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });

  const postParameters =
    consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2026");

  assert.equal(Object.isFrozen(postParameters), true);
  assert.equal(Object.getPrototypeOf(postParameters), null);
  assert.deepEqual(Object.keys(postParameters), []);
  assert.deepEqual(Object.getOwnPropertyNames(postParameters), ["toJSON"]);
  disposeOfficialMarketCalendarKrxOtpEphemeralBody(otpHandle);
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
    postParameters
  );
});

test("KRX OTP fixed consumer rejects reuse after successful transfer", () => {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });
  const postParameters =
    consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2025");

  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2025"),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
    postParameters
  );
});

test("KRX OTP fixed consumer consumes and clears ownership on invalid year", () => {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });

  assert.throws(() =>
    consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2027")
  );
  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2026"),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxOtpEphemeralBody(otpHandle);
});

test("KRX holiday data POST parameters reject JSON export and dispose", () => {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });
  const postParameters =
    consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2016");

  assert.throws(
    () => JSON.stringify(postParameters),
    /cannot be serialized or exported/
  );
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
    postParameters
  );
});

test("KRX holiday data POST parameter disposal is idempotent", () => {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });
  const postParameters =
    consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(otpHandle, "2024");

  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
    postParameters
  );
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
    postParameters
  );
});

test("KRX holiday data POST parameters reject forged handles", () => {
  for (const handle of [
    {},
    Object.freeze(Object.create(null)),
    null,
    "handle"
  ]) {
    assert.throws(() =>
      disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
        handle as OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
      )
    );
  }
});

test("KRX OTP fixed consumer rejects forged OTP handles", () => {
  for (const handle of [{}, Object.freeze(Object.create(null)), null, "handle"]) {
    assert.throws(() =>
      consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(
        handle as OfficialMarketCalendarKrxOtpEphemeralBody,
        "2026"
      )
    );
  }
});

test("KRX fixed byte encoder creates an opaque wire body", () => {
  const postParameters = createPostParameters("2026");

  const wireBody =
    consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
      postParameters
    );

  assert.equal(Object.isFrozen(wireBody), true);
  assert.equal(Object.getPrototypeOf(wireBody), null);
  assert.deepEqual(Object.keys(wireBody), []);
  assert.deepEqual(Object.getOwnPropertyNames(wireBody), ["toJSON"]);
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
    postParameters
  );
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(wireBody);
});

test("KRX fixed byte encoder rejects parameter handle reuse", () => {
  const postParameters = createPostParameters("2025");
  const wireBody =
    consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
      postParameters
    );

  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
        postParameters
      ),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(wireBody);
});

test("KRX holiday data POST wire body rejects JSON export and disposes", () => {
  const wireBody =
    consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
      createPostParameters("2016")
    );

  assert.throws(
    () => JSON.stringify(wireBody),
    /cannot be serialized or exported/
  );
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(wireBody);
});

test("KRX holiday data POST wire body disposal is idempotent", () => {
  const wireBody =
    consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
      createPostParameters("2024")
    );

  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(wireBody);
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(wireBody);
});

test("KRX fixed byte encoder rejects forged parameter handles", () => {
  for (const handle of [{}, Object.freeze(Object.create(null)), null, "handle"]) {
    assert.throws(() =>
      consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
        handle as OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
      )
    );
  }
});

test("KRX holiday data POST wire body rejects forged handles", () => {
  for (const handle of [
    {},
    Object.freeze(Object.create(null)),
    null,
    "handle"
  ]) {
    assert.throws(() =>
      disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody(
        handle as OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
      )
    );
  }
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

function createPostParameters(
  targetYear: "2026" | "2025" | "2024" | "2016"
): OfficialMarketCalendarKrxHolidayDataPostEphemeralParameters {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });
  return consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(
    otpHandle,
    targetYear
  );
}
