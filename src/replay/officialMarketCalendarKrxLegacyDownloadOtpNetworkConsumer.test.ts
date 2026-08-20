import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters
} from "./officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.js";
import {
  createOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer,
  createTestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer,
  OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError,
  type TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector
} from "./officialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer.js";
import {
  KRX_HOLIDAY_DATA_TEST_CA,
  KRX_HOLIDAY_DATA_TEST_SERVER_OPTIONS
} from "./officialMarketCalendarKrxHolidayDataNetworkTestFixture.js";

const FILE_NAMES = [
  "E_Trading_Calendar2013.doc",
  "E_Trading_Calendar2014.doc",
  "E_Trading_Calendar2015.doc"
] as const;

test("KRX legacy OTP consumer binds each registered file to the exact GET", async () => {
  for (const fileName of FILE_NAMES) {
    await withOtpServer(
      (request, response) => {
        assert.equal(request.method, "GET");
        assert.equal(request.headers.host, "global.krx.co.kr");
        assert.equal(request.headers.connection, "close");
        assert.equal(request.headers.accept, "*/*");
        assert.equal(request.headers["cache-control"], "no-cache");
        assert.equal(request.headers.pragma, "no-cache");
        assert.equal(
          request.headers.referer,
          "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp"
        );
        assert.equal(request.headers["user-agent"], "Mozilla/5.0");
        assert.equal(request.headers.cookie, undefined);
        assert.equal(request.headers.authorization, undefined);
        assert.equal(request.headers["proxy-authorization"], undefined);
        assert.equal(
          request.url,
          "/contents/COM/GenerateOTP.jspx?name=fileDown&filetype=att&url=MKD%2F01%2F0110%2F01100303%2Fmkd01100303_DN&file_nm=" +
            fileName
        );
        sendValidResponse(response);
      },
      async (port) => {
        const otpHandle = await createTestConsumer(port).acquire(fileName);
        assert.equal(Object.isFrozen(otpHandle), true);
        assert.deepEqual(Object.keys(otpHandle), []);
        const parameters =
          consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(
            otpHandle
          );
        disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralParameters(
          parameters
        );
      }
    );
  }
});

test("KRX legacy OTP production consumer exposes no connector override", () => {
  const consumer =
    createOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer();
  assert.equal(Object.isFrozen(consumer), true);
  assert.deepEqual(Object.keys(consumer), ["acquire"]);
  assert.equal(
    createOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer.length,
    0
  );
});

test("KRX legacy OTP consumer rejects unregistered files before dialing", async () => {
  const consumer = createTestConsumer(1);
  for (const value of [
    "E_Trading_Calendar2012.doc",
    " E_Trading_Calendar2013.doc",
    2013,
    null,
    undefined
  ]) {
    await assert.rejects(
      () => consumer.acquire(value),
      (error: unknown) =>
        hasCode(error, "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INVALID_REQUEST")
    );
  }
});

test("KRX legacy OTP consumer rejects invalid test connectors", () => {
  const invalid: TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector[] = [
    {
      dialAddress: "192.0.2.1",
      dialPort: 443,
      certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 0,
      certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 443,
      certificateAuthority: ""
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 443,
      certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA,
      deadlineMs: 10_001
    }
  ];
  for (const connector of invalid) {
    assert.throws(
      () =>
        createTestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer(
          connector
        ),
      (error: unknown) =>
        hasCode(error, "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INVALID_CONFIG")
    );
  }
});

test("KRX legacy OTP consumer maps network failure without provider detail", async () => {
  await assert.rejects(
    () => createTestConsumer(1, { deadlineMs: 50 }).acquire(FILE_NAMES[0]),
    (error: unknown) =>
      hasCode(error, "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_FAILURE")
  );
});

test("KRX legacy OTP consumer enforces one absolute deadline", async () => {
  await withOtpServer(
    () => {
      // Leave the response pending beyond the test-only deadline.
    },
    async (port) => {
      await assert.rejects(
        () =>
          createTestConsumer(port, { deadlineMs: 20 }).acquire(FILE_NAMES[0]),
        (error: unknown) =>
          hasCode(
            error,
            "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_DEADLINE_EXCEEDED"
          )
      );
    }
  );
});

test("KRX legacy OTP consumer rejects response metadata drift", async () => {
  const cases: Array<(response: ServerResponse) => void> = [
    (response) => {
      response.writeHead(302, { Location: "https://example.invalid/" });
      response.end();
    },
    (response) => sendValidResponse(response, { "Content-Encoding": "identity" }),
    (response) => sendValidResponse(response, { "Content-Type": "text/plain" }),
    (response) => sendValidResponse(response, { "Set-Cookie": ["only-one=1"] }),
    (response) => sendValidResponse(response, { Age: "0" }),
    (response) =>
      sendValidResponse(response, { Expires: "Fri, 21 Aug 2026 00:00:00 GMT" })
  ];
  for (const sendResponse of cases) {
    await withOtpServer(
      (_request, response) => sendResponse(response),
      async (port) => {
        await assert.rejects(
          () => createTestConsumer(port).acquire(FILE_NAMES[0]),
          (error: unknown) =>
            hasCode(
              error,
              "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_RESPONSE_REJECTED"
            )
        );
      }
    );
  }
});

test("KRX legacy OTP consumer rejects noncanonical and incomplete bodies", async () => {
  await withOtpServer(
    (_request, response) => {
      sendValidResponse(response, {}, Buffer.alloc(300, 0x41));
    },
    async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).acquire(FILE_NAMES[0]),
        (error: unknown) =>
          hasCode(
            error,
            "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_RESPONSE_REJECTED"
          )
      );
    }
  );

  await withOtpServer(
    (_request, response) => {
      response.writeHead(200, validHeaders());
      response.end(Buffer.from(canonicalOtpBytes()).subarray(0, 299));
    },
    async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).acquire(FILE_NAMES[0]),
        (error: unknown) =>
          hasCode(
            error,
            "KRX_LEGACY_DOWNLOAD_OTP_NETWORK_INCOMPLETE_RESPONSE"
          )
      );
    }
  );
});

async function withOtpServer<T>(
  handler: (
    request: IncomingMessage,
    response: ServerResponse
  ) => void | Promise<void>,
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = createServer(KRX_HOLIDAY_DATA_TEST_SERVER_OPTIONS, handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
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
  overrides: Partial<TestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpSocketConnector> = {}
) {
  return createTestOnlyOfficialMarketCalendarKrxLegacyDownloadOtpNetworkConsumer(
    {
      dialAddress: "127.0.0.1",
      dialPort: port,
      certificateAuthority: KRX_HOLIDAY_DATA_TEST_CA,
      deadlineMs: 1_000,
      ...overrides
    }
  );
}

function canonicalOtpBytes(): Uint8Array {
  const decoded = Uint8Array.from(
    { length: 224 },
    (_, index) => (index * 73 + 19) % 256
  );
  return Uint8Array.from(
    Buffer.from(decoded).toString("base64"),
    (character) => character.charCodeAt(0)
  );
}

function validHeaders(): Record<string, string | string[]> {
  return {
    "Content-Length": "300",
    "Content-Type": "text/html;charset=UTF-8",
    "Cache-Control": "max-age=0, no-cache, no-store",
    Pragma: "no-cache",
    Date: "Thu, 20 Aug 2026 00:00:00 GMT",
    Expires: "Thu, 20 Aug 2026 00:00:00 GMT",
    "Set-Cookie": ["synthetic-a=1", "synthetic-b=2"]
  };
}

function sendValidResponse(
  response: ServerResponse,
  overrides: Record<string, string | string[]> = {},
  body: Uint8Array = canonicalOtpBytes()
): void {
  response.writeHead(200, { ...validHeaders(), ...overrides });
  response.end(body);
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarKrxLegacyDownloadOtpNetworkError &&
    error.code === code
  );
}
