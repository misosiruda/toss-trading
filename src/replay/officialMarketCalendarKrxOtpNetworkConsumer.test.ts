import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  consumeOfficialMarketCalendarKrxOtpForHolidayDataPost,
  disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters
} from "./officialMarketCalendarKrxOtpEphemeralBody.js";
import {
  createOfficialMarketCalendarKrxOtpNetworkConsumer,
  createTestOnlyOfficialMarketCalendarKrxOtpNetworkConsumer,
  OfficialMarketCalendarKrxOtpNetworkError,
  type TestOnlyOfficialMarketCalendarKrxOtpSocketConnector
} from "./officialMarketCalendarKrxOtpNetworkConsumer.js";
import {
  KRX_HOLIDAY_DATA_TEST_CA,
  KRX_HOLIDAY_DATA_TEST_SERVER_OPTIONS
} from "./officialMarketCalendarKrxHolidayDataNetworkTestFixture.js";

test("KRX OTP network consumer sends the exact isolated GET and returns an opaque handle", async () => {
  await withServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(
      request.url,
      "/contents/COM/GenerateOTP.jspx?bld=GLB%2F05%2F0501%2F0501110000%2Fglb0501110000_01&name=form"
    );
    assert.equal(request.headers.host, "global.krx.co.kr");
    assert.equal(request.headers.connection, "close");
    assert.equal(request.headers.accept, "*/*");
    assert.equal(request.headers["cache-control"], "no-cache");
    assert.equal(request.headers.pragma, "no-cache");
    assert.equal(request.headers["user-agent"], "Mozilla/5.0");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["proxy-authorization"], undefined);
    sendValidResponse(response, canonicalOtpBytes());
  }, async (port) => {
    const handle = await createConsumer(port).acquire();
    assert.equal(Object.isFrozen(handle), true);
    assert.deepEqual(Object.keys(handle), []);
    const parameters =
      consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(handle, "2026");
    disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(
      parameters
    );
  });
});

test("KRX OTP production consumer exposes no connector override", () => {
  const consumer = createOfficialMarketCalendarKrxOtpNetworkConsumer();
  assert.equal(Object.isFrozen(consumer), true);
  assert.deepEqual(Object.keys(consumer), ["acquire"]);
});

test("KRX OTP test connector is loopback-only and snapshots fields", async () => {
  const invalid: TestOnlyOfficialMarketCalendarKrxOtpSocketConnector[] = [
    { dialAddress: "192.0.2.1", dialPort: 443, certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA },
    { dialAddress: "127.0.0.1", dialPort: 0, certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA },
    { dialAddress: "127.0.0.1", dialPort: 443, certificateAuthority: "" },
    { dialAddress: "127.0.0.1", dialPort: 443, certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA, deadlineMs: 10_001 }
  ];
  for (const connector of invalid) {
    assert.throws(
      () => createTestOnlyOfficialMarketCalendarKrxOtpNetworkConsumer(connector),
      (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_INVALID_CONFIG")
    );
  }

  await withServer((_request, response) => {
    sendValidResponse(response, canonicalOtpBytes());
  }, async (port) => {
    const connector = {
      dialAddress: "127.0.0.1",
      dialPort: port,
      certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA,
      deadlineMs: 1_000
    };
    const consumer =
      createTestOnlyOfficialMarketCalendarKrxOtpNetworkConsumer(connector);
    connector.dialAddress = "192.0.2.1";
    connector.dialPort = 1;
    connector.certificateAuthority = "invalid";
    const handle = await consumer.acquire();
    const parameters =
      consumeOfficialMarketCalendarKrxOtpForHolidayDataPost(handle, "2026");
    disposeOfficialMarketCalendarKrxHolidayDataPostEphemeralParameters(parameters);
  });
});

test("KRX OTP consumer maps network failure and enforces one deadline", async () => {
  await assert.rejects(
    () => createConsumer(1, { deadlineMs: 50 }).acquire(),
    (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_FAILURE")
  );
  await withServer(() => {
    // Keep the response pending past the shorter test-only deadline.
  }, async (port) => {
    await assert.rejects(
      () => createConsumer(port, { deadlineMs: 20 }).acquire(),
      (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_DEADLINE_EXCEEDED")
    );
  });
});

test("KRX OTP consumer rejects status, representation and cookie-boundary drift", async () => {
  const cases: Array<(response: ServerResponse) => void> = [
    (response) => {
      response.writeHead(302, { Location: "https://example.invalid/" });
      response.end();
    },
    (response) => sendValidResponse(response, canonicalOtpBytes(), { "Content-Encoding": "gzip" }),
    (response) => sendValidResponse(response, canonicalOtpBytes(), { "Content-Type": "text/plain" }),
    (response) => sendValidResponse(response, canonicalOtpBytes(), { "Set-Cookie": [] }),
    (response) => sendValidResponse(response, canonicalOtpBytes(), { Age: "1" }),
    (response) => sendValidResponse(response, canonicalOtpBytes(), {
      Date: "not-a-date",
      Expires: "not-a-date"
    })
  ];
  for (const send of cases) {
    await withServer((_request, response) => send(response), async (port) => {
      await assert.rejects(
        () => createConsumer(port).acquire(),
        (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_RESPONSE_REJECTED")
      );
    });
  }
});

test("KRX OTP consumer rejects incomplete and invalid OTP bodies", async () => {
  await withServer((_request, response) => {
    sendValidResponse(response, canonicalOtpBytes().subarray(0, 210));
  }, async (port) => {
    await assert.rejects(
      () => createConsumer(port).acquire(),
      (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_RESPONSE_REJECTED")
    );
  });

  await withServer((_request, response) => {
    const bytes = canonicalOtpBytes();
    response.writeHead(200, validHeaders(216));
    response.end(bytes.subarray(0, 210));
  }, async (port) => {
    await assert.rejects(
      () => createConsumer(port).acquire(),
      (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_INCOMPLETE_RESPONSE")
    );
  });

  await withServer((_request, response) => {
    const bytes = canonicalOtpBytes();
    bytes[20] = 0x20;
    sendValidResponse(response, bytes);
  }, async (port) => {
    await assert.rejects(
      () => createConsumer(port).acquire(),
      (error: unknown) => hasCode(error, "KRX_OTP_NETWORK_RESPONSE_REJECTED")
    );
  });
});

async function withServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
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

function createConsumer(
  port: number,
  overrides: Partial<TestOnlyOfficialMarketCalendarKrxOtpSocketConnector> = {}
) {
  return createTestOnlyOfficialMarketCalendarKrxOtpNetworkConsumer({
    dialAddress: "127.0.0.1",
    dialPort: port,
    certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA,
    deadlineMs: 1_000,
    ...overrides
  });
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

function validHeaders(contentLength: number): Record<string, string | string[]> {
  return {
    "Content-Length": String(contentLength),
    "Content-Type": "text/html;charset=UTF-8",
    "Cache-Control": "max-age=0, no-cache, no-store",
    Pragma: "no-cache",
    Date: "Thu, 20 Aug 2026 08:14:59 GMT",
    Expires: "Thu, 20 Aug 2026 08:14:59 GMT",
    "Set-Cookie": ["synthetic-a=1", "synthetic-b=2"]
  };
}

function sendValidResponse(
  response: ServerResponse,
  body: Uint8Array,
  overrides: Record<string, string | string[]> = {}
): void {
  response.writeHead(200, { ...validHeaders(body.byteLength), ...overrides });
  response.end(body);
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarKrxOtpNetworkError["code"]
): boolean {
  return error instanceof OfficialMarketCalendarKrxOtpNetworkError && error.code === code;
}
