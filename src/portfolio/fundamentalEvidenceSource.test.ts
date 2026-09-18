import assert from "node:assert/strict";
import test from "node:test";
import { createFundamentalEvidenceRecord, parseFundamentalEvidenceRecord } from "./fundamentalEvidenceSource.js";
import { FundamentalEvidenceFileRepository } from "./fundamentalEvidenceFiles.js";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const input = { sourceContractId: "credential-free-fundamental.v1" as const, issuerId: "issuer-a", symbol: "ABC", fiscalPeriod: "FY2025",
  observedAt: "2026-01-01T00:00:00.000Z", sourceUri: "https://example.test/abc/fy2025", sourceDocumentHash: `sha256:${"a".repeat(64)}`,
  metrics: [{ name: "revenue", value: 100, unit: "KRW", periodEnd: "2025-12-31T00:00:00.000Z" }], quality: "reported" as const };

test("credential-free fundamental evidence preserves immutable provenance and exact retry", () => {
  const record = createFundamentalEvidenceRecord({ ...input, createdAt: "2026-01-02T00:00:00.000Z" });
  assert.ok(Object.isFrozen(record)); assert.ok(Object.isFrozen(record.metrics));
  assert.deepEqual(parseFundamentalEvidenceRecord(record), record);
});
test("fundamental evidence rejects future observations, duplicate metrics and unavailable quality", () => {
  assert.throws(() => createFundamentalEvidenceRecord({ ...input, createdAt: "2025-12-31T00:00:00.000Z" }), /before observation/);
  const row = input.metrics[0]!;
  assert.throws(() => createFundamentalEvidenceRecord({ ...input, metrics: [row, row], createdAt: "2026-01-02T00:00:00.000Z" }), /duplicate/);
  assert.throws(() => createFundamentalEvidenceRecord({ ...input, quality: "unavailable", createdAt: "2026-01-02T00:00:00.000Z" }), /unavailable/);
});
test("fundamental evidence repository persists exact retries and replays the journal", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "fundamental-evidence-"));
  try {
    const repo = new FundamentalEvidenceFileRepository(dir);
    const record = await repo.append({ ...input, createdAt: "2026-01-02T00:00:00.000Z" });
    assert.deepEqual(await repo.append({ ...input, createdAt: "2026-01-02T00:00:00.000Z" }), record);
    assert.deepEqual(await new FundamentalEvidenceFileRepository(dir).readAll(), [record]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test("fundamental evidence repository rejects a torn or rehashed journal", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "fundamental-evidence-corrupt-"));
  try {
    const repo = new FundamentalEvidenceFileRepository(dir);
    await repo.append({ ...input, createdAt: "2026-01-02T00:00:00.000Z" });
    const path = join(dir, "fundamental-evidence-records.jsonl"); const bytes = await fs.readFile(path);
    await fs.writeFile(path, bytes.subarray(0, -1));
    await assert.rejects(new FundamentalEvidenceFileRepository(dir).readAll(), /torn/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
