import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TOSS_OPEN_API_BASE_URL,
  readTossOpenApiAuthConfig,
  summarizeTossOpenApiAuthConfig
} from "./tossOpenApiAuthConfig.js";

test("Toss Open API auth config keeps safe disabled default", () => {
  const config = readTossOpenApiAuthConfig({});

  assert.deepEqual(config, {
    enabled: false,
    status: "disabled",
    baseUrl: DEFAULT_TOSS_OPEN_API_BASE_URL,
    issues: []
  });
});

test("Toss Open API auth config fails closed when enabled without secrets", () => {
  const config = readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true"
  });

  assert.equal(config.status, "invalid");
  assert.deepEqual(
    config.issues.map((issue) => issue.code),
    ["MISSING_CLIENT_ID", "MISSING_CLIENT_SECRET"]
  );
});

test("Toss Open API auth config trims placeholder secrets and becomes ready", () => {
  const config = readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_BASE_URL: " https://openapi.tossinvest.com ",
    TOSS_OPEN_API_CLIENT_ID: " local-client-id ",
    TOSS_OPEN_API_CLIENT_SECRET: " local-client-secret "
  });

  assert.deepEqual(config, {
    enabled: true,
    status: "ready",
    baseUrl: "https://openapi.tossinvest.com",
    issues: [],
    clientId: "local-client-id",
    clientSecret: "local-client-secret"
  });
});

test("Toss Open API auth config rejects non-https base URL when enabled", () => {
  const config = readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_BASE_URL: "http://localhost:8787",
    TOSS_OPEN_API_CLIENT_ID: "local-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "local-client-secret"
  });

  assert.equal(config.status, "invalid");
  assert.deepEqual(
    config.issues.map((issue) => issue.code),
    ["INVALID_BASE_URL"]
  );
});

test("Toss Open API auth summary does not expose credential values", () => {
  const config = readTossOpenApiAuthConfig({
    TOSS_OPEN_API_AUTH_ENABLED: "true",
    TOSS_OPEN_API_CLIENT_ID: "local-client-id",
    TOSS_OPEN_API_CLIENT_SECRET: "local-client-secret"
  });
  const summary = summarizeTossOpenApiAuthConfig(config);
  const serialized = JSON.stringify(summary);

  assert.deepEqual(summary, {
    enabled: true,
    status: "ready",
    baseUrl: DEFAULT_TOSS_OPEN_API_BASE_URL,
    hasClientId: true,
    hasClientSecret: true,
    issues: []
  });
  assert.equal(serialized.includes("local-client-id"), false);
  assert.equal(serialized.includes("local-client-secret"), false);
});
