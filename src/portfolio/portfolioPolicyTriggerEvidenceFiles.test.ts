import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioPolicyTriggerEvidenceRecord } from "./portfolioPolicyTriggerEvidence.js";
import {
  PortfolioPolicyTriggerEvidenceFileRepository,
  createPortfolioPolicyTriggerEvidencePaths,
  getVerifiedPortfolioPolicyTriggerEvidenceRecords,
  parseVerifiedPortfolioPolicyTriggerEvidenceHistory,
  type VerifiedPortfolioPolicyTriggerEvidenceHistory
} from "./portfolioPolicyTriggerEvidenceFiles.js";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;
const SOURCE_HASH = `sha256:${"b".repeat(64)}`;

test("policy trigger evidence repository appends, resolves, and converges semantic retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioPolicyTriggerEvidenceFileRepository(baseDir);
    const first = policyEvidence();
    const retry = policyEvidence({ createdAt: "2026-09-03T00:00:03.000Z" });

    assert.deepEqual(await repository.append(first), first);
    assert.deepEqual(await repository.append(retry), first);
    assert.deepEqual(await repository.resolveByRef(first.evidenceRef), first);
    assert.deepEqual(await repository.readAll(), [first]);
    const history = await repository.readVerifiedHistory();
    assert.deepEqual(history.records, [first]);
    assert.deepEqual(getVerifiedPortfolioPolicyTriggerEvidenceRecords(history), [
      first
    ]);
    const raw = await readFile(
      createPortfolioPolicyTriggerEvidencePaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(first)}\n`);
  });
});

test("policy trigger evidence repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioPolicyTriggerEvidenceFileRepository(baseDir);
    const candidate = policyEvidence();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(candidate))
    );

    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [candidate]);
  });
});

test("policy trigger evidence repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "policy-evidence.json");
    const candidate = policyEvidence();
    await writeFile(fixturePath, JSON.stringify(candidate), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );

    assert.deepEqual(stored, [candidate, candidate, candidate, candidate]);
    assert.deepEqual(
      await new PortfolioPolicyTriggerEvidenceFileRepository(baseDir).readAll(),
      [candidate]
    );
  });
});

test("policy trigger evidence repository preserves distinct immutable records", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioPolicyTriggerEvidenceFileRepository(baseDir);
    const first = policyEvidence();
    const second = policyEvidence({ sourceArtifactId: "regime-artifact-2" });

    await repository.append(first);
    await repository.append(second);
    assert.deepEqual(await repository.readAll(), [first, second]);
    await assert.rejects(
      () => repository.resolveByRef("missing"),
      /does not resolve exactly once/
    );
  });
});

test("policy trigger evidence repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioPolicyTriggerEvidencePaths(baseDir);
    const candidate = policyEvidence();
    const repository = new PortfolioPolicyTriggerEvidenceFileRepository(baseDir);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n{`, "utf8");
    await assert.rejects(() => repository.readAll(), /torn final line/);

    await writeFile(paths.recordsPath, `${JSON.stringify(candidate)}\n\n`, "utf8");
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify({
        ...candidate,
        currentRegime: "bull"
      })}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /corrupt line 2/);

    await writeFile(
      paths.recordsPath,
      `${JSON.stringify(candidate)}\n${JSON.stringify(candidate)}\n`,
      "utf8"
    );
    await assert.rejects(() => repository.readAll(), /duplicate ref/);
  });
});

test("policy trigger evidence verified history rejects forged identities", () => {
  assert.throws(
    () =>
      getVerifiedPortfolioPolicyTriggerEvidenceRecords({
        records: []
      } as unknown as VerifiedPortfolioPolicyTriggerEvidenceHistory),
    /history is not verified/
  );

  const record = policyEvidence();
  const valid = parseVerifiedPortfolioPolicyTriggerEvidenceHistory(
    `${JSON.stringify(record)}\n`
  );
  const forged = Object.create(valid) as {
    records: readonly ReturnType<typeof policyEvidence>[];
  };
  Object.defineProperty(forged, "records", {
    value: Object.freeze([]),
    enumerable: true
  });
  assert.throws(
    () =>
      getVerifiedPortfolioPolicyTriggerEvidenceRecords(
        forged as VerifiedPortfolioPolicyTriggerEvidenceHistory
      ),
    /history is not verified/
  );
  assert.deepEqual(getVerifiedPortfolioPolicyTriggerEvidenceRecords(valid), [
    record
  ]);
});

test("policy trigger evidence repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioPolicyTriggerEvidencePaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PortfolioPolicyTriggerEvidenceFileRepository(
      baseDir,
      { lockTimeoutMs: 30, lockRetryDelayMs: 5 }
    );

    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function policyEvidence(
  overrides: Partial<{ createdAt: string; sourceArtifactId: string }> = {}
) {
  return createPortfolioPolicyTriggerEvidenceRecord({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceType: "regime_change",
    market: "KR",
    previousRegime: "sideways",
    currentRegime: "bear",
    sourceContractId: "verified-regime-classification.v1",
    sourceArtifactId: overrides.sourceArtifactId ?? "regime-artifact-1",
    sourceArtifactHash: SOURCE_HASH,
    observedAt: "2026-09-03T00:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-policy-evidence-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof policyEvidence>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PortfolioPolicyTriggerEvidenceFileRepository } from "./dist/portfolio/portfolioPolicyTriggerEvidenceFiles.js";
    const record = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PortfolioPolicyTriggerEvidenceFileRepository(process.argv[2]);
    const stored = await repository.append(record);
    process.stdout.write(JSON.stringify(stored));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script, fixturePath, baseDir],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `child exited with code ${code}`));
        return;
      }
      resolve(JSON.parse(stdout) as ReturnType<typeof policyEvidence>);
    });
  });
}
