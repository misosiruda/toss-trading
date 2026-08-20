import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody,
  consumeOfficialMarketCalendarKrxOtpForHolidayDataPost,
  createOfficialMarketCalendarKrxHolidayDataNetworkConsumer,
  createOfficialMarketCalendarKrxOtpEphemeralBody,
  createTestOnlyOfficialMarketCalendarKrxHolidayDataNetworkConsumer,
  OfficialMarketCalendarKrxHolidayDataNetworkError,
  type OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody,
  type TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector
} from "./officialMarketCalendarKrxOtpEphemeralBody.js";
import { consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse } from "./officialMarketCalendarKrxHolidayDataEphemeralResponse.js";
import {
  KRX_HOLIDAY_DATA_TEST_CA,
  KRX_HOLIDAY_DATA_TEST_SERVER_OPTIONS
} from "./officialMarketCalendarKrxHolidayDataNetworkTestFixture.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy
} from "./officialMarketCalendarKrxHolidayDataPostPolicy.js";

test("KRX fixed network consumer sends the exact isolated POST and returns an opaque response", async () => {
  await withHolidayDataServer(async (request, response) => {
    const requestBody = await readRequestBody(request);
    assert.equal(request.method, "POST");
    assert.equal(
      request.url,
      "/contents/GLB/99/GLB99000001.jspx"
    );
    assert.equal(request.headers.host, "global.krx.co.kr");
    assert.equal(request.headers.connection, "close");
    assert.equal(request.headers.accept, "*/*");
    assert.equal(request.headers["cache-control"], "no-cache");
    assert.equal(
      request.headers["content-type"],
      "application/x-www-form-urlencoded; charset=UTF-8"
    );
    assert.equal(request.headers.pragma, "no-cache");
    assert.equal(request.headers["content-length"], String(requestBody.byteLength));
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["proxy-authorization"], undefined);
    assert.deepEqual(requestBody, expectedWireBody("2026"));
    sendValidResponse(response, semanticBody("2026"));
  }, async (port) => {
    const wireBody = createWireBody("2026");
    const responseHandle = await createTestConsumer(port).consume(wireBody);
    assert.equal(Object.isFrozen(responseHandle), true);
    assert.deepEqual(Object.keys(responseHandle), []);
    const summary =
      consumeOfficialMarketCalendarKrxHolidayDataEphemeralResponse(
        responseHandle
      );
    assert.equal(summary.targetYear, "2026");
    assert.equal(summary.rowCount, 2);
    assert.equal(summary.returnedRowValues, false);
    assert.equal(summary.durableEvidenceReusable, false);
    assert.equal(summary.acceptedAcquisition, false);
    await assert.rejects(() => createTestConsumer(port).consume(wireBody),
      /already been consumed/);
  });
});

test("KRX production consumer exposes no connector override surface", () => {
  const consumer = createOfficialMarketCalendarKrxHolidayDataNetworkConsumer();
  assert.equal(Object.isFrozen(consumer), true);
  assert.deepEqual(Object.keys(consumer), ["consume"]);
});

test("KRX fixed network consumer rejects invalid test-only connectors", () => {
  const invalidConnectors: TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector[] = [
    { dialAddress: "192.0.2.1", dialPort: 443, certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA },
    { dialAddress: "127.0.0.1", dialPort: 0, certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA },
    { dialAddress: "127.0.0.1", dialPort: 443, certificateAuthority: "" },
    { dialAddress: "127.0.0.1", dialPort: 443, certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA, deadlineMs: 10_001 }
  ];
  for (const connector of invalidConnectors) {
    assert.throws(
      () => createTestOnlyOfficialMarketCalendarKrxHolidayDataNetworkConsumer(connector),
      (error: unknown) => hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_INVALID_CONFIG")
    );
  }
});

test("KRX fixed network consumer rejects forged handles", async () => {
  const consumer = createTestConsumer(443);
  for (const handle of [{}, Object.freeze(Object.create(null)), null, "handle"]) {
    await assert.rejects(() =>
      consumer.consume(
        handle as OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody
      )
    );
  }
});

test("KRX fixed network consumer consumes the wire handle on network failure", async () => {
  const wireBody = createWireBody("2025");
  const consumer = createTestConsumer(1, { deadlineMs: 50 });
  await assert.rejects(
    () => consumer.consume(wireBody),
    (error: unknown) => hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_FAILURE")
  );
  await assert.rejects(() => consumer.consume(wireBody), /already been consumed/);
});

test("KRX fixed network consumer enforces one absolute deadline", async () => {
  await withHolidayDataServer(() => {
    // Intentionally leave the response pending past the test-only deadline.
  }, async (port) => {
    const consumer = createTestConsumer(port, { deadlineMs: 20 });
    await assert.rejects(
      () => consumer.consume(createWireBody("2024")),
      (error: unknown) =>
        hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_DEADLINE_EXCEEDED")
    );
  });
});

test("KRX fixed network consumer rejects status, redirect and encoded responses", async () => {
  const cases: Array<(response: ServerResponse) => void> = [
    (response) => {
      response.writeHead(302, { Location: "https://example.invalid/" });
      response.end();
    },
    (response) => {
      sendValidResponse(response, semanticBody("2026"), {
        "Content-Encoding": "gzip"
      });
    },
    (response) => {
      response.writeHead(200, {
        "Content-Type": "text/html;charset=UTF-8",
        Trailer: "Digest"
      });
      response.end(semanticBody("2026"));
    }
  ];
  for (const sendResponse of cases) {
    await withHolidayDataServer((_request, response) => sendResponse(response), async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).consume(createWireBody("2026")),
        (error: unknown) => hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_REJECTED")
      );
    });
  }
});

test("KRX fixed network consumer rejects oversized and incomplete bodies before acceptance", async () => {
  await withHolidayDataServer((_request, response) => {
    response.writeHead(200, {
      "Content-Length": "1000001",
      "Content-Type": "text/html;charset=UTF-8"
    });
    response.end();
  }, async (port) => {
    await assert.rejects(
      () => createTestConsumer(port).consume(createWireBody("2026")),
      (error: unknown) => hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_TOO_LARGE")
    );
  });

  await withHolidayDataServer((_request, response) => {
    const body = semanticBody("2026");
    sendValidResponse(response, body, {
      "Content-Length": String(body.byteLength + 5)
    });
  }, async (port) => {
    await assert.rejects(
      () => createTestConsumer(port).consume(createWireBody("2026")),
      (error: unknown) => hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_INCOMPLETE_RESPONSE")
    );
  });
});

test("KRX fixed network consumer rejects invalid body semantics and non-observed metadata", async () => {
  const cases: Array<(response: ServerResponse) => void> = [
    (response) => sendValidResponse(response, new TextEncoder().encode("not-json")),
    (response) => sendValidResponse(response, semanticBody("2026"), { "Set-Cookie": [] })
  ];
  for (const sendResponse of cases) {
    await withHolidayDataServer((_request, response) => sendResponse(response), async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).consume(createWireBody("2026")),
        (error: unknown) => hasCode(error, "KRX_HOLIDAY_DATA_NETWORK_RESPONSE_REJECTED")
      );
    });
  }
});

async function withHolidayDataServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = createServer(KRX_HOLIDAY_DATA_TEST_SERVER_OPTIONS, handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    return await run(address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function createTestConsumer(
  port: number,
  overrides: Partial<TestOnlyOfficialMarketCalendarKrxHolidayDataSocketConnector> = {}
) {
  return createTestOnlyOfficialMarketCalendarKrxHolidayDataNetworkConsumer({
    dialAddress: "127.0.0.1",
    dialPort: port,
    certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA,
    deadlineMs: 1_000,
    ...overrides
  });
}

function createWireBody(
  targetYear: "2026" | "2025" | "2024"
): OfficialMarketCalendarKrxHolidayDataPostEphemeralWireBody {
  const otpHandle = createOfficialMarketCalendarKrxOtpEphemeralBody({
    rawResponseBytes: canonicalOtpBytes()
  });
  const parameters = consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(
    otpHandle,
    targetYear
  );
  return consumeOfficialMarketCalendarKrxHolidayDataPostParametersToWireBody(
    parameters
  );
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

function expectedWireBody(targetYear: "2026"): Buffer {
  const postPolicy =
    resolveRegisteredOfficialMarketCalendarKrxHolidayDataPostPolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_HOLIDAY_DATA_POST_POLICY_VERSION
    );
  const otp = Buffer.from(canonicalOtpBytes()).toString("ascii");
  return Buffer.from(
    `search_bas_yy=${targetYear}&gridTp=KRX&pagePath=${encodeURIComponent(postPolicy.fixedRequestParameters.pagePath)}&code=${encodeURIComponent(otp)}`,
    "ascii"
  );
}

function semanticBody(targetYear: "2026"): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    block1: [
      {
        calnd_dd: `${targetYear}-01-01`,
        dy_tp_cd: "THU",
        calnd_dd_dy: `${targetYear}-01-01`,
        kr_dy_tp: "신정",
        holdy_eng_nm: "New Year's Day"
      },
      {
        calnd_dd: `${targetYear}-02-16`,
        dy_tp_cd: "MON",
        calnd_dd_dy: `${targetYear}-02-16`,
        kr_dy_tp: "설날",
        holdy_eng_nm: ""
      }
    ]
  }));
}

function sendValidResponse(
  response: ServerResponse,
  body: Uint8Array,
  overrides: Record<string, string | string[]> = {}
): void {
  response.writeHead(200, {
    "Content-Length": String(body.byteLength),
    "Content-Type": "text/html;charset=UTF-8",
    "Cache-Control": "no-store, no-cache, max-age=0",
    Pragma: "no-cache",
    Date: "Thu, 20 Aug 2026 05:33:51 GMT",
    Expires: "Thu, 20 Aug 2026 05:33:51 GMT",
    "Set-Cookie": ["synthetic-a=1", "synthetic-b=2"],
    ...overrides
  });
  response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarKrxHolidayDataNetworkError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarKrxHolidayDataNetworkError &&
    error.code === code
  );
}
