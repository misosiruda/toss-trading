import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  createOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse,
  type CreateOfficialMarketCalendarKrxHolidayDataEphemeralResponseInput,
  type OfficialMarketCalendarKrxHolidayDataEphemeralResponse
} from "./officialMarketCalendarKrxHolidayDataEphemeralResponse.js";
import { verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

test("KRX holiday ephemeral response takes ownership and hides transferred state", () => {
  const rawResponseBytes = semanticBytes();
  const handle = createResponse(rawResponseBytes);

  assertZeroed(rawResponseBytes);
  assert.equal(Object.isFrozen(handle), true);
  assert.equal(Object.getPrototypeOf(handle), null);
  assert.deepEqual(Object.keys(handle), []);
  assert.deepEqual(Object.getOwnPropertyNames(handle), ["toJSON"]);
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle);
});

test("KRX holiday ephemeral response reads transferred inputs once", () => {
  const rawResponseBytes = semanticBytes();
  const decoyBytes = semanticBytes();
  const metadata = verifiedMetadata(rawResponseBytes.byteLength);
  let rawReadCount = 0;
  const input = {
    get rawResponseBytes() {
      rawReadCount += 1;
      return rawReadCount === 1 ? rawResponseBytes : decoyBytes;
    },
    responseMetadata: metadata,
    targetYear: "2026"
  } satisfies CreateOfficialMarketCalendarKrxHolidayDataEphemeralResponseInput;

  const handle =
    createOfficialMarketCalendarKrxHolidayDataEphemeralResponse(input);
  assert.equal(rawReadCount, 1);
  assertZeroed(rawResponseBytes);
  assert.equal(decoyBytes.some((byte) => byte !== 0), true);
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle);
});

test("KRX holiday ephemeral response zeroizes bytes before later input getters", () => {
  for (const failingField of ["responseMetadata", "targetYear"] as const) {
    const rawResponseBytes = semanticBytes();
    const metadata = verifiedMetadata(rawResponseBytes.byteLength);
    const input = {
      rawResponseBytes,
      get responseMetadata() {
        if (failingField === "responseMetadata") {
          throw new Error("metadata getter failed");
        }
        return metadata;
      },
      get targetYear() {
        if (failingField === "targetYear") {
          throw new Error("target-year getter failed");
        }
        return "2026";
      }
    } satisfies CreateOfficialMarketCalendarKrxHolidayDataEphemeralResponseInput;

    assert.throws(() =>
      createOfficialMarketCalendarKrxHolidayDataEphemeralResponse(input)
    );
    assertZeroed(rawResponseBytes);
  }
});

test("KRX holiday ephemeral response has one fixed semantic consumer", () => {
  const handle = createResponse(semanticBytes());
  const summary =
    consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle);

  assert.equal(summary.targetYear, "2026");
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.englishHolidayNameEmptyCount, 1);
  assert.equal(summary.returnedRowValues, false);
  assert.equal(summary.durableEvidenceReusable, false);
  assert.equal(summary.acceptedAcquisition, false);
  assert.throws(
    () => consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle);
});

test("KRX holiday ephemeral response zeroizes rejected transferred bytes", () => {
  for (const rawResponseBytes of [
    new TextEncoder().encode("not-json"),
    encodeBody({ block1: [] })
  ]) {
    assert.throws(() => createResponse(rawResponseBytes));
    assertZeroed(rawResponseBytes);
  }
});

test("KRX holiday ephemeral response consumes ownership on semantic failure", () => {
  const rawResponseBytes = encodeBody({
    block1: [
      {
        calnd_dd: "2026-01-01",
        dy_tp_cd: "FRI",
        calnd_dd_dy: "2026-01-01",
        kr_dy_tp: "신정",
        holdy_eng_nm: ""
      }
    ]
  });
  const handle = createResponse(rawResponseBytes);

  assert.throws(() =>
    consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle)
  );
  assert.throws(
    () => consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle),
    /already been consumed/
  );
});

test("KRX holiday ephemeral response consumes ownership on invalid target year", () => {
  const rawResponseBytes = semanticBytes();
  assert.throws(() =>
    createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
      rawResponseBytes,
      responseMetadata: verifiedMetadata(rawResponseBytes.byteLength),
      targetYear: "2027"
    })
  );
  assertZeroed(rawResponseBytes);
});

test("KRX holiday ephemeral response rejects JSON export and disposes", () => {
  const handle = createResponse(semanticBytes());
  assert.throws(
    () => JSON.stringify(handle),
    /cannot be serialized or exported/
  );
  assert.throws(
    () => consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle),
    /already been consumed/
  );
});

test("KRX holiday ephemeral response explicit disposal is idempotent", () => {
  const handle = createResponse(semanticBytes());
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle);
  disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle);
  assert.throws(
    () => consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(handle),
    /already been consumed/
  );
});

test("KRX holiday ephemeral response rejects forged handles", () => {
  for (const handle of [{}, Object.freeze(Object.create(null)), null, "handle"]) {
    assert.throws(() =>
      disposeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
        handle as OfficialMarketCalendarKrxHolidayDataEphemeralResponse
      )
    );
    assert.throws(() =>
      consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
        handle as OfficialMarketCalendarKrxHolidayDataEphemeralResponse
      )
    );
  }
});

test("KRX holiday ephemeral response rejects non-typed and detached inputs", () => {
  assert.throws(() =>
    createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
      rawResponseBytes: { length: 1 } as Uint8Array,
      responseMetadata: {},
      targetYear: "2026"
    })
  );

  const detached = semanticBytes();
  void structuredClone(detached, { transfer: [detached.buffer] });
  assert.throws(() =>
    createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
      rawResponseBytes: detached,
      responseMetadata: {},
      targetYear: "2026"
    })
  );
});

test("KRX holiday ephemeral response rejects shared backing memory", () => {
  const source = semanticBytes();
  const sharedBytes = new Uint8Array(new SharedArrayBuffer(source.byteLength));
  sharedBytes.set(source);

  assert.throws(
    () =>
      createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
        rawResponseBytes: sharedBytes,
        responseMetadata: verifiedMetadata(sharedBytes.byteLength),
        targetYear: "2026"
      }),
    /must not use shared backing memory/
  );
  assertZeroed(sharedBytes);
});

test("KRX holiday ephemeral response rejects oversized bytes before copying", () => {
  const rawResponseBytes = new Uint8Array(1_000_001).fill(1);
  let metadataRead = false;

  assert.throws(
    () =>
      createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
        rawResponseBytes,
        get responseMetadata() {
          metadataRead = true;
          return {};
        },
        targetYear: "2026"
      }),
    /exceed the local validation boundary/
  );
  assert.equal(metadataRead, false);
  assertZeroed(rawResponseBytes);
});

test("KRX holiday ephemeral response rejects forged metadata projections", () => {
  const rawResponseBytes = semanticBytes();
  const verified = verifiedMetadata(rawResponseBytes.byteLength);

  assert.throws(
    () =>
      createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
        rawResponseBytes,
        responseMetadata: { ...verified },
        targetYear: "2026"
      }),
    /must come from the process-local verifier/
  );
  assertZeroed(rawResponseBytes);
});

function createResponse(rawResponseBytes: Uint8Array) {
  return createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
    rawResponseBytes,
    responseMetadata: verifiedMetadata(rawResponseBytes.byteLength),
    targetYear: "2026"
  });
}

function semanticBytes(): Uint8Array {
  return encodeBody({
    block1: [
      {
        calnd_dd: "2026-01-01",
        dy_tp_cd: "THU",
        calnd_dd_dy: "2026-01-01",
        kr_dy_tp: "신정",
        holdy_eng_nm: "New Year's Day"
      },
      {
        calnd_dd: "2026-02-16",
        dy_tp_cd: "MON",
        calnd_dd_dy: "2026-02-16",
        kr_dy_tp: "설날",
        holdy_eng_nm: ""
      }
    ]
  });
}

function encodeBody(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

function assertZeroed(bytes: Uint8Array): void {
  assert.equal(bytes.every((byte) => byte === 0), true);
}

function verifiedMetadata(contentLength: number) {
  return verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata({
    requestIsolation: {
      automaticRedirectFollow: false,
      cookieJarEnabled: false,
      requestCookieHeaderCount: 0
    },
    responseUrl:
      "https://global.krx.co.kr/contents/GLB/99/GLB99000001.jspx",
    httpStatus: 200,
    redirectLocationHeaderValues: [],
    contentTypeHeaderValues: ["text/html; charset=UTF-8"],
    contentEncodingHeaderValues: [],
    transferEncodingHeaderValues: [],
    pragmaHeaderValues: ["no-cache"],
    setCookieHeaderCount: 2,
    responseCacheHeaders: {
      dateHeaderValues: ["Thu, 20 Aug 2026 05:33:51 GMT"],
      ageHeaderValues: [],
      expiresHeaderValues: ["Thu, 20 Aug 2026 05:33:51 GMT"]
    },
    responseCacheControl: {
      cacheControlHeaderValues: ["no-store, no-cache, max-age=0"]
    },
    transferCompletion: {
      httpProtocolVersion: "http_1_1",
      transferFraming: "content_length",
      transferCompleted: true,
      declaredContentLength: contentLength,
      contentLength
    }
  });
}
