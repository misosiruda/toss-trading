import assert from "node:assert/strict";
import test from "node:test";
import { prepareReplaySourceSnapshot, replaySourceSnapshotObservationSchema } from "./replaySourceSnapshot.js";
import { minimalSourceSnapshot } from "./replaySourceSnapshotTestFixtures.js";

const credentialStrings = [
  "https://fixture.invalid/path?token=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?access_token=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path#refresh-token=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?api_key=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?%74oken=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?%2574oken=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?%74oken=SYNTHETIC_PRIVATE_ACCESS&bad=%ZZ",
  "Authorization: Bearer SYNTHETIC_PRIVATE_ACCESS",
  "source=Authorization: Bearer SYNTHETIC_PRIVATE_ACCESS",
  "source=token=SYNTHETIC_PRIVATE_ACCESS",
  "source.token=SYNTHETIC_PRIVATE_ACCESS",
  "source-token=SYNTHETIC_PRIVATE_ACCESS",
  "source_token=SYNTHETIC_PRIVATE_ACCESS",
  "source[token]=SYNTHETIC_PRIVATE_ACCESS",
  "token[]=SYNTHETIC_PRIVATE_ACCESS",
  '{"source":"Authorization: Bearer SYNTHETIC_PRIVATE_ACCESS"}',
  "authorization \t: bearer\tSYNTHETIC_PRIVATE_ACCESS",
  "Proxy-Authorization: Basic U1lOVEhFVElDX09OTFk=",
  "Bearer SYNTHETIC_PRIVATE_ACCESS",
  "X-Api-Key: SYNTHETIC_PRIVATE_ACCESS",
  "X-Auth-Token: SYNTHETIC_PRIVATE_ACCESS",
  "X-API-Token: SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?auth_token=SYNTHETIC_PRIVATE_ACCESS",
  "https://fixture.invalid/path?api_token=SYNTHETIC_PRIVATE_ACCESS",
  "Cookie: session=SYNTHETIC_PRIVATE_ACCESS",
  '{"client_secret":"SYNTHETIC_PRIVATE_ACCESS"}',
  "https://synthetic:SYNTHETIC_PRIVATE_ACCESS@fixture.invalid/path",
  "token\\u003dSYNTHETIC_PRIVATE_ACCESS",
  "-----BEGIN RSA PRIVATE KEY-----"
];

for (const value of credentialStrings) {
  test(`credential-bearing source text is unavailable before snapshot or hash: ${credentialStrings.indexOf(value)}`, () => {
    for (const field of ["snapshotId", "symbol", "name", "sector", "sourceRefs"] as const) {
      const snapshot = { ...minimalSourceSnapshot(), [field]: field === "sourceRefs" ? [value] : value };
      const observed = prepareReplaySourceSnapshot([snapshot]);
      assert.deepEqual(observed, { status: "unavailable", reason: "redacted" });
      assert.equal(JSON.stringify(observed).includes("SYNTHETIC_PRIVATE_ACCESS"), false);
      assert.equal(replaySourceSnapshotObservationSchema.safeParse({ status: "recorded", snapshotVersion: "replay_source_snapshot.v1",
        snapshot: [snapshot], contentHash: `sha256:${"a".repeat(64)}` }).success, false);
    }
  });
}

test("ordinary public source URLs and token words preserve their exact recorded contents", () => {
  const publicText = ["https://fixture.invalid/token/history?symbol=SYNTH&count=5", "https://fixture.invalid/docs?q=token",
    "https://fixture.invalid/data?token_count=10", "https://fixture.invalid/data?wordtoken=public", "https://fixture.invalid/data?monkey=public", "https://fixture.invalid/%74oken/history",
    "https://fixture.invalid/data?name=public%20series", "token market documentation", "bearer-bond reference", "source_ordinary_001"];
  for (const value of publicText) {
    const snapshot = { ...minimalSourceSnapshot(), name: value, sourceRefs: [value] };
    const observed = prepareReplaySourceSnapshot([snapshot]);
    assert.equal(observed.status, "recorded", value);
    if (observed.status === "recorded") assert.deepEqual(observed.snapshot, [snapshot]);
  }
});
