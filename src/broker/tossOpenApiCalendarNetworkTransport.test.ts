import assert from "node:assert/strict";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { TLSSocket } from "node:tls";

import { readTossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";
import type { TossOpenApiBearerTokenProvider } from "./tossOpenApiReadOnlyHttpClient.js";
import {
  createTestOnlyTossOpenApiCalendarNetworkTransport,
  createTossOpenApiCalendarNetworkTransport,
  TOSS_OPEN_API_CALENDAR_RESPONSE_MAX_BYTES,
  TossOpenApiCalendarNetworkError,
  type TestOnlyTossOpenApiCalendarSocketConnector
} from "./tossOpenApiCalendarNetworkTransport.js";

// Public, synthetic test-only TLS material. It is not a broker credential.
const TEST_CA_DER =
  "MIIDCTCCAfGgAwIBAgIBATANBgkqhkiG9w0BAQsFADA0MTIwMAYDVQQDDCl0b3NzLXRyYWRpbmcgdGVzdC1vbmx5IHRva2VuIHRyYW5zcG9ydCBDQTAeFw0yNTAxMDEwMDAwMDBaFw00NTAxMDEwMDAwMDBaMDQxMjAwBgNVBAMMKXRvc3MtdHJhZGluZyB0ZXN0LW9ubHkgdG9rZW4gdHJhbnNwb3J0IENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzzPxvTaQKMvit6zYffXPSIaVNMNyhzqTQTfsGfySH3fRxWHPwtU8lpAJxunabkOY87favmgVA/7jx3J1moMdB3t+4An/45XMYYM+vQN8Hkn0iE+zSR18Yn8WIdlTwkSXMenfT5AsDhcOF9R7TNUczf1h3gpKFPCW6mg9qP/vS3AI/eHsHfJJ4WiGce3A4BinGO1d+5eQyJT15q5LacfPIdHUFTUG3d8JNcvbUaXZRgh1ehsEalthtTnR674QJsI0h2SaXa2DFoeKbwnjNt+BTQvMhuiSezjuChfMR2p/WbynaRthbnBsUYPwhYKIFPsSnP72zlWCPo3nkZA06U2aCwIDAQABoyYwJDASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsFAAOCAQEAZMnmV0hWlIKmJ0JPGHpmJ48A3/f4rN2UszwkeAPH/GATb+/AafIGm13xxNG1qOOSAvdzdMLKUdByn2QahWF/uHwja6dZ5qu1l3XucVh6OYR4lNScmpFlEA0NJ0GKoynUlOPwpCxIGUV8PpOOkS0u01v2u0FYGFGwccwzHd9RJxWEeT5Rfjm5UiwNyXWe9eBcTKSw6HPY2/5GU5GfDATYZYeOvm/J9QkbzUjGQH3pf8AMM1/PC7Rp/niVcobHROmIqEYX7h4G2/wU9LNhrCkHbtHmqwb3icUtmWZTDN5Q1t6EYQfdSoYb75VRW8RxS45Jb1AJgFhtq0XtQYIQ1Fmqlg==";
const TEST_SERVER_CERT_DER =
  "MIIDKDCCAhCgAwIBAgIBAjANBgkqhkiG9w0BAQsFADA0MTIwMAYDVQQDDCl0b3NzLXRyYWRpbmcgdGVzdC1vbmx5IHRva2VuIHRyYW5zcG9ydCBDQTAeFw0yNTAxMDEwMDAwMDBaFw00NTAxMDEwMDAwMDBaMCExHzAdBgNVBAMMFm9wZW5hcGkudG9zc2ludmVzdC5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDSmd864/mGyrxqbuFziIQf0RDysJSfM6Uu3kepJtSnlNk7zqjExqoi4tQk014S0oEccRaeTTxV+6QDl0mpdAQnKeaZqfOcupyHpHBMYvq2W3B+/pLsyZhg9etYHT+wGLV4QmO5IyX9qy6TIkzYKJ9CwYCG3IFVJewdo0ZEUa38L8FVvKRkAb1Xi21ltNoAgtTD/j3c0VBmrVP51gPeazsq98wOFepHn8sEvLW9IbXfg8YWjjhVFhg72TC7Nq6SnXJOA1JH0wd02wyNar7e99XBC5JiyJazGNSCX+qHs0iRpSwapgSUUwfMR6GjgxBFy79UXO36xGMtnT2za7d2yKgVAgMBAAGjWDBWMAwGA1UdEwEB/wQCMAAwIQYDVR0RBBowGIIWb3BlbmFwaS50b3NzaW52ZXN0LmNvbTATBgNVHSUEDDAKBggrBgEFBQcDATAOBgNVHQ8BAf8EBAMCBaAwDQYJKoZIhvcNAQELBQADggEBADudmbm0g91QRGh9scuVgclJPMjREb+BmMdHbAGg4TNfbnCMpK0n4WrwGYVPJG17YYF4Vd8OWyE53DVkdiKxCunB8Ruu95vJspO6SibM/oQ5wYic9geyIf97pPhs9ut2GS/rKy3opD+4BI4UkdRT4jW/wexEqfAnfVz0lv7fxIaSavsXKVIiFhrRqDXYWd97EkVKbdIKvfq/B/Lrhhoz5nFayl1AdlLJC13sq2kNixn62aAqM5L4+HQQEiTSxmV9jZE7Iak2mAIZfrB5wYc0x9jme5VYIiI/vnaswZzQ0qTlz1PnkkXYMdKGgkoIRsZhQs7Mocevfm+Z7zEDKdXCJko=";
const TEST_SERVER_KEY_DER =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDSmd864/mGyrxqbuFziIQf0RDysJSfM6Uu3kepJtSnlNk7zqjExqoi4tQk014S0oEccRaeTTxV+6QDl0mpdAQnKeaZqfOcupyHpHBMYvq2W3B+/pLsyZhg9etYHT+wGLV4QmO5IyX9qy6TIkzYKJ9CwYCG3IFVJewdo0ZEUa38L8FVvKRkAb1Xi21ltNoAgtTD/j3c0VBmrVP51gPeazsq98wOFepHn8sEvLW9IbXfg8YWjjhVFhg72TC7Nq6SnXJOA1JH0wd02wyNar7e99XBC5JiyJazGNSCX+qHs0iRpSwapgSUUwfMR6GjgxBFy79UXO36xGMtnT2za7d2yKgVAgMBAAECggEABtlWNytpgVwKhfOWhWlafVERRLNAF3ADM+OqtPI8VuQyWbg+KNgaebP4GOfULAyIgmJIeAbPAC+E2qZgO5CNqgW6KCPXdltjR84DO5i5ypXCsilD90tpweLS2ooTo33KOQpVBT+tYUiLOoxnr11IK1BGW8cZYFQxZO1bFacKX3nRrFF7n2x27G20WodRRA6FlHDhQbOIVvrL0cUXDdCPpyGV2FerTnq3WmAXrat/hYLBxbvX7BZ9wJWkQQOiKThYxy9hs5TF84hyHQXwRH/rFzOCfXeHL2treWuz1jt8x27ClBotIudHzMaNDqyf0AZUSzstXo6Dm/CTRnL0DpL/6QKBgQDsH3Oe6oB/IVYY5MifoQ95KSdDrSZI565ROpnBaxqLtiy9tEGdge8CurPMjJe+sjPFHf2eTeSsulCf/UjI9fo3CSCni4PfVdO1ca0k4mWpa/TRKcwz+HaEis7hodbLC3KfGGxY0VEA2G4AyCqhlaJIlHmpLhmJxVxiHR5jFjXhgwKBgQDkVGot9rtV94OhMAGh/C7bcvy6neqvHJuKpYCLc0gFaeoWhvhLtqI6ldo4fhIHtiCa+fjmlo7OgnyxkvFHcO+LFIA6b0zPhXohXJhfKKuGrsfq/AvsBib4LxPOc29i/SoPv26cqHP4NkUwccPBKuZnG46jKO2IKBdQIipvqNWUhwKBgD+m/uExMDCVSQNu8VJu9Z/g4y/QRojSw+Ar3vUQLVjKZGdDZ4jRVSA0OnIC2IlUurYBrrP1JZcWptNqUSuze59Ie6AO8R7MoUTBfz55NZSlgJq+HMlJypFSZhDXMvMLg/u1dse+rYp/za+yRiPHFbdhJybfQY0tQglE9kMZ4q6HAoGBAKj9lUyJlWNt+r0846h5FlETTNvt7vlF6hT2oyoS25YuKrQblv+qn21O5aD0JfIRKRaqtj4r5mwPhayDvhILEy/Tr4gQQkBBYP/6IUgkuLbI+2v+ufApKYR8i2M8ao9QImZfX8WQo6xstk7BlImOb9KWQb6elxcz3PVRJClaQyFXAoGAM1bbH5+Gr7sxIjAcRezkKA0dcF7Zdc0LSmOHMzRPwnrNqsXl0SeR5jLSpSNBdd86LktjoVp2Cwg/QlzqU1RyV6va7uKJUzHUN+RdcMNmiHPCpjBYISTIMuFPRs3890Jgw9jQAlOd9b0OXCDAjVNhwGV1X2YJxdc7XfC+znRE9uI=";

const TEST_CA = new X509Certificate(
  Buffer.from(TEST_CA_DER, "base64")
).toString();
const TEST_SERVER_OPTIONS: ServerOptions = {
  cert: new X509Certificate(
    Buffer.from(TEST_SERVER_CERT_DER, "base64")
  ).toString(),
  key: createPrivateKey({
    key: Buffer.from(TEST_SERVER_KEY_DER, "base64"),
    format: "der",
    type: "pkcs8"
  }).export({ format: "pem", type: "pkcs8" })
};

function readyConfig() {
  return readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_CLIENT_ID: "synthetic-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "synthetic-client-secret"
  });
}

function tokenProvider(...accessTokens: string[]) {
  let issueCount = 0;
  const invalidated: number[] = [];
  const provider: TossOpenApiBearerTokenProvider = {
    async getTokenLease() {
      const token = accessTokens[Math.min(issueCount, accessTokens.length - 1)];
      issueCount += 1;
      return {
        token: { accessToken: token ?? "synthetic-token" },
        generation: issueCount
      };
    },
    invalidateTokenLease(generation) {
      invalidated.push(generation);
      return true;
    }
  };
  return {
    provider,
    invalidated,
    get issueCount() {
      return issueCount;
    }
  };
}

async function withCalendarServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = createServer(TEST_SERVER_OPTIONS, handler);
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

function createTransport(
  port: number,
  provider: TossOpenApiBearerTokenProvider = tokenProvider().provider,
  overrides: Partial<TestOnlyTossOpenApiCalendarSocketConnector> = {}
) {
  return createTestOnlyTossOpenApiCalendarNetworkTransport(
    readyConfig(),
    provider,
    {
      dialAddress: "127.0.0.1",
      dialPort: port,
      certificateAuthority: TEST_CA,
      deadlineMs: 1_000,
      ...overrides
    }
  );
}

function sendCalendarJson(
  response: ServerResponse,
  body: unknown,
  status = 200,
  headers: Record<string, string | string[]> = {}
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
    ...headers
  });
  response.end(JSON.stringify(body));
}

async function expectTransportError(
  action: () => Promise<unknown>,
  code: TossOpenApiCalendarNetworkError["code"],
  label?: string
): Promise<TossOpenApiCalendarNetworkError> {
  let actual: unknown;
  try {
    await action();
  } catch (error) {
    actual = error;
  }
  assert.ok(actual instanceof TossOpenApiCalendarNetworkError, label);
  assert.equal(actual.code, code);
  return actual;
}

function sequenceClock(...values: bigint[]): () => bigint {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

test("calendar transport preserves exact KR request and raw response identity", async () => {
  const rawBody = Buffer.from('{"today":{"date":"2025-08-14"}}');
  await withCalendarServer(
    (request, response) => {
      assert.equal(request.method, "GET");
      assert.equal(request.url, "/api/v1/market-calendar/KR?date=2025-08-14");
      assert.equal(request.headers.host, "openapi.tossinvest.com");
      assert.equal(request.headers.authorization, "Bearer synthetic-token");
      assert.equal(request.headers.accept, "application/json");
      assert.equal(request.headers["accept-encoding"], "identity");
      assert.equal(
        request.headers["cache-control"],
        "no-cache, no-store, max-age=0"
      );
      assert.equal(request.headers.pragma, "no-cache");
      assert.equal(request.headers.range, undefined);
      assert.equal(request.headers["if-range"], undefined);
      assert.equal(request.headers["if-none-match"], undefined);
      assert.equal(request.headers["if-modified-since"], undefined);
      assert.equal(request.headers["x-tossinvest-account"], undefined);
      assert.equal((request.socket as TLSSocket).servername, "openapi.tossinvest.com");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(rawBody.byteLength),
        Date: "Thu, 14 Aug 2025 00:00:00 GMT",
        Age: "2",
        Expires: "Thu, 14 Aug 2025 01:00:00 GMT",
        "Cache-Control": "public, max-age=3600"
      });
      response.end(rawBody);
    },
    async (port) => {
      const observation = await createTransport(port, tokenProvider().provider, {
        nowMonotonicNanoseconds: sequenceClock(
          1_000_000_000n,
          1_125_000_001n
        ),
        nowUtc: () => new Date("2025-08-14T00:00:03.000Z")
      }).getCalendar({ market: "KR", date: "2025-08-14" });
      assert.equal(
        observation.requestUrl,
        "https://openapi.tossinvest.com/api/v1/market-calendar/KR?date=2025-08-14"
      );
      assert.equal(observation.responseDelayMilliseconds, 126);
      assert.equal(observation.completedAt, "2025-08-14T00:00:03.000Z");
      assert.deepEqual(observation.responseBytes, rawBody);
      assert.equal(observation.responseByteLength, rawBody.byteLength);
      assert.equal(
        observation.responseSha256,
        createHash("sha256").update(rawBody).digest("hex")
      );
      assert.equal(
        observation.responseFreshness.freshness.responseDate,
        "2025-08-14T00:00:00Z"
      );
      assert.equal(observation.responseFreshness.freshness.responseAgeSeconds, 2);
      assert.equal(
        observation.responseFreshness.freshness.responseExpires,
        "2025-08-14T01:00:00Z"
      );
      assert.equal(
        observation.responseFreshness.freshness.effectiveResponseAt,
        "2025-08-14T00:00:00.000Z"
      );
      assert.equal(
        observation.responseFreshness.freshness.staleAfter,
        "2025-08-14T01:00:00.000Z"
      );
    }
  );
});

test("calendar transport allows only exact US path with one canonical date", async () => {
  await withCalendarServer(
    (request, response) => {
      assert.equal(request.url, "/api/v1/market-calendar/US?date=2025-08-15");
      sendCalendarJson(response, { ok: true });
    },
    async (port) => {
      const result = await createTransport(port).getCalendar({
        market: "US",
        date: "2025-08-15"
      });
      assert.equal(result.market, "US");
      assert.equal(result.date, "2025-08-15");
    }
  );
});

test("calendar transport rejects disabled config and malformed request before token or dial", async () => {
  const tokens = tokenProvider();
  const disabled = createTestOnlyTossOpenApiCalendarNetworkTransport(
    readTossOpenApiAuthConfig({}),
    tokens.provider,
    {
      dialAddress: "127.0.0.1",
      dialPort: 9,
      certificateAuthority: TEST_CA
    }
  );
  await expectTransportError(
    () => disabled.getCalendar({ market: "KR", date: "2025-08-14" }),
    "TOSS_OPEN_API_CALENDAR_TRANSPORT_DISABLED"
  );

  const transport = createTransport(9, tokens.provider);
  for (const input of [
    { market: "JP", date: "2025-08-14" },
    { market: "KR", date: "2025-8-14" },
    { market: "KR", date: "2025-02-29" },
    { market: "KR", date: "2025-08-14", query: "extra" }
  ]) {
    await expectTransportError(
      () =>
        transport.getCalendar(
          input as unknown as { market: "KR"; date: string }
        ),
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_REQUEST"
    );
  }
  assert.equal(tokens.issueCount, 0);
});

test("calendar transport rejects invalid token lease before dialing", async () => {
  for (const lease of [
    { token: { accessToken: "" }, generation: 1 },
    { token: { accessToken: "bad token" }, generation: 1 },
    { token: { accessToken: "bad\r\ntoken" }, generation: 1 },
    { token: { accessToken: "synthetic-token" }, generation: 0 }
  ]) {
    const provider: TossOpenApiBearerTokenProvider = {
      async getTokenLease() {
        return lease;
      },
      invalidateTokenLease() {
        return false;
      }
    };
    await expectTransportError(
      () =>
        createTransport(9, provider).getCalendar({
          market: "KR",
          date: "2025-08-14"
        }),
      "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_TOKEN_LEASE"
    );
  }
});

test("calendar transport retries one refreshable 401 with generation invalidation", async () => {
  const tokens = tokenProvider("token-a", "token-b");
  const authorizations: string[] = [];
  await withCalendarServer(
    (request, response) => {
      authorizations.push(request.headers.authorization ?? "");
      if (authorizations.length === 1) {
        sendCalendarJson(response, { error: { code: "invalid_token" } }, 401);
      } else {
        sendCalendarJson(response, { ok: true });
      }
    },
    async (port) => {
      const result = await createTransport(port, tokens.provider).getCalendar({
        market: "KR",
        date: "2025-08-14"
      });
      assert.equal(result.httpStatus, 200);
    }
  );
  assert.deepEqual(authorizations, ["Bearer token-a", "Bearer token-b"]);
  assert.deepEqual(tokens.invalidated, [1]);
  assert.equal(tokens.issueCount, 2);
});

test("calendar transport invalidates retry generation and never makes a third attempt", async () => {
  const tokens = tokenProvider("token-a", "token-b", "token-c");
  let requests = 0;
  await withCalendarServer(
    (_request, response) => {
      requests += 1;
      sendCalendarJson(response, { code: "expired-token" }, 401);
    },
    async (port) => {
      await expectTransportError(
        () =>
          createTransport(port, tokens.provider).getCalendar({
            market: "US",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_AUTH_FAILED"
      );
    }
  );
  assert.equal(requests, 2);
  assert.deepEqual(tokens.invalidated, [1, 2]);
  assert.equal(tokens.issueCount, 2);
});

test("calendar transport does not retry a non-refreshable 401", async () => {
  const tokens = tokenProvider("token-a", "token-b");
  let requests = 0;
  await withCalendarServer(
    (_request, response) => {
      requests += 1;
      sendCalendarJson(response, { error: { code: "access_denied" } }, 401);
    },
    async (port) => {
      await expectTransportError(
        () =>
          createTransport(port, tokens.provider).getCalendar({
            market: "KR",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_AUTH_FAILED"
      );
    }
  );
  assert.equal(requests, 1);
  assert.deepEqual(tokens.invalidated, []);
  assert.equal(tokens.issueCount, 1);
});

test("calendar transport accepts only exact status 200 or guarded 401", async () => {
  for (const status of [201, 202, 204, 206, 302, 403, 429, 500]) {
    await withCalendarServer(
      (_request, response) => sendCalendarJson(response, { hidden: "provider" }, status),
      async (port) => {
        const error = await expectTransportError(
          () =>
            createTransport(port).getCalendar({
              market: "KR",
              date: "2025-08-14"
            }),
          "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_STATUS"
        );
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /provider/);
      }
    );
  }
});

test("calendar transport rejects forbidden representation headers", async () => {
  for (const headers of [
    { "Content-Range": "bytes 0-1/2" },
    { "Content-Encoding": "identity" },
    { "Content-Encoding": "gzip" },
    { "Content-Type": "text/plain" }
  ]) {
    await withCalendarServer(
      (_request, response) => sendCalendarJson(response, {}, 200, headers),
      async (port) => {
        await expectTransportError(
          () =>
            createTransport(port).getCalendar({
              market: "KR",
              date: "2025-08-14"
            }),
          "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_HEADERS"
        );
      }
    );
  }
});

test("calendar transport rejects forbidden response trailers", async () => {
  for (const [name, value] of [
    ["Content-Range", "bytes 0-1/2"],
    ["Content-Encoding", "gzip"],
    ["Content-Type", "text/plain"],
    ["Cache-Control", "no-store"]
  ] as const) {
    await withCalendarServer(
      (_request, response) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          Trailer: name
        });
        response.write("{}");
        response.addTrailers({ [name]: value });
        response.end();
      },
      async (port) => {
        await expectTransportError(
          () =>
            createTransport(port).getCalendar({
              market: "KR",
              date: "2025-08-14"
            }),
          "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_HEADERS"
        );
      }
    );
  }
});

test("calendar transport rejects invalid cache metadata and stale freshness", async () => {
  const cases: Array<{
    headers: Record<string, string>;
    sendDate?: boolean;
  }> = [
    { headers: {}, sendDate: false },
    { headers: { Age: "1.0" } },
    {
      headers: {
        Date: "Thu, 14 Aug 2025 00:00:00 GMT",
        Expires: "Thu, 14 Aug 2025 00:00:00 GMT",
        "Cache-Control": "public"
      }
    },
    { headers: { "Cache-Control": "no-store" } },
    { headers: { "Cache-Control": "max-age=0" } }
  ];
  for (const current of cases) {
    await withCalendarServer(
      (_request, response) => {
        if (current.sendDate === false) {
          response.sendDate = false;
        }
        sendCalendarJson(response, {}, 200, current.headers);
      },
      async (port) => {
        await expectTransportError(
          () =>
            createTransport(port, tokenProvider().provider, {
              nowUtc: () => new Date("2025-08-14T00:00:01.000Z")
            }).getCalendar({ market: "KR", date: "2025-08-14" }),
          "TOSS_OPEN_API_CALENDAR_TRANSPORT_FRESHNESS_REJECTED",
          JSON.stringify(current)
        );
      }
    );
  }
});

test("calendar transport enforces declared and streamed 1MiB limits", async () => {
  await withCalendarServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(TOSS_OPEN_API_CALENDAR_RESPONSE_MAX_BYTES + 1)
      });
      response.end("{}");
    },
    async (port) => {
      await expectTransportError(
        () =>
          createTransport(port).getCalendar({
            market: "KR",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_RESPONSE_TOO_LARGE"
      );
    }
  );
  await withCalendarServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600"
      });
      response.end(Buffer.alloc(TOSS_OPEN_API_CALENDAR_RESPONSE_MAX_BYTES + 1));
    },
    async (port) => {
      await expectTransportError(
        () =>
          createTransport(port).getCalendar({
            market: "KR",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_RESPONSE_TOO_LARGE"
      );
    }
  );
});

test("calendar transport rejects invalid UTF-8 JSON and incomplete bodies", async () => {
  await withCalendarServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600"
      });
      response.end(Buffer.from([0xff, 0xfe]));
    },
    async (port) => {
      const error = await expectTransportError(
        () =>
          createTransport(port).getCalendar({
            market: "KR",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_JSON"
      );
      assert.equal(error.responseByteLength, 2);
      assert.doesNotMatch(error.message, /ff|fe/i);
    }
  );
  await withCalendarServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "10"
      });
      response.write("{}");
      setTimeout(() => response.socket?.destroy(), 5);
    },
    async (port) => {
      await expectTransportError(
        () =>
          createTransport(port).getCalendar({
            market: "KR",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_INCOMPLETE_RESPONSE"
      );
    }
  );
});

test("calendar transport uses one absolute deadline across slow chunks", async () => {
  await withCalendarServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600"
      });
      const interval = setInterval(() => response.write(" "), 5);
      response.once("close", () => clearInterval(interval));
    },
    async (port) => {
      await expectTransportError(
        () =>
          createTransport(port, tokenProvider().provider, { deadlineMs: 40 }).getCalendar({
            market: "KR",
            date: "2025-08-14"
          }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED"
      );
    }
  );
});

test("calendar transport rejects regressed, exceeded and invalid clocks", async () => {
  const cases: Array<{
    nowMonotonicNanoseconds: () => bigint;
    nowUtc: () => Date;
    code: TossOpenApiCalendarNetworkError["code"];
  }> = [
    {
      nowMonotonicNanoseconds: sequenceClock(2n, 1n),
      nowUtc: () => new Date(),
      code: "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED"
    },
    {
      nowMonotonicNanoseconds: sequenceClock(0n, 1_001_000_000n),
      nowUtc: () => new Date(),
      code: "TOSS_OPEN_API_CALENDAR_TRANSPORT_DEADLINE_EXCEEDED"
    },
    {
      nowMonotonicNanoseconds: sequenceClock(0n, 1n),
      nowUtc: () => new Date(Number.NaN),
      code: "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG"
    },
    {
      nowMonotonicNanoseconds: () => {
        throw new Error("test clock failure");
      },
      nowUtc: () => new Date(),
      code: "TOSS_OPEN_API_CALENDAR_TRANSPORT_INVALID_CONFIG"
    }
  ];
  for (const current of cases) {
    await withCalendarServer(
      (_request, response) => sendCalendarJson(response, { ok: true }),
      async (port) => {
        await expectTransportError(
          () =>
            createTransport(port, tokenProvider().provider, {
              nowMonotonicNanoseconds: current.nowMonotonicNanoseconds,
              nowUtc: current.nowUtc
            }).getCalendar({ market: "KR", date: "2025-08-14" }),
          current.code
        );
      }
    );
  }
});

test("calendar test connector is loopback-only and snapshots validated fields", async () => {
  const provider = tokenProvider().provider;
  for (const connector of [
    { dialAddress: "192.0.2.1", dialPort: 443, certificateAuthority: TEST_CA },
    { dialAddress: "127.0.0.1", dialPort: 0, certificateAuthority: TEST_CA },
    { dialAddress: "127.0.0.1", dialPort: 443, certificateAuthority: "" },
    {
      dialAddress: "127.0.0.1",
      dialPort: 443,
      certificateAuthority: TEST_CA,
      deadlineMs: 10_001
    }
  ]) {
    assert.throws(
      () =>
        createTestOnlyTossOpenApiCalendarNetworkTransport(
          readyConfig(),
          provider,
          connector
        ),
      TossOpenApiCalendarNetworkError
    );
  }

  await withCalendarServer(
    (_request, response) => sendCalendarJson(response, { ok: true }),
    async (port) => {
      const connector: TestOnlyTossOpenApiCalendarSocketConnector = {
        dialAddress: "127.0.0.1",
        dialPort: port,
        certificateAuthority: TEST_CA,
        deadlineMs: 1_000
      };
      const transport = createTestOnlyTossOpenApiCalendarNetworkTransport(
        readyConfig(),
        provider,
        connector
      );
      connector.dialAddress = "192.0.2.1";
      connector.dialPort = 1;
      connector.certificateAuthority = "invalid";
      connector.deadlineMs = 1;
      connector.nowMonotonicNanoseconds = () => {
        throw new Error("mutated clock");
      };
      connector.nowUtc = () => new Date(Number.NaN);
      const result = await transport.getCalendar({
        market: "KR",
        date: "2025-08-14"
      });
      assert.equal(result.httpStatus, 200);
    }
  );
});

test("calendar transport requires trusted synthetic CA and hides production overrides", async () => {
  assert.equal(createTossOpenApiCalendarNetworkTransport.length, 2);
  await withCalendarServer(
    (_request, response) => sendCalendarJson(response, { ok: true }),
    async (port) => {
      const transport = createTestOnlyTossOpenApiCalendarNetworkTransport(
        readyConfig(),
        tokenProvider().provider,
        {
          dialAddress: "127.0.0.1",
          dialPort: port,
          certificateAuthority: new X509Certificate(
            Buffer.from(TEST_SERVER_CERT_DER, "base64")
          ).toString()
        }
      );
      await expectTransportError(
        () => transport.getCalendar({ market: "KR", date: "2025-08-14" }),
        "TOSS_OPEN_API_CALENDAR_TRANSPORT_NETWORK_FAILURE"
      );
    }
  );
});
