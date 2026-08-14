import assert from "node:assert/strict";
import test from "node:test";

import { readTossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";
import {
  TossOpenApiAuthClient,
  type TossOpenApiTokenIssueRequest,
  type TossOpenApiTokenIssueResponse,
  type TossOpenApiTokenIssuer
} from "./tossOpenApiAuthClient.js";
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
  clearCount = 0;
  private currentIndex = 0;
  private readonly tokens: string[];

  constructor(tokens: string | string[] = "local-access-token") {
    this.tokens = Array.isArray(tokens) ? [...tokens] : [tokens];
  }

  async getTokenLease() {
    const index = Math.min(this.currentIndex, this.tokens.length - 1);
    const token = this.tokens[index];
    this.callCount += 1;
    return {
      token: { accessToken: token ?? "local-access-token" },
      generation: index + 1
    };
  }

  invalidateTokenLease(generation: number): boolean {
    this.clearCount += 1;
    if (generation !== this.currentIndex + 1) {
      return false;
    }
    this.currentIndex = Math.min(this.currentIndex + 1, this.tokens.length - 1);
    return true;
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

class SequenceTokenIssuer implements TossOpenApiTokenIssuer {
  readonly requests: TossOpenApiTokenIssueRequest[] = [];

  constructor(private readonly responses: TossOpenApiTokenIssueResponse[]) {}

  async issueToken(
    request: TossOpenApiTokenIssueRequest
  ): Promise<TossOpenApiTokenIssueResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    assert.ok(response, "unexpected token issue");
    return response;
  }
}

function tokenResponse(accessToken: string): TossOpenApiTokenIssueResponse {
  return { access_token: accessToken, token_type: "Bearer", expires_in: 3600 };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: () => {
      assert.ok(resolve);
      resolve();
    }
  };
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

test("read-only HTTP client injects accountSeq into Toss account header", async () => {
  const tokenProvider = new FakeTokenProvider("issued-token");
  const transport = new FakeReadOnlyTransport([
    { status: 200, body: { result: { items: [] } } }
  ]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    tokenProvider,
    transport
  );

  const body = await client.getJson("/api/v1/holdings", {
    accountSeq: 1,
    query: [["symbol", "005930"]]
  });

  assert.deepEqual(body, { result: { items: [] } });
  assert.equal(tokenProvider.callCount, 1);
  assert.equal(transport.requests.length, 1);
  assert.equal(
    transport.requests[0]?.url,
    "https://openapi.tossinvest.com/api/v1/holdings?symbol=005930"
  );
  assert.deepEqual(transport.requests[0]?.headers, {
    Accept: "application/json",
    Authorization: "Bearer issued-token",
    "X-Tossinvest-Account": "1"
  });
});

test("read-only HTTP client rejects invalid accountSeq before auth and transport", async () => {
  const tokenProvider = new FakeTokenProvider();
  const transport = new FakeReadOnlyTransport([]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    tokenProvider,
    transport
  );

  await assert.rejects(
    () => client.getJson("/api/v1/holdings", { accountSeq: 0 }),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_INVALID_ACCOUNT_SEQ"
  );
  assert.equal(tokenProvider.callCount, 0);
  assert.equal(transport.requests.length, 0);
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
    new FakeTokenProvider("local-access-token"),
    new FakeReadOnlyTransport([
      { status: 401, body: { code: "invalid_token" } },
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

test("read-only HTTP client retries once after refreshable token failure", async () => {
  const tokenProvider = new FakeTokenProvider(["stale-token", "fresh-token"]);
  const transport = new FakeReadOnlyTransport([
    { status: 401, body: { error: { code: "expired-token" } } },
    { status: 200, body: { prices: ["ok"] } }
  ]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    tokenProvider,
    transport
  );

  assert.deepEqual(await client.getJson("/api/v1/prices"), { prices: ["ok"] });
  assert.equal(tokenProvider.callCount, 2);
  assert.equal(tokenProvider.clearCount, 1);
  assert.equal(transport.requests.length, 2);
  assert.equal(
    transport.requests[0]?.headers.Authorization,
    "Bearer stale-token"
  );
  assert.equal(
    transport.requests[1]?.headers.Authorization,
    "Bearer fresh-token"
  );
});

test("read-only HTTP client returns auth failure after one token retry", async () => {
  const tokenProvider = new FakeTokenProvider(["stale-token", "fresh-token"]);
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    tokenProvider,
    new FakeReadOnlyTransport([
      { status: 401, body: { error: { code: "invalid-token" } } },
      { status: 401, body: { error: { code: "invalid-token" } } }
    ])
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_AUTH_FAILED" &&
      error.status === 401 &&
      error.responseCode === "invalid-token"
  );
  assert.equal(tokenProvider.callCount, 2);
  assert.equal(tokenProvider.clearCount, 2);
});

test("staggered refreshable 401 responses preserve the newer token lease", async () => {
  const issuer = new SequenceTokenIssuer([
    tokenResponse("token-a"),
    tokenResponse("token-b"),
    tokenResponse("unexpected-token-c")
  ]);
  const authClient = new TossOpenApiAuthClient(readyConfig(), issuer, {
    now: () => new Date("2026-06-17T09:00:00+09:00")
  });
  const lateTokenA = deferred();
  const authorizations: string[] = [];
  let tokenACount = 0;
  const transport: TossOpenApiReadOnlyTransport = {
    async request(request) {
      authorizations.push(request.headers.Authorization);
      if (request.headers.Authorization === "Bearer token-a") {
        tokenACount += 1;
        if (tokenACount === 2) {
          await lateTokenA.promise;
        }
        return { status: 401, body: { error: { code: "expired-token" } } };
      }
      return { status: 200, body: { token: "b" } };
    }
  };
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    authClient,
    transport
  );

  const first = client.getJson("/api/v1/prices");
  const second = client.getJson("/api/v1/prices");
  assert.deepEqual(await first, { token: "b" });
  lateTokenA.resolve();
  assert.deepEqual(await second, { token: "b" });

  assert.equal(issuer.requests.length, 2);
  assert.deepEqual(authorizations, [
    "Bearer token-a",
    "Bearer token-a",
    "Bearer token-b",
    "Bearer token-b"
  ]);
});

test("a double refreshable 401 clears the retry lease without a third attempt", async () => {
  const issuer = new SequenceTokenIssuer([
    tokenResponse("token-a"),
    tokenResponse("token-b"),
    tokenResponse("token-c")
  ]);
  const authClient = new TossOpenApiAuthClient(readyConfig(), issuer, {
    now: () => new Date("2026-06-17T09:00:00+09:00")
  });
  const authorizations: string[] = [];
  const transport: TossOpenApiReadOnlyTransport = {
    async request(request) {
      authorizations.push(request.headers.Authorization);
      if (request.headers.Authorization !== "Bearer token-c") {
        return { status: 401, body: { error: { code: "invalid-token" } } };
      }
      return { status: 200, body: { token: "c" } };
    }
  };
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    authClient,
    transport
  );

  await assert.rejects(
    () => client.getJson("/api/v1/prices"),
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_AUTH_FAILED"
  );
  assert.equal(issuer.requests.length, 2);
  assert.deepEqual(authorizations, ["Bearer token-a", "Bearer token-b"]);

  assert.deepEqual(await client.getJson("/api/v1/prices"), { token: "c" });
  assert.equal(issuer.requests.length, 3);
  assert.deepEqual(authorizations, [
    "Bearer token-a",
    "Bearer token-b",
    "Bearer token-c"
  ]);
});

test("a stale retry 401 cannot clear a concurrently issued current lease", async () => {
  const issuer = new SequenceTokenIssuer([
    tokenResponse("token-a"),
    tokenResponse("token-b"),
    tokenResponse("token-c"),
    tokenResponse("unexpected-token-d")
  ]);
  const authClient = new TossOpenApiAuthClient(readyConfig(), issuer, {
    now: () => new Date("2026-06-17T09:00:00+09:00")
  });
  const firstTokenBStarted = deferred();
  const releaseFirstTokenB = deferred();
  const authorizations: string[] = [];
  let tokenBCount = 0;
  const transport: TossOpenApiReadOnlyTransport = {
    async request(request) {
      authorizations.push(request.headers.Authorization);
      if (request.headers.Authorization === "Bearer token-a") {
        return { status: 401, body: { error: { code: "expired-token" } } };
      }
      if (request.headers.Authorization === "Bearer token-b") {
        tokenBCount += 1;
        if (tokenBCount === 1) {
          firstTokenBStarted.resolve();
          await releaseFirstTokenB.promise;
        }
        return { status: 401, body: { error: { code: "expired-token" } } };
      }
      return { status: 200, body: { token: "c" } };
    }
  };
  const client = new TossOpenApiReadOnlyHttpClient(
    readyConfig(),
    authClient,
    transport
  );

  const staleRetry = client.getJson("/api/v1/prices");
  await firstTokenBStarted.promise;
  assert.deepEqual(await client.getJson("/api/v1/prices"), { token: "c" });
  releaseFirstTokenB.resolve();
  await assert.rejects(
    () => staleRetry,
    (error) =>
      error instanceof TossOpenApiReadOnlyHttpClientError &&
      error.code === "TOSS_OPEN_API_READONLY_AUTH_FAILED"
  );

  assert.deepEqual(await client.getJson("/api/v1/prices"), { token: "c" });
  assert.equal(issuer.requests.length, 3);
  assert.deepEqual(authorizations, [
    "Bearer token-a",
    "Bearer token-b",
    "Bearer token-b",
    "Bearer token-c",
    "Bearer token-c"
  ]);
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
      { status: 400, body: { error: { code: "account-header-required" } } }
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
      error.responseCode === "account-header-required"
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
