import assert from "node:assert/strict";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { createServer, type ServerOptions } from "node:https";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import test from "node:test";

import { readTossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";
import {
  buildTossOpenApiTokenIssueRequest,
  TossOpenApiAuthClient,
  type TossOpenApiTokenIssueRequest
} from "./tossOpenApiAuthClient.js";
import {
  createTestOnlyTossOpenApiTokenIssuerNetworkTransport,
  createTossOpenApiTokenIssuerNetworkTransport,
  TOSS_OPEN_API_TOKEN_RESPONSE_MAX_BYTES,
  TossOpenApiTokenIssuerNetworkError
} from "./tossOpenApiTokenIssuerNetworkTransport.js";

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

async function withTokenServer<T>(
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

function createTransport(port: number, deadlineMs = 1_000) {
  return createTestOnlyTossOpenApiTokenIssuerNetworkTransport(readyConfig(), {
    dialAddress: "127.0.0.1",
    dialPort: port,
    certificateAuthority: TEST_CA,
    deadlineMs
  });
}

function canonicalRequest(): TossOpenApiTokenIssueRequest {
  return buildTossOpenApiTokenIssueRequest(readyConfig());
}

function sendJson(
  response: ServerResponse,
  body: unknown,
  status = 200,
  headers: Record<string, string | string[]> = {}
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers
  });
  response.end(JSON.stringify(body));
}

async function expectTransportError(
  action: () => Promise<unknown>,
  code: TossOpenApiTokenIssuerNetworkError["code"]
): Promise<TossOpenApiTokenIssuerNetworkError> {
  let actual: unknown;
  try {
    await action();
  } catch (error) {
    actual = error;
  }
  assert.ok(actual instanceof TossOpenApiTokenIssuerNetworkError);
  assert.equal(actual.code, code);
  return actual;
}

test("token transport preserves canonical production URL, Host, SNI and identity bytes", async () => {
  await withTokenServer(
    async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk as Buffer);
      }
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/oauth2/token");
      assert.equal(request.headers.host, "openapi.tossinvest.com");
      assert.equal(request.headers.accept, "application/json");
      assert.equal(request.headers["accept-encoding"], "identity");
      assert.equal(
        request.headers["content-type"],
        "application/x-www-form-urlencoded"
      );
      assert.equal(request.headers.range, undefined);
      assert.equal(request.headers["if-range"], undefined);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers["proxy-authorization"], undefined);
      assert.equal(
        (request.socket as TLSSocket).servername,
        "openapi.tossinvest.com"
      );
      assert.equal(Buffer.concat(chunks).toString("utf8"), canonicalRequest().body);
      sendJson(response, {
        access_token: "synthetic-token",
        token_type: "Bearer",
        expires_in: 3600
      });
    },
    async (port) => {
      assert.deepEqual(await createTransport(port).issueToken(canonicalRequest()), {
        access_token: "synthetic-token",
        token_type: "Bearer",
        expires_in: 3600
      });
    }
  );
});

test("auth client parses and caches the accepted network token response", async () => {
  let requestCount = 0;
  await withTokenServer(
    (_request, response) => {
      requestCount += 1;
      sendJson(response, {
        access_token: "synthetic-cached-token",
        token_type: "Bearer",
        expires_in: 3600
      });
    },
    async (port) => {
      const authClient = new TossOpenApiAuthClient(
        readyConfig(),
        createTransport(port),
        { now: () => new Date("2026-08-14T05:00:00.000Z") }
      );
      assert.equal(await authClient.getAccessToken(), "synthetic-cached-token");
      assert.equal(await authClient.getAccessToken(), "synthetic-cached-token");
      assert.equal(requestCount, 1);
    }
  );
});

test("token transport rejects disabled, invalid and noncanonical requests before dialing", async () => {
  let connectionCount = 0;
  await withTokenServer(
    (_request, response) => {
      connectionCount += 1;
      sendJson(response, {});
    },
    async (port) => {
      const disabled = createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
        readTossOpenApiAuthConfig({}),
        {
          dialAddress: "127.0.0.1",
          dialPort: port,
          certificateAuthority: TEST_CA
        }
      );
      await expectTransportError(
        () => disabled.issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_DISABLED"
      );

      const invalidConfig = readTossOpenApiAuthConfig({
        TOSS_OPEN_API_AUTH_ENABLED: "true"
      });
      const invalid = createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
        invalidConfig,
        {
          dialAddress: "127.0.0.1",
          dialPort: port,
          certificateAuthority: TEST_CA
        }
      );
      await expectTransportError(
        () => invalid.issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG"
      );

      const missingCredentialConfig = { ...readyConfig() };
      delete missingCredentialConfig.clientId;
      const missingCredential =
        createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
          missingCredentialConfig,
          {
            dialAddress: "127.0.0.1",
            dialPort: port,
            certificateAuthority: TEST_CA
          }
        );
      await expectTransportError(
        () => missingCredential.issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG"
      );

      const blankCredentialConfig = {
        ...readyConfig(),
        clientSecret: " "
      };
      const blankCredential =
        createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
          blankCredentialConfig,
          {
            dialAddress: "127.0.0.1",
            dialPort: port,
            certificateAuthority: TEST_CA
          }
        );
      await expectTransportError(
        () => blankCredential.issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG"
      );

      const request = canonicalRequest();
      await expectTransportError(
        () =>
          createTransport(port).issueToken({
            ...request,
            url: "https://openapi.tossinvest.com/oauth2/token?unexpected=1"
          }),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_REQUEST"
      );
      assert.equal(connectionCount, 0);
    }
  );
});

test("production factory does not expose a dial target override", () => {
  const factory: (config: ReturnType<typeof readyConfig>) => unknown =
    createTossOpenApiTokenIssuerNetworkTransport;
  assert.equal(factory.length, 1);
});

test("test-only connector rejects non-loopback, invalid port and invalid deadline", () => {
  for (const connector of [
    {
      dialAddress: "192.0.2.10",
      dialPort: 443,
      certificateAuthority: TEST_CA
    },
    {
      dialAddress: "localhost",
      dialPort: 443,
      certificateAuthority: TEST_CA
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 0,
      certificateAuthority: TEST_CA
    },
    {
      dialAddress: "127.0.0.1",
      dialPort: 443,
      certificateAuthority: TEST_CA,
      deadlineMs: 10_001
    }
  ]) {
    assert.throws(
      () =>
        createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
          readyConfig(),
          connector
        ),
      (error) =>
        error instanceof TossOpenApiTokenIssuerNetworkError &&
        error.code === "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_CONFIG"
    );
  }
});

test("test-only transport snapshots the validated loopback connector", async () => {
  await withTokenServer(
    (_request, response) => sendJson(response, { ok: true }),
    async (port) => {
      const connector = {
        dialAddress: "127.0.0.1",
        dialPort: port,
        certificateAuthority: TEST_CA,
        deadlineMs: 500
      };
      const transport =
        createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
          readyConfig(),
          connector
        );

      connector.dialAddress = "192.0.2.10";
      connector.dialPort = 443;
      connector.certificateAuthority = "attacker-controlled-ca";
      connector.deadlineMs = 10_001;

      assert.deepEqual(await transport.issueToken(canonicalRequest()), {
        ok: true
      });
    }
  );
});

test("token transport requires the test CA and production hostname certificate", async () => {
  await withTokenServer(
    (_request, response) => sendJson(response, {}),
    async (port) => {
      const transport = createTestOnlyTossOpenApiTokenIssuerNetworkTransport(
        readyConfig(),
        {
          dialAddress: "127.0.0.1",
          dialPort: port,
          certificateAuthority: new X509Certificate(
            Buffer.from(TEST_SERVER_CERT_DER, "base64")
          ).toString(),
          deadlineMs: 500
        }
      );
      await expectTransportError(
        () => transport.issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_NETWORK_FAILURE"
      );
    }
  );
});

test("token transport accepts only exact status 200", async () => {
  for (const status of [201, 202, 204, 206, 500]) {
    await withTokenServer(
      (_request, response) => sendJson(response, { access_token: "not-read" }, status),
      async (port) => {
        const error = await expectTransportError(
          () => createTransport(port).issueToken(canonicalRequest()),
          "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_STATUS"
        );
        assert.equal(error.status, status);
        assert.doesNotMatch(error.message, /not-read/);
      }
    );
  }
});

test("token transport rejects Content-Range and every Content-Encoding value", async () => {
  for (const headers of [
    { "Content-Range": "bytes 0-10/11" },
    { "Content-Encoding": "identity" },
    { "Content-Encoding": "gzip" }
  ]) {
    await withTokenServer(
      (_request, response) => sendJson(response, {}, 200, headers),
      async (port) => {
        await expectTransportError(
          () => createTransport(port).issueToken(canonicalRequest()),
          "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_HEADERS"
        );
      }
    );
  }
});

test("token transport requires a single JSON content type", async () => {
  for (const contentType of ["text/plain", "application/json; charset=latin1"]){
    await withTokenServer(
      (_request, response) => {
        response.writeHead(200, { "Content-Type": contentType });
        response.end("{}");
      },
      async (port) => {
        await expectTransportError(
          () => createTransport(port).issueToken(canonicalRequest()),
          "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_HEADERS"
        );
      }
    );
  }
});

test("token transport enforces declared and streamed 256KiB response limits", async () => {
  await withTokenServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(TOSS_OPEN_API_TOKEN_RESPONSE_MAX_BYTES + 1)
      });
      response.end("{}");
    },
    async (port) => {
      await expectTransportError(
        () => createTransport(port).issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_RESPONSE_TOO_LARGE"
      );
    }
  );

  await withTokenServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(Buffer.alloc(TOSS_OPEN_API_TOKEN_RESPONSE_MAX_BYTES + 1, 0x20));
    },
    async (port) => {
      await expectTransportError(
        () => createTransport(port).issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_RESPONSE_TOO_LARGE"
      );
    }
  );
});

test("token transport rejects invalid UTF-8 JSON without exposing provider bytes", async () => {
  await withTokenServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(Buffer.from([0xff, 0xfe, 0xfd]));
    },
    async (port) => {
      const error = await expectTransportError(
        () => createTransport(port).issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INVALID_JSON"
      );
      assert.equal(error.responseByteLength, 3);
      assert.doesNotMatch(error.message, /ff|fe|fd/i);
    }
  );
});

test("token transport uses one absolute deadline across slow response chunks", async () => {
  await withTokenServer(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      const interval = setInterval(() => response.write(" "), 5);
      response.once("close", () => clearInterval(interval));
    },
    async (port) => {
      const startedAt = performance.now();
      await expectTransportError(
        () => createTransport(port, 40).issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_DEADLINE_EXCEEDED"
      );
      assert.ok(performance.now() - startedAt < 500);
    }
  );
});

test("token transport rejects incomplete bodies", async () => {
  await withTokenServer(
    (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": "100"
      });
      response.write("{}");
      setTimeout(() => response.socket?.destroy(), 5);
    },
    async (port) => {
      await expectTransportError(
        () => createTransport(port).issueToken(canonicalRequest()),
        "TOSS_OPEN_API_TOKEN_TRANSPORT_INCOMPLETE_RESPONSE"
      );
    }
  );
});
