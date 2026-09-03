import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioPolicyTriggerEvent } from "./portfolioPolicyTriggerEvent.js";
import {
  PortfolioPolicyTriggerEventFileRepository,
  createPortfolioPolicyTriggerEventPaths,
  getVerifiedPortfolioPolicyTriggerEventRecords,
  parseVerifiedPortfolioPolicyTriggerEventHistory,
  type VerifiedPortfolioPolicyTriggerEventHistory
} from "./portfolioPolicyTriggerEventFiles.js";

const POLICY_HASH = `sha256:${"a".repeat(64)}`;

test("policy event repository appends, resolves, and converges semantic retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioPolicyTriggerEventFileRepository(baseDir);
    const first = policyEvent();
    const retry = policyEvent({ createdAt: "2026-09-03T00:00:02.000Z" });

    assert.deepEqual(await repository.append(first), first);
    assert.deepEqual(await repository.append(retry), first);
    assert.deepEqual(
      await repository.resolveById(first.policyTriggerEventId),
      first
    );
    assert.deepEqual(await repository.readAll(), [first]);
    assert.deepEqual((await repository.readVerifiedHistory()).records, [first]);
    const raw = await readFile(
      createPortfolioPolicyTriggerEventPaths(baseDir).recordsPath,
      "utf8"
    );
    assert.equal(raw, `${JSON.stringify(first)}\n`);
  });
});

test("policy event repository serializes concurrent exact retries", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioPolicyTriggerEventFileRepository(baseDir);
    const candidate = policyEvent();
    const stored = await Promise.all(
      Array.from({ length: 12 }, () => repository.append(candidate))
    );

    assert.equal(stored.length, 12);
    assert.deepEqual(await repository.readAll(), [candidate]);
  });
});

test("policy event repository serializes retries across processes", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const fixturePath = join(baseDir, "policy-event.json");
    const candidate = policyEvent();
    await writeFile(fixturePath, JSON.stringify(candidate), "utf8");
    const stored = await Promise.all(
      Array.from({ length: 4 }, () => appendFromChild(fixturePath, baseDir))
    );

    assert.deepEqual(stored, [candidate, candidate, candidate, candidate]);
    assert.deepEqual(
      await new PortfolioPolicyTriggerEventFileRepository(baseDir).readAll(),
      [candidate]
    );
  });
});

test("policy event repository preserves distinct immutable events", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const repository = new PortfolioPolicyTriggerEventFileRepository(baseDir);
    const first = policyEvent();
    const second = policyEvent({ currentRegime: "bull" });

    await repository.append(first);
    await repository.append(second);
    assert.deepEqual(await repository.readAll(), [first, second]);
    await assert.rejects(
      () => repository.resolveById("missing"),
      /does not resolve exactly once/
    );
  });
});

test("policy event repository fails closed for corrupt and torn history", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioPolicyTriggerEventPaths(baseDir);
    const candidate = policyEvent();
    const repository = new PortfolioPolicyTriggerEventFileRepository(baseDir);

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
    await assert.rejects(() => repository.readAll(), /duplicate ID/);
  });
});

test("policy event verified history rejects prototype forgery", () => {
  const event = policyEvent();
  const valid = parseVerifiedPortfolioPolicyTriggerEventHistory(
    `${JSON.stringify(event)}\n`
  );
  const forged = Object.create(valid) as {
    records: readonly ReturnType<typeof policyEvent>[];
  };
  Object.defineProperty(forged, "records", {
    value: Object.freeze([]),
    enumerable: true
  });

  assert.throws(
    () =>
      getVerifiedPortfolioPolicyTriggerEventRecords(
        forged as VerifiedPortfolioPolicyTriggerEventHistory
      ),
    /history is not verified/
  );
  assert.deepEqual(getVerifiedPortfolioPolicyTriggerEventRecords(valid), [
    event
  ]);
});

test("policy event repository leaves abandoned locks fail-closed", async () => {
  await withTemporaryDirectory(async (baseDir) => {
    const paths = createPortfolioPolicyTriggerEventPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned\n", "utf8");
    const repository = new PortfolioPolicyTriggerEventFileRepository(baseDir, {
      lockTimeoutMs: 30,
      lockRetryDelayMs: 5
    });

    await assert.rejects(() => repository.readAll(), /lock is unavailable/);
    assert.equal(await readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
});

function policyEvent(
  overrides: Partial<{ createdAt: string; currentRegime: string }> = {}
) {
  return createPortfolioPolicyTriggerEvent({
    portfolioId: "portfolio-1",
    policyHash: POLICY_HASH,
    evidenceRefs: ["regime-a"],
    asOf: "2026-09-03T00:00:00.000Z",
    eventType: "regime_change",
    market: "KR",
    previousRegime: "sideways",
    currentRegime: overrides.currentRegime ?? "bear",
    createdAt: overrides.createdAt ?? "2026-09-03T00:00:01.000Z"
  });
}

async function withTemporaryDirectory(
  run: (baseDir: string) => Promise<void>
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-policy-event-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

function appendFromChild(
  fixturePath: string,
  baseDir: string
): Promise<ReturnType<typeof policyEvent>> {
  const script = `
    import { readFile } from "node:fs/promises";
    import { PortfolioPolicyTriggerEventFileRepository } from "./dist/portfolio/portfolioPolicyTriggerEventFiles.js";
    const event = JSON.parse(await readFile(process.argv[1], "utf8"));
    const repository = new PortfolioPolicyTriggerEventFileRepository(process.argv[2]);
    const stored = await repository.append(event);
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
      resolve(JSON.parse(stdout) as ReturnType<typeof policyEvent>);
    });
  });
}
