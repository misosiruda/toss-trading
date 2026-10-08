import assert from "node:assert/strict";
import test from "node:test";
import { prepareReplaySettingsSnapshot, replaySettingsSnapshotSchema } from "./replaySettingsSnapshot.js";
import { allSettings, atPath, leafPaths, recordedSettings, replacePath } from "./replaySettingsSnapshotTestFixtures.js";

const sensitive = ["account:123456-123-123456", "abcdefghijklmnop.abcdefgh.ijklmnop", "ord_abcdef", "exec_abcdef",
  "https://fixture.invalid/path?token=SYNTHETIC_PRIVATE", "https://fixture.invalid/path?%2574oken=SYNTHETIC_PRIVATE",
  "https://fixture.invalid/path?access_token=SYNTHETIC_PRIVATE", "https://fixture.invalid/#refresh-token=SYNTHETIC_PRIVATE",
  "source=token=SYNTHETIC_PRIVATE", "source.token=SYNTHETIC_PRIVATE", "source[token]=SYNTHETIC_PRIVATE",
  "Authorization: Bearer SYNTHETIC_PRIVATE", "Proxy-Authorization: Basic U1lOVEhFVElDX09OTFk=", "Bearer SYNTHETIC_PRIVATE",
  "X-Api-Key: SYNTHETIC_PRIVATE", "X-Auth-Token: SYNTHETIC_PRIVATE", "Cookie: session=SYNTHETIC_PRIVATE",
  '{"client_secret":"SYNTHETIC_PRIVATE"}', "https://synthetic:PRIVATE@fixture.invalid/path", "token\\u003dSYNTHETIC_PRIVATE",
  "-----BEGIN RSA PRIVATE KEY-----"];

test("every selected string including enums uses the existing masking and credential syntax guard", () => {
  for (const path of leafPaths(allSettings())) {
    if (typeof atPath(allSettings(), path) !== "string") continue;
    for (const value of sensitive) {
      const input = allSettings(); replacePath(input, path, value);
      const observed = prepareReplaySettingsSnapshot(input);
      assert.deepEqual(observed, { status: "unavailable", reason: "redacted" }, path.join("."));
      assert.equal(JSON.stringify(observed).includes(value), false);
      assert.equal(replaySettingsSnapshotSchema.safeParse(input).success, false);
    }
  }
});

test("public IDs, URL paths and token words remain byte-for-byte available in all free-text fields", () => {
  const paths = [["packetIdPrefix"], ["allocationPolicy", "policyName"], ["marketRegimeAllocationPolicy", "policyNameSuffix"],
    ["riskPolicy", "cooldownEntries", 0, "symbol"], ["riskPolicy", "cooldownEntries", 0, "activeUntil"],
    ["riskPolicy", "cooldownEntries", 0, "reason"], ["universeManifest", "symbols", 0, "symbol"]];
  const publicText = ["source_packet", "synthetic_packet_001", "token market documentation", "bearer-bond reference",
    "https://fixture.invalid/token/history?symbol=SYNTH&count=5", "https://fixture.invalid/docs?q=token",
    "https://fixture.invalid/data?token_count=10", "https://fixture.invalid/data?wordtoken=public",
    "https://fixture.invalid/data?monkey=public", "https://fixture.invalid/%74oken/history",
    "https://fixture.invalid/data?name=public%20series"];
  for (const path of paths) for (const value of publicText) {
    const input = allSettings(); replacePath(input, path, value);
    assert.equal(atPath(recordedSettings(input).snapshot, path), value);
  }
});
