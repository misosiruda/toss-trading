import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonlStore } from "../storage/jsonlStore.js";
import {
  bucketSelectionPolicyRecordSchema,
  createBucketSelectionPolicyRecord,
  selectionPolicyRefFor
} from "./runtimePolicyContracts.js";
import {
  ImmutablePolicyDependencyFileLoader,
  createImmutablePolicyDependencyPaths
} from "./runtimePolicyDependencyFiles.js";

const CREATED_AT = "2026-08-28T00:00:00.000Z";

test("dependency loader returns an empty fail-closed repository for missing files", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir).load();

    assert.deepEqual(loaded.records.selectionPolicies, []);
    assert.equal(Object.isFrozen(loaded.records), true);
    assert.throws(
      () =>
        loaded.repository.resolveSelectionPolicy({
          selectionPolicyRecordId: "selection_policy_missing",
          version: "selection.v1",
          hash: `sha256:${"0".repeat(64)}`
        }),
      /selection policy ref does not resolve/
    );
  });
});

test("dependency loader reads verified records from the documented artifact path", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await new JsonlStore(
      paths.selectionPolicies,
      bucketSelectionPolicyRecordSchema,
      "bucketSelectionPolicyRecord"
    ).append(record);

    const loaded = await new ImmutablePolicyDependencyFileLoader(baseDir).load();
    assert.equal(loaded.records.selectionPolicies.length, 1);
    assert.deepEqual(
      loaded.repository.resolveSelectionPolicy(selectionPolicyRefFor(record)),
      record
    );
    assert.equal(
      paths.selectionPolicies,
      join(baseDir, "bucket-selection-policy-records.jsonl")
    );
  });
});

test("dependency loader rejects malformed JSONL instead of accepting a partial set", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await appendFile(paths.riskRuleSets, "{not-json}\n", "utf8");

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /riskRuleSets:1/
    );
  });
});

test("dependency loader rejects semantic hash tamper after JSON schema parsing", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    await new JsonlStore(
      paths.selectionPolicies,
      bucketSelectionPolicyRecordSchema,
      "bucketSelectionPolicyRecord"
    ).append({ ...record, scoringModelVersion: "selector.v2" });

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /record hash mismatch/
    );
  });
});

test("dependency loader rejects duplicate immutable IDs", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const record = selectionPolicyRecord();
    const paths = createImmutablePolicyDependencyPaths(baseDir);
    const store = new JsonlStore(
      paths.selectionPolicies,
      bucketSelectionPolicyRecordSchema,
      "bucketSelectionPolicyRecord"
    );
    await store.append(record);
    await store.append(record);

    await assert.rejects(
      () => new ImmutablePolicyDependencyFileLoader(baseDir).load(),
      /record ID must resolve exactly once/
    );
  });
});

function selectionPolicyRecord() {
  return createBucketSelectionPolicyRecord({
    bucket: "swing",
    version: "selection.v1",
    requiredEvidence: [
      {
        evidenceClass: "market_technical",
        sourceContractId: "verified-market-packet.v1",
        maximumAgeSeconds: 60
      }
    ],
    hardGateRuleIds: ["liquidity"],
    scoringModelVersion: "selector.v1",
    featureDefinitionRefs: ["momentum.v1"],
    createdAt: CREATED_AT
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "policy-dependencies-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}
