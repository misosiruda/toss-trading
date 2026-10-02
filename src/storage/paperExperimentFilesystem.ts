import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export type PaperExperimentStorageCode =
  | "INVALID_REQUEST" | "PATH_UNSAFE" | "PATH_OVERLAP" | "ATTEMPT_EXISTS"
  | "IO_FAILURE" | "INPUT_INTEGRITY" | "ARTIFACT_INTEGRITY" | "STATE_INVALID"
  | "REPLAY_NOT_EMPTY" | "RUNTIME_MISMATCH";

export class PaperExperimentStorageError extends Error {
  constructor(readonly code: PaperExperimentStorageCode) {
    super(`Paper experiment storage failed: ${code}`);
    this.name = "PaperExperimentStorageError";
  }
}

export function requireExperimentStorage(
  condition: unknown, code: PaperExperimentStorageCode
): asserts condition {
  if (!condition) throw new PaperExperimentStorageError(code);
}

export function storageError(error: unknown): PaperExperimentStorageError {
  return error instanceof PaperExperimentStorageError
    ? error : new PaperExperimentStorageError("IO_FAILURE");
}

export function hasFsCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Reject aliases instead of silently resolving them. No hostile-writer/OS sandbox claim. */
export async function assertExperimentPath(path: string, allowMissing = false): Promise<void> {
  let current = parse(resolve(path)).root;
  for (const part of resolve(path).slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      requireExperimentStorage(!info.isSymbolicLink(), "PATH_UNSAFE");
      if (current !== resolve(path)) requireExperimentStorage(info.isDirectory(), "PATH_UNSAFE");
    } catch (error) {
      if (allowMissing && hasFsCode(error, "ENOENT")) return;
      throw error;
    }
  }
}

export function assertExperimentPathSyntax(path: string): void {
  requireExperimentStorage(typeof path === "string" && path.length > 0
    && !path.includes("\0") && (sep === "\\" || !path.includes("\\"))
    && !path.split(/[\\/]/).includes(".."), "PATH_UNSAFE");
}

export function experimentPathsOverlap(left: string, right: string): boolean {
  function inside(child: string, parent: string) {
    const suffix = relative(resolve(parent), resolve(child));
    return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
  }
  return inside(left, right) || inside(right, left);
}

export async function ensureExperimentDirectory(path: string): Promise<void> {
  await assertExperimentPath(path, true);
  try {
    requireExperimentStorage((await lstat(path)).isDirectory(), "PATH_UNSAFE");
  } catch (error) {
    if (!hasFsCode(error, "ENOENT")) throw error;
    await ensureExperimentDirectory(dirname(path));
    try { await mkdir(path); } catch (createError) {
      if (!hasFsCode(createError, "EEXIST")) throw createError;
    }
    await assertExperimentPath(path);
    requireExperimentStorage((await lstat(path)).isDirectory(), "PATH_UNSAFE");
  }
}

export async function assertEmptyExperimentDirectory(path: string): Promise<void> {
  await assertExperimentPath(path);
  requireExperimentStorage((await lstat(path)).isDirectory(), "PATH_UNSAFE");
  requireExperimentStorage((await readdir(path)).length === 0, "REPLAY_NOT_EMPTY");
}

export async function readExperimentFile(path: string, maxBytes: number): Promise<string> {
  await assertExperimentPath(path);
  const before = await lstat(path);
  requireExperimentStorage(before.isFile() && before.nlink === 1 && before.size <= maxBytes, "ARTIFACT_INTEGRITY");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    requireExperimentStorage(opened.isFile() && opened.nlink === 1 && opened.dev === before.dev
      && opened.ino === before.ino && opened.size <= maxBytes, "ARTIFACT_INTEGRITY");
    // Bounded allocation also handles a file growing after stat. Do not use readFile's unbounded allocation.
    const buffer = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    requireExperimentStorage(used <= maxBytes, "ARTIFACT_INTEGRITY");
    const after = await handle.stat();
    requireExperimentStorage(after.size === used && after.mtimeMs === opened.mtimeMs, "ARTIFACT_INTEGRITY");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used));
    } catch { throw new PaperExperimentStorageError("ARTIFACT_INTEGRITY"); }
  } finally {
    await handle.close();
  }
}

export async function writeExclusiveExperimentFile(path: string, text: string): Promise<void> {
  await assertExperimentPath(dirname(path));
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function replaceExperimentState(path: string, text: string, nonce: string): Promise<void> {
  await assertExperimentPath(path);
  const existing = await lstat(path);
  requireExperimentStorage(existing.isFile() && existing.nlink === 1, "PATH_UNSAFE");
  const temporary = `${path}.${nonce}.tmp`;
  await writeExclusiveExperimentFile(temporary, text);
  await assertExperimentPath(path);
  await assertExperimentPath(temporary);
  await rename(temporary, path);
  // Failed temporary files are deliberately retained, never removed by reader or writer recovery.
}
