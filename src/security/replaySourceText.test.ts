import assert from "node:assert/strict";
import test from "node:test";
import { containsReplaySourceCredential } from "./replaySourceText.js";

test("credential key runs preserve assignments across punctuation, wrappers and long prefixes", () => {
  for (const prefix of ["", "source.", "source-", "source_", "...", "---", ".".repeat(3_900)]) {
    for (const key of ["api_key", "access_token", "client.secret", "password", "source.token"]) {
      assert.equal(containsReplaySourceCredential(`${prefix}${key}=SYNTHETIC_PRIVATE`), true);
    }
  }
  for (const value of ["prefix[api_key]=SYNTHETIC_PRIVATE", '{"client_secret":"SYNTHETIC_PRIVATE"}',
    "source=Authorization: Bearer SYNTHETIC_PRIVATE", "https://example.test/?%2561pi_key=SYNTHETIC_PRIVATE",
    "token\\u003dSYNTHETIC_PRIVATE", "Bearer SYNTHETIC_PRIVATE", "-----BEGIN RSA PRIVATE KEY-----"]) {
    assert.equal(containsReplaySourceCredential(value), true);
  }
});

test("userinfo detection does not depend on an optional URL scheme prefix", () => {
  for (const value of ["//synthetic:secret@example.test", "https://synthetic@example.test/path",
    "custom+scheme://synthetic@example.test", "label://synthetic@example.test/?public=1", "//synthetic@example.test"]) {
    assert.equal(containsReplaySourceCredential(value), true);
  }
  for (const value of ["https://example.test/path@public", "https://example.test/path?email=public@example.test",
    "https://example.test/#public@example.test", "https://example.test/public", "https://example.test/token/history?token_count=5"]) {
    assert.equal(containsReplaySourceCredential(value), false);
  }
});

test("maximum bounded punctuation and public key runs remain ordinary input", () => {
  for (const value of [".".repeat(4_094) + " !", "X".repeat(4_095) + " ",
    "https://example.test/" + ".".repeat(4_000), ".".repeat(3_900) + "wordtoken=public",
    "---token_count=10", "source.monkey=public", "token market documentation"]) {
    assert.ok(value.length <= 4_096);
    assert.equal(containsReplaySourceCredential(value), false);
  }
});
