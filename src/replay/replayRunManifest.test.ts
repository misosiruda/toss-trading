import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWithSchema,
  replayResearchManifestSchema,
  type ReplayResearchManifest
} from "../domain/schemas.js";
import {
  createReplayResearchHash,
  createReplayResearchManifest,
  stableStringifyResearchInput,
  type CreateReplayResearchManifestInput
} from "./replayRunManifest.js";

test("research hash is deterministic across object key order", () => {
  const first = {
    risk: { maxPositionWeightRatio: 0.2, minCashReserveRatio: 0.1 },
    config: { runs: 10, seed: "batch-seed-001" }
  };
  const second = {
    config: { seed: "batch-seed-001", runs: 10 },
    risk: { minCashReserveRatio: 0.1, maxPositionWeightRatio: 0.2 }
  };

  assert.match(createReplayResearchHash(first), /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    createReplayResearchHash(first),
    createReplayResearchHash(second)
  );
});

test("research hash changes when canonical input changes", () => {
  const first = { config: { runs: 10, seed: "batch-seed-001" } };
  const second = { config: { runs: 11, seed: "batch-seed-001" } };

  assert.notEqual(
    createReplayResearchHash(first),
    createReplayResearchHash(second)
  );
});

test("research hash canonicalizes Date values as ISO strings", () => {
  const date = new Date("2026-06-11T00:00:00.000Z");

  assert.equal(
    stableStringifyResearchInput({ createdAt: date }),
    '{"createdAt":"2026-06-11T00:00:00.000Z"}'
  );
  assert.equal(
    createReplayResearchHash({ createdAt: date }),
    createReplayResearchHash({ createdAt: "2026-06-11T00:00:00.000Z" })
  );
});

test("research hash preserves own __proto__ keys", () => {
  const withProtoKey = JSON.parse('{"__proto__":{"x":1}}') as Record<
    string,
    unknown
  >;

  assert.equal(
    stableStringifyResearchInput(withProtoKey),
    '{"__proto__":{"x":1}}'
  );
  assert.notEqual(
    createReplayResearchHash({}),
    createReplayResearchHash(withProtoKey)
  );
});

test("research hash uses locale-independent UTF-8 key ordering", () => {
  const input = {
    가: 3,
    ä: 2,
    z: 1
  };

  assert.equal(stableStringifyResearchInput(input), '{"z":1,"ä":2,"가":3}');
  assert.equal(
    createReplayResearchHash(input),
    createReplayResearchHash({ z: 1, ä: 2, 가: 3 })
  );
});

test("research hash rejects sparse arrays before JSON serialization", () => {
  const sparse = new Array<unknown>(1);
  const deleted = [null];
  delete deleted[0];

  assert.equal(stableStringifyResearchInput([null]), "[null]");
  assert.throws(() => createReplayResearchHash(sparse), /sparse array hole/);
  assert.throws(() => createReplayResearchHash(deleted), /sparse array hole/);
});

test("research hash rejects non JSON-compatible values", () => {
  assert.throws(
    () => createReplayResearchHash({ config: undefined }),
    /JSON-compatible/
  );
  assert.throws(
    () => createReplayResearchHash({ value: Number.NaN }),
    /non-finite/
  );
  assert.throws(
    () => createReplayResearchHash(new Map([["runs", 10]])),
    /plain data/
  );
});

test("creates paper-only replay research manifest with reproducibility hashes", () => {
  const manifest = createReplayResearchManifest(manifestInput());

  assert.equal(manifest.manifestVersion, "replay_research_manifest.v1");
  assert.equal(manifest.mode, "paper_only");
  assert.equal(manifest.runId, "batch_001_run_000001");
  assert.equal(manifest.batchId, "batch_001");
  assert.equal(manifest.createdAt, "2026-06-11T00:00:00.000Z");
  assert.match(manifest.configHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.dataSnapshotHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.universeHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.coverageHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.promptHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.schemaHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.riskPolicyHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(manifest.costModelHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(manifest.executionModelVersion, "execution_simulator.v0");
  assert.deepEqual(manifest.warnings, []);
});

test("manifest schema rejects malformed hashes", () => {
  const manifest: ReplayResearchManifest = createReplayResearchManifest(
    manifestInput()
  );

  assert.throws(
    () =>
      parseWithSchema(
        replayResearchManifestSchema,
        {
          ...manifest,
          configHash: "not-a-hash"
        },
        "replayResearchManifest"
      ),
    /sha256/
  );
});

test("manifest supports single replay runs without a batch id", () => {
  const manifest = createReplayResearchManifest({
    ...manifestInput(),
    batchId: null,
    warnings: ["legacy run metadata is not attached yet"]
  });

  assert.equal(manifest.batchId, null);
  assert.deepEqual(manifest.warnings, [
    "legacy run metadata is not attached yet"
  ]);
});

function manifestInput(): CreateReplayResearchManifestInput {
  return {
    runId: "batch_001_run_000001",
    batchId: "batch_001",
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    config: {
      runCount: 10,
      seed: "batch-seed-001",
      decisionFrequency: "once_per_week"
    },
    dataSnapshot: {
      sourceDataDir: "data/replay-fixture",
      historicalMarketSnapshotsFileName: "historical-market-snapshots.jsonl"
    },
    universe: {
      universeId: "global-broad",
      symbols: ["KR:005930", "US:AAPL"]
    },
    coverage: {
      status: "available",
      totalSnapshotCount: 128,
      corruptLineCount: 0
    },
    prompt: {
      provider: "deterministic_fixture",
      promptVersion: "not_applicable"
    },
    schema: {
      marketPacketSchemaVersion: "current",
      virtualDecisionSchemaVersion: "current"
    },
    riskPolicy: {
      maxPositionWeightRatio: 0.2,
      minCashReserveRatio: 0.1
    },
    costModel: {
      version: "not_configured"
    },
    executionModelVersion: "execution_simulator.v0"
  };
}
