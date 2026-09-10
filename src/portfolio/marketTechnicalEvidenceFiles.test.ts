import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import { createMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { createMarketTechnicalEvidencePaths, getDurableMarketTechnicalEvidenceObservation, MarketTechnicalEvidenceFileRepository,
  resolveObservedMarketTechnicalEvidenceHistory, type VerifiedMarketTechnicalEvidenceHistory } from "./marketTechnicalEvidenceFiles.js";
import type { MarketTechnicalEvidenceSourceBinding, MarketTechnicalEvidenceSourceInput } from "./marketTechnicalEvidenceSource.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

test("market technical evidence files preserve original captures across retry restart and source growth", async () => temporary(async (dir, source) => {
  const repo = new MarketTechnicalEvidenceFileRepository(dir);
  assert.deepEqual(await repo.readAll(), []);
  const paths = createMarketTechnicalEvidencePaths(dir);
  await assert.rejects(fs.readFile(paths.recordsPath), { code: "ENOENT" });
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const first = await repo.capture(input());
  const original = await fs.readFile(paths.recordsPath, "utf8");
  await source.append(snapshot(5));
  assert.deepEqual(await new MarketTechnicalEvidenceFileRepository(dir).capture(input()), first);
  assert.equal(await fs.readFile(paths.recordsPath, "utf8"), original);
  const second = await repo.capture(input(6));
  assert.notEqual(first.binding.evidence.evidenceRef, second.binding.evidence.evidenceRef);
  assert.equal(second.binding.sourceObservation.recordCount, 3);
  assert.deepEqual(await new MarketTechnicalEvidenceFileRepository(dir).readAll(), [first, second]);
  assert.equal((await fs.readFile(paths.recordsPath, "utf8")).trim().split("\n").length, 6);
  frozen(first);
  await assert.rejects(repo.capture({ ...input(), sourceContractId: "another-contract" }), /reference collision/);
  assert.equal((await repo.readAll()).length, 2);
}));

test("market technical evidence capture copies query and never accepts supplied binding evidence or timestamps", async () => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const repo = new MarketTechnicalEvidenceFileRepository(dir);
  const value = input();
  const pending = repo.capture(value); value.query.symbol = "changed";
  const result = await pending;
  assert.equal(result.binding.evidence.calculation.symbol, "SYNTH");
  for (const extra of [{ evidence: result.binding.evidence }, { sourceObservation: result.binding.sourceObservation }, { createdAt: "2099-01-01T00:00:00.000Z" }]) {
    await assert.rejects(repo.capture({ ...input(), ...extra }));
  }
  for (const path of Object.values(createMarketTechnicalEvidencePaths(dir))) {
    assert.throws(() => new MarketTechnicalEvidenceFileRepository(dir, { historicalPath: path }), /overlap/);
  }
}));

test("market technical evidence concurrent captures converge on one original committed pair", async () => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const captures = await Promise.all(Array.from({ length: 8 }, () => new MarketTechnicalEvidenceFileRepository(dir).capture(input())));
  captures.forEach((capture) => assert.deepEqual(capture, captures[0]));
  assert.equal((await fs.readFile(createMarketTechnicalEvidencePaths(dir).recordsPath, "utf8")).trim().split("\n").length, 3);
}));

test("market technical evidence reads validate the entire source and exact original prefix before returning or retrying", async () => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const repo = new MarketTechnicalEvidenceFileRepository(dir);
  await repo.capture(input());
  const path = createMarketTechnicalEvidencePaths(dir).recordsPath;
  const raw = await fs.readFile(path);
  for (const records of [[snapshot(1)], [{ ...snapshot(1), lastPriceKrw: 999 }, snapshot(3)]]) {
    await source.replaceAll(records);
    await assert.rejects(repo.readAll(), /corrupt entry/);
    await assert.rejects(repo.capture(input()));
    assert.deepEqual(await fs.readFile(path), raw);
  }
  await source.replaceAll([snapshot(1), snapshot(3)]);
  await fs.appendFile(join(dir, "historical-market-snapshots.jsonl"), "bad-json\n");
  await assert.rejects(repo.readAll());
  await assert.rejects(repo.capture(input()));
  assert.deepEqual(await fs.readFile(path), raw);
}));

test("market technical evidence rejects corrupt pairs hashes chronology and rehashed fabricated calculations", async () => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const repo = new MarketTechnicalEvidenceFileRepository(dir);
  await repo.capture(input());
  const path = createMarketTechnicalEvidencePaths(dir).recordsPath;
  const raw = await fs.readFile(path, "utf8");
  const [entry, marker] = pair(raw);
  const completion = JSON.parse(raw.trim().split("\n")[2]!);
  const forged = structuredClone(entry);
  forged.binding = { ...forged.binding, evidence: createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: forged.binding.evidence.sourceContractId,
    createdAt: forged.binding.evidence.createdAt, calculationInput: { ...forged.binding.evidence.calculationInput,
      snapshots: [{ ...snapshot(1), lastPriceKrw: 777 }, snapshot(3)] } }) };
  const variants = [raw.trimEnd(), JSON.stringify(entry) + "\n", raw + "\n", raw + "bad\n",
    raw.replace(entry.entryHash, `sha256:${"f".repeat(64)}`), rewrite(forged, marker, completion),
    rewrite({ ...entry, previousCommitHash: marker.commitHash }, marker, completion),
    rewrite({ ...entry, appendStartedAt: "2099-01-01T00:00:00.000Z" }, marker, completion),
    rewrite(entry, { ...marker, committedAt: "2099-01-01T00:00:00.000Z" }, completion),
    raw + rewrite({ ...entry, previousCommitHash: completion.completionHash, appendStartedAt: completion.observedAt }, marker, completion),
    rewrite(entry, marker), // A v2 entry must include completion, even if the pair is otherwise valid.
    rewrite(entry, marker, { ...completion, observedAt: "2026-09-01T00:00:00.000Z" }),
    rewrite(entry, marker, { ...completion, observedAt: "2099-01-01T00:00:00.000Z" }),
    raw.replace(completion.completionHash, `sha256:${"f".repeat(64)}`),
    raw.replace('"schemaVersion":"market_technical_evidence_completion.v1"', '"extra":true,"schemaVersion":"market_technical_evidence_completion.v1"')];
  for (const corrupt of variants) {
    await fs.writeFile(path, corrupt);
    await assert.rejects(repo.readAll(), /torn|corrupt/);
    await assert.rejects(repo.capture(input()), /torn|corrupt/);
    assert.equal(await fs.readFile(path, "utf8"), corrupt);
  }
}));

test("market technical evidence pending failures preserve barriers and never auto-recover partial commits", async (context) => {
  for (const phase of ["pending_sync", "entry_write", "entry_sync", "marker_write", "marker_sync", "completion_write", "completion_sync", "pending_remove"] as const) await temporary(async (dir, source) => {
    await source.replaceAll([snapshot(1), snapshot(3)]);
    const paths = createMarketTechnicalEvidencePaths(dir), repo = new MarketTechnicalEvidenceFileRepository(dir);
    const originalOpen = fs.open, originalUnlink = fs.unlink;
    let writes = 0, injected = false;
    const fail = () => { injected = true; throw new Error("injected commit failure"); };
    const openMock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.pendingPath && args[1] === "wx" && phase === "pending_sync") context.mock.method(handle, "sync", async () => fail());
      if (args[0] === paths.recordsPath && args[1] === "a") {
        writes += 1;
        if ((writes === 1 && phase === "entry_write") || (writes === 2 && phase === "marker_write") || (writes === 3 && phase === "completion_write")) context.mock.method(handle, "writeFile", async () => fail());
        if ((writes === 1 && phase === "entry_sync") || (writes === 2 && phase === "marker_sync") || (writes === 3 && phase === "completion_sync")) context.mock.method(handle, "sync", async () => fail());
      }
      return handle;
    });
    const unlinkMock = context.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
      if (args[0] === paths.pendingPath && phase === "pending_remove") fail();
      return originalUnlink(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.capture(input()), /injected commit failure/); }
    finally { openMock.mock.restore(); unlinkMock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.ok(await fs.readFile(paths.pendingPath, "utf8"));
    await assert.rejects(repo.readAll(), /pending append requires explicit recovery/);
    await assert.rejects(repo.capture(input()), /pending append requires explicit recovery/);
  });
});

test("market technical evidence reports post-removal sync uncertainty and revalidates a complete capture on retry", async (context) => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const repo = new MarketTechnicalEvidenceFileRepository(dir), paths = createMarketTechnicalEvidencePaths(dir);
  const originalOpen = fs.open, originalUnlink = fs.unlink;
  let removed = false;
  const unlinkMock = context.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
    await originalUnlink(...args);
    if (args[0] === paths.pendingPath) removed = true;
  });
  const openMock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (removed && args[0] === dir && args[1] === "r") {
      return { sync: async () => { throw new Error("post-removal sync failed"); }, close: async () => {} } as unknown as Awaited<ReturnType<typeof fs.open>>;
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try { await assert.rejects(repo.capture(input()), /post-removal sync failed/); }
  finally { openMock.mock.restore(); unlinkMock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(removed, true);
  await assert.rejects(fs.readFile(paths.pendingPath), { code: "ENOENT" });
  const all = await repo.readAll(); assert.equal(all.length, 1);
  assert.deepEqual(await repo.capture(input()), all[0]);
}));

test("market technical evidence callback leases and committed prefixes expire and retain both source and destination locks", async () => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const repo = new MarketTechnicalEvidenceFileRepository(dir);
  const first = await repo.capture(input());
  let retained!: VerifiedMarketTechnicalEvidenceHistory;
  const receipt = await repo.withDurableVerifiedHistory(async (history) => {
    retained = history;
    const receipt = getDurableMarketTechnicalEvidenceObservation(history);
    frozen(receipt); frozen(history);
    assert.throws(() => getDurableMarketTechnicalEvidenceObservation(structuredClone(history)), /live durable/);
    await assert.rejects(new FileHistoricalMarketSnapshotStore(join(dir, "historical-market-snapshots.jsonl"),
      { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).append(snapshot(5)), /lock is unavailable/);
    await assert.rejects(new MarketTechnicalEvidenceFileRepository(dir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).capture(input()), /lock is unavailable/);
    return receipt;
  });
  assert.throws(() => getDurableMarketTechnicalEvidenceObservation(retained), /live durable/);
  await source.append(snapshot(5)); await repo.capture(input(6));
  await repo.withDurableVerifiedHistory(async (history) => {
    assert.deepEqual(resolveObservedMarketTechnicalEvidenceHistory(history, JSON.parse(JSON.stringify(receipt))), [first]);
    for (const patch of [{ recordCount: 3 }, { entriesHash: `sha256:${"a".repeat(64)}` },
      { observedAt: "2099-01-01T00:00:00.000Z" }, { observedAt: "2026-09-01T00:00:00.000Z" }, { extra: true }]) {
      assert.throws(() => resolveObservedMarketTechnicalEvidenceHistory(history, { ...receipt, ...patch }));
    }
  });
  await assert.rejects(repo.withDurableVerifiedHistory(async (history) => { retained = history; throw new Error("consumer failed"); }), /consumer failed/);
  assert.throws(() => getDurableMarketTechnicalEvidenceObservation(retained), /live durable/);
  await assert.rejects(repo.withDurableVerifiedHistory(async (history) => {
    retained = history; await fs.writeFile(createMarketTechnicalEvidencePaths(dir).lockPath, "foreign\n");
  }), /ownership changed/);
  assert.throws(() => getDurableMarketTechnicalEvidenceObservation(retained), /live durable/);
  assert.equal(await fs.readFile(createMarketTechnicalEvidencePaths(dir).lockPath, "utf8"), "foreign\n");
}));

test("market technical evidence observation rejects sync errors rewrites path replacement and invalid UTF-8", async (context) => {
  for (const phase of ["sync", "rewrite", "replacement", "utf8"] as const) await temporary(async (dir, source) => {
    await source.replaceAll([snapshot(1), snapshot(3)]);
    const repo = new MarketTechnicalEvidenceFileRepository(dir), path = createMarketTechnicalEvidencePaths(dir).recordsPath;
    await repo.capture(input());
    if (phase === "utf8") {
      await fs.appendFile(path, Buffer.from([0xff]));
      await assert.rejects(repo.readAll(), /invalid UTF-8/);
      return;
    }
    const originalOpen = fs.open;
    let injected = false, invoked = false;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === path && args[1] === "r+") {
        const originalSync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          injected = true;
          if (phase === "sync") throw new Error("log sync failed");
          await originalSync();
          const raw = await fs.readFile(path);
          if (phase === "replacement") { await fs.rename(path, `${path}.old`); await fs.writeFile(path, raw); }
          else { raw[10] = raw[10] === 65 ? 66 : 65; await fs.writeFile(path, raw); }
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.withDurableVerifiedHistory(async () => { invoked = true; }), /sync failed|changed during observation/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.equal(invoked, false);
  });
});

test("market technical evidence monotonic lock timeout preserves abandoned and initialization failure barriers", async (context) => {
  await temporary(async (dir, source) => {
    await source.replaceAll([snapshot(1), snapshot(3)]);
    const paths = createMarketTechnicalEvidencePaths(dir);
    await fs.writeFile(paths.lockPath, "abandoned\n");
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-10T00:00:00.000Z") });
    try { await assert.rejects(new MarketTechnicalEvidenceFileRepository(dir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readAll(), /lock is unavailable/); }
    finally { context.mock.timers.reset(); }
    assert.equal(await fs.readFile(paths.lockPath, "utf8"), "abandoned\n");
  });
  for (const phase of ["acquisition", "write", "sync"] as const) await temporary(async (dir, source) => {
    await source.replaceAll([snapshot(1), snapshot(3)]);
    const paths = createMarketTechnicalEvidencePaths(dir);
    const originalOpen = fs.open; let attempts = 0;
    const failure = Object.assign(new Error("lock failure"), { code: "EPERM" });
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] !== paths.lockPath || args[1] !== "wx") return originalOpen(...args);
      attempts += 1;
      if (phase === "acquisition" && attempts <= 2) throw failure;
      const handle = await originalOpen(...args);
      if (phase !== "acquisition") context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => {
        await fs.writeFile(paths.lockPath, "uncertain\n"); throw failure;
      });
      return handle;
    });
    syncBuiltinESMExports();
    try {
      const repo = new MarketTechnicalEvidenceFileRepository(dir);
      if (phase === "acquisition" && process.platform === "win32") { await repo.capture(input()); assert.equal(attempts, 3); }
      else { await assert.rejects(repo.capture(input()), (value) => value === failure); assert.equal(attempts, 1); }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    if (phase !== "acquisition") assert.equal(await fs.readFile(paths.lockPath, "utf8"), "uncertain\n");
  });
});

test("market technical evidence commit and flush clock regressions leave pending barriers", async (context) => {
  for (const afterWrite of [1, 2, 3]) await temporary(async (dir, source) => {
    await source.replaceAll([snapshot(1), snapshot(3)]);
    const paths = createMarketTechnicalEvidencePaths(dir), repo = new MarketTechnicalEvidenceFileRepository(dir);
    const originalOpen = fs.open; let writes = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === paths.recordsPath && args[1] === "a" && ++writes === afterWrite) {
        const originalSync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => {
          await originalSync(); context.mock.timers.enable({ apis: ["Date"], now: Date.now() - 60_000 });
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(repo.capture(input()), /clock moved backwards/); }
    finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(await fs.readFile(paths.pendingPath));
    await assert.rejects(repo.readAll(), /pending append requires explicit recovery/);
  });
});

test("market technical evidence keeps legacy pairs unchanged without retroactive completion and chains new v2 records", async () => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const repo = new MarketTechnicalEvidenceFileRepository(dir), path = createMarketTechnicalEvidencePaths(dir).recordsPath;
  await repo.capture(input());
  const [entry, marker] = pair(await fs.readFile(path, "utf8"));
  const legacy = rewrite({ ...entry, schemaVersion: "market_technical_evidence_entry.v1" }, marker);
  await fs.writeFile(path, legacy);
  const first = await repo.capture(input());
  assert.equal("completion" in first, false);
  assert.equal(await fs.readFile(path, "utf8"), legacy);
  const receipt = await repo.withDurableVerifiedHistory(async (history) => getDurableMarketTechnicalEvidenceObservation(history));
  await source.append(snapshot(5));
  const second = await repo.capture(input(6));
  assert.ok(second.completion);
  assert.deepEqual(await new MarketTechnicalEvidenceFileRepository(dir).readAll(), [first, second]);
  await repo.withDurableVerifiedHistory(async (history) => assert.deepEqual(resolveObservedMarketTechnicalEvidenceHistory(history, receipt), [first]));
  const lines = (await fs.readFile(path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 5);
  assert.equal(JSON.parse(lines[2]!).previousCommitHash, first.commitHash);
}));

test("market technical evidence completion is observed after marker fsync and binds the generation and receipt", async (context) => temporary(async (dir, source) => {
  await source.replaceAll([snapshot(1), snapshot(3)]);
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  const repo = new MarketTechnicalEvidenceFileRepository(dir), paths = createMarketTechnicalEvidencePaths(dir);
  const originalOpen = fs.open;
  let writes = 0;
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === paths.recordsPath && args[1] === "a" && ++writes === 2) {
      const sync = handle.sync.bind(handle);
      context.mock.method(handle, "sync", async () => { await sync(); context.mock.timers.setTime(now + 1000); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    const origin = await repo.capture(input());
    assert.equal(origin.committedAt, new Date(now).toISOString());
    assert.equal(origin.completion!.observedAt, new Date(now + 1000).toISOString());
    await repo.withDurableVerifiedHistory(async (history) => {
      assert.equal(history.generationHash, origin.completion!.completionHash);
      const receipt = getDurableMarketTechnicalEvidenceObservation(history);
      assert.throws(() => resolveObservedMarketTechnicalEvidenceHistory(history, { ...receipt, observedAt: origin.committedAt }), /committed prefix/);
    });
  } finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
}));

type Entry = { schemaVersion: string; binding: MarketTechnicalEvidenceSourceBinding; appendStartedAt: string; previousCommitHash: string | null; entryHash: string };
type Marker = { schemaVersion: string; entryHash: string; committedAt: string; commitHash: string };
function pair(raw: string): [Entry, Marker] { const lines = raw.trim().split("\n"); return [JSON.parse(lines[0]!), JSON.parse(lines[1]!)]; }
function rewrite(entry: Entry, marker: Marker, completion?: { schemaVersion: string; entryHash: string; commitHash: string; observedAt: string; completionHash: string }) {
  const { entryHash: ignoredEntry, ...payload } = entry; void ignoredEntry;
  const entryHash = hashCanonicalPayload(payload);
  const { commitHash: ignoredMarker, ...markerPayload } = { ...marker, entryHash }; void ignoredMarker;
  const commitHash = hashCanonicalPayload(markerPayload);
  const pair = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash })}\n`;
  if (!completion) return pair;
  const { completionHash: ignoredCompletion, ...completionPayload } = { ...completion, entryHash, commitHash }; void ignoredCompletion;
  return pair + `${JSON.stringify({ ...completionPayload, completionHash: hashCanonicalPayload(completionPayload) })}\n`;
}
function input(asOfDay = 4): MarketTechnicalEvidenceSourceInput {
  return { sourceContractId: "synthetic-local.v1", query: { market: "KR", symbol: "SYNTH", interval: "1d",
    windowStart: "2026-09-01T00:00:00.000Z", asOf: `2026-09-0${asOfDay}T00:00:00.000Z`, minimumObservationCount: 2, maximumAgeSeconds: 86400 } };
}
function snapshot(day: number): HistoricalMarketSnapshot {
  return { snapshotId: `row-${day}`, market: "KR", symbol: "SYNTH", interval: "1d", observedAt: `2026-09-0${day}T00:00:00.000Z`,
    createdAt: "2026-09-05T00:00:00.000Z", lastPriceKrw: day * 100, volume: 10, sourceRefs: ["synthetic-local"] };
}
function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function temporary(run: (dir: string, source: FileHistoricalMarketSnapshotStore) => Promise<void>) {
  const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "toss-market-evidence-files-")));
  try { await run(dir, new FileHistoricalMarketSnapshotStore(join(dir, "historical-market-snapshots.jsonl"))); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
