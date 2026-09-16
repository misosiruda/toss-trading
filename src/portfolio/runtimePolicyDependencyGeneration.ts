import type { BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { createImmutablePolicyDependencyPaths, loadConsistentImmutablePolicyDependencies,
  type ImmutablePolicyDependencyRawGeneration, type LoadedImmutablePolicyDependencies } from "./runtimePolicyDependencyFiles.js";

interface Source { path: string; handle: FileHandle; stat: BigIntStats; bytes: Buffer }

/** A checked byte generation, not a writer lock or a reusable execution lease.
 * The consumer must verify immediately before and after dependent persistence while holding its own locks.
 * Changes are rejected, not repaired; a post-write rejection leaves destination bytes for normal strict recovery.
 */
export async function withDurablePolicyDependencies<T>(baseDir: string,
  operation: (dependencies: LoadedImmutablePolicyDependencies, verify: () => Promise<void>) => Promise<T>): Promise<T> {
  const directory = resolve(baseDir), paths = createImmutablePolicyDependencyPaths(directory);
  const handles: FileHandle[] = [], sources: Array<Source | { path: string; handle: null }> = [];
  let active = true;
  try {
    const reads: Partial<ImmutablePolicyDependencyRawGeneration> = {};
    for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
      const path = paths[key];
      let handle: FileHandle;
      try { handle = await open(path, "r+"); }
      catch (error) {
        if (!isMissing(error)) throw error;
        sources.push({ path, handle: null }); reads[key] = { records: [], corruptLineCount: 0 }; continue;
      }
      handles.push(handle);
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n) throw new Error("policy dependency source must be a regular single-link file");
      const bytes = await handle.readFile();
      await handle.sync();
      if (stat.size !== BigInt(bytes.length) || !sameStat(stat, await handle.stat({ bigint: true }))) throw changed();
      sources.push({ path, handle, stat, bytes });
      const raw = bytes.toString("utf8");
      if (!Buffer.from(raw, "utf8").equals(bytes) || (raw.length > 0 && !raw.endsWith("\n"))) {
        throw new Error("policy dependency source has invalid UTF-8 or a torn final line");
      }
      // Preserve the existing loader's blank-line/CRLF compatibility, but never omit malformed JSON.
      reads[key] = { records: raw.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line)), corruptLineCount: 0 };
    }
    await syncDirectory(directory);
    const verify = async () => {
      if (!active) throw new Error("policy dependency generation observation has expired");
      for (const source of sources) await verifySource(source);
    };
    await verify();
    // All seven keys were captured above. Validation/replay consumes those exact bytes, not a second path read.
    const dependencies = await loadConsistentImmutablePolicyDependencies({
      readGeneration: async () => reads as ImmutablePolicyDependencyRawGeneration
    });
    return await operation(dependencies, verify);
  } finally {
    active = false;
    const closed = await Promise.allSettled(handles.map((handle) => handle.close()));
    const errors = closed.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason);
    if (errors.length) throw new AggregateError(errors, "policy dependency generation close failed");
  }
}

async function verifySource(source: Source | { path: string; handle: null }) {
  let namedStat;
  try { namedStat = await lstat(source.path); }
  catch (error) { if (source.handle === null && isMissing(error)) return; throw error; }
  if (source.handle === null || namedStat.isSymbolicLink() || !namedStat.isFile()) throw changed();
  const before = await source.handle.stat({ bigint: true });
  if (!sameStat(source.stat, before)) throw changed();
  const bytes = Buffer.alloc(source.bytes.length);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await source.handle.read(bytes, offset, bytes.length - offset, offset);
    if (bytesRead === 0) throw changed();
    offset += bytesRead;
  }
  const after = await source.handle.stat({ bigint: true });
  // Descriptor-to-descriptor comparison avoids Windows pathname stat dev=0.
  const named = await open(source.path, "r");
  try {
    if (!bytes.equals(source.bytes) || !sameStat(source.stat, after) || !sameStat(source.stat, await named.stat({ bigint: true }))) throw changed();
  } finally { await named.close(); }
}

function sameStat(left: BigIntStats, right: BigIntStats) {
  return right.isFile() && left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}
function changed() { return new Error("policy dependency source changed during snapshot publication"); }
function isMissing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function syncDirectory(path: string) {
  let handle: FileHandle;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown) {
  return process.platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM";
}
