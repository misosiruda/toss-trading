import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  createOfficialMarketCalendarKrxAcquisitionCoordinator,
  createTestOnlyOfficialMarketCalendarKrxAcquisitionCoordinator,
  OfficialMarketCalendarKrxAcquisitionError,
  type TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies
} from "./officialMarketCalendarKrxAcquisitionCoordinator.js";
import {
  createOfficialMarketCalendarKrxHolidayDataNetworkConsumer,
  createOfficialMarketCalendarKrxOtpEphemeralBody,
  type OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
} from "./officialMarketCalendarKrxOtpEphemeralBody.js";
import { createOfficialMarketCalendarKrxHolidayDataEphemeralResponse } from "./officialMarketCalendarKrxHolidayDataEphemeralResponse.js";
import { verifyOfficialMarketCalendarKrxHolidayDataResponseMetadata } from "./officialMarketCalendarKrxHolidayDataResponseMetadata.js";

test("KRX acquisition coordinator composes one-shot stages into a summary-only result", async () => {
  let otpAcquireCount = 0;
  let holidayDataConsumeCount = 0;
  const coordinator = createTestOnlyOfficialMarketCalendarKrxAcquisitionCoordinator({
    otpConsumer: {
      async acquire() {
        otpAcquireCount += 1;
        return createOfficialMarketCalendarKrxOtpEphemeralBody({
          rawResponseBytes: canonicalOtpBytes()
        });
      }
    },
    holidayDataConsumer: {
      async consume(_handle) {
        holidayDataConsumeCount += 1;
        return createResponse("2026");
      }
    }
  });

  const summary = await coordinator.acquire({ targetYear: "2026" });

  assert.equal(otpAcquireCount, 1);
  assert.equal(holidayDataConsumeCount, 1);
  assert.equal(summary.targetYear, "2026");
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.returnedRowValues, false);
  assert.equal(summary.historicalCompletenessClaim, "not_claimed");
  assert.equal(summary.durableEvidenceReusable, false);
  assert.equal(summary.acceptedAcquisition, false);
  assert.equal(Object.isFrozen(summary), true);
});

test("KRX production coordinator exposes no dependency override surface", () => {
  const coordinator = createOfficialMarketCalendarKrxAcquisitionCoordinator();
  assert.equal(Object.isFrozen(coordinator), true);
  assert.deepEqual(Object.keys(coordinator), ["acquire"]);
});

test("KRX acquisition coordinator rejects invalid requests before OTP I/O", async () => {
  let otpAcquireCount = 0;
  const coordinator = createTestCoordinator({
    otpConsumer: {
      async acquire() {
        otpAcquireCount += 1;
        return createOfficialMarketCalendarKrxOtpEphemeralBody({
          rawResponseBytes: canonicalOtpBytes()
        });
      }
    }
  });
  const invalidRequests = [
    null,
    "2026",
    {},
    { targetYear: "2027" },
    { targetYear: "2026", extra: true }
  ];

  for (const request of invalidRequests) {
    await assert.rejects(
      () => coordinator.acquire(request as { targetYear: "2026" }),
      (error: unknown) => hasCode(error, "KRX_ACQUISITION_INVALID_REQUEST")
    );
  }
  assert.equal(otpAcquireCount, 0);
});

test("KRX acquisition coordinator snapshots and validates test-only dependencies", async () => {
  const dependencies = createDependencies();
  const coordinator =
    createTestOnlyOfficialMarketCalendarKrxAcquisitionCoordinator(dependencies);
  dependencies.otpConsumer.acquire = async () => {
    throw new Error("mutated");
  };
  dependencies.holidayDataConsumer.consume = async () => {
    throw new Error("mutated");
  };

  const summary = await coordinator.acquire({ targetYear: "2026" });
  assert.equal(summary.rowCount, 2);

  for (const invalid of [null, {}, { otpConsumer: {}, holidayDataConsumer: {} }]) {
    assert.throws(
      () =>
        createTestOnlyOfficialMarketCalendarKrxAcquisitionCoordinator(
          invalid as TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies
        ),
      (error: unknown) => hasCode(error, "KRX_ACQUISITION_INVALID_CONFIG")
    );
  }
});

test("KRX acquisition coordinator maps OTP and holiday data failures without leaking causes", async () => {
  const otpFailure = createTestCoordinator({
    otpConsumer: {
      async acquire() {
        throw new Error("synthetic raw OTP detail");
      }
    }
  });
  await assert.rejects(
    () => otpFailure.acquire({ targetYear: "2026" }),
    (error: unknown) =>
      hasCode(error, "KRX_ACQUISITION_OTP_REJECTED") &&
      !String(error).includes("synthetic raw OTP detail")
  );

  let capturedWireBody:
    | OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
    | undefined;
  const dataFailure = createTestCoordinator({
    holidayDataConsumer: {
      async consume(handle) {
        capturedWireBody = handle;
        throw new Error("synthetic response detail");
      }
    }
  });
  await assert.rejects(
    () => dataFailure.acquire({ targetYear: "2026" }),
    (error: unknown) =>
      hasCode(error, "KRX_ACQUISITION_HOLIDAY_DATA_REJECTED") &&
      !String(error).includes("synthetic response detail")
  );
  assert.ok(capturedWireBody);
  await assert.rejects(
    () =>
      createOfficialMarketCalendarKrxHolidayDataNetworkConsumer().consume(
        capturedWireBody!
      ),
    /already been consumed/
  );
});

test("KRX acquisition coordinator maps semantic rejection and disposes response ownership", async () => {
  const coordinator = createTestCoordinator({
    holidayDataConsumer: {
      async consume() {
        return createResponse("2025");
      }
    }
  });

  await assert.rejects(
    () => coordinator.acquire({ targetYear: "2026" }),
    (error: unknown) => hasCode(error, "KRX_ACQUISITION_SEMANTICS_REJECTED")
  );
});

function createTestCoordinator(
  overrides: Partial<TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies>
) {
  return createTestOnlyOfficialMarketCalendarKrxAcquisitionCoordinator({
    ...createDependencies(),
    ...overrides
  });
}

function createDependencies(): TestOnlyOfficialMarketCalendarKrxAcquisitionDependencies {
  return {
    otpConsumer: {
      async acquire() {
        return createOfficialMarketCalendarKrxOtpEphemeralBody({
          rawResponseBytes: canonicalOtpBytes()
        });
      }
    },
    holidayDataConsumer: {
      async consume(_handle) {
        return createResponse("2026");
      }
    }
  };
}

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 160 },
    (_, index) => (index * 19 + 7) % 256
  );
  return Uint8Array.from(Buffer.from(decoded).toString("base64"), (character) =>
    character.charCodeAt(0)
  );
}

function createResponse(targetYear: "2026" | "2025") {
  const rawResponseBytes = semanticBytes(targetYear);
  return createOfficialMarketCalendarKrxHolidayDataEphemeralResponse({
    rawResponseBytes,
    responseMetadata: verifiedMetadata(rawResponseBytes.byteLength),
    targetYear
  });
}

function semanticBytes(targetYear: "2026" | "2025"): Uint8Array {
  const weekdays =
    targetYear === "2026"
      ? (["THU", "MON"] as const)
      : (["WED", "SUN"] as const);
  return new TextEncoder().encode(
    JSON.stringify({
      block1: [
        {
          calnd_dd: `${targetYear}-01-01`,
          dy_tp_cd: weekdays[0],
          calnd_dd_dy: `${targetYear}-01-01`,
          kr_dy_tp: "신정",
          holdy_eng_nm: "New Year's Day"
        },
        {
          calnd_dd: `${targetYear}-02-16`,
          dy_tp_cd: weekdays[1],
          calnd_dd_dy: `${targetYear}-02-16`,
          kr_dy_tp: "설날",
          holdy_eng_nm: ""
        }
      ]
    })
  );
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

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarKrxAcquisitionError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarKrxAcquisitionError &&
    error.code === code
  );
}
