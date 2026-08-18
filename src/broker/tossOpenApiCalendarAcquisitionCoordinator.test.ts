import assert from "node:assert/strict";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { readTossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";
import { consumeOfficialBrokerObservedCalendarEphemeralReplayInput } from "../replay/officialBrokerObservedCalendarEphemeralObservation.js";
import type { TossOpenApiTokenIssuer } from "./tossOpenApiAuthClient.js";
import {
  createTestOnlyTossOpenApiCalendarAcquisitionCoordinator,
  createTossOpenApiCalendarAcquisitionCoordinator,
  TossOpenApiCalendarAcquisitionError
} from "./tossOpenApiCalendarAcquisitionCoordinator.js";

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

const PINNED_OPENAPI_DOCUMENT = JSON.parse(
  readFileSync(
    "src/replay/officialTossCalendarOpenApi-1.2.14.json",
    "utf8"
  )
) as {
  paths: Record<
    string,
    {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                examples: Record<string, { value: unknown }>;
              };
            };
          };
        };
      };
    }
  >;
};

test("acquires a pinned calendar response into an opaque one-shot observation", async () => {
  let requestCount = 0;
  const token = tokenIssuer();
  await withCalendarServer(
    (request, response) => {
      requestCount += 1;
      assertCalendarRequest(request);
      sendResponse(response, pinnedKrResponseBytes());
    },
    async (port) => {
      const coordinator = createCoordinator(port, token.issuer);
      const observation = await coordinator.acquireCalendarObservation({
        market: "KR",
        date: "2026-03-25"
      });

      assert.equal(requestCount, 1);
      assert.equal(token.issueCount, 1);
      assert.equal(
        consumeOfficialBrokerObservedCalendarEphemeralReplayInput(
          observation,
          { asOf: "2026-03-25T01:00:10.000Z" }
        ),
        undefined
      );

      const staleObservation =
        await coordinator.acquireCalendarObservation({
          market: "KR",
          date: "2026-03-25"
        });
      assert.throws(
        () =>
          consumeOfficialBrokerObservedCalendarEphemeralReplayInput(
            staleObservation,
            { asOf: "2026-03-25T01:01:00.000Z" }
          ),
        /stale/
      );
      assert.equal(requestCount, 2);
      assert.equal(token.issueCount, 1);
    }
  );
});

test("uses a pinned example only for registry selection and accepts separate strict network bytes", async () => {
  const token = tokenIssuer();
  await withCalendarServer(
    (request, response) => {
      assertCalendarRequest(request, "2026-04-01");
      sendResponse(
        response,
        unpinnedStrictKrResponseBytes(),
        "Wed, 01 Apr 2026 01:00:00 GMT"
      );
    },
    async (port) => {
      const coordinator = createCoordinator(port, token.issuer, {
        completedAt: "2026-04-01T01:00:10.000Z"
      });
      const observation = await coordinator.acquireCalendarObservation({
        market: "KR",
        date: "2026-04-01"
      });

      assert.equal(
        consumeOfficialBrokerObservedCalendarEphemeralReplayInput(
          observation,
          { asOf: "2026-04-01T01:00:10.000Z" }
        ),
        undefined
      );
      assert.equal(token.issueCount, 1);
    }
  );
});

test("rejects caller metadata injection before token issue or calendar request", async () => {
  let requestCount = 0;
  const token = tokenIssuer();
  await withCalendarServer(
    (_request, response) => {
      requestCount += 1;
      sendResponse(response, pinnedKrResponseBytes());
    },
    async (port) => {
      const coordinator = createCoordinator(port, token.issuer);
      await expectCoordinatorError(
        () =>
          coordinator.acquireCalendarObservation({
            market: "KR",
            date: "2026-03-25",
            retrievedAt: "2099-01-01T00:00:00.000Z"
          } as never),
        "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_REQUEST"
      );
      assert.equal(token.issueCount, 0);
      assert.equal(requestCount, 0);
    }
  );
});

test("fails closed when actual network bytes violate the strict response contract", async () => {
  const token = tokenIssuer();
  await withCalendarServer(
    (_request, response) => {
      sendResponse(
        response,
        Buffer.from('{"result":{"today":{"date":"2026-03-25"}}}', "utf8")
      );
    },
    async (port) => {
      const coordinator = createCoordinator(port, token.issuer);
      await expectCoordinatorError(
        () =>
          coordinator.acquireCalendarObservation({
            market: "KR",
            date: "2026-03-25"
          }),
        "TOSS_OPEN_API_CALENDAR_ACQUISITION_EVIDENCE_REJECTED"
      );
    }
  );
});

test("production coordinator rejects disabled and noncanonical config without network", async () => {
  const disabled = createTossOpenApiCalendarAcquisitionCoordinator(
    readTossOpenApiAuthConfig({})
  );
  await expectCoordinatorError(
    () =>
      disabled.acquireCalendarObservation({
        market: "KR",
        date: "2026-03-25"
      }),
    "TOSS_OPEN_API_CALENDAR_ACQUISITION_DISABLED"
  );

  const invalid = createTossOpenApiCalendarAcquisitionCoordinator(
    readTossOpenApiAuthConfig({
      TOSS_OPEN_API_AUTH_ENABLED: "true",
      TOSS_OPEN_API_BASE_URL: "https://example.com",
      TOSS_OPEN_API_CLIENT_ID: "synthetic-client-id",
      TOSS_OPEN_API_CLIENT_SECRET: "synthetic-client-secret"
    })
  );
  await expectCoordinatorError(
    () =>
      invalid.acquireCalendarObservation({
        market: "KR",
        date: "2026-03-25"
      }),
    "TOSS_OPEN_API_CALENDAR_ACQUISITION_INVALID_CONFIG"
  );
});

function readyConfig() {
  return readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_CLIENT_ID: "synthetic-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "synthetic-client-secret"
  });
}

function createCoordinator(
  port: number,
  issuer: TossOpenApiTokenIssuer,
  options: { completedAt?: string } = {}
) {
  return createTestOnlyTossOpenApiCalendarAcquisitionCoordinator(
    readyConfig(),
    {
      tokenIssuer: issuer,
      authClientOptions: {
        now: () => new Date("2026-03-25T01:00:00.000Z"),
        expirySafetyMarginMs: 1_000
      },
      calendarConnector: {
        dialAddress: "127.0.0.1",
        dialPort: port,
        certificateAuthority: TEST_CA,
        deadlineMs: 1_000,
        nowMonotonicNanoseconds: sequenceClock(
          1_000_000n,
          1_250_000n
        ),
        nowUtc: () =>
          new Date(options.completedAt ?? "2026-03-25T01:00:10.000Z")
      }
    }
  );
}

function tokenIssuer() {
  let issueCount = 0;
  const issuer: TossOpenApiTokenIssuer = {
    async issueToken(request) {
      issueCount += 1;
      assert.equal(request.method, "POST");
      assert.equal(
        request.url,
        "https://openapi.tossinvest.com/oauth2/token"
      );
      assert.match(request.body, /grant_type=client_credentials/);
      return {
        access_token: "synthetic-calendar-token",
        token_type: "Bearer",
        expires_in: 3_600
      };
    }
  };
  return {
    issuer,
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

function assertCalendarRequest(
  request: IncomingMessage,
  date = "2026-03-25"
): void {
  assert.equal(request.method, "GET");
  assert.equal(
    request.url,
    `/api/v1/market-calendar/KR?date=${date}`
  );
  assert.equal(request.headers.host, "openapi.tossinvest.com");
  assert.equal(
    request.headers.authorization,
    "Bearer synthetic-calendar-token"
  );
  assert.equal(request.headers["accept-encoding"], "identity");
  assert.equal(request.headers["x-tossinvest-account"], undefined);
}

function sendResponse(
  response: ServerResponse,
  body: Buffer,
  dateHeader = "Wed, 25 Mar 2026 01:00:00 GMT"
): void {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60",
    Date: dateHeader,
    Age: "5"
  });
  response.end(body);
}

function pinnedKrResponseBytes(): Buffer {
  const value = PINNED_OPENAPI_DOCUMENT.paths[
    "/api/v1/market-calendar/KR"
  ]!.get.responses["200"].content["application/json"].examples.businessDay!
    .value;
  return Buffer.from(JSON.stringify(value), "utf8");
}

function unpinnedStrictKrResponseBytes(): Buffer {
  return Buffer.from(
    pinnedKrResponseBytes()
      .toString("utf8")
      .replaceAll("2026-03-24", "2026-03-31")
      .replaceAll("2026-03-25", "2026-04-01")
      .replaceAll("2026-03-26", "2026-04-02"),
    "utf8"
  );
}

function sequenceClock(...values: bigint[]): () => bigint {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

async function expectCoordinatorError(
  action: () => Promise<unknown>,
  code: TossOpenApiCalendarAcquisitionError["code"]
): Promise<void> {
  let actual: unknown;
  try {
    await action();
  } catch (error) {
    actual = error;
  }
  assert.ok(actual instanceof TossOpenApiCalendarAcquisitionError);
  assert.equal(actual.code, code);
}
