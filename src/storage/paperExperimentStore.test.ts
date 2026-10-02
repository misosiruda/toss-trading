import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { createPaperExperimentArtifactPaths } from "./artifactPaths.js";
import { PAPER_EXPERIMENT_ARTIFACTS } from "./paperExperimentContract.js";
import { createPaperExperimentAttempt, inspectPaperExperimentAttempt, retryPaperExperimentAttempt } from "./paperExperimentStore.js";
import { EXPERIMENT_TEST_RUNTIME, EXPERIMENT_TEST_TIME, experimentFixtureJson, writeExperimentEvidence } from "./paperExperimentTestFixtures.js";

const run = promisify(execFile);
const moduleUrl = pathToFileURL(join(process.cwd(), "dist/storage/paperExperimentStore.js")).href;

async function setup(t: test.TestContext) {
  const temp = await fs.mkdtemp(join(tmpdir(), "paper-experiment-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = join(temp, "original.json");
  const shared = join(temp, "shared");
  await fs.mkdir(shared);
  await fs.writeFile(join(shared, "virtual-portfolio.json"), "sentinel");
  const inputJson = await experimentFixtureJson();
  await fs.writeFile(source, inputJson);
  const options = { rootDir: join(temp, "attempts"), protectedPaths: [source, shared],
    inputJson, runtimeIdentity: EXPERIMENT_TEST_RUNTIME, createdAt: EXPERIMENT_TEST_TIME, attemptId: "fixture-attempt" };
  return { temp, source, shared, options };
}

async function bytes(path: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of Object.entries(await bytes(file))) result[`${entry.name}/${key}`] = value;
    } else if (entry.isFile()) result[entry.name] = (await fs.readFile(file)).toString("base64");
  }
  return result;
}

async function patchJson(path: string, mutate: (value: any) => void) {
  const value = JSON.parse(await fs.readFile(path, "utf8"));
  mutate(value);
  await fs.writeFile(path, JSON.stringify(value));
}

function assertCode(code: string) { return (error: any) => error.code === code; }

async function child(script: string, args: unknown, env: NodeJS.ProcessEnv = {}) {
  return run(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(args)], {
    env: { ...process.env, ...env }, maxBuffer: 3 * 1024 * 1024
  });
}
const childPrelude = `import * as store from ${JSON.stringify(moduleUrl)};
const options = JSON.parse(process.argv[1]);
if (options.createdAt) options.createdAt = new Date(options.createdAt);`;

test("materializes full normalized input/source, preserves original/shared bytes and only returns a fresh empty replay dir", async (t) => {
  const { options, source, shared } = await setup(t);
  const original = await fs.readFile(source, "utf8");
  const owner = await createPaperExperimentAttempt(options);
  const stored = await inspectPaperExperimentAttempt(options, owner.attemptId);
  assert.equal(stored.status, "incomplete"); assert.equal(stored.storedStatus, "prepared");
  assert.deepEqual(stored.input, owner.input);
  assert.deepEqual(await fs.readdir(owner.paths.replayDir), []);
  assert.deepEqual(JSON.parse(await fs.readFile(owner.paths.inputPath, "utf8")), owner.input.normalizedInput);
  assert.deepEqual((await fs.readFile(owner.paths.sourcePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line)), owner.input.normalizedInput.source.snapshots);
  assert.equal(await fs.readFile(source, "utf8"), original);
  assert.equal(await fs.readFile(join(shared, "virtual-portfolio.json"), "utf8"), "sentinel");
});

test("fresh process reconstructs without original source or environment and read never repairs", async (t) => {
  const { options, source } = await setup(t);
  const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME);
  await fs.rm(source);
  const before = await bytes(owner.paths.attemptDir);
  const result = await child(`${childPrelude}
console.log(JSON.stringify(await store.inspectPaperExperimentAttempt(options, options.attemptId)));`, options,
  { TZ: "America/New_York", TRADING_ENABLED: "true", BROKER_PROVIDER: "live", AI_DECISION_ENABLED: "true" });
  const stored = JSON.parse(result.stdout);
  assert.equal(stored.status, "incomplete"); assert.equal(stored.storedStatus, "running");
  assert.deepEqual(stored.input, owner.input);
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
});

for (const existing of ["directory", "file", "completed", "failed"] as const) {
  test(`existing ${existing} attempt is rejected without changing any bytes`, async (t) => {
    const { options } = await setup(t);
    const paths = createPaperExperimentArtifactPaths(options.rootDir, options.attemptId);
    await fs.mkdir(options.rootDir);
    if (existing === "directory") await fs.mkdir(paths.attemptDir);
    else if (existing === "file") await fs.writeFile(paths.attemptDir, "sentinel");
    else {
      const owner = await createPaperExperimentAttempt(options);
      if (existing === "completed") {
        await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner); await owner.complete(EXPERIMENT_TEST_TIME);
      } else await owner.fail("execution_failed", EXPERIMENT_TEST_TIME);
    }
    const before = await bytes(options.rootDir);
    await assert.rejects(createPaperExperimentAttempt(options), assertCode("ATTEMPT_EXISTS"));
    assert.deepEqual(await bytes(options.rootDir), before);
  });
}

test("same attempt child-process race has exactly one exclusive creator", async (t) => {
  const { options } = await setup(t);
  const script = `${childPrelude}
try { await store.createPaperExperimentAttempt(options); console.log('created'); }
catch (error) { console.log(error.code); }`;
  const results = await Promise.all(Array.from({ length: 4 }, () => child(script, options)));
  assert.deepEqual(results.map((result) => result.stdout.trim()).sort(), ["ATTEMPT_EXISTS", "ATTEMPT_EXISTS", "ATTEMPT_EXISTS", "created"]);
  const stored = await inspectPaperExperimentAttempt(options, options.attemptId);
  assert.equal(stored.storedStatus, "prepared"); assert.equal(stored.errorCode, null);
});

for (const id of ["", ".", "..", "../escape", "/absolute", "a/b", "a\\b", "a:b", " x", "a".repeat(81)]) {
  test(`attempt ID rejects invalid token ${JSON.stringify(id)}`, async (t) => {
    const { options, temp } = await setup(t);
    const before = await bytes(temp);
    await assert.rejects(createPaperExperimentAttempt({ ...options, attemptId: id }));
    assert.deepEqual(await bytes(temp), before);
  });
}

for (const relation of ["same", "ancestor", "descendant"] as const) {
  test(`protected source/shared path ${relation} overlap rejects before writes`, async (t) => {
    const { options, shared, temp } = await setup(t);
    const rootDir = relation === "same" ? shared : relation === "ancestor" ? temp : join(shared, "child");
    const before = await bytes(temp);
    await assert.rejects(createPaperExperimentAttempt({ ...options, rootDir }), assertCode("PATH_OVERLAP"));
    assert.deepEqual(await bytes(temp), before);
  });
}

test("traversal root and nested namespace inside an existing attempt reject", async (t) => {
  const { options } = await setup(t);
  await assert.rejects(createPaperExperimentAttempt({ ...options, rootDir: `${options.rootDir}/../escape` }), assertCode("PATH_UNSAFE"));
  const owner = await createPaperExperimentAttempt(options);
  const before = await bytes(owner.paths.attemptDir);
  await assert.rejects(createPaperExperimentAttempt({ ...options, rootDir: owner.paths.replayDir }), assertCode("PATH_OVERLAP"));
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
});

for (const part of ["ancestor", "root", "attempt", "input", "source", "state", "replay", "artifact"] as const) {
  test(`symlink at ${part} is rejected without following it`, async (t) => {
    const { options, temp } = await setup(t);
    if (part === "ancestor" || part === "root") {
      const target = join(temp, "actual"); await fs.mkdir(target);
      const alias = join(temp, "alias"); await fs.symlink(target, alias, "dir");
      await assert.rejects(createPaperExperimentAttempt({ ...options, rootDir: part === "ancestor" ? join(alias, "nested") : alias }), assertCode("PATH_UNSAFE"));
      assert.deepEqual(await fs.readdir(target), []); return;
    }
    const owner = await createPaperExperimentAttempt(options);
    if (part === "artifact") { await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner); await owner.complete(EXPERIMENT_TEST_TIME); }
    const path = part === "attempt" ? owner.paths.attemptDir : part === "input" ? owner.paths.inputDir
      : part === "source" ? owner.paths.sourcePath : part === "state" ? owner.paths.statePath
        : part === "artifact" ? join(owner.paths.attemptDir, PAPER_EXPERIMENT_ARTIFACTS.report) : owner.paths.replayDir;
    const moved = join(temp, `moved-${part}`);
    await fs.rename(path, moved); await fs.symlink(moved, path, ["attempt", "input", "replay"].includes(part) ? "dir" : "file");
    const before = await bytes(temp);
    if (part === "replay") await assert.rejects(owner.start(EXPERIMENT_TEST_TIME), assertCode("PATH_UNSAFE"));
    else assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).status, "incomplete");
    assert.deepEqual(await bytes(temp), before);
  });
}

for (const corruption of ["source-value", "source-row-cut", "source-torn", "source-missing", "source-blank", "input-value", "input-not-normalized", "input-missing", "inputHash", "hardlink"] as const) {
  test(`input/source integrity detects ${corruption} and inspection is read-only`, async (t) => {
    const { options, temp } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    if (corruption === "source-value") await fs.writeFile(owner.paths.sourcePath, (await fs.readFile(owner.paths.sourcePath, "utf8")).replace('"lastPriceKrw":10000', '"lastPriceKrw":10001'));
    else if (corruption === "source-row-cut") await fs.writeFile(owner.paths.sourcePath, (await fs.readFile(owner.paths.sourcePath, "utf8")).split("\n").slice(0, 2).join("\n") + "\n");
    else if (corruption === "source-torn") await fs.appendFile(owner.paths.sourcePath, '{"snapshotId":');
    else if (corruption === "source-blank") await fs.appendFile(owner.paths.sourcePath, "\n");
    else if (corruption === "source-missing") await fs.rm(owner.paths.sourcePath);
    else if (corruption === "input-missing") await fs.rm(owner.paths.inputPath);
    else if (corruption === "input-value") await patchJson(owner.paths.inputPath, (value) => { value.question += "changed"; });
    else if (corruption === "input-not-normalized") await patchJson(owner.paths.inputPath, (value) => { value.implementationRevision = null; });
    else if (corruption === "inputHash") await patchJson(owner.paths.statePath, (value) => { value.inputHash = `sha256:${"0".repeat(64)}`; });
    else await fs.link(owner.paths.sourcePath, join(temp, "alias-source"));
    const before = await bytes(temp);
    assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).status, "incomplete");
    await assert.rejects(owner.start(EXPERIMENT_TEST_TIME));
    assert.deepEqual(await bytes(temp), before);
  });
}

test("invalid input and validated-object impostor cause no attempt allocation", async (t) => {
  const { options, temp } = await setup(t); const before = await bytes(temp);
  for (const inputJson of ["{}", "{", JSON.stringify({ normalizedInput: {}, inputHash: "fake", preflight: {} })]) {
    await assert.rejects(createPaperExperimentAttempt({ ...options, inputJson }));
  }
  assert.deepEqual(await bytes(temp), before);
});

test("preexisting replay portfolio sentinel is never removed and start fails", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await fs.writeFile(join(owner.paths.replayDir, "virtual-portfolio.json"), "sentinel");
  const before = await bytes(owner.paths.attemptDir);
  await assert.rejects(owner.start(EXPERIMENT_TEST_TIME), assertCode("REPLAY_NOT_EMPTY"));
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
});

test("only valid complete inventory commits terminal state; read ignores unrelated/review files", async (t) => {
  const { options, temp } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME), assertCode("STATE_INVALID"));
  await owner.start(EXPERIMENT_TEST_TIME);
  await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME));
  const paths = await writeExperimentEvidence(owner);
  await owner.complete(EXPERIMENT_TEST_TIME);
  await fs.symlink(join(temp, "nonexistent"), join(owner.paths.attemptDir, "unrelated"));
  await fs.mkdir(owner.paths.reviewDir); await fs.writeFile(join(owner.paths.reviewDir, "anything.json"), "invalid json");
  const before = await bytes(owner.paths.attemptDir);
  const inspected = await inspectPaperExperimentAttempt(options, owner.attemptId);
  assert.equal(inspected.status, "completed");
  assert.equal(inspected.state?.artifactInventory?.length, 11);
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
  assert.ok(paths.historicalReplayReportPath);
  await assert.rejects(owner.start(EXPERIMENT_TEST_TIME), assertCode("STATE_INVALID"));
  await assert.rejects(owner.fail("execution_failed", EXPERIMENT_TEST_TIME), assertCode("STATE_INVALID"));
});

for (const corruption of ["whole-row-truncation", "report-number", "missing-log", "torn-log", "missing-report", "count-mismatch", "run-identity", "path-traversal", "inventory-path", "inventory-duplicate", "inventory-digest", "unknown-state-field"] as const) {
  test(`completed evidence ${corruption} projects incomplete without repair`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner); await owner.complete(EXPERIMENT_TEST_TIME);
    if (corruption === "whole-row-truncation") await fs.writeFile(paths.historicalReplayPacketLogPath, (await fs.readFile(paths.historicalReplayPacketLogPath, "utf8")).split("\n").slice(0, 2).join("\n") + "\n");
    else if (corruption === "report-number") await patchJson(paths.historicalReplayReportPath, (value) => { value.costSummary.feeKrw += 1; });
    else if (corruption === "count-mismatch") await patchJson(paths.historicalReplayReportPath, (value) => { value.replaySummary.packetCount += 1; });
    else if (corruption === "missing-log") await fs.rm(paths.historicalReplayTradeLogPath);
    else if (corruption === "missing-report") await fs.rm(paths.historicalReplayReportPath);
    else if (corruption === "torn-log") await fs.appendFile(paths.historicalReplayDecisionLogPath, '{"packetId":');
    else if (corruption === "run-identity") await patchJson(paths.historicalReplayRunMetadataPath, (value) => { value.identity.runId = "different"; });
    else if (corruption === "path-traversal") await patchJson(paths.historicalReplayRunMetadataPath, (value) => { value.logPaths.packetLogPath = "../../outside.jsonl"; });
    else if (corruption === "inventory-path") await patchJson(owner.paths.statePath, (value) => { value.artifactInventory[0].relativePath = "../../outside.json"; });
    else if (corruption === "inventory-duplicate") await patchJson(owner.paths.statePath, (value) => { value.artifactInventory[1] = value.artifactInventory[0]; });
    else if (corruption === "inventory-digest") await patchJson(owner.paths.statePath, (value) => { value.artifactInventory[0].digest = `sha256:${"0".repeat(64)}`; });
    else await patchJson(owner.paths.statePath, (value) => { value.outputPath = "/outside"; });
    const before = await bytes(owner.paths.attemptDir);
    assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).status, "incomplete");
    assert.deepEqual(await bytes(owner.paths.attemptDir), before);
  });
}

test("fresh-process explicit retry allocates new identity/lineage and never resumes or changes parent bytes", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME); await owner.fail("execution_failed", EXPERIMENT_TEST_TIME);
  const before = await bytes(owner.paths.attemptDir);
  const result = await child(`${childPrelude}
const retry = await store.retryPaperExperimentAttempt(options);
console.log(JSON.stringify(await store.inspectPaperExperimentAttempt(options, retry.attemptId)));`, { ...options, attemptId: "retry-attempt", parentAttemptId: owner.attemptId });
  const retry = JSON.parse(result.stdout);
  assert.equal(retry.state.parentAttemptId, owner.attemptId); assert.notEqual(retry.state.runId, owner.runId);
  assert.equal(retry.state.inputHash, owner.input.inputHash); assert.deepEqual(retry.input, owner.input);
  assert.deepEqual(retry.state.runtimeIdentity, EXPERIMENT_TEST_RUNTIME); assert.equal(retry.storedStatus, "prepared");
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
  await assert.rejects(retryPaperExperimentAttempt({ ...options, parentAttemptId: owner.attemptId }), assertCode("ATTEMPT_EXISTS"));
});

for (const field of ["implementationRevision", "dependencyLockHash", "nodeVersion"] as const) {
  test(`retry rejects changed runtime ${field} before creating output`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    const runtimeIdentity = { ...EXPERIMENT_TEST_RUNTIME, [field]: field === "implementationRevision" ? "2".repeat(40)
      : field === "dependencyLockHash" ? `sha256:${"2".repeat(64)}` : "v22.15.0" };
    const before = await bytes(options.rootDir);
    await assert.rejects(retryPaperExperimentAttempt({ ...options, attemptId: "new", parentAttemptId: owner.attemptId, runtimeIdentity }), assertCode("RUNTIME_MISMATCH"));
    assert.deepEqual(await bytes(options.rootDir), before);
  });
}

for (const boundary of ["root", "attempt", "input-directory", "input-write", "source-write", "replay-directory", "state-replace", "read"] as const) {
  test(`injected filesystem ${boundary} failure never produces completed or removes partial data`, async (t) => {
    const { options, temp, source } = await setup(t);
    const paths = createPaperExperimentArtifactPaths(options.rootDir, options.attemptId);
    const original = await fs.readFile(source, "utf8");
    const mkdirOriginal = fs.mkdir.bind(fs); const openOriginal = fs.open.bind(fs); const renameOriginal = fs.rename.bind(fs);
    const failure = () => { throw Object.assign(new Error("synthetic io failure"), { code: "EIO" }); };
    if (["root", "attempt", "input-directory", "replay-directory"].includes(boundary)) {
      const target = boundary === "root" ? options.rootDir : boundary === "attempt" ? paths.attemptDir : boundary === "input-directory" ? paths.inputDir : paths.replayDir;
      t.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => String(args[0]) === target ? failure() : mkdirOriginal(...args));
    } else if (boundary === "state-replace") {
      t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => String(args[1]) === paths.statePath ? failure() : renameOriginal(...args));
    } else {
      t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await openOriginal(...args);
        const target = boundary === "source-write" ? paths.sourcePath : paths.inputPath;
        if (String(args[0]) === target) {
          if (boundary === "read" && typeof args[1] === "number" && (args[1] & 3) === 0) {
            await handle.close(); failure();
          } else if (boundary !== "read") {
            t.mock.method(handle, "writeFile", async () => { await handle.write('{"partial":'); failure(); });
          }
        }
        return handle;
      });
    }
    syncBuiltinESMExports();
    try { await assert.rejects(createPaperExperimentAttempt(options)); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.notEqual((await inspectPaperExperimentAttempt(options, options.attemptId)).status, "completed");
    assert.equal(await fs.readFile(source, "utf8"), original);
    const before = await bytes(temp);
    await inspectPaperExperimentAttempt(options, options.attemptId);
    assert.deepEqual(await bytes(temp), before);
  });
}

test("terminal replace failure leaves running plus partial temp evidence, never completed", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner);
  t.mock.method(fs, "rename", async () => { throw new Error("synthetic rename failure"); }); syncBuiltinESMExports();
  try { await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME)); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  const result = await inspectPaperExperimentAttempt(options, owner.attemptId);
  assert.equal(result.storedStatus, "running"); assert.equal(result.status, "incomplete");
  assert.ok((await fs.readdir(owner.paths.attemptDir)).some((name) => name.endsWith(".tmp")));
  await owner.fail("artifact_integrity_failed", EXPERIMENT_TEST_TIME);
  assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).status, "failed");
});

test("process crash during preparation preserves incomplete attempt and retry cannot reuse its identity", async (t) => {
  const { options } = await setup(t);
  await assert.rejects(child(`import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
const mkdir = fs.mkdir.bind(fs);
fs.mkdir = async (...args) => { const result = await mkdir(...args); if (String(args[0]).endsWith('/replay')) process.exit(71); return result; };
syncBuiltinESMExports(); ${childPrelude}
await store.createPaperExperimentAttempt(options);`, options));
  const before = await bytes(options.rootDir);
  const result = await inspectPaperExperimentAttempt(options, options.attemptId);
  assert.equal(result.status, "incomplete"); assert.equal(result.storedStatus, "preparing");
  await assert.rejects(createPaperExperimentAttempt(options), assertCode("ATTEMPT_EXISTS"));
  assert.deepEqual(await bytes(options.rootDir), before);
  const retry = await retryPaperExperimentAttempt({ ...options, attemptId: "after-crash", parentAttemptId: options.attemptId });
  assert.equal(retry.input.inputHash, result.input?.inputHash);
});

test("owner rejects overlapping lifecycle calls and cannot adopt altered lifecycle metadata", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  const results = await Promise.allSettled([owner.start(EXPERIMENT_TEST_TIME), owner.start(EXPERIMENT_TEST_TIME)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await patchJson(owner.paths.statePath, (state) => { state.createdAt = "2026-10-01T00:00:00.000Z"; });
  const before = await bytes(owner.paths.attemptDir);
  await assert.rejects(owner.fail("execution_failed", EXPERIMENT_TEST_TIME), assertCode("STATE_INVALID"));
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
});

for (const field of ["portfolio", "costSummary", "benchmarks", "analytics", "advancedPerformance", "sharpeValidation", "portfolioTimeline"] as const) {
  test(`pre-completion malformed ${field} cannot be sealed as completed`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner);
    await patchJson(paths.historicalReplayReportPath, (report) => { report[field] = field === "portfolioTimeline" ? [] : {}; });
    await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME));
    assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).storedStatus, "running");
  });
}

for (const corruption of ["missing-final-tick", "wrong-timestamp", "wrong-portfolio-timestamp", "wrong-report-timestamp"] as const) {
  test(`pre-completion timeline ${corruption} cannot be sealed`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner);
    const rows = (await fs.readFile(paths.historicalReplayPortfolioTimelinePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    if (corruption === "missing-final-tick") rows[2] = { ...rows[0], recordId: "replacement-row" };
    else if (corruption === "wrong-timestamp") rows[2].simulatedAt = rows[0].simulatedAt;
    else if (corruption === "wrong-portfolio-timestamp") rows[2].portfolio.simulatedAt = rows[0].simulatedAt;
    else await patchJson(paths.historicalReplayReportPath, (report) => { report.portfolioTimeline[2].simulatedAt = report.portfolioTimeline[0].simulatedAt; });
    await fs.writeFile(paths.historicalReplayPortfolioTimelinePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME));
    assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).status, "incomplete");
  });
}

test("fresh-process completed inventory verification and post-completion input tampering are fail-closed", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner); await owner.complete(EXPERIMENT_TEST_TIME);
  const script = `${childPrelude} console.log(JSON.stringify(await store.inspectPaperExperimentAttempt(options, options.attemptId)));`;
  assert.equal(JSON.parse((await child(script, options)).stdout).status, "completed");
  await patchJson(owner.paths.inputPath, (input) => { input.configuration.initialCashKrw += 1; });
  assert.equal(JSON.parse((await child(script, options)).stdout).status, "incomplete");
});

test("retry refuses a corrupt parent input and input mutation is blocked before completion", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner);
  await fs.writeFile(owner.paths.sourcePath, "");
  const before = await bytes(options.rootDir);
  await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME));
  await assert.rejects(retryPaperExperimentAttempt({ ...options, parentAttemptId: owner.attemptId, attemptId: "new" }));
  assert.deepEqual(await bytes(options.rootDir), before);
});

for (const boundary of ["initial-state-open", "initial-state-partial-write", "input-sync", "terminal-state-partial-write"] as const) {
  test(`filesystem ${boundary} cannot leave a trustworthy completed marker`, async (t) => {
    const { options } = await setup(t);
    const paths = createPaperExperimentArtifactPaths(options.rootDir, options.attemptId);
    let owner: Awaited<ReturnType<typeof createPaperExperimentAttempt>> | undefined;
    if (boundary === "terminal-state-partial-write") {
      owner = await createPaperExperimentAttempt(options); await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner);
    }
    const openOriginal = fs.open.bind(fs);
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const path = String(args[0]);
      if (boundary === "initial-state-open" && path === paths.statePath) throw new Error("synthetic state open failure");
      const handle = await openOriginal(...args);
      if ((boundary === "initial-state-partial-write" && path === paths.statePath)
        || (boundary === "terminal-state-partial-write" && path.startsWith(`${paths.statePath}.`) && path.endsWith(".tmp"))) {
        t.mock.method(handle, "writeFile", async () => { await handle.write('{"schemaVersion":'); throw new Error("synthetic partial state"); });
      }
      if (boundary === "input-sync" && path === paths.inputPath) t.mock.method(handle, "sync", async () => { throw new Error("synthetic sync failure"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(owner ? owner.complete(EXPERIMENT_TEST_TIME) : createPaperExperimentAttempt(options)); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    const before = await bytes(options.rootDir);
    assert.equal((await inspectPaperExperimentAttempt(options, options.attemptId)).status, "incomplete");
    assert.deepEqual(await bytes(options.rootDir), before);
  });
}

test("read failures stay incomplete and inspect/import never invoke mutation, process, network or provider calls", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME); await writeExperimentEvidence(owner); await owner.complete(EXPERIMENT_TEST_TIME);
  const before = await bytes(owner.paths.attemptDir);
  const result = await child(`import fs from 'node:fs/promises'; import syncFs from 'node:fs';
import cp from 'node:child_process'; import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
let calls = 0; const denied = () => { calls++; throw new Error('unexpected effect'); };
for (const api of [fs, syncFs]) for (const key of ['writeFile', 'appendFile', 'mkdir', 'rename', 'rm', 'unlink', 'rmdir', 'truncate', 'chmod', 'chown']) api[key] = denied;
for (const key of ['spawn', 'spawnSync', 'exec', 'execFile', 'execFileSync']) cp[key] = denied;
for (const api of [http, https]) for (const key of ['request', 'get']) api[key] = denied;
net.connect = denied; net.createConnection = denied; globalThis.fetch = denied;
syncBuiltinESMExports();
const store = await import(${JSON.stringify(moduleUrl)});
const options = JSON.parse(process.argv[1]);
const inspected = await store.inspectPaperExperimentAttempt(options, options.attemptId);
console.log(JSON.stringify({ status: inspected.status, calls }));`, options,
  { TRADING_ENABLED: "true", AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "live", BROKER_PROVIDER: "live" });
  assert.deepEqual(JSON.parse(result.stdout), { status: "completed", calls: 0 });
  const original = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === owner.paths.inputPath) throw new Error("synthetic read failure");
    return original(...args);
  }); syncBuiltinESMExports();
  try { assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).status, "incomplete"); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(await bytes(owner.paths.attemptDir), before);
});

test("each required report field is checked before completion, including nested report contract fields", async (t) => {
  const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
  await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner);
  const report = JSON.parse(await fs.readFile(paths.historicalReplayReportPath, "utf8"));
  // Pure contract validation tests all object-field omissions without repeating filesystem reads.
  const { paperExperimentReportSchema } = await import("./paperExperimentReportContract.js");
  assert.equal(paperExperimentReportSchema.safeParse(report).success, true);
  function visit(object: Record<string, unknown>, path: string[]) {
    for (const [key, value] of Object.entries(object)) {
      const changed = structuredClone(report);
      let parent = changed;
      for (const segment of path) parent = parent[segment];
      delete parent[key];
      // Effective configuration optional keys remain optional in legacy schemas; the input hash binds them separately.
      if (!["allocationPolicy", "paperExitPolicy"].includes(path[0] ?? "")) {
        assert.equal(paperExperimentReportSchema.safeParse(changed).success, false, [...path, key].join("."));
      }
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        // Dynamic records may validly omit keys; their enclosing field remains required.
        if (!["byAction", "rejectCodes", "skipReasons"].includes(key)) visit(value as Record<string, unknown>, [...path, key]);
      }
    }
  }
  visit(report, []);
});

test("normalized input expansion is byte-bounded before directory allocation", async (t) => {
  const { options, temp } = await setup(t);
  const input = JSON.parse(options.inputJson);
  input.universe.description = "x";
  const remaining = 2 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(input), "utf8");
  input.universe.description += "x".repeat(remaining);
  const inputJson = JSON.stringify(input);
  assert.equal(Buffer.byteLength(inputJson, "utf8"), 2 * 1024 * 1024);
  const before = await bytes(temp);
  await assert.rejects(createPaperExperimentAttempt({ ...options, inputJson }), assertCode("INVALID_REQUEST"));
  assert.deepEqual(await bytes(temp), before);
});

test("backend path syntax accepts native absolute paths and rejects both traversal separators", async (t) => {
  const { options } = await setup(t);
  const { assertExperimentPathSyntax } = await import("./paperExperimentFilesystem.js");
  assert.doesNotThrow(() => assertExperimentPathSyntax(options.rootDir));
  for (const suffix of ["/../escape", "\\..\\escape", "/..\\escape"]) {
    assert.throws(() => assertExperimentPathSyntax(`${options.rootDir}${suffix}`), assertCode("PATH_UNSAFE"));
  }
});

for (const field of ["initialCashKrw", "finalCashKrw", "finalPositionCount", "finalPositionMarketValueKrw", "finalVirtualNetWorthKrw"] as const) {
  test(`completion rejects schema-valid report portfolio ${field} inconsistent with final audit evidence`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner);
    await patchJson(paths.historicalReplayReportPath, (report) => { report.portfolio[field] += 1; });
    const before = await bytes(owner.paths.attemptDir);
    await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME), assertCode("ARTIFACT_INTEGRITY"));
    assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).storedStatus, "running");
    assert.deepEqual(await bytes(owner.paths.attemptDir), before);
  });
}

for (const field of ["cashKrw", "positionCount", "positionMarketValueKrw", "virtualNetWorthKrw", "simulatedAt", "positions"] as const) {
  test(`completion rejects schema-valid progress currentPortfolio ${field} inconsistent with final audit evidence`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner);
    await patchJson(paths.historicalReplayProgressPath, (progress) => {
      if (field === "simulatedAt") progress.currentPortfolio.simulatedAt = "2025-01-01T00:00:00.000Z";
      else if (field === "positions") progress.currentPortfolio.positions = [{ market: "KR", symbol: "FIXTURE_A", quantity: 1,
        averagePriceKrw: 10000, updatedAt: "2025-01-03T00:00:00.000Z" }];
      else progress.currentPortfolio[field] += 1;
    });
    const before = await bytes(owner.paths.attemptDir);
    await assert.rejects(owner.complete(EXPERIMENT_TEST_TIME), assertCode("ARTIFACT_INTEGRITY"));
    assert.deepEqual(await bytes(owner.paths.attemptDir), before);
  });
}

for (const format of ["json-syntax", "json-schema", "jsonl-syntax", "jsonl-schema", "utf8"] as const) {
  test(`malformed persisted replay ${format} is artifact integrity, while filesystem failures stay IO_FAILURE`, async (t) => {
    const { options } = await setup(t); const owner = await createPaperExperimentAttempt(options);
    await owner.start(EXPERIMENT_TEST_TIME); const paths = await writeExperimentEvidence(owner); await owner.complete(EXPERIMENT_TEST_TIME);
    if (format === "json-syntax") await fs.writeFile(paths.historicalReplayReportPath, '{"portfolio":');
    else if (format === "json-schema") await patchJson(paths.historicalReplayReportPath, (report) => { delete report.costSummary; });
    else if (format === "jsonl-syntax") await fs.writeFile(paths.historicalReplayTradeLogPath, '{"tradeId":\n');
    else if (format === "jsonl-schema") await fs.writeFile(paths.historicalReplayTradeLogPath, '{}\n');
    else await fs.writeFile(paths.historicalReplayReportPath, Buffer.from([0xc3, 0x28]));
    const before = await bytes(owner.paths.attemptDir);
    const inspected = await inspectPaperExperimentAttempt(options, owner.attemptId);
    assert.equal(inspected.status, "incomplete"); assert.equal(inspected.storedStatus, "completed");
    assert.equal(inspected.errorCode, "ARTIFACT_INTEGRITY");
    assert.deepEqual(await bytes(owner.paths.attemptDir), before);
    const original = fs.open.bind(fs);
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === paths.historicalReplayReportPath) throw Object.assign(new Error("synthetic EIO"), { code: "EIO" });
      return original(...args);
    }); syncBuiltinESMExports();
    try { assert.equal((await inspectPaperExperimentAttempt(options, owner.attemptId)).errorCode, "IO_FAILURE"); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.deepEqual(await bytes(owner.paths.attemptDir), before);
  });
}
