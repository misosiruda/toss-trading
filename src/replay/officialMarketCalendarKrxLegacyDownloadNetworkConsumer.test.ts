import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument,
  consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody,
  createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer,
  createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody,
  createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer,
  disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse,
  disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody,
  OfficialMarketCalendarKrxLegacyDownloadNetworkError,
  type OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody,
  type TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector
} from "./officialMarketCalendarKrxLegacyDownloadOtpEphemeralBody.js";
import {
  KRX_LEGACY_DOWNLOAD_TEST_CA,
  KRX_LEGACY_DOWNLOAD_TEST_SERVER_OPTIONS
} from "./officialMarketCalendarKrxLegacyDownloadNetworkTestFixture.js";

const FILE_NAME = "E_Trading_Calendar2013.doc";
const FILE_LENGTH = 195_584;

test("KRX legacy download consumer sends the exact isolated encoded POST", async () => {
  await withDownloadServer(
    async (request, response) => {
      const requestBody = await readRequestBody(request);
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/download.jspx");
      assert.equal(request.headers.host, "file.krx.co.kr");
      assert.equal(request.headers.connection, "close");
      assert.equal(request.headers.accept, "*/*");
      assert.equal(request.headers["cache-control"], "no-cache");
      assert.equal(
        request.headers["content-type"],
        "application/x-www-form-urlencoded"
      );
      assert.equal(request.headers.origin, "https://global.krx.co.kr");
      assert.equal(request.headers.pragma, "no-cache");
      assert.equal(
        request.headers.referer,
        "https://global.krx.co.kr/contents/GLB/05/0501/0501060000/GLB0501060000T3.jsp"
      );
      assert.equal(request.headers["user-agent"], "Mozilla/5.0");
      assert.equal(
        request.headers["content-length"],
        String(requestBody.byteLength)
      );
      assert.equal(request.headers.cookie, undefined);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers["proxy-authorization"], undefined);
      assert.deepEqual(requestBody, expectedWireBody());
      sendValidResponse(response);
    },
    async (port) => {
      const wireBody = createWireBody();
      const responseHandle = await createTestConsumer(port).consume(wireBody);
      assert.equal(Object.isFrozen(responseHandle), true);
      assert.deepEqual(Object.keys(responseHandle), []);
      assert.throws(
        () => JSON.stringify(responseHandle),
        /cannot be serialized or exported/
      );
      disposeOfficialMarketCalendarKrxLegacyDownloadEphemeralResponse(
        responseHandle
      );
      await assert.rejects(
        () => createTestConsumer(port).consume(wireBody),
        /already been consumed/
      );
    }
  );
});

test("KRX legacy download encoder consumes parameters and keeps wire opaque", () => {
  const otpBytes = canonicalOtpBytes();
  const otpHandle =
    createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
      rawResponseBytes: otpBytes,
      requestedFileName: FILE_NAME
    });
  assert.equal(otpBytes.every((byte) => byte === 0), true);
  const parameters =
    consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(otpHandle);
  const wireBody =
    consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody(
      parameters
    );

  assert.equal(Object.isFrozen(wireBody), true);
  assert.deepEqual(Object.keys(wireBody), []);
  assert.throws(
    () =>
      consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody(
        parameters
      ),
    /already been consumed/
  );
  disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody(
    wireBody
  );
  disposeOfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody(
    wireBody
  );
});

test("KRX legacy download production consumer exposes no connector override", () => {
  const consumer =
    createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer();
  assert.equal(Object.isFrozen(consumer), true);
  assert.deepEqual(Object.keys(consumer), ["consume"]);
  assert.equal(
    createOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer.length,
    0
  );
});

test("KRX legacy download consumer rejects invalid test connectors", () => {
  const invalidConnectors: TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector[] = [
    {
      dialAddress: "192.0.2.1",
      dialPort: 443,
      certificateAuthority: KRX_LEGACY_DOWNLOAD_TEST_CA
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 0,
      certificateAuthority: KRX_LEGACY_DOWNLOAD_TEST_CA
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 443,
      certificateAuthority: ""
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 443,
      certificateAuthority: KRX_LEGACY_DOWNLOAD_TEST_CA,
      deadlineMs: 10_001
    }
  ];
  for (const connector of invalidConnectors) {
    assert.throws(
      () =>
        createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(
          connector
        ),
      (error: unknown) =>
        hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_INVALID_CONFIG")
    );
  }
  assert.throws(
    () =>
      createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer(
        Object.defineProperty({}, "dialAddress", {
          get() {
            throw new Error("synthetic getter failure");
          }
        }) as TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector
      ),
    (error: unknown) =>
      hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_INVALID_CONFIG")
  );
});

test("KRX legacy download consumer rejects forged handles", async () => {
  const consumer = createTestConsumer(443);
  for (const handle of [{}, Object.freeze(Object.create(null)), null, "x"]) {
    await assert.rejects(() =>
      consumer.consume(
        handle as OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody
      )
    );
  }
});

test("KRX legacy download consumer consumes wire ownership on failure", async () => {
  const wireBody = createWireBody();
  const consumer = createTestConsumer(1, { deadlineMs: 50 });
  await assert.rejects(
    () => consumer.consume(wireBody),
    (error: unknown) =>
      hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_FAILURE")
  );
  await assert.rejects(
    () => consumer.consume(wireBody),
    /already been consumed/
  );
});

test("KRX legacy download consumer enforces one absolute deadline", async () => {
  await withDownloadServer(
    () => {
      // Keep the response pending beyond the test-only deadline.
    },
    async (port) => {
      await assert.rejects(
        () =>
          createTestConsumer(port, { deadlineMs: 20 }).consume(
            createWireBody()
          ),
        (error: unknown) =>
          hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_DEADLINE_EXCEEDED")
      );
    }
  );
});

test("KRX legacy download consumer rejects status and representation drift", async () => {
  const cases: Array<(response: ServerResponse) => void> = [
    (response) => {
      response.writeHead(302, { Location: "https://example.invalid/" });
      response.end();
    },
    (response) =>
      sendValidResponse(response, { "Content-Encoding": "identity" }),
    (response) =>
      sendValidResponse(response, {
        "Content-Disposition":
          "attachment; filename=E_Trading_Calendar2014.doc"
      }),
    (response) => sendValidResponse(response, { "Set-Cookie": "x=1" }),
    (response) =>
      sendValidResponse(response, { Expires: "Fri, 21 Aug 2026 00:00:00 GMT" })
  ];
  for (const sendResponse of cases) {
    await withDownloadServer(
      (_request, response) => sendResponse(response),
      async (port) => {
        await assert.rejects(
          () => createTestConsumer(port).consume(createWireBody()),
          (error: unknown) =>
            hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_REJECTED")
        );
      }
    );
  }
});

test("KRX legacy download consumer rejects trailers and oversized declarations", async () => {
  await withDownloadServer(
    (_request, response) => {
      const headers = validHeaders();
      delete headers["Content-Length"];
      response.writeHead(200, { ...headers, Trailer: "Digest" });
      response.addTrailers({ Digest: "synthetic" });
      response.end(Buffer.alloc(FILE_LENGTH));
    },
    async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).consume(createWireBody()),
        (error: unknown) =>
          hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_REJECTED")
      );
    }
  );

  await withDownloadServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Length": "252929",
        "Content-Type": "application/octet-stream"
      });
      response.end();
    },
    async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).consume(createWireBody()),
        (error: unknown) =>
          hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_RESPONSE_TOO_LARGE")
      );
    }
  );
});

test("KRX legacy download consumer rejects incomplete bodies", async () => {
  await withDownloadServer(
    (_request, response) => {
      response.writeHead(200, validHeaders());
      response.end(Buffer.alloc(FILE_LENGTH - 1));
    },
    async (port) => {
      await assert.rejects(
        () => createTestConsumer(port).consume(createWireBody()),
        (error: unknown) =>
          hasCode(error, "KRX_LEGACY_DOWNLOAD_NETWORK_INCOMPLETE_RESPONSE")
      );
    }
  );
});

async function withDownloadServer<T>(
  handler: (
    request: IncomingMessage,
    response: ServerResponse
  ) => void | Promise<void>,
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = createServer(
    KRX_LEGACY_DOWNLOAD_TEST_SERVER_OPTIONS,
    handler
  );
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
  overrides: Partial<TestOnlyOfficialMarketCalendarKrxLegacyDownloadSocketConnector> = {}
) {
  return createTestOnlyOfficialMarketCalendarKrxLegacyDownloadNetworkConsumer({
    dialAddress: "127.0.0.1",
    dialPort: port,
    certificateAuthority: KRX_LEGACY_DOWNLOAD_TEST_CA,
    deadlineMs: 1_000,
    ...overrides
  });
}

function createWireBody(): OfficialMarketCalendarKrxLegacyDownloadPostEphemeralWireBody {
  const otpHandle =
    createOfficialMarketCalendarKrxLegacyDownloadOtpEphemeralBody({
      rawResponseBytes: canonicalOtpBytes(),
      requestedFileName: FILE_NAME
    });
  const parameters =
    consumeOfficialMarketCalendarKrxLegacyDownloadOtpForDocument(otpHandle);
  return consumeOfficialMarketCalendarKrxLegacyDownloadParametersToWireBody(
    parameters
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

function expectedWireBody(): Buffer {
  const otp = Buffer.from(canonicalOtpBytes()).toString("ascii");
  return Buffer.from(`code=${encodeURIComponent(otp)}`, "ascii");
}

function validHeaders(): Record<string, string> {
  return {
    "Content-Length": String(FILE_LENGTH),
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename=${FILE_NAME}`,
    "Cache-Control": "max-age=0, no-cache, no-store",
    Pragma: "no-cache",
    Date: "Thu, 20 Aug 2026 00:00:00 GMT",
    Expires: "Thu, 20 Aug 2026 00:00:00 GMT"
  };
}

function sendValidResponse(
  response: ServerResponse,
  overrides: Record<string, string | string[]> = {}
): void {
  response.writeHead(200, { ...validHeaders(), ...overrides });
  response.end(Buffer.alloc(FILE_LENGTH));
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
  code: OfficialMarketCalendarKrxLegacyDownloadNetworkError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarKrxLegacyDownloadNetworkError &&
    error.code === code
  );
}
