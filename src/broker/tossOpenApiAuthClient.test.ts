import assert from "node:assert/strict";
import test from "node:test";

import { readTossOpenApiAuthConfig } from "../config/tossOpenApiAuthConfig.js";
import {
  buildTossOpenApiTokenIssueRequest,
  parseTossOpenApiTokenIssueResponse,
  TossOpenApiAuthClient,
  TossOpenApiAuthClientError,
  type TossOpenApiTokenIssueRequest,
  type TossOpenApiTokenIssueResponse,
  type TossOpenApiTokenIssuer
} from "./tossOpenApiAuthClient.js";

class FakeTokenIssuer implements TossOpenApiTokenIssuer {
  readonly requests: TossOpenApiTokenIssueRequest[] = [];
  private readonly responses: TossOpenApiTokenIssueResponse[];

  constructor(responses: TossOpenApiTokenIssueResponse[]) {
    this.responses = [...responses];
  }

  async issueToken(
    request: TossOpenApiTokenIssueRequest
  ): Promise<TossOpenApiTokenIssueResponse> {
    this.requests.push(request);
    return (
      this.responses.shift() ?? {
        access_token: "fallback-token",
        token_type: "Bearer",
        expires_in: 3600
      }
    );
  }
}

function readyConfig() {
  return readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_CLIENT_ID: "local-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "local-client-secret"
  });
}

test("token issue request uses form-urlencoded client credentials", () => {
  const request = buildTossOpenApiTokenIssueRequest(readyConfig());
  const params = new URLSearchParams(request.body);

  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://openapi.tossinvest.com/oauth2/token");
  assert.equal(
    request.headers["Content-Type"],
    "application/x-www-form-urlencoded"
  );
  assert.equal(request.headers.Accept, "application/json");
  assert.equal(params.get("grant_type"), "client_credentials");
  assert.equal(params.get("client_id"), "local-client-id");
  assert.equal(params.get("client_secret"), "local-client-secret");
});

test("token issue request builder refuses disabled config", () => {
  assert.throws(
    () => buildTossOpenApiTokenIssueRequest(readTossOpenApiAuthConfig({})),
    (error) =>
      error instanceof TossOpenApiAuthClientError &&
      error.code === "TOSS_OPEN_API_AUTH_DISABLED"
  );
});

test("auth client refuses disabled config before issuing token", async () => {
  const issuer = new FakeTokenIssuer([]);
  const client = new TossOpenApiAuthClient(
    readTossOpenApiAuthConfig({}),
    issuer
  );

  await assert.rejects(
    () => client.getAccessToken(),
    (error) =>
      error instanceof TossOpenApiAuthClientError &&
      error.code === "TOSS_OPEN_API_AUTH_DISABLED"
  );
  assert.equal(issuer.requests.length, 0);
});

test("auth client refuses invalid config before issuing token", async () => {
  const issuer = new FakeTokenIssuer([]);
  const client = new TossOpenApiAuthClient(
    readTossOpenApiAuthConfig({ TOSS_OPEN_API_AUTH_ENABLED: "true" }),
    issuer
  );

  await assert.rejects(
    () => client.getAccessToken(),
    (error) =>
      error instanceof TossOpenApiAuthClientError &&
      error.code === "TOSS_OPEN_API_AUTH_INVALID_CONFIG" &&
      error.message.includes("MISSING_CLIENT_ID") &&
      error.message.includes("MISSING_CLIENT_SECRET")
  );
  assert.equal(issuer.requests.length, 0);
});

test("auth client caches token until expiry safety margin", async () => {
  let now = new Date("2026-06-17T09:00:00+09:00");
  const issuer = new FakeTokenIssuer([
    { access_token: "first-token", token_type: "Bearer", expires_in: 120 },
    { access_token: "second-token", token_type: "Bearer", expires_in: 120 }
  ]);
  const client = new TossOpenApiAuthClient(readyConfig(), issuer, {
    now: () => now,
    expirySafetyMarginMs: 30_000
  });

  assert.equal(await client.getAccessToken(), "first-token");
  now = new Date("2026-06-17T09:01:20+09:00");
  assert.equal(await client.getAccessToken(), "first-token");
  now = new Date("2026-06-17T09:01:31+09:00");
  assert.equal(await client.getAccessToken(), "second-token");
  assert.equal(issuer.requests.length, 2);
});

test("auth client collapses concurrent token requests into one issue call", async () => {
  let release: ((response: TossOpenApiTokenIssueResponse) => void) | undefined;
  const issuer: TossOpenApiTokenIssuer = {
    async issueToken() {
      return new Promise<TossOpenApiTokenIssueResponse>((resolve) => {
        release = resolve;
      });
    }
  };
  const client = new TossOpenApiAuthClient(readyConfig(), issuer, {
    now: () => new Date("2026-06-17T09:00:00+09:00")
  });

  const first = client.getAccessToken();
  const second = client.getAccessToken();
  release?.({
    access_token: "single-flight-token",
    token_type: "Bearer",
    expires_in: 3600
  });

  assert.deepEqual(await Promise.all([first, second]), [
    "single-flight-token",
    "single-flight-token"
  ]);
});

test("invalid token response is rejected and not cached", async () => {
  const issuer = new FakeTokenIssuer([
    { access_token: "", token_type: "Bearer", expires_in: 3600 },
    { access_token: "valid-token", token_type: "Bearer", expires_in: 3600 }
  ]);
  const client = new TossOpenApiAuthClient(readyConfig(), issuer, {
    now: () => new Date("2026-06-17T09:00:00+09:00")
  });

  await assert.rejects(
    () => client.getAccessToken(),
    (error) =>
      error instanceof TossOpenApiAuthClientError &&
      error.code === "TOSS_OPEN_API_INVALID_TOKEN_RESPONSE"
  );
  assert.equal(await client.getAccessToken(), "valid-token");
  assert.equal(issuer.requests.length, 2);
});

test("token response parser rejects non-Bearer token type", () => {
  assert.throws(
    () =>
      parseTossOpenApiTokenIssueResponse(
        { access_token: "token", token_type: "Basic", expires_in: 3600 },
        new Date("2026-06-17T09:00:00+09:00")
      ),
    (error) =>
      error instanceof TossOpenApiAuthClientError &&
      error.code === "TOSS_OPEN_API_INVALID_TOKEN_RESPONSE"
  );
});

test("token response parser rejects malformed response shapes", () => {
  const malformedResponses: unknown[] = [
    {},
    { access_token: null, token_type: "Bearer", expires_in: 3600 },
    { access_token: "token", token_type: null, expires_in: 3600 },
    { access_token: "token", token_type: "Bearer", expires_in: "3600" }
  ];

  for (const response of malformedResponses) {
    assert.throws(
      () =>
        parseTossOpenApiTokenIssueResponse(
          response,
          new Date("2026-06-17T09:00:00+09:00")
        ),
      (error) =>
        error instanceof TossOpenApiAuthClientError &&
        error.code === "TOSS_OPEN_API_INVALID_TOKEN_RESPONSE"
    );
  }
});
