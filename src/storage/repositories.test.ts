import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEvent, VirtualPortfolio } from "../domain/schemas.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileVirtualPortfolioStore
} from "./repositories.js";

async function createTempStoragePaths() {
  const dir = await mkdtemp(join(tmpdir(), "toss-trading-test-"));
  return createStoragePaths(dir);
}

function auditEvent(id: string): AuditEvent {
  return {
    eventId: id,
    eventType: "TEST_EVENT",
    actor: "system",
    summary: "Test event",
    maskedRefs: [],
    createdAt: "2026-06-11T09:00:00+09:00"
  };
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T09:00:00+09:00"
  };
}

test("audit log appends and reads events", async () => {
  const paths = await createTempStoragePaths();
  const auditLog = new FileAuditLog(paths.auditLogPath);

  await auditLog.append(auditEvent("audit_001"));
  await auditLog.append(auditEvent("audit_002"));

  const result = await auditLog.readAll();
  assert.equal(result.corruptLineCount, 0);
  assert.deepEqual(
    result.records.map((event) => event.eventId),
    ["audit_001", "audit_002"]
  );
});

test("virtual portfolio store writes and reads current portfolio", async () => {
  const paths = await createTempStoragePaths();
  const store = new FileVirtualPortfolioStore(paths.virtualPortfolioPath);

  await store.write(portfolio());

  const loaded = await store.read();
  assert.equal(loaded?.portfolioId, "virtual_default");
  assert.equal(loaded?.cashKrw, 1_000_000);
});

test("jsonl store reports corrupted lines without dropping valid records", async () => {
  const paths = await createTempStoragePaths();
  await writeFile(
    paths.auditLogPath,
    `${JSON.stringify(auditEvent("audit_valid_001"))}\nnot-json\n${JSON.stringify(auditEvent("audit_valid_002"))}\n`,
    "utf8"
  );

  const result = await new FileAuditLog(paths.auditLogPath).readAll();
  assert.equal(result.corruptLineCount, 1);
  assert.deepEqual(
    result.records.map((event) => event.eventId),
    ["audit_valid_001", "audit_valid_002"]
  );
});
