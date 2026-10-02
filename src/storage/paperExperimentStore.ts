import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { PAPER_EXPERIMENT_LIMITS, parsePaperExperimentInput } from "../replay/paperExperimentInput.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { createPaperExperimentArtifactPaths, PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN, PAPER_EXPERIMENT_RUN_FILE_NAME } from "./artifactPaths.js";
import {
  paperExperimentRuntimeIdentitySchema, paperExperimentStateSchema,
  type PaperExperimentRuntimeIdentity, type PaperExperimentState
} from "./paperExperimentContract.js";
import {
  assertEmptyExperimentDirectory, assertExperimentPath, assertExperimentPathSyntax,
  ensureExperimentDirectory, experimentPathsOverlap, hasFsCode, PaperExperimentStorageError,
  readExperimentFile, replaceExperimentState, requireExperimentStorage, storageError,
  writeExclusiveExperimentFile, type PaperExperimentStorageCode
} from "./paperExperimentFilesystem.js";
import { captureExperimentInventory, verifyExperimentInput, type ExperimentPaths } from "./paperExperimentInventory.js";

export { PaperExperimentStorageError } from "./paperExperimentFilesystem.js";
export type { PaperExperimentRuntimeIdentity, PaperExperimentState } from "./paperExperimentContract.js";

export interface PaperExperimentStoreLocation {
  /** Backend-controlled namespace, not an input JSON field or a replay/source directory. */
  rootDir: string;
  /** Backend-known source files/directories and shared storage roots; neither overlap direction is allowed. */
  protectedPaths: readonly string[];
}

export interface CreatePaperExperimentAttemptOptions extends PaperExperimentStoreLocation {
  inputJson: string | Uint8Array;
  /** The execution adapter observes/verifies this receipt; storage never reads Git, env or package files. */
  runtimeIdentity: PaperExperimentRuntimeIdentity;
  createdAt: Date;
  /** Optional trusted backend allocator output. CLI/input must never expose it as an output path. */
  attemptId?: string;
}

export interface PaperExperimentInspection {
  status: "completed" | "failed" | "incomplete";
  storedStatus: PaperExperimentState["status"] | null;
  state: PaperExperimentState | null;
  input: ReturnType<typeof parsePaperExperimentInput> | null;
  errorCode: PaperExperimentStorageCode | null;
}

async function validateLocation(location: PaperExperimentStoreLocation): Promise<string> {
  assertExperimentPathSyntax(location.rootDir);
  requireExperimentStorage(Array.isArray(location.protectedPaths), "INVALID_REQUEST");
  const root = resolve(location.rootDir);
  await assertExperimentPath(root, true);
  for (const path of location.protectedPaths) {
    assertExperimentPathSyntax(path);
    await assertExperimentPath(path, true);
    requireExperimentStorage(!experimentPathsOverlap(root, path), "PATH_OVERLAP");
  }
  // A caller cannot accidentally create a second namespace inside a retained attempt.
  for (let ancestor = root; ; ancestor = dirname(ancestor)) {
    try {
      await lstat(join(ancestor, PAPER_EXPERIMENT_RUN_FILE_NAME));
      throw new PaperExperimentStorageError("PATH_OVERLAP");
    } catch (error) {
      if (!hasFsCode(error, "ENOENT")) throw error;
    }
    if (ancestor === dirname(ancestor)) break;
  }
  return root;
}

function instant(date: Date): string {
  requireExperimentStorage(date instanceof Date && Number.isFinite(date.getTime()), "INVALID_REQUEST");
  const value = date.toISOString();
  requireExperimentStorage(/^\d{4}-/.test(value), "INVALID_REQUEST");
  return value;
}

function attemptPaths(root: string, attemptId: string): ExperimentPaths {
  requireExperimentStorage(typeof attemptId === "string" && PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(attemptId), "INVALID_REQUEST");
  return createPaperExperimentArtifactPaths(root, attemptId);
}

async function readState(paths: ExperimentPaths, attemptId: string): Promise<PaperExperimentState> {
  const text = await readExperimentFile(paths.statePath, 64 * 1024, "STATE_INVALID");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new PaperExperimentStorageError("STATE_INVALID"); }
  const result = paperExperimentStateSchema.safeParse(raw);
  requireExperimentStorage(result.success && result.data.attemptId === attemptId, "STATE_INVALID");
  return result.data;
}

export async function inspectPaperExperimentAttempt(
  location: PaperExperimentStoreLocation, attemptId: string
): Promise<PaperExperimentInspection> {
  let state: PaperExperimentState | null = null;
  let input: ReturnType<typeof parsePaperExperimentInput> | null = null;
  try {
    const root = await validateLocation(location);
    const paths = attemptPaths(root, attemptId);
    state = await readState(paths, attemptId);
    input = await verifyExperimentInput(paths, state);
    if (state.status === "completed") {
      const actual = await captureExperimentInventory(paths, state);
      requireExperimentStorage(createReplayResearchHash(actual)
        === createReplayResearchHash(state.artifactInventory), "ARTIFACT_INTEGRITY");
      return { status: "completed", storedStatus: state.status, state, input, errorCode: null };
    }
    return { status: state.status === "failed" ? "failed" : "incomplete",
      storedStatus: state.status, state, input, errorCode: null };
  } catch (error) {
    return { status: "incomplete", storedStatus: state?.status ?? null, state, input, errorCode: storageError(error).code };
  }
}

/** Only exclusive creation returns mutation methods. There is deliberately no reopen/resume writer. */
export async function createPaperExperimentAttempt(options: CreatePaperExperimentAttemptOptions) {
  return createAttempt(options, null);
}

export async function retryPaperExperimentAttempt(options: Omit<CreatePaperExperimentAttemptOptions, "inputJson"> & {
  parentAttemptId: string;
}) {
  try {
    const root = await validateLocation(options);
    const parentPaths = attemptPaths(root, options.parentAttemptId);
    const parent = await readState(parentPaths, options.parentAttemptId);
    const input = await verifyExperimentInput(parentPaths, parent);
    const runtime = paperExperimentRuntimeIdentitySchema.safeParse(options.runtimeIdentity);
    requireExperimentStorage(runtime.success, "INVALID_REQUEST");
    requireExperimentStorage(createReplayResearchHash(runtime.data) === createReplayResearchHash(parent.runtimeIdentity), "RUNTIME_MISMATCH");
    requireExperimentStorage(instant(options.createdAt) >= parent.createdAt, "INVALID_REQUEST");
    return await createAttempt({ ...options, inputJson: JSON.stringify(input.normalizedInput) }, parent.attemptId);
  } catch (error) { throw storageError(error); }
}

async function createAttempt(options: CreatePaperExperimentAttemptOptions, parentAttemptId: string | null) {
  let state: PaperExperimentState;
  let paths: ExperimentPaths;
  let input: ReturnType<typeof parsePaperExperimentInput>;
  let serializedInput: string;
  try {
    const runtime = paperExperimentRuntimeIdentitySchema.safeParse(options.runtimeIdentity);
    requireExperimentStorage(runtime.success, "INVALID_REQUEST");
    const runtimeIdentity = runtime.data;
    const createdAt = instant(options.createdAt);
    try { input = parsePaperExperimentInput(options.inputJson, { implementationRevision: runtimeIdentity.implementationRevision }); }
    catch { throw new PaperExperimentStorageError("INVALID_REQUEST"); }
    serializedInput = `${JSON.stringify(input.normalizedInput)}\n`;
    requireExperimentStorage(Buffer.byteLength(serializedInput, "utf8") <= PAPER_EXPERIMENT_LIMITS.inputBytes, "INVALID_REQUEST");
    const root = await validateLocation(options);
    const attemptId = options.attemptId ?? `exp-${randomUUID()}`;
    paths = attemptPaths(root, attemptId);
    requireExperimentStorage(attemptId !== parentAttemptId, "ATTEMPT_EXISTS");
    state = paperExperimentStateSchema.parse({
      schemaVersion: "paper_experiment_attempt.v1", attemptId, runId: attemptId, parentAttemptId,
      inputHash: input.inputHash, runtimeIdentity, status: "preparing", createdAt,
      startedAt: null, endedAt: null, terminationReason: null, generation: 0, artifactInventory: null
    });
    await ensureExperimentDirectory(root);
    // mkdir without recursive is the cross-process single-winner boundary. Never inspect then reuse.
    try { await mkdir(paths.attemptDir); } catch (error) {
      if (hasFsCode(error, "EEXIST")) throw new PaperExperimentStorageError("ATTEMPT_EXISTS");
      throw error;
    }
    await writeExclusiveExperimentFile(paths.statePath, `${JSON.stringify(state)}\n`);
  } catch (error) { throw storageError(error); }

  let busy = false;
  async function transition(next: PaperExperimentState): Promise<void> {
    const parsed = paperExperimentStateSchema.parse(next);
    const current = await readState(paths, state.attemptId);
    requireExperimentStorage(createReplayResearchHash(current) === createReplayResearchHash(state), "STATE_INVALID");
    await replaceExperimentState(paths.statePath, `${JSON.stringify(parsed)}\n`, randomUUID());
    state = parsed;
  }
  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    requireExperimentStorage(!busy, "STATE_INVALID");
    busy = true;
    try { return await operation(); } catch (error) { throw storageError(error); }
    finally { busy = false; }
  }
  async function fail(reason: "preparation_failed" | "execution_failed" | "artifact_integrity_failed", at: Date) {
    requireExperimentStorage(!["completed", "failed"].includes(state.status), "STATE_INVALID");
    await transition({ ...state, status: "failed", endedAt: instant(at), terminationReason: reason,
      generation: state.generation + 1, artifactInventory: null });
  }
  try {
    await assertExperimentPath(paths.attemptDir);
    await mkdir(paths.inputDir);
    await writeExclusiveExperimentFile(paths.inputPath, serializedInput);
    await writeExclusiveExperimentFile(paths.sourcePath, input.normalizedInput.source.snapshots.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await mkdir(paths.replayDir);
    await verifyExperimentInput(paths, state);
    await assertEmptyExperimentDirectory(paths.replayDir);
    await transition({ ...state, status: "prepared", generation: state.generation + 1 });
  } catch (error) {
    // Retain all partial artifacts. Failure-record failure never creates a completed marker.
    try { await fail("preparation_failed", options.createdAt); } catch { /* Read-only inspection reports incomplete. */ }
    throw storageError(error);
  }
  return Object.freeze({
    attemptId: state.attemptId,
    runId: state.runId,
    paths,
    input,
    start: (at: Date) => exclusive(async () => {
      requireExperimentStorage(state.status === "prepared", "STATE_INVALID");
      await verifyExperimentInput(paths, state);
      await assertEmptyExperimentDirectory(paths.replayDir);
      await transition({ ...state, status: "running", startedAt: instant(at), generation: state.generation + 1 });
    }),
    complete: (at: Date) => exclusive(async () => {
      requireExperimentStorage(state.status === "running", "STATE_INVALID");
      const artifactInventory = await captureExperimentInventory(paths, state);
      await transition({ ...state, status: "completed", endedAt: instant(at), terminationReason: "completed",
        generation: state.generation + 1, artifactInventory });
    }),
    fail: (reason: "execution_failed" | "artifact_integrity_failed", at: Date) => exclusive(() => fail(reason, at))
  });
}
