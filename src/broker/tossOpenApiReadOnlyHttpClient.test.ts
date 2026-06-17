import assert from "node:assert/strict";
import test from "node:test";

import { readTossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";
import {
  buildTossOpenApiReadOnlyUrl,
  TossOpenApiReadOnlyHttpClient,
  TossOpenApiReadOnlyHttpClientError,
  type TossOpenApiReadOnlyHttpRequest,
  type TossOpenApiReadOnlyHttpResponse,
  type TossOpenApiReadOnlyTransport
} from "./tossOpenApiReadOnlyHttpClient.js";

class FakeTokenProvider {
  callCount = 0;

  constructor(private readonly token = "local-access-token") {}

  async getAccessToken(): Promise<string> {
    this.callCount += 1;
    return this.token;
  }
}

class FakeReadOnlyTransport implements TossOpenApiReadOnlyTransport {
  readonly requests: TossOpenApiReadOnlyHttpRequest[] = [];
  private readonly responses: TossOpenApiReadOnlyHttpResponse[];

  constructor(responses: TossOpenApiReadOnlyHttpResponse[]) {
    this.responses = [...responses];
  }

  async request(
    request: TossOpenApiReadOnlyHttpRequest
  ): Promise<TossOpenApiReadOnlyHttpResponse> {
    this.requests.push(request);
    return this.responses.shift() ?? { status: 200, body: { ok: true } };
  }
}

function readyConfig() {
  return readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_CLIENT_ID: "local-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "local-client-secret"
  });
}

test("read-only HTTP client injects bearer token into GET request", async () => {
  const tokenProvider = new FakeTokenProvider("issued-token");
  const transport = new FakeReadOnlyTransport([
    { status: 200, body: { prices: [] } }
  ]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    tokenProvider,
    transport
  );

  const body = await client.getJson("/api/v1/prices", [
    ["symbol", "005930"],
    ["includeExtended", false],
    ["limit", 10],
    ["optional", undefined]
  ]);

  assert.deepEqual(body, { prices: [] });
  assert.equal(tokenProvider.callCount, 1);
  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0]?.method, "GET");
  assert.equal(
    transport.requests[0]?.url,
    "https://openapi.tossinvest.com/api/v1/prices?symbol=005930&includeExtended=false&limit=10"
  );
  assert.deepEqual(transport.requests[0]?.headers, {
    Accept: "application/json",
    Authorization: "Bearer issued-token"
  });
});

test("read-only HTTP client blocks mutation methods before auth and transport", async () => {
  const tokenProvider = new FakeTokenProvider();
  const transport = new FakeReadOnlyTransport([]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    tokenProvider,
    transport
  );

  await assert.rejects(
    () => client.requestJson({ method: "POST", path: "/api/v1/orders" }),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_MUTATION_BLOCKED"
  );
  assert.equal(tokenProvider.callCount, 0);
  assert.equal(transport.requests.length, 0);
});

test("read-only HTTP client refuses disabled auth config before token and transport", async () => {
  const tokenProvider = new FakeTokenProvider();
  const transport = new FakeReadOnlyTransport([]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readTossOpenApiAuthConfig({}),
    tokenProvider,
    transport
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_AUTH_DISABLED"
  );
  assert.equal(tokenProvider.callCount, 0);
  assert.equal(transport.requests.length, 0);
});

test("read-only HTTP client refuses invalid auth config before token and transport", async () => {
  const tokenProvider = new FakeTokenProvider();
  const transport = new FakeReadOnlyTransport([]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readTossOpenApiAuthConfig({ TOSS_OPEN_API_AUTH_ENABLED: "true" }),
    tokenProvider,
    transport
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_AUTH_INVALID_CONFIG" &&
      error.message.includes("MISSING_CLIENT_ID") &&
      error.message.includes("MISSING_CLIENT_SECRET")
  );
  assert.equal(tokenProvider.callCount, 0);
  assert.equal(transport.requests.length, 0);
});

test("read-only URL builder rejects non-root-relative paths", () => {
  const invalidPaths = [
    "api/v1/prices",
    "//evil.example/path",
    "https://evil.example/path",
    "/api/v1\\orders"
  ];

  for (const path of invalidPaths) {
    assert.throws(
      () =>
        buildTossOpenApiReadOnlyUrl("https://openapi.tossinvest.com", {
          path
        }),
      (error) =>
        error instanceof TossOpenApiReadOnlyHttpClientError &&
        error.code === "TOSS_OPEN_API_READONLY_INVALID_PATH"
    );
  }
});

test("read-only URL builder rejects non-https base URL", () => {
  assert.throws(
    () =>
      buildTossOpenApiReadOnlyUrl("http://openapi.tossinvest.com", {
        path: "/api/v1/prices"
      }),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_INVALID_BASE_URL"
  );
});

test("read-only HTTP client maps authentication failures", async () => {
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    new FakeTokenProvider(),
    new FakeReadOnlyTransport([
      { status: 401, body: { code: "invalid_token" } }
    ])
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_AUTH_FAILED" &&
      error.status === 401 &&
      error.responseCode === "invalid_token"
  );
});

test("read-only HTTP client maps forbidden responses", async () => {
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    new FakeTokenProvider(),
    new FakeReadOnlyTransport([
      { status: 403, body: { code: "forbidden" } }
    ])
  );

  await assert.rejects(
    () => client.getJson("/api/v1/accounts"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_FORBIDDEN" &&
      error.status === 403 &&
      error.responseCode === "forbidden"
  );
});

test("read-only HTTP client maps rate limit responses with retry-after", async () => {
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    new FakeTokenProvider(),
    new FakeReadOnlyTransport([
      {
        status: 429,
        headers: { "Retry-After": "3" },
        body: { error: "too_many_requests" }
      }
    ])
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_RATE_LIMITED" &&
      error.status === 429 &&
      error.responseCode === "too_many_requests" &&
      error.retryAfterMs === 3000
  );
});

test("read-only HTTP client maps generic client and server errors", async () => {
  const clientError = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    new FakeTokenProvider(),
    new FakeReadOnlyTransport([
      { status: 400, body: { code: "invalid_query" } }
    ])
  );
  const serverError = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    new FakeTokenProvider(),
    new FakeReadOnlyTransport([
      { status: 503, body: { code: "service_unavailable" } }
    ])
  );

  await assert.rejects(
    () => clientError.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_CLIENT_ERROR" &&
      error.status === 400 &&
      error.responseCode === "invalid_query"
  );

  await assert.rejects(
    () => serverError.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_SERVER_ERROR" &&
      error.status === 503 &&
      error.responseCode === "service_unavailable"
  );
});

test("read-only response parser rejects invalid response status", async () => {
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    new FakeTokenProvider(),
    new FakeReadOnlyTransport([{ status: 99, body: { ok: false } }])
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_INVALID_RESPONSE"
  );
});
